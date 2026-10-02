import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { tokens } from '../lib/tokens.js';

export function pasteRoutes(config, db) {
  const router = Router();
  const codec = tokens(config.secret);
  const insert = db.prepare('INSERT OR IGNORE INTO pastes (id, title, content, created_at) VALUES (?, ?, ?, ?)');
  const metadata = db.prepare('SELECT id, title, created_at FROM pastes WHERE id = ?');
  const content = db.prepare('SELECT * FROM pastes WHERE id = ?');
  const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'lax' };
  const showHome = (res, error = '', values = {}) => res.render('home', { page: 'home', title: 'A little space for your text', error, values });
  const fail = (res, status, title, message, back) => res.status(status).render('error', { title, message, back });
  const hasAccess = (req, id) => {
    const grant = codec.read(req.cookies.folio_access);
    return grant?.kind === 'access' && grant.id === id && grant.sid === req.cookies.folio_sid;
  };
  router.get('/', (_req, res) => showHome(res));
  router.post('/pastes', rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, res) => fail(res, 429, 'A moment, please', 'You have reached the creation limit. Please try again in 15 minutes.', '/'),
  }), (req, res) => {
    const text = req.body?.content;
    const title = req.body?.title ?? '';
    if (typeof text !== 'string' || typeof title !== 'string') return fail(res, 400, 'Invalid paste', 'Please send text and an optional title.', '/');
    const values = { content: text, title: title.slice(0, 120) };
    if (!text.trim()) return showHome(res.status(422), 'Your paste needs a little text first.', values);
    if (Buffer.byteLength(text, 'utf8') > config.maxBytes || title.length > 120) {
      return showHome(res.status(422), 'Use a title under 120 characters and text under 128 KB.', values);
    }
    let id;
    for (let attempt = 0; attempt < 5; attempt++) {
      id = randomBytes(9).toString('base64url');
      if (insert.run(id, title.trim(), text, Date.now()).changes) return res.redirect(303, `/created/${id}`);
    }
    throw new Error('Could not allocate paste ID');
  });
  router.param('id', (req, res, next, id) => {
    const paste = /^[A-Za-z0-9_-]{12}$/.test(id) ? metadata.get(id) : null;
    if (!paste) return fail(res, 404, 'Paste not found', 'This link is incomplete, or the paste has been removed.', '/');
    req.paste = paste;
    next();
  });
  router.get('/created/:id', (req, res) => res.render('created', {
    title: 'Ready to pass along', paste: req.paste, shareUrl: `${config.origin}/p/${req.paste.id}`,
  }));
  router.get('/p/:id', (req, res) => {
    const { id } = req.paste;
    if (hasAccess(req, id)) return res.redirect(302, `/p/${id}/view`);
    let sid = req.cookies.folio_sid;
    if (typeof sid !== 'string' || !/^[a-f0-9]{48}$/.test(sid)) sid = randomBytes(24).toString('hex');
    res.cookie('folio_sid', sid, { ...cookieOptions, path: '/', maxAge: 24 * 60 * 60_000 });
    const now = Date.now();
    const token = codec.issue({ kind: 'bridge', id, sid, nbf: now + config.waitMs, exp: now + 15 * 60_000 });
    res.render('bridge', { title: 'Your paste is ready', paste: req.paste, token, waitMs: config.waitMs, adUrl: config.adUrl });
  });
  router.post('/p/:id/unlock', (req, res) => {
    const token = codec.read(req.body?.token);
    const { id } = req.paste;
    if (token?.kind !== 'bridge' || token.id !== id || token.sid !== req.cookies.folio_sid) {
      return fail(res, 403, 'Let’s try that again', 'This page expired, or cookies are disabled. Enable cookies and open the gateway again.', `/p/${id}`);
    }
    if (!Number.isFinite(token.nbf) || token.nbf > Date.now()) {
      res.set('Retry-After', '3');
      return fail(res, 425, 'Almost there', 'Please wait three seconds on the gateway before continuing.', `/p/${id}`);
    }
    res.cookie('folio_access', codec.issue({ kind: 'access', id, sid: token.sid, exp: Date.now() + 60 * 60_000 }), {
      ...cookieOptions, path: `/p/${id}`, maxAge: 60 * 60_000,
    });
    res.redirect(303, `/p/${id}/view`);
  });
  const requireAccess = (req, res, next) => hasAccess(req, req.paste.id) ? next() : res.redirect(302, `/p/${req.paste.id}`);
  router.get('/p/:id/view', requireAccess, (req, res) => {
    const paste = content.get(req.paste.id);
    res.render('viewer', { title: paste.title || 'Untitled paste', paste, shareUrl: `${config.origin}/p/${paste.id}`,
      byteSize: Buffer.byteLength(paste.content, 'utf8'), lineCount: paste.content.split('\n').length,
    });
  });
  router.get('/p/:id/raw', requireAccess, (req, res) => {
    res.type('text/plain').send(content.get(req.paste.id).content);
  });
  router.get('/p/:id/download', requireAccess, (req, res) => {
    res.attachment(`paste-${req.paste.id}.txt`).type('text/plain').send(content.get(req.paste.id).content);
  });
  return router;
}
