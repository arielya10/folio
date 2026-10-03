# Deploy Folio on Oracle Cloud Ubuntu

These commands use the default `ubuntu` SSH user, `/home/ubuntu/folio`, Node.js 24, and one PM2 process. Replace `YOUR_SERVER_IP`, `YOUR_SUBDOMAIN.duckdns.org`, and `you@example.com` with your values. Your database and secrets remain on the server. Run server commands as `ubuntu` unless prefixed with `sudo`.

## 1. Check DNS and network access

Your DuckDNS A record must point at this instance's public IPv4 address. If an AAAA record exists, it must also reach this instance over IPv6; remove a stale AAAA record. Keep your existing DuckDNS updater running if the address changes.

In Oracle Cloud, allow TCP **80 and 443** in the instance's applicable VCN security list or network security group. Preserve restricted SSH access on 22. Do not expose 3000. Keep existing working host firewall rules; if UFW is already active, these commands add the web ports:

```bash
sudo ufw status
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

Do not enable or reset a firewall blindly on an existing Oracle image: its existing iptables/nftables rules and SSH rules must remain valid. Oracle network rules and host firewall rules both need to permit web traffic. Your existing HTTPS site indicates this is likely already configured.

## 2. Install Node.js 24 and PM2

Install OS utilities (do not replace a working Nginx configuration):

```bash
sudo apt update
sudo apt install -y ca-certificates curl xz-utils nginx
```

Install the latest available Node.js 24 binary directly from Node.js with a checksum check. This chooses ARM64 or x64 to match your instance:

```bash
case "$(uname -m)" in
  aarch64) NODE_ARCH=arm64 ;;
  x86_64) NODE_ARCH=x64 ;;
  *) echo 'Unsupported CPU architecture'; exit 1 ;;
esac
NODE_INSTALL_TMP=$(mktemp -d)
cd "$NODE_INSTALL_TMP"
curl -fsSLO https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt
NODE_TARBALL=$(awk -v suffix="linux-${NODE_ARCH}.tar.xz" '$2 ~ suffix "$" {print $2}' SHASUMS256.txt)
test -n "$NODE_TARBALL" || exit 1
curl -fsSLO "https://nodejs.org/dist/latest-v24.x/$NODE_TARBALL"
awk -v archive="$NODE_TARBALL" '$2 == archive {print}' SHASUMS256.txt | sha256sum -c - || exit 1
sudo mkdir -p /opt/folio-node24
sudo tar -xJf "$NODE_TARBALL" -C /opt/folio-node24 --strip-components=1
sudo ln -sfn /opt/folio-node24/bin/node /usr/local/bin/node
sudo ln -sfn /opt/folio-node24/bin/npm /usr/local/bin/npm
sudo ln -sfn /opt/folio-node24/bin/npx /usr/local/bin/npx
node --version
npm --version
sudo /usr/local/bin/npm install -g --prefix /opt/folio-node24 pm2
sudo ln -sfn /opt/folio-node24/bin/pm2 /usr/local/bin/pm2
pm2 --version
cd /home/ubuntu
```

This sets `/usr/local/bin/node`, `npm`, and `npx` to Node 24. If this instance runs other Node applications, check their compatibility first or retain their existing explicit interpreter paths. Require at least Node 24.13. The SQLite API may print an experimental warning; no native SQLite add-on installation is needed.

## 3. Upload and configure

On your local Windows machine, from this project directory (PowerShell):

```powershell
tar --exclude=node_modules --exclude=.npm-cache --exclude=.git --exclude=.env --exclude=data --exclude=backups --exclude=test-results -czf ../folio-app.tar.gz .
scp ../folio-app.tar.gz ubuntu@YOUR_SERVER_IP:/home/ubuntu/folio-app.tar.gz
ssh ubuntu@YOUR_SERVER_IP
```

If your SSH key is not configured in your SSH agent, add `-i C:/path/to/key` to both SSH commands. On the server:

```bash
mkdir -p /home/ubuntu/folio
tar -xzf /home/ubuntu/folio-app.tar.gz -C /home/ubuntu/folio
cd /home/ubuntu/folio
npm ci
npm test
npm prune --omit=dev
cp .env.example .env
npm run setup-owner
nano .env
```

The setup command asks for your owner password with hidden input and saves a salted scrypt hash plus a random cookie secret. Keep those generated values when editing `.env`; replace the hostname and sponsor settings below. There is no default owner password. For an existing installation, keep `.env` and just run `npm run setup-owner` to add or reset owner access.

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
APP_URL=https://YOUR_SUBDOMAIN.duckdns.org
COOKIE_SECRET=KEEP_THE_RANDOM_VALUE_SAVED_BY_SETUP
OWNER_PASSWORD_HASH=KEEP_THE_SCRYPT_HASH_SAVED_BY_SETUP
DATABASE_PATH=./data/pastes.sqlite
ADSTERRA_DIRECT_LINK=https://YOUR_EXACT_ADSTERRA_DIRECT_LINK
TRUST_PROXY=1
```

Set `ADSTERRA_DIRECT_LINK=` to leave advertising off until you have your actual URL. Do not leave the example sponsor hostname in place. `APP_URL` must be just the origin, with no subpath. It determines generated links and allowed form origins. Do not put quotes around a URL containing `&` in a browser; the `.env` parser accepts it as a value. No real credentials belong in Git.

```bash
chmod 600 .env
mkdir -p data backups
chmod 700 data backups
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

**Run the exact `sudo ...` command printed by `pm2 startup`**, then:

```bash
pm2 save
pm2 status
curl -fsS http://127.0.0.1:3000/healthz
```

Expected: `{"status":"ok"}`. Run PM2 as `ubuntu`, not root. The ecosystem file sets production mode and reads `.env`. One process is intentional for SQLite and in-memory rate limits.

## 4A. Your existing Nginx + Certbot HTTPS setup (recommended for you)

Locate the existing config for the DuckDNS domain:

```bash
sudo nginx -T
ls -l /etc/nginx/sites-enabled/
```

Set the actual config path and back it up (replace the path if it differs):

```bash
NGINX_SITE=/etc/nginx/sites-available/YOUR_EXISTING_SITE
sudo cp "$NGINX_SITE" "${NGINX_SITE}.backup-$(date +%Y%m%d-%H%M%S)"
sudo nano "$NGINX_SITE"
```

Inside the **existing HTTPS `server` block for your DuckDNS name**, replace its `location /` with the contents of `deploy/nginx-location.conf`, including `client_max_body_size 1m;` at server scope. Keep the existing `listen 443 ssl`, `server_name`, certificate paths, TLS settings, and HTTP-to-HTTPS redirect. Do not create a second server block with the same name and port. Remove any other old static locations that would expose this project's data or source files. Nginx should proxy requests to Express, which serves only `public/` under `/assets`.

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -fsS https://YOUR_SUBDOMAIN.duckdns.org/healthz
sudo certbot renew --dry-run
```

No certificate reissue is needed for a working certificate on the same hostname. If Nginx's config test fails, correct the error before reloading; the running configuration remains in effect.

## 4B. Fresh Nginx and SSL setup (only if there is no existing domain config)

Skip this section when using 4A.

```bash
cd /home/ubuntu/folio
sudo cp deploy/nginx-new-site.conf /etc/nginx/sites-available/folio
sudo sed -i 's/YOUR_SUBDOMAIN.duckdns.org/your-real-subdomain.duckdns.org/g' /etc/nginx/sites-available/folio
sudo ln -s /etc/nginx/sites-available/folio /etc/nginx/sites-enabled/folio
sudo nginx -t && sudo systemctl reload nginx
```

If Certbot is already installed, reuse it. Otherwise, install the official snap (do not install a second conflicting Certbot over a working package installation):

```bash
sudo apt install -y snapd
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/local/bin/certbot
```

Then obtain the certificate and enable the redirect:

```bash
sudo certbot --nginx -d YOUR_SUBDOMAIN.duckdns.org --redirect --agree-tos -m you@example.com
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run
curl -fsS https://YOUR_SUBDOMAIN.duckdns.org/healthz
```

Certbot's packaged renewal timer handles renewals. Check it with `systemctl list-timers --all`. Keep port 80 reachable for HTTP certificate challenges. Production session cookies require HTTPS, so test the full user flow on the HTTPS domain, not the initial HTTP server.

## 5. Verify the live flow

1. Open `/owner/login`, sign in with your chosen password, and create a paste from your private library. Set its deletion time. Its generated link must start with your HTTPS domain.
2. Open the link in a private window. You should see the gateway, not the text.
3. Wait three seconds. With a real sponsor configured, the disclosed Proceed button opens a sponsor tab and the paste in the original tab. Close the sponsor whenever you wish.
4. Test the fallback with a blocker enabled. It must still display the paste.
5. Test raw/download in a new private session: both must redirect to the gateway.
6. Check light/dark themes, copy buttons, and a phone-sized browser window.
7. Sign out. Anonymous users must not see your library or editor and must not be able to publish.
8. Verify the library shows deletion countdowns. Expired records are removed by the app; existing pastes migrated from the first version have no expiry.

No sponsor visit or payable ad impression has been tested by this repository's automated tests. Tests use an inert example URL; your real account configuration must be verified by you.

## Maintenance

```bash
cd /home/ubuntu/folio
pm2 logs folio --lines 100
pm2 status
df -h
npm run backup
npm run delete-paste -- PASTE_ID
```

Backups are consistent snapshots even with WAL enabled; copy them off-instance to a secure location. Do not copy only `pastes.sqlite` while the app is writing. Backups contain all saved text. Set your retention policy and monitor SQLite growth and PM2/Nginx logs. Install/configure log rotation for a long-lived public deployment.

To reset the owner password, run `npm run setup-owner` in `/home/ubuntu/folio`, then `pm2 restart ecosystem.config.cjs --update-env`. Existing owner sessions are rejected after restart. No password reset endpoint is exposed publicly. Lost server access requires recovering the server first.

Time limits use the server clock; keep Ubuntu time synchronization enabled. Expired records are purged at startup, every minute and before app routes. Restored backups are purged on startup too. Keep `.env` permissions at 600 and protect backups, which also include hashed owner session records.

To update: make a backup, upload the new source **excluding `.env`, `data/`, and `backups/`**, then:

```bash
cd /home/ubuntu/folio
npm ci --include=dev
npm test
npm prune --omit=dev
pm2 restart ecosystem.config.cjs --update-env
pm2 save
curl -fsS https://YOUR_SUBDOMAIN.duckdns.org/healthz
```

For a restore, stop writes first. Use a known backup filename below:

```bash
cd /home/ubuntu/folio
pm2 stop folio
RESTORE_STASH="data-before-restore-$(date +%Y%m%d-%H%M%S)"
mv data "$RESTORE_STASH"
mkdir -m 700 data
cp backups/YOUR_BACKUP.sqlite data/pastes.sqlite
chmod 600 data/pastes.sqlite
pm2 restart folio
curl -fsS http://127.0.0.1:3000/healthz
```

Moving the entire stopped database directory preserves its old main file and WAL/SHM sidecars for recovery. Never restore a main file alongside stale WAL files. Keep that stash protected and delete it only after confirming the restore.

## Troubleshooting

- **502:** inspect `pm2 logs folio`, local `/healthz`, and Nginx's upstream port. Keep Node bound to 127.0.0.1.
- **Forms rejected:** `APP_URL` must match the browser's origin exactly; verify HTTPS redirects and the proxy headers.
- **Gateway repeats:** allow first-party cookies and confirm HTTPS is working. The wait is checked on the server; changing the browser timer does not unlock early.
- **Rate limits affect everyone:** verify Nginx overwrites `X-Forwarded-For` and `TRUST_PROXY=1`. Do not use this proxy setting unchanged behind an additional CDN; configure trusted hops and real client IP handling first.
- **Certificate challenge fails:** check A/AAAA, port 80, both Oracle and host firewall rules, and duplicate Nginx server names.
- **No sponsor/revenue:** ensure `ADSTERRA_DIRECT_LINK` is a real HTTPS publisher link, restart PM2 after edits, and verify the placement in your account. Browser blockers and network failures can prevent ads. No completion or revenue guarantee is possible with Direct Links.

References: [PM2 startup](https://pm2.keymetrics.io/docs/usage/quick-start/), [Nginx reverse proxy](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [Certbot instructions](https://certbot.eff.org/instructions?os=snap&tab=standard&ws=nginx), [Node.js releases](https://nodejs.org/dist/latest-v24.x/).

## GitHub Actions deployment

The workflow in `.github/workflows/deploy.yml` tests every push to `main` and then deploys it to production. Releases are installed under `/opt/folio-releases`; `/opt/folio` points to the active release. The server keeps `.env`, SQLite data, and backups under `/opt/folio-shared`. A failed PM2 reload or local health check restores the previous release.

Create one GitHub repository secret named `FOLIO_DEPLOY_KEY` and paste the full contents of the dedicated private key into it. The matching public key on the server is restricted to `/usr/local/sbin/folio-actions-command`, so it cannot open a shell or run arbitrary SSH commands.

In the GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret**. Use `FOLIO_DEPLOY_KEY` as the name. You may also open **Settings → Environments → production** to add branch protection or required reviewers. The workflow has read-only repository permissions and serializes production deployments to prevent overlapping releases.
