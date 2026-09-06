# Deploying the worker

The worker is the long-lived process (agents, gates, API). It cannot run on
Vercel; it runs on a box. This folder makes it a hive app the droplet
driver can ship.

```bash
# once: provision a box (docker + nginx + certbot)
ssh root@<ip> bash < scripts/provision-droplet.sh
# .env: DROPLET_HOST=<ip>, CERTBOT_EMAIL=you@…

cp deploy/worker/.env.deploy.example deploy/worker/.env.deploy   # fill it
cd deploy/worker && hive ship --driver droplet
```

The image clones `main` from GitHub at build time, so ship after pushing.
Companies are copied into the `/data` volume on first start; later edits
from Settings persist there across releases. The control-plane database is
`/data/company.db`.

DNS: `api.prodigalai.com` → the box IP (A record) gives TLS via certbot on
the next ship; OAuth redirect URIs become `https://api.prodigalai.com/api/oauth/callback`.

The UI (platform/web) goes to Vercel or the same box with
`HIVE_API_URL=https://api.prodigalai.com` and the same `HIVE_API_TOKEN`.
