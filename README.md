# Folio

A lightweight, self-hosted Pastebin-style application for Node.js 24, Express 5, and SQLite. Only the owner can publish. Visitors read shared links without an account. Includes a private paste library, timed deletion, responsive light/dark UI, and no frontend build step or CDN dependency.

## Run locally

Install Node.js **24.13 or newer within the 24.x line**, then:

```powershell
npm ci
Copy-Item .env.example .env
npm run setup-owner
npm start
```

On Linux/macOS use `cp .env.example .env` instead of `Copy-Item`. Choose your own password in the hidden terminal prompt (at least 12 characters). Open **http://localhost:3000/owner/login** to sign in. `npm run dev` watches the server for changes. `npm test` runs integration tests. If `.env` already exists, keep it instead of copying over it.

## Configuration

`.env.example` documents every supported setting. The defaults are suitable for local development. For production, set `NODE_ENV=production`, use an HTTPS `APP_URL`, and provide a `COOKIE_SECRET` with at least 32 random characters. `npm run setup-owner` writes or updates `OWNER_PASSWORD_HASH` and creates a cookie secret when one is not already present.

| Setting | Purpose | Default |
| --- | --- | --- |
| `NODE_ENV` | Enables production HTTPS and secure-cookie behavior when set to `production` | `development` |
| `HOST` | Network interface for the Node server | `127.0.0.1` |
| `PORT` | Local listening port | `3000` |
| `APP_URL` | Public origin used for links and same-origin form checks; no path or credentials | `http://localhost:3000` |
| `COOKIE_SECRET` | Signs gateway, access, and owner-session tokens | Generated for development; required in production |
| `OWNER_PASSWORD_HASH` | Salted scrypt hash used for the single owner account | Empty, which disables publishing |
| `DATABASE_PATH` | SQLite database file location | `./data/pastes.sqlite` |
| `ADSTERRA_DIRECT_LINK` | Optional HTTPS sponsor link; empty disables advertising | Empty |
| `TRUST_PROXY` | Set to `1` only when using the supplied local Nginx reverse proxy | `0` |

## Owner workspace and timed deletion

- `/owner` lists all your active pastes, newest first, with 30 per page. Open, copy a share link, or delete a paste after a confirmation page. There is no public directory or public registration.
- `/owner/new` creates a paste. The backend requires an owner session and a CSRF token; hiding the public editor is not the access control.
- Choose **1 hour, 24 hours (default), 7 days, 30 days, or Never**, or enter **1–8760 custom hours**. Custom hours override the preset. The timer starts when creation succeeds.
- The dashboard, gateway, confirmation, and viewer display the deletion countdown. Without JavaScript, the exact UTC deletion time is shown instead.
- The server removes expired records at startup, every minute, and before application routes. An expired paste cannot be opened, downloaded, or read as raw text, including by an already-unlocked visitor or the owner. Existing rendered/downloaded copies and backups cannot be recalled.
- Existing databases migrate automatically. Old pastes remain in your private library with **No expiry**; migration does not retroactively delete them.
- Owner sessions last 12 hours and use opaque HttpOnly cookies, SameSite=Strict, and Secure in production. Only SHA-256 session token hashes are stored in SQLite. Passwords are stored as salted scrypt hashes in `.env`. Owner state-changing forms require CSRF tokens. Login is limited to five attempts per IP per 15 minutes.
- With no configured owner password, publishing stays locked; no default password or public setup endpoint exists. Run `npm run setup-owner` to set/reset the owner password, then restart the server. Password changes invalidate earlier owner sessions after restart. Do not share the password or `.env`.
- Owners preview their own pastes directly, without the sponsor gateway. Visitors still pass through it.

Node's built-in `node:sqlite` avoids native package compilation on Oracle AMD or ARM instances. It may print an experimental SQLite warning on the minimum supported Node version; that is expected. By default, the database is created at `data/pastes.sqlite` using WAL mode and parameterized queries; set `DATABASE_PATH` to use another location.

## Structure

```text
server.js                 Process startup and graceful shutdown
app.js                    Express middleware, security headers, error handling
lib/config.js             Environment validation
lib/database.js           SQLite schema and initialization
lib/tokens.js             Signed gateway and access tokens
lib/owner.js              Owner sessions and CSRF checks
lib/passwords.js          Scrypt password hashing and verification
routes/owner.js           Login, private library, logout and deletion
routes/pastes.js           Creation, bridge, unlock, viewer, raw, download routes
views/                    Escaped EJS templates and shared page chrome
public/                   Local CSS, JavaScript, favicon (only public assets)
test/app.test.js          HTTP integration and persistence tests
scripts/backup.js          Consistent online SQLite backup
scripts/delete-paste.js    Owner-operated paste removal
scripts/setup-owner.js     Hidden terminal prompt for owner password setup/reset
deploy/                   Nginx configuration examples
ecosystem.config.cjs       Single-process PM2 configuration
DEPLOYMENT.md             Exact Ubuntu, Oracle, PM2, Nginx and SSL instructions
.env.example              Configuration template
package-lock.json         Reproducible dependency versions
```

## Flow and endpoints

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/` | Public welcome page; signed-in owner redirects to library |
| GET/POST | `/owner/login` | Owner password sign-in |
| GET | `/owner` | Private paginated paste library and deletion countdowns |
| GET | `/owner/new` | Owner editor, title, expiration, 128 KiB text limit |
| POST | `/owner/logout` | Invalidate the owner session |
| GET/POST | `/owner/pastes/:id/delete` | Owner deletion confirmation and action |
| POST | `/pastes` | Owner-only creation; redirect to link confirmation |
| GET | `/created/:id` | Owner-only shareable URL and copy/open controls |
| GET | `/p/:id` | Three-second gateway; no paste body in HTML |
| POST | `/p/:id/unlock` | Validate browser-bound signed token and server-side timer |
| GET | `/p/:id/view` | Escaped text viewer; requires access cookie |
| GET | `/p/:id/raw` | Plain text; requires the same cookie |
| GET | `/p/:id/download` | Text attachment; requires the same cookie |
| GET | `/healthz` | Database-backed health check |

Random 12-character IDs have 72 bits of entropy. Tokens expire after 15 minutes on the gateway, and viewer grants last one hour. Visiting an already unlocked link in the same browser skips the bridge until its grant expires. Each paste uses a separately scoped grant cookie. Cookies are HttpOnly, SameSite=Lax, and Secure in production. Changing `COOKIE_SECRET` invalidates existing tokens. Cookies are required; JavaScript is optional for the core create/read flow.

The timer gates access but is **not DRM or proof of ad consumption**. A reader can share the text after viewing it. Pastes are unlisted, not private or end-to-end encrypted. Anyone holding a link may open it. Responses tell search engines not to index pastes; this is advisory.

## Adsterra setup

Set `ADSTERRA_DIRECT_LINK` in `.env` to the exact HTTPS Smart Direct Link from your publisher dashboard. Restart the app. No link is hardcoded and an empty value disables advertising.

After three seconds, clicking **Proceed to paste** opens the sponsor in a new tab and submits the local unlock form in the original tab. The button explains this before the click. Ads are opened only on that explicit action. There are no automatic pop-unders or third-party scripts. The sponsor receives no paste text or referrer from this app.

When advertising is enabled, a blocked sponsor tab keeps the paste locked and shows a prompt to allow pop-ups. There is no visible bypass control, and the Proceed button stays disabled when JavaScript is unavailable. The site still cannot verify that a third-party page rendered successfully or guarantee a payable impression because Direct Links have no completion callback. Confirm your placement and traffic source with your Adsterra account requirements.

Do not paste an arbitrary ad script into the page or disable the content-security policy to make one work. This implementation uses the requested Direct Link option. Integrating a different ad format would require reviewing its specific script domains and browser behavior.

## Operations and limits

- Creation limit: 20 pastes per 15 minutes per IP; overall dynamic-route limit: 120 requests per minute per IP. These are in-memory limits for a **single process** and reset on restart. Nginx is configured to overwrite forwarding headers; only loopback proxies are trusted when enabled. Shared-IP users share a quota.
- Title limit: 120 characters. Content limit: 128 KiB of UTF-8. Native form bodies are capped at 1 MiB because URL encoding expands text.
- Paste content is escaped by EJS; raw output is `text/plain` with `nosniff`. CSP allows only local scripts/styles and forbids embedding and plugins. No user HTML runs.
- The SQLite file, `.env`, backups and source files are never served as static content. Keep them outside any separate Nginx static root.
- Automatic expiration is enforced server-side. Monitor disk space and backup retention. Use the private dashboard or `npm run delete-paste -- PASTE_ID` for manual removal. Deletion does not erase copies readers made or copies retained in backups.
- Run `npm run backup` for a consistent online SQLite backup; copy it to separate protected storage. Do **not** copy just the live main database while WAL writes are active. Backup retention is operator managed.
- This is a small single-instance service, not a highly available cluster. Keep PM2 at one instance. There is one owner account; no multi-user registration, encryption at rest, or public paste directory.

See [DEPLOYMENT.md](DEPLOYMENT.md) for server installation, existing HTTPS integration, fresh SSL setup, updates, backups and recovery.

## Primary references

- [Node.js SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [Express production security](https://expressjs.com/en/advanced/best-practice-security.html)
- [Adsterra Direct Link guide](https://adsterra.com/blog/guide-for-working-with-direct-links/)
- [PM2 startup and process management](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Certbot Nginx instructions](https://certbot.eff.org/instructions?os=snap&tab=standard&ws=nginx)
