import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { pasteRoutes } from './routes/pastes.js';
import { ownerAuth } from './lib/owner.js';
import { ownerRoutes } from './routes/owner.js';
import { purgeExpired } from './lib/database.js';

export function createApp(config, db) {
  const app = express();
  Object.assign(app.locals, { page: '', isOwner: false, ownerCsrf: '', assetVersion: Date.now().toString(36) });
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 'loopback');
  app.set('view engine', 'ejs');
  app.set('views', fileURLToPath(new URL('./views', import.meta.url)));
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
      imgSrc: ["'self'"], fontSrc: ["'self'"], connectSrc: ["'self'"],
      formAction: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"],
      baseUri: ["'none'"], manifestSrc: ["'none'"],
      upgradeInsecureRequests: config.production ? [] : null,
    } },
    // Keep same-origin form Origin headers intact; suppress cross-origin referrers.
    referrerPolicy: { policy: 'same-origin' },
    strictTransportSecurity: config.production ? { maxAge: 31536000 } : false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  }));
  app.use('/assets', express.static(fileURLToPath(new URL('./public', import.meta.url)), { maxAge: config.production ? '1h' : 0, dotfiles: 'deny' }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.locals.page = '';
    res.locals.isOwner = false;
    res.locals.ownerCsrf = '';
    next();
  });
  app.get('/healthz', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  });
  app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, res) => res.status(429).render('error', { title: 'A moment, please', message: 'Too many requests. Please try again in a minute.', back: '/' })
  }));
  app.use((req, res, next) => {
    if (req.method === 'POST' && ((req.get('origin') && req.get('origin') !== config.origin) || req.get('sec-fetch-site') === 'cross-site')) {
      return res.status(403).render('error', { title: 'Request not allowed', message: 'Please submit this form from this website.', back: '/' });
    }
    next();
  });
  app.use(express.urlencoded({ extended: false, limit: '1mb', parameterLimit: 10 }));
  app.use(cookieParser());
  app.use((_req, _res, next) => { purgeExpired(db); next(); });
  const auth = ownerAuth(config, db);
  app.use(auth.middleware);
  app.use(ownerRoutes(config, db, auth));
  app.use(pasteRoutes(config, db, auth));
  app.use((_req, res) => res.status(404).render('error', { title: 'Nothing here just yet', message: 'This link is incomplete, or the paste has been removed.', back: '/' }));
  app.use((err, _req, res, _next) => {
    const status = err.type === 'entity.too.large' ? 413 : err.status === 400 ? 400 : 500;
    if (status === 500) console.error('Request failed:', err.code || err.name);
    res.status(status).render('error', {
      title: status === 413 ? 'That paste is too large' : status === 400 ? 'Could not read this request' : 'Something went wrong',
      message: status === 413 ? 'Please keep pastes under 128 KB.' : 'Please go back and try again.', back: '/',
    });
  });
  return app;
}
