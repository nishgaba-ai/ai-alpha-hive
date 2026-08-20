# Deploy drivers

`hive ship --driver <name>` — gates always run first; a blocking failure
refuses the deploy. Every ship writes a release record to `.hive/releases/`.

## vercel

Deploys via the Vercel CLI (through npx, no global install).

| Env | |
|---|---|
| `VERCEL_TOKEN` | required — vercel.com/account/settings/tokens |
| `VERCEL_TEAM_ID` | optional team scope |

Note: `*.vercel.app` preview URLs may sit behind Vercel SSO deployment
protection; ship reports "access-protected" when that's the case.

## droplet

Deploys to any VPS you've provisioned with
[scripts/provision-droplet.sh](../scripts/provision-droplet.sh) — plain
ssh + docker + nginx, nothing DigitalOcean-specific.

| Env | |
|---|---|
| `DROPLET_HOST` | required — IP or hostname |
| `DROPLET_SSH_USER` | default `root` |
| `DROPLET_APP_ROOT` | default `/opt/hive-apps` |
| `CERTBOT_EMAIL` | optional — enables TLS when the app declares a domain |

Flow: source is tar-streamed over ssh (works on Windows — no rsync) into
`/opt/hive-apps/<slug>/releases/<ts>` → docker build + run (a default
Dockerfile is generated for npm apps without one) → health-checked on its
stable per-app port → nginx vhost → atomic `current` symlink flip → old
releases pruned (last 3 kept).

**URLs**: declare `site.domain` in `hive.yaml` to serve on your domain
(TLS via certbot once DNS points at the box). Without a domain you get an
instant public preview at `http://<slug>.<host-ip>.sslip.io` — sslip.io
resolves the embedded IP, so there is zero DNS setup.

**Rollback**: point the `current` symlink at a previous release and restart
the container from its image tag (`hive rollback` is planned).
