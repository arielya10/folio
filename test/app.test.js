import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createApp } from '../app.js';
import { openDatabase } from '../lib/database.js';
import { readConfig } from '../lib/config.js';
import { tokens } from '../lib/tokens.js';
import { hashPassword } from '../lib/passwords.js';

const ownerPassword = 'test-only-owner-password';
const ownerHash = await hashPassword(ownerPassword);
test('browser scripts parse so countdowns and form controls can initialize', () => {
  for (const script of ['app.js', 'theme.js']) {
    assert.doesNotThrow(() => new vm.Script(readFileSync(new URL(`../public/${script}`, import.meta.url), 'utf8')));
  }
});
const sessions = new WeakMap();
async function signIn(agent) {
  if (sessions.has(agent)) return sessions.get(agent);
  await agent.post('/owner/login').type('form').send({ password: ownerPassword }).expect(303);
  const page = await agent.get('/owner/new').expect(200);
  const csrf = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  sessions.set(agent, csrf);
  return csrf;
}

function setup(t, overrides = {}) {
  const config = { ...readConfig({ COOKIE_SECRET: 'test-secret-that-is-at-least-32-characters', OWNER_PASSWORD_HASH: ownerHash }), ...overrides };
  const db = openDatabase(':memory:');
  const app = createApp(config, db);
  t.after(() => db.close());
  return { app, db, config };
}
const extractToken = html => html.match(/name="token" value="([^"]+)"/)[1];
async function create(agent, content = 'A useful little note.', title = 'A note') {
  const _csrf = await signIn(agent);
  const result = await agent.post('/pastes').type('form').send({ title, content, _csrf }).expect(303);
  return result.headers.location.split('/').at(-1);
}

test('full flow: persistence, actual countdown, browser binding, escaped rendering, protected raw/download', async t => {
  const { app, db } = setup(t);
  const reader = request.agent(app);
  const text = '<script>alert("not executable")</script>\nhello & goodbye\n  indentation';
  const writer = request.agent(app);
  const id = await create(writer, text, '<img src=x onerror=alert(1)>');
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
  const other = await create(writer);
  await reader.get(`/p/${other}/view`).expect(302);
});

test('invalid input, multibyte limits, missing paste and cross-origin protection', async t => {
  const { app } = setup(t);
  const writer = request.agent(app);
  const _csrf = await signIn(writer);
  await writer.post('/pastes').type('form').send({ content: '   ', _csrf }).expect(422);
  await writer.post('/pastes').type('form').send({ content: '📝'.repeat(32769), _csrf }).expect(422);
  await writer.post('/pastes').type('form').send({ content: 'ok', title: 'x'.repeat(121), _csrf }).expect(422);
  await writer.post('/pastes').type('form').send({ content: ['a', 'b'], _csrf }).expect(400);
  await writer.post('/pastes').type('form').send({ content: 'ok', expiresIn: '-1', _csrf }).expect(422);
  await writer.post('/pastes').type('form').send({ content: 'ok', expiryHours: '0', _csrf }).expect(422);
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
  const writer = request.agent(app);
  const _csrf = await signIn(writer);
  for (let i = 0; i < 20; i++) await create(writer);
  const response = await writer.post('/pastes').type('form').send({ content: 'limited', _csrf }).expect(429);
  assert.ok(response.headers['retry-after']);
});

test('expired tokens fail closed and production configuration validates URLs and secrets', () => {
  const codec = tokens('secret');
  assert.equal(codec.read(codec.issue({ exp: Date.now() - 1 })), null);
  assert.equal(codec.read('broken.token'), null);
  assert.throws(() => readConfig({ NODE_ENV: 'staging' }), /NODE_ENV/);
  assert.throws(() => readConfig({ NODE_ENV: 'production' }), /APP_URL/);
  assert.throws(() => readConfig({ NODE_ENV: 'production', APP_URL: 'https://example.com' }), /COOKIE_SECRET/);
  assert.throws(() => readConfig({ TRUST_PROXY: '2' }), /TRUST_PROXY/);
  assert.throws(() => readConfig({ ADSTERRA_DIRECT_LINK: 'javascript:alert(1)' }), /HTTPS/);
  assert.throws(() => readConfig({ ADSTERRA_NATIVE_SCRIPT: 'https://ads.example/unit' }), /both/);
  assert.throws(() => readConfig({ ADSTERRA_NATIVE_SCRIPT: 'javascript:alert(1)', ADSTERRA_NATIVE_CONTAINER: 'unit' }), /HTTPS/);
  assert.throws(() => readConfig({ ADSTERRA_NATIVE_SCRIPT: 'https://ads.example/unit', ADSTERRA_NATIVE_CONTAINER: '<unit>' }), /unsupported/);
  assert.throws(() => readConfig({ APP_URL: 'https://example.com/subpath' }), /origin/);
});

test('sponsor configuration requires a popup and renders no bypass control or external script', async t => {
  const { app } = setup(t, { adUrl: 'https://example.com/sponsor?key=test' });
  const agent = request.agent(app);
  const id = await create(agent);
  const bridge = await request(app).get(`/p/${id}`).expect(200);
  assert.ok(bridge.text.includes('Continuing opens a sponsor in a new tab. Pop-ups must be allowed.'));
  assert.ok(bridge.text.includes('id="proceed-button" disabled'));
  assert.ok(bridge.text.includes('id="sponsor-error"'));
  assert.ok(!bridge.text.includes('Continue without it'));
  assert.ok(!bridge.text.includes('<script src="https://'));
});

test('native banner renders only for public viewers and extends CSP to its reviewed origin', async t => {
  const nativeAd = { scriptUrl: 'https://ads.example/native/unit', containerId: 'native-unit' };
  const { app } = setup(t, { nativeAd, waitMs: 10 });
  const owner = request.agent(app);
  const id = await create(owner);

  const ownerView = await owner.get(`/p/${id}/view`).expect(200);
  assert.ok(!ownerView.text.includes('https://ads.example/native/unit'));

  const reader = request.agent(app);
  const bridge = await reader.get(`/p/${id}`).expect(200);
  await new Promise(resolve => setTimeout(resolve, 20));
  await reader.post(`/p/${id}/unlock`).type('form').send({ token: extractToken(bridge.text) }).expect(303);
  const viewer = await reader.get(`/p/${id}/view`).expect(200);
  assert.ok(viewer.text.includes('https://ads.example/native/unit'));
  assert.ok(viewer.text.includes('id="native-unit"'));
  assert.ok(viewer.text.includes('data-adblock-notice'));
  assert.ok(viewer.text.includes('pause it for Folio'));
  assert.match(viewer.headers['content-security-policy'], /script-src 'self' https:\/\/ads\.example/);
});

test('theme bootstrap falls back safely without browser storage or matchMedia support', () => {
  const source = readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8');
  const document = { documentElement: { dataset: {}, style: {} } };
  const context = {
    document,
    localStorage: { getItem: () => { throw new Error('storage unavailable'); }, setItem: () => {} },
    matchMedia: undefined,
    window: { matchMedia: undefined }
  };
  assert.doesNotThrow(() => vm.runInNewContext(source, context));
  assert.equal(document.documentElement.dataset.theme, 'light');
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

test('owner-only publishing and library, CSRF, safe logout and manual deletion', async t => {
  const { app, db } = setup(t);
  await request(app).post('/pastes').type('form').send({ content: 'unauthorized' }).expect(401);
  await request(app).get('/owner').expect(302).expect('Location', '/owner/login');
  await request(app).get('/owner/new').expect(302);
  const landing = await request(app).get('/').expect(200);
  assert.ok(!landing.text.includes('id="paste-form"'));
  const writer = request.agent(app);
  await writer.post('/owner/login').type('form').send({ password: 'wrong' }).expect(401);
  const csrf = await signIn(writer);
  await writer.post('/pastes').type('form').send({ content: 'missing csrf' }).expect(403);
  const id = await create(writer, 'owner text', 'Private library entry');
  const dashboard = await writer.get('/owner').expect(200);
  assert.ok(dashboard.text.includes('Private library entry'));
  assert.ok(dashboard.text.includes('data-expires-at'));
  // The owner can preview without an ad or visitor gateway.
  await writer.get(`/p/${id}/view`).expect(200);
  await request(app).post(`/owner/pastes/${id}/delete`).expect(401);
  await writer.post(`/owner/pastes/${id}/delete`).type('form').send({ _csrf: 'wrong' }).expect(403);
  await writer.post(`/owner/pastes/${id}/delete`).type('form').send({ _csrf: csrf }).expect(303);
  assert.equal(db.prepare('SELECT id FROM pastes WHERE id = ?').get(id), undefined);
  await request(app).get(`/p/${id}`).expect(404);
  await writer.post('/owner/logout').type('form').send({ _csrf: csrf }).expect(303);
  await writer.get('/owner').expect(302);
  await writer.post('/pastes').type('form').send({ content: 'logged out', _csrf: csrf }).expect(401);
});

test('time limits: defaults, custom hours, no expiry, expired links and previously unlocked visitors', async t => {
  const { app, db } = setup(t, { waitMs: 0 });
  const writer = request.agent(app);
  const csrf = await signIn(writer);
  const id = await create(writer);
  const saved = db.prepare('SELECT * FROM pastes WHERE id = ?').get(id);
  assert.equal(saved.expires_at - saved.created_at, 86400_000);
  const custom = await writer.post('/pastes').type('form').send({ content: 'custom', expiresIn: '0', expiryHours: '48', _csrf: csrf }).expect(303);
  const customPaste = db.prepare('SELECT * FROM pastes WHERE id = ?').get(custom.headers.location.split('/').at(-1));
  assert.equal(customPaste.expires_at - customPaste.created_at, 48 * 3600_000);
  const never = await writer.post('/pastes').type('form').send({ content: 'forever', expiresIn: '0', _csrf: csrf }).expect(303);
  const neverId = never.headers.location.split('/').at(-1);
  assert.equal(db.prepare('SELECT expires_at FROM pastes WHERE id = ?').get(neverId).expires_at, null);
  const reader = request.agent(app);
  const bridge = await reader.get(`/p/${id}`).expect(200);
  await reader.post(`/p/${id}/unlock`).type('form').send({ token: extractToken(bridge.text) }).expect(303);
  await reader.get(`/p/${id}/view`).expect(200);
  db.prepare('UPDATE pastes SET expires_at = ? WHERE id = ?').run(Date.now() - 1, id);
  for (const suffix of ['', '/view', '/raw', '/download']) await reader.get(`/p/${id}${suffix}`).expect(404);
  assert.equal(db.prepare('SELECT id FROM pastes WHERE id = ?').get(id), undefined);
  await writer.get(`/p/${neverId}/view`).expect(200);
});

test('unconfigured owner account fails closed and password changes invalidate sessions', async t => {
  const disabled = setup(t, { ownerPasswordHash: '' });
  const login = await request(disabled.app).get('/owner/login').expect(200);
  assert.ok(login.text.includes('npm run setup-owner'));
  await request(disabled.app).post('/owner/login').type('form').send({ password: 'anything' }).expect(503);
  await request(disabled.app).post('/pastes').type('form').send({ content: 'no owner' }).expect(401);
  const { app, db, config } = setup(t);
  const signed = await request(app).post('/owner/login').type('form').send({ password: ownerPassword }).expect(303);
  const cookie = signed.headers['set-cookie'][0].split(';')[0];
  const changedApp = createApp({ ...config, ownerPasswordHash: await hashPassword('a-new-owner-password') }, db);
  await request(changedApp).get('/owner').set('Cookie', cookie).expect(302);
});
