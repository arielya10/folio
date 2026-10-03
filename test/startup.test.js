import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('occupied port reports a startup failure instead of a false listening message', { timeout: 15000 }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'folio-startup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const blocker = createServer();
  blocker.listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  t.after(() => blocker.close());
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    env: { ...process.env, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(blocker.address().port),
      APP_URL: 'http://localhost:3000', OWNER_PASSWORD_HASH: '', ADSTERRA_DIRECT_LINK: '', DATABASE_PATH: path.join(directory, 'pastes.sqlite') },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const [code] = await once(child, 'close');
  assert.equal(code, 1);
  assert.match(output, /already in use/);
  assert.doesNotMatch(output, /Folio is listening/);
});
