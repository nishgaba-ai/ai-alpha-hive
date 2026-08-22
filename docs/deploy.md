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
(TLS via certbot once DNS points at the box; `www.` is served and
certified automatically when its DNS follows the apex — point a CNAME
`www` → your apex — and falls back to apex-only until then). Without a domain you get an
instant public preview at `http://<slug>.<host-ip>.sslip.io` — sslip.io
resolves the embedded IP, so there is zero DNS setup.

**Rollback**: point the `current` symlink at a previous release and restart
the container from its image tag (`hive rollback` is planned).

## Isolation model (multi-app boxes)

A droplet may host several apps (and the hive platform itself). The rules
that keep them from exposing each other:

- every app runs in its own container, published on `127.0.0.1:<port>` only —
  the sole public path is nginx matching that app's `server_name`;
- unmatched Host headers, including direct IP hits, are dropped (`return 444`
  default vhost — provisioned by the script): nothing on the box is
  discoverable by scanning the IP;
- app containers get only their own env (`SITE_URL` today, per-app vars
  later) — never another app's secrets, never host mounts outside their
  release dir;
- stateful data lives in per-app docker volumes; apps never share a database.

## Migrating an app to another box (minutes, by design)

1. Provision the new box: `ssh root@<new-ip> bash < scripts/provision-droplet.sh`
2. Change `DROPLET_HOST` in `.env` to the new IP.
3. `hive ship --driver droplet` from the project.
4. Stateless site: done — point DNS (or use the new sslip.io preview).
   Stateful app: copy its docker volume/SQLite file first
   (`docker run --rm -v <vol>:/v -v /opt/hive-backups:/b alpine tar czf /b/<vol>.tar.gz -C /v .`,
   restore on the new box the same way).
5. Old box: `docker rm -f hive-<slug>` and delete its nginx vhost.

Nothing about an app references its box outside `.env` — that is the whole
migration surface.
