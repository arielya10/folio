# Folio

A lightweight, self-hosted Pastebin-style application for Node.js 24, Express 5, and SQLite. Clean responsive light/dark UI, no frontend build step, no CDN dependency, no account required.

## Run locally

Install Node.js **24.13 or newer within the 24.x line**, then:

```powershell
npm ci
Copy-Item .env.example .env
npm start
```

On Linux/macOS use `cp .env.example .env` instead of `Copy-Item`. Open **http://localhost:3000**. `npm run dev` watches the server for changes. `npm test` runs integration tests.

Node's built-in `node:sqlite` avoids native package compilation on Oracle AMD or ARM instances. It may print an experimental SQLite warning on the minimum supported Node version; that is expected. The database is created automatically at `data/pastes.sqlite` using WAL mode and parameterized queries.

## Structure

```text
server.js                 Process startup and graceful shutdown
app.js                    Express middleware, security headers, error handling
lib/config.js             Environment validation
lib/database.js           SQLite schema and initialization
lib/tokens.js             Signed gateway and access tokens
routes/pastes.js           Creation, bridge, unlock, viewer, raw, download routes
views/                    Escaped EJS templates and shared page chrome
public/                   Local CSS, JavaScript, favicon (only public assets)
test/app.test.js          HTTP integration and persistence tests
scripts/backup.js          Consistent online SQLite backup
scripts/delete-paste.js    Owner-operated paste removal
deploy/                   Nginx configuration examples
ecosystem.config.cjs       Single-process PM2 configuration
DEPLOYMENT.md             Exact Ubuntu, Oracle, PM2, Nginx and SSL instructions
.env.example              Configuration template
package-lock.json         Reproducible dependency versions
```

## Flow and endpoints

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/` | Editor with optional title and 128 KiB content limit |
| POST | `/pastes` | Validate and save; redirect to link confirmation |
| GET | `/created/:id` | Shareable URL and copy/open controls |
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

**Sponsor blocked? Continue without it** submits the same unlock form without opening an ad. Both paths enforce the server timer. A blocked popup or thrown error never prevents form submission. If all JavaScript is blocked, a standard sponsor link is shown and the native form still unlocks after the wait. No fragile adblock detection is needed. The site cannot verify an ad view, force a sponsor to load, or guarantee a payable impression: Direct Links have no general completion callback. This implementation intentionally preserves content access when ads fail. Confirm your placement and traffic source with your Adsterra account requirements.

Do not paste an arbitrary ad script into the page or disable the content-security policy to make one work. This implementation uses the requested Direct Link option. Integrating a different ad format would require reviewing its specific script domains and browser behavior.

## Operations and limits

- Creation limit: 20 pastes per 15 minutes per IP; overall dynamic-route limit: 120 requests per minute per IP. These are in-memory limits for a **single process** and reset on restart. Nginx is configured to overwrite forwarding headers; only loopback proxies are trusted when enabled. Shared-IP users share a quota.
- Title limit: 120 characters. Content limit: 128 KiB of UTF-8. Native form bodies are capped at 1 MiB because URL encoding expands text.
- Paste content is escaped by EJS; raw output is `text/plain` with `nosniff`. CSP allows only local scripts/styles and forbids embedding and plugins. No user HTML runs.
- The SQLite file, `.env`, backups and source files are never served as static content. Keep them outside any separate Nginx static root.
- No automatic deletion or expiration is configured. Monitor disk space; public creation can consume storage over time. Run `npm run delete-paste -- PASTE_ID` to remove abuse. Deletion does not erase copies readers made or copies retained in backups.
- Run `npm run backup` for a consistent online SQLite backup; copy it to separate protected storage. Do **not** copy just the live main database while WAL writes are active. Backup retention is operator managed.
- This is a small single-instance service, not a highly available cluster. Keep PM2 at one instance. It does not include accounts, encryption at rest, content moderation automation, or a public paste directory.

See [DEPLOYMENT.md](DEPLOYMENT.md) for server installation, existing HTTPS integration, fresh SSL setup, updates, backups and recovery.

## Primary references

- [Node.js SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [Express production security](https://expressjs.com/en/advanced/best-practice-security.html)
- [Adsterra Direct Link guide](https://adsterra.com/blog/guide-for-working-with-direct-links/)
- [PM2 startup and process management](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Certbot Nginx instructions](https://certbot.eff.org/instructions?os=snap&tab=standard&ws=nginx)
