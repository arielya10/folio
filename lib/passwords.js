import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
export const validPasswordHash = hash => typeof hash === 'string' && /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 1024 || !validPasswordHash(encoded)) return false;
  const [, salt, hex] = encoded.split(':');
  const actual = await derive(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hex, 'hex'));
}
