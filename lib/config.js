import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { validPasswordHash } from './passwords.js';

export function readConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('NODE_ENV must be development, test, or production.');
  const production = nodeEnv === 'production';
  if (production && !env.APP_URL) throw new Error('Set APP_URL in production.');
  const url = new URL(env.APP_URL || 'http://localhost:3000');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('APP_URL must be an HTTP(S) origin without a path or credentials.');
  }
  if (production && url.protocol !== 'https:') throw new Error('Production APP_URL must use HTTPS.');
  const secret = env.COOKIE_SECRET || randomBytes(32).toString('hex');
  if (production && (!env.COOKIE_SECRET || secret.length < 32)) throw new Error('Set COOKIE_SECRET to at least 32 random characters.');
  const adUrl = env.ADSTERRA_DIRECT_LINK || '';
  if (adUrl) {
    const ad = new URL(adUrl);
    if (ad.protocol !== 'https:' || ad.username || ad.password) throw new Error('ADSTERRA_DIRECT_LINK must be an HTTPS URL without credentials.');
  }
  const nativeAdScript = env.ADSTERRA_NATIVE_SCRIPT || '';
  const nativeAdContainer = env.ADSTERRA_NATIVE_CONTAINER || '';
  if (Boolean(nativeAdScript) !== Boolean(nativeAdContainer)) {
    throw new Error('Set both ADSTERRA_NATIVE_SCRIPT and ADSTERRA_NATIVE_CONTAINER, or leave both empty.');
  }
  if (nativeAdScript) {
    const script = new URL(nativeAdScript);
    if (script.protocol !== 'https:' || script.username || script.password) {
      throw new Error('ADSTERRA_NATIVE_SCRIPT must be an HTTPS URL without credentials.');
    }
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(nativeAdContainer)) {
      throw new Error('ADSTERRA_NATIVE_CONTAINER contains unsupported characters.');
    }
  }
  const port = Number(env.PORT || 3000);
  const ownerPasswordHash = env.OWNER_PASSWORD_HASH || '';
  if (!['0', '1'].includes(env.TRUST_PROXY || '0')) throw new Error('TRUST_PROXY must be 0 or 1.');
  if (ownerPasswordHash && !validPasswordHash(ownerPasswordHash)) throw new Error('Invalid OWNER_PASSWORD_HASH. Run npm run setup-owner.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  return {
    production, origin: url.origin, secret, adUrl,
    nativeAd: nativeAdScript ? { scriptUrl: nativeAdScript, containerId: nativeAdContainer } : null,
    port, ownerPasswordHash,
    host: env.HOST || '127.0.0.1',
    databasePath: path.resolve(env.DATABASE_PATH || './data/pastes.sqlite'),
    trustProxy: env.TRUST_PROXY === '1',
    maxBytes: 128 * 1024, waitMs: 3000,
  };
}
