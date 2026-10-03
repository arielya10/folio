import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { hashPassword } from '../lib/passwords.js';

if (!process.stdin.isTTY) {
  console.error('Run npm run setup-owner in an interactive terminal. Password input is hidden.');
  process.exit(1);
}
const silent = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
const rl = createInterface({ input: process.stdin, output: silent, terminal: true });
rl.on('SIGINT', () => { rl.close(); process.stdout.write('\nCancelled.\n'); process.exit(1); });
const ask = prompt => new Promise(resolve => {
  process.stdout.write(prompt);
  rl.question('', value => { process.stdout.write('\n'); resolve(value); });
});
try {
  const password = await ask('Choose an owner password (at least 12 characters; input hidden): ');
  const confirmation = await ask('Confirm password: ');
  if (password.length < 12 || password.length > 1024) throw new Error('Use between 12 and 1024 characters.');
  if (password !== confirmation) throw new Error('Passwords did not match.');
  let env;
  try { env = await readFile('.env', 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; env = await readFile('.env.example', 'utf8'); }
  const set = (name, value) => {
    const pattern = new RegExp(`^${name}=.*$`, 'm');
    env = pattern.test(env) ? env.replace(pattern, `${name}=${value}`) : `${env.trimEnd()}\n${name}=${value}\n`;
  };
  set('OWNER_PASSWORD_HASH', await hashPassword(password));
  if (!/^COOKIE_SECRET=\S{32,}/m.test(env)) set('COOKIE_SECRET', randomBytes(32).toString('hex'));
  await writeFile('.env', env, { mode: 0o600 });
  console.log('Owner password saved as a salted scrypt hash in .env. Restart the app, then open /owner/login.');
  console.log('Changing this password invalidates existing owner sessions after restart.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { rl.close(); }
