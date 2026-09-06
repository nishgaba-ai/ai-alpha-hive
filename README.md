# AI Alpha Hive

**A deterministic delivery engine for AI-built software.** The AI proposes, the
gates dispose: Claude (or any agent) does the creative work; `hive` owns
structure, checks, deployment, and the dependency graph — so "all checks pass"
is a property of the engine, never of a prompt.

> Status: **phase 1 of [MASTER-PLAN.md](MASTER-PLAN.md) complete** — the
> golden path is live: `hive new` scaffolds a gate-passing Next.js site,
> eight gates run (secrets, deps, types, lint, build, test, links, seo), and
> `hive ship` deploys to Vercel with post-deploy verification. Verified with
> a real production deploy. Intent graph and modules come next.

## What it does

- `hive new <template> <name>` — scaffold a gate-passing, SEO-complete site
- `hive check` — run policy gates (types, lint, build, secrets, links, seo,
  geo, a11y, perf) in parallel, with machine-readable findings agents can fix
- `hive graph impact <node>` — blast radius of any change, powered by an
  intent graph (declared `hive.yaml` + generated code analysis)
- `hive add <module>` — plug integrations (payments, email, analytics, CMS)
  built once, reused forever
- `hive ship` — gates → build → deploy (Vercel/static) → verify → release
  record; refuses to deploy on any blocking failure

It runs two ways: as a CLI + [Claude Code plugin](plugin/) in your editor, and
as the engine behind a prompt-to-website product.

## Launch your AI company

One human board, a company of agents. Describe the company you want; get
roles (engineer, CMO, writers, paid media, finance, quants, sales) with
real tools, real budgets and a treasury the engine caps, running as a live
graph and a 3D floor you can watch. Every external side effect — spend,
send, publish, deploy to prod, hire — is a gate the board controls, from
the inbox, from Telegram, or by voice.

```bash
# runtime (once)
cd runtime && npm install && npm run build && cd ..

# a company from a template, on any model backend
hive company init startup "Prodigal AI"            # or cmo, trading-research, real-estate, waste-management
hive company validate --company prodigal-ai
hive company run --group . --port 4700             # every company in this directory, one worker

# the product UI (needs .env.local: HIVE_API_URL=http://localhost:4700)
cd platform/web && npm install && npm run dev      # http://localhost:3000/c
```

What is in the box:

- **Runtime** ([runtime/](runtime/)): providers for Anthropic, OpenRouter,
  Ollama, Claude Code (Agent SDK) and a mock; the side-effect gate; a
  scheduler; a double-entry ledger; an AES-GCM vault; SQLite control plane
  with an HTTP API and SSE; export/import for migration.
- **Integrations library** ([runtime/integrations/](runtime/integrations/)):
  plugins with modes (permission bundles), declared secrets and guidance —
  content, email (Postmark), LinkedIn, Slack, Telegram (board commands and
  approvals), GA4, Search Console, Meta Ads. Guide:
  [docs/company/integrations.md](docs/company/integrations.md).
- **ERP under one roof**: people, payroll, expenses, time, cash accounts and
  a monthly statement CSV for the CA ([docs/company/erp.md](docs/company/erp.md)).
- **Voice**: an MCP server so Claude's apps can run the company by voice,
  plus an in-product voice console ([docs/company/voice.md](docs/company/voice.md)).
- **UI** ([platform/web/app/c/](platform/web/app/c/)): group of verticals,
  org graph, 3D floor, missions, task tracker, inbox, treasury, ERP,
  integrations, settings, templates gallery — in the Obsidian & Brass
  design system.
- **Plan and specs**: [COMPANY-PLAN.md](COMPANY-PLAN.md), [docs/company/](docs/company/).
- **Skills**: `company-launch`, `company-role`, `company-treasury`,
  `company-integrate`, `company-infra`, `hive-design`.

Tests: `npm test` in `runtime/` runs the gate, ledger, ERP, export and a
full mock company end-to-end (mission → plan → runs → parked approval →
board decision → done).

## Quickstart

```bash
# install (linux/macos; Windows: grab the zip from GitHub releases)
curl -fsSL https://raw.githubusercontent.com/nishgaba-ai/ai-alpha-hive/main/scripts/install.sh | sh
# or from source on any OS: go install github.com/nishgaba-ai/ai-alpha-hive/cmd/hive@latest

hive doctor                     # verify your environment

# prompt → live site
hive new marketing "Sunrise Bakery" --intent "Order cakes on WhatsApp"
cd sunrise-bakery
hive check                      # all gates must pass
hive ship                       # deploy preview to Vercel (VERCEL_TOKEN in .env)
hive ship --env prod
```

A complete, gates-green example lives in [examples/bakery-demo](examples/bakery-demo/).

Requirements: Go ≥ 1.26, Node ≥ 20, git. Everything machine-specific lives in
environment variables — copy [.env.example](.env.example) to `.env` and fill
what you use. Migrating machines is: install Go+Node, clone, copy `.env`.

## Repository layout

```
cmd/hive/        CLI entrypoint
internal/        engine: cli/ config/ gates/ (graph/ modules/ deploy/ to come)
plugin/          Claude Code plugin + skills (hive-launch, hive-audit, company-*, hive-design)
modules/         official module registry (cms, integrations, payments, seo)
templates/       site templates (marketing, …) and company templates (startup, cmo)
runtime/         company runtime worker (TypeScript): tool manifest, company schema
platform/web/    the platform UI (Next.js) — gains the company graph in C2
analyzers/ts/    TypeScript sidecar: type-aware site graph emitter
examples/        deployable end-to-end examples
docs/            quickstart, architecture, module spec, gates, intent graph
```

## Design principles

1. **AI proposes, gates dispose** — deploys go through `hive ship`; gates are
   deterministic Go code the model cannot skip.
2. **Everything is a module** — one `module.yaml` spec; build an integration
   once, `hive add` it forever.
3. **Intent is data** — audience, journeys, keywords live in `hive.yaml`;
   changed intent yields a computed blast radius, not archaeology.
4. **Portable by contract** — no machine-specific state outside `.env`.

Full architecture, roadmap, and rationale: [MASTER-PLAN.md](MASTER-PLAN.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Every feature lands with docs, tests,
and an example. License: [MIT](LICENSE).
