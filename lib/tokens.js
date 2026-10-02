import { createHmac, timingSafeEqual } from 'node:crypto';

export function tokens(secret) {
  const sign = value => createHmac('sha256', secret).update(value).digest('base64url');
  return {
    issue(payload) {
      const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${data}.${sign(data)}`;
    },
    read(token) {
      if (typeof token !== 'string' || token.length > 2048) return null;
      const parts = token.split('.');
      if (parts.length !== 2) return null;
      const expected = Buffer.from(sign(parts[0]));
      const received = Buffer.from(parts[1]);
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
      try {
        const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
        return data && Number.isFinite(data.exp) && data.exp > Date.now() ? data : null;
      } catch { return null; }
    },
  };
}
