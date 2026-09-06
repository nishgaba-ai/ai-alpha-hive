# Deploying — local, a box, Vercel

Two processes: the **worker** (agents, gates, API, webhooks; long-lived,
needs a box) and the **web app** (the dashboard; Next.js).

## Local

```bash
hive company run --group ./companies --port 4700     # worker
cd platform/web && npm run dev                        # dashboard on :3000
```

## One box (what Prodigal AI runs today)

`deploy/worker` is a hive app the droplet driver ships: it clones `main`,
builds the runtime, runs every company under `/data/companies`. The
dashboard ships the same way. nginx + certbot give TLS; Cloudflare proxies
the names. Webhooks and OAuth callbacks land on the worker's public URL
(`HIVE_PUBLIC_URL`), so the worker must be reachable from the internet:

- `https://api.<domain>/api/oauth/callback`
- `https://api.<domain>/api/webhooks/stripe/<slug>`
- `https://api.<domain>/api/webhooks/razorpay/<slug>`

```bash
cd deploy/worker && hive ship --driver droplet
cd platform/web && hive ship --driver droplet
```

## Vercel (dashboard only)

The worker cannot run on Vercel. The dashboard can, with two changes the
code is shaped for but does not ship yet:

1. **Hosted database for the web app.** `platform/web/lib/db.ts` keeps
   users, sessions, memberships, company access, invites and audit in
   SQLite under `DATA_DIR`. On Vercel that directory is ephemeral. Plan:
   Turso (libSQL) behind the same `getDb()` shape, or move these tables
   into the worker and let the dashboard call the worker for auth. Both
   are mechanical; the second keeps one database for export/import.
2. **Environment.** `HIVE_API_URL=https://api.<domain>`,
   `HIVE_API_TOKEN`, `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.

`hive ship --driver vercel` already builds and deploys `platform/web`; it
is the database that blocks flipping the switch.

## Moving machines

`hive company export --group ./companies` writes one JSON bundle (config,
prompts, every table, encrypted vault rows). On the new box:
`hive company import bundle.json --into ./companies` with the same
`VAULT_KEY`, then `hive company run --group ./companies`. Workspaces (git
checkouts) are cloned again, not carried.
