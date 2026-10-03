import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function ownerAuth(config, db) {
  const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'strict', path: '/' };
  const digest = value => createHash('sha256').update(value).digest('hex');
  const version = digest(config.ownerPasswordHash || 'not-configured');
  const lookup = db.prepare('SELECT * FROM owner_sessions WHERE token_hash = ? AND expires_at > ? AND password_version = ?');
  const middleware = (req, res, next) => {
    const token = req.cookies.folio_owner;
    req.owner = typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? lookup.get(digest(token), Date.now(), version) : null;
    res.locals.isOwner = Boolean(req.owner);
    res.locals.ownerCsrf = req.owner?.csrf || '';
    next();
  };
  const requireOwner = (req, res, next) => {
    if (req.owner) return next();
    if (req.method === 'GET') return res.redirect(302, '/owner/login');
    return res.status(401).render('error', { title: 'Sign-in required', message: 'Only the site owner can create or manage pastes.', back: '/owner/login' });
  };
  const csrf = (req, res, next) => {
    const actual = typeof req.body?._csrf === 'string' ? Buffer.from(req.body._csrf) : Buffer.alloc(0);
    const expected = Buffer.from(req.owner?.csrf || '');
    if (!req.owner || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return res.status(403).render('error', { title: 'Please refresh this page', message: 'The form has expired. Open the page again before submitting.', back: '/owner' });
    }
    next();
  };
  return {
    middleware, requireOwner, csrf,
    login(res) {
      const token = randomBytes(32).toString('hex');
      const expires = Date.now() + 12 * 60 * 60_000;
      db.prepare('DELETE FROM owner_sessions WHERE expires_at <= ? OR password_version != ?').run(Date.now(), version);
      db.prepare('INSERT INTO owner_sessions (token_hash, csrf, expires_at, password_version) VALUES (?, ?, ?, ?)')
        .run(digest(token), randomBytes(32).toString('hex'), expires, version);
      res.cookie('folio_owner', token, { ...cookieOptions, maxAge: 12 * 60 * 60_000 });
    },
    logout(req, res) {
      db.prepare('DELETE FROM owner_sessions WHERE token_hash = ?').run(req.owner.token_hash);
      res.clearCookie('folio_owner', cookieOptions);
    },
  };
}
