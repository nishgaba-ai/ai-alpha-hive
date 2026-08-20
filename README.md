# AI Alpha Hive

**A deterministic delivery engine for AI-built software.** The AI proposes, the
gates dispose: Claude (or any agent) does the creative work; `hive` owns
structure, checks, deployment, and the dependency graph — so "all checks pass"
is a property of the engine, never of a prompt.

> Status: **phase 1 of [MASTER-PLAN.md](MASTER-PLAN.md)** — the golden path
> works: `hive new` scaffolds a gate-passing Next.js site, seven gates run
> (secrets, deps, types, lint, build, links, seo), and `hive ship` deploys to
> Vercel with post-deploy verification. Intent graph and modules come next.

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

## Quickstart

```bash
git clone https://github.com/nishgaba-ai/ai-alpha-hive
cd ai-alpha-hive
go build -o hive ./cmd/hive     # hive.exe on Windows
./hive doctor                   # verify your environment

# prompt → live site
./hive new marketing "Sunrise Bakery" --intent "Order cakes on WhatsApp"
cd sunrise-bakery
hive check                      # all seven gates must pass
hive ship                       # deploy preview to Vercel (VERCEL_TOKEN in .env)
hive ship --env prod
```

Requirements: Go ≥ 1.26, Node ≥ 20, git. Everything machine-specific lives in
environment variables — copy [.env.example](.env.example) to `.env` and fill
what you use. Migrating machines is: install Go+Node, clone, copy `.env`.

## Repository layout

```
cmd/hive/        CLI entrypoint
internal/        engine: cli/ config/ gates/ (graph/ modules/ deploy/ to come)
plugin/          Claude Code plugin + skills (hive-launch, hive-audit, …)
modules/         official module registry (cms, integrations, payments, seo)
templates/       site templates (marketing, blog, store, docs, portfolio)
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
