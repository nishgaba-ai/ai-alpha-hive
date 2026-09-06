---
name: company-infra
description: Run the company platform and worker — local dev, Vercel for the UI, the runtime worker on a laptop or droplet, database choice (SQLite vs libSQL), secrets, and what agents may do to infrastructure. Use when deploying the company UI, starting or debugging the worker, moving between local and Vercel, or giving an agent deploy, domain, or DNS tools.
---

# company-infra

Two processes and one database. The UI and API are Next.js in
`platform/web`; the worker is `runtime/`; both read the same tables.

## Local (default today)

```bash
# terminal 1 — UI + API
cd platform/web && npm run dev            # http://localhost:3000, DATA_DIR=./data

# terminal 2 — worker
cd my-company && hive company run         # reads ../.env for ANTHROPIC_API_KEY, VAULT_KEY, DATA_DIR
```

Both must point at the same `DATA_DIR`. `hive doctor` reports if they do
not. `VAULT_KEY` is 32 random bytes base64; generate once, never commit.

## Vercel (UI only)

- Vercel cannot host the SQLite file or the long-lived worker. Use libSQL
  (Turso) for the database: same schema, `@libsql/client` in place of
  `better-sqlite3`, `DATABASE_URL` + `DATABASE_AUTH_TOKEN` in Vercel env.
- The worker runs on your machine or the droplet with the same
  `DATABASE_URL`. It is the only process holding `ANTHROPIC_API_KEY`.
- Ship with `hive ship` from `platform/web` (vercel driver). Preview URLs
  are fine until domains are chosen.
- Stripe/Razorpay webhooks target the Vercel URL; the API route writes the
  event row and the worker acts on it — no direct call to the worker.

## Droplet (worker + optional UI)

`scripts/provision-droplet.sh` as documented in `docs/deploy.md`; the
worker is a container like any app, with `DATA_DIR` on a volume when
running SQLite locally on the box. Isolation rules from `docs/deploy.md`
apply: one container, localhost port, nginx by server_name only.

## What agents may do to infra

| Tool | Class | Note |
|---|---|---|
| `hive.ship preview` | deploy (allow) | coding roles |
| `hive.ship prod` | deploy (approve) | the only prod path |
| `infra.domain.search/buy` | read / spend | buy parks over threshold |
| `infra.dns.set` | write | on company domains only |
| `infra.secret.set` | write | write-only |
| provisioning boxes, changing Vercel project settings, rotating keys | board | not tools |

## Debugging the worker

```bash
hive company status                       # agents, runs, parked approvals
hive company runs --last 10               # recent runs with cost and outcome
hive company events --run <id>            # the event stream for one run
```

Common causes: wrong `DATA_DIR` (two databases), missing `VAULT_KEY`
(secret resolution fails closed → tools deny), API key without access to
the role's model (the run's first event shows the 400; set a supported
model in the role), quiet hours blocking `send`/`publish` (event says so).

## Rules

- Never start the worker on Vercel or in a serverless function.
- Never put `ANTHROPIC_API_KEY` in the web app's env; the UI does not call
  the model.
- Keep the portability contract: nothing machine-specific outside `.env`
  and the vault.
