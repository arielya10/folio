import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { openDatabase } from '../lib/database.js';
import { readConfig } from '../lib/config.js';
import { tokens } from '../lib/tokens.js';

function setup(t, overrides = {}) {
  const config = { ...readConfig({ COOKIE_SECRET: 'test-secret-that-is-at-least-32-characters' }), ...overrides };
  const db = openDatabase(':memory:');
  const app = createApp(config, db);
  t.after(() => db.close());
  return { app, db, config };
}
const extractToken = html => html.match(/name="token" value="([^"]+)"/)[1];
async function create(agent, content = 'A useful little note.', title = 'A note') {
  const result = await agent.post('/pastes').type('form').send({ title, content }).expect(303);
  return result.headers.location.split('/').at(-1);
}

test('full flow: persistence, actual countdown, browser binding, escaped rendering, protected raw/download', async t => {
  const { app, db } = setup(t);
  const reader = request.agent(app);
  const text = '<script>alert("not executable")</script>\nhello & goodbye\n  indentation';
  const id = await create(reader, text, '<img src=x onerror=alert(1)>');
  assert.match(id, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(db.prepare('SELECT content FROM pastes WHERE id = ?').get(id).content, text);
  for (const suffix of ['view', 'raw', 'download']) {
    const response = await reader.get(`/p/${id}/${suffix}`).expect(302);
    assert.equal(response.headers.location, `/p/${id}`);
    assert.ok(!response.text.includes(text));
  }
  const bridge = await reader.get(`/p/${id}`).expect(200);
  assert.ok(!bridge.text.includes('not executable'));
  assert.match(bridge.headers['set-cookie'][0], /HttpOnly; SameSite=Lax/);
  const token = extractToken(bridge.text);
  await reader.post(`/p/${id}/unlock`).type('form').send({ token }).expect(425);
  await new Promise(resolve => setTimeout(resolve, 3050));
  await request(app).post(`/p/${id}/unlock`).type('form').send({ token }).expect(403);
  await reader.post(`/p/${id}/unlock`).type('form').send({ token: `${token}x` }).expect(403);
  await reader.post(`/p/${id}/unlock`).type('form').send({ token }).expect(303);
  const viewer = await reader.get(`/p/${id}/view`).expect(200);
  assert.ok(viewer.text.includes('&lt;script&gt;'));
  assert.ok(!viewer.text.includes('<img src=x'));
  assert.equal(viewer.headers['cache-control'], 'no-store');
  // no-referrer can cause browsers to send Origin: null on native POST forms.
  assert.equal(viewer.headers['referrer-policy'], 'same-origin');
  assert.match(viewer.headers['content-security-policy'], /script-src 'self'/);
  const raw = await reader.get(`/p/${id}/raw`).expect(200);
  assert.equal(raw.text, text);
  assert.match(raw.headers['content-type'], /^text\/plain/);
  const download = await reader.get(`/p/${id}/download`).expect(200);
  assert.match(download.headers['content-disposition'], /attachment/);
  assert.equal(download.text, text);
  // A grant for one paste must not unlock another paste.
  const other = await create(reader);
  await reader.get(`/p/${other}/view`).expect(302);
});

test('invalid input, multibyte limits, missing paste and cross-origin protection', async t => {
  const { app } = setup(t);
  await request(app).post('/pastes').type('form').send({ content: '   ' }).expect(422);
  await request(app).post('/pastes').type('form').send({ content: '📝'.repeat(32769) }).expect(422);
  await request(app).post('/pastes').type('form').send({ content: 'ok', title: 'x'.repeat(121) }).expect(422);
  await request(app).post('/pastes').type('form').send({ content: ['a', 'b'] }).expect(400);
  await request(app).post('/pastes').set('Origin', 'https://attacker.example').type('form').send({ content: 'ok' }).expect(403);
  await request(app).post('/pastes').set('Sec-Fetch-Site', 'cross-site').type('form').send({ content: 'ok' }).expect(403);
  await request(app).get('/p/bad-id').expect(404);
  await request(app).get('/p/aaaaaaaaaaaa').expect(404);
  await request(app).get('/data/pastes.sqlite').expect(404);
  await request(app).get('/.env').expect(404);
  await request(app).get('/healthz').expect(200, { status: 'ok' });
});

test('rate limiting prevents unlimited creation', async t => {
  const { app } = setup(t);
  for (let i = 0; i < 20; i++) await create(request(app));
  const response = await request(app).post('/pastes').type('form').send({ content: 'limited' }).expect(429);
  assert.ok(response.headers['retry-after']);
});

test('expired tokens fail closed and production configuration validates URLs and secrets', () => {
  const codec = tokens('secret');
  assert.equal(codec.read(codec.issue({ exp: Date.now() - 1 })), null);
  assert.equal(codec.read('broken.token'), null);
  assert.throws(() => readConfig({ NODE_ENV: 'production', APP_URL: 'https://example.com' }), /COOKIE_SECRET/);
  assert.throws(() => readConfig({ ADSTERRA_DIRECT_LINK: 'javascript:alert(1)' }), /HTTPS/);
  assert.throws(() => readConfig({ APP_URL: 'https://example.com/subpath' }), /origin/);
});

test('sponsor configuration renders explicit disclosure and fallback without external script loading', async t => {
  const { app } = setup(t, { adUrl: 'https://example.com/sponsor?key=test' });
  const agent = request.agent(app);
  const id = await create(agent);
  const bridge = await agent.get(`/p/${id}`).expect(200);
  assert.ok(bridge.text.includes('Continuing opens a sponsor in a new tab.'));
  assert.ok(bridge.text.includes('Sponsor blocked? Continue without it'));
  assert.ok(!bridge.text.includes('<script src="https://'));
});

test('SQLite content survives reopening the database', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'folio-test-'));
  const filename = path.join(directory, 'test.sqlite');
  let db;
  try {
    db = openDatabase(filename);
    db.prepare('INSERT INTO pastes (id, content, created_at) VALUES (?, ?, ?)').run('abcdefghijkl', 'persistent text', Date.now());
    db.close();
    db = openDatabase(filename);
    assert.equal(db.prepare('SELECT content FROM pastes WHERE id = ?').get('abcdefghijkl').content, 'persistent text');
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }); }
});
