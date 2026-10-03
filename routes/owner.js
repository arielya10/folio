import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { verifyPassword } from '../lib/passwords.js';

export function ownerRoutes(config, db, auth) {
  const router = Router();
  const loginView = (res, error = '') => res.render('login', { title: 'Your space, your words', configured: Boolean(config.ownerPasswordHash), error });
  router.get('/owner/login', (req, res) => req.owner ? res.redirect('/owner') : loginView(res));
  router.post('/owner/login', rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, res) => loginView(res.status(429), 'Too many sign-in attempts. Please try again in 15 minutes.'),
  }), async (req, res) => {
    if (!config.ownerPasswordHash) return loginView(res.status(503), 'Sign-in has not been configured yet.');
    if (!await verifyPassword(req.body?.password, config.ownerPasswordHash)) return loginView(res.status(401), 'That password did not match. Please try again.');
    auth.login(res);
    res.redirect(303, '/owner');
  });
  router.post('/owner/logout', auth.requireOwner, auth.csrf, (req, res) => {
    auth.logout(req, res);
    res.redirect(303, '/owner/login');
  });
  router.get('/owner', auth.requireOwner, (req, res) => {
    const total = db.prepare('SELECT COUNT(*) AS count FROM pastes').get().count;
    const pages = Math.max(1, Math.ceil(total / 30));
    const pageNumber = Math.min(pages, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
    const pastes = db.prepare('SELECT id, title, created_at, expires_at FROM pastes ORDER BY created_at DESC, id DESC LIMIT 30 OFFSET ?').all((pageNumber - 1) * 30);
    res.render('dashboard', { title: 'Your pastes', page: 'dashboard', pastes, total, pages, pageNumber, origin: config.origin });
  });
  router.get('/owner/new', auth.requireOwner, (_req, res) => res.render('home', { title: 'Create a paste', page: 'home', error: '', values: {} }));
  router.get('/owner/pastes/:id/delete', auth.requireOwner, (req, res) => {
    const paste = db.prepare('SELECT id, title FROM pastes WHERE id = ?').get(req.params.id);
    if (!paste) return res.redirect('/owner');
    res.render('delete', { title: 'Delete this paste?', paste });
  });
  router.post('/owner/pastes/:id/delete', auth.requireOwner, auth.csrf, (req, res) => {
    db.prepare('DELETE FROM pastes WHERE id = ?').run(req.params.id);
    res.redirect(303, '/owner');
  });
  return router;
}
