# AI Alpha Hive — Master Plan

> **One engine, two surfaces.** A deterministic software-delivery engine ("hive") that
> (a) runs locally as a Claude Code skill/plugin for our own team, and
> (b) powers a public product where anyone launches a website from a prompt in minutes —
> deployed on Vercel, GitHub-connectable, domain purchase included, CMS built in.
>
> Status: PLANNING (v1 of this document). Nothing below is built yet unless marked.

---

## 1. Vision

"JARVIS of AI Code Development." Today, shipping software with AI agents fails in
predictable ways:

1. **Bulky sites become unmanageable.** When intent changes ("we now sell to clinics,
   not corporates"), finding everything linked to that intent — pages, components, copy,
   keywords, integrations — is manual archaeology.
2. **Checks are best-effort.** An LLM "usually" runs the tests. "Usually" is not a
   guarantee. Production needs *always*.
3. **Everything is rebuilt.** The 10,000th LinkedIn integration, the 500th Razorpay
   checkout, the 200th blog-with-SEO. Zero reuse across projects.
4. **SEO/GEO is re-thought per site.** Keywords, backlinks, schema.org, llms.txt,
   AI-citability — reinvented every launch.
5. **Non-devs can't launch at all.** The people with business intent can't get from
   idea → live site without hiring.

Hive solves these with one thesis: **the AI proposes, the engine disposes.** Claude
(or any agent) does the creative and interpretive work; a deterministic engine owns
structure, checks, deployment, and the dependency graph. Guarantees live in code,
not in prompts.

Two surfaces, one engine:

| Surface | User | How the engine runs |
|---|---|---|
| **Hive Framework** (this repo, open source) | Developers, our own team | `hive` CLI + Claude Code plugin/skills in local sessions |
| **Hive Product** (SaaS, closed source, separate repo later) | Anyone ("launch my bakery site") | Same engine, driven by the Claude Agent SDK in sandboxed cloud workers; web dashboard on top |

The open-source framework is the moat *and* the marketing: devs adopt the CLI/skill,
non-devs buy the product, both run the same modules, templates, and gates.

---

## 2. What we are actually building (layers)

```
┌────────────────────────────────────────────────────────────────────┐
│  L6  PRODUCT (SaaS)  prompt→site chat UI, dashboard, billing,      │
│      domain purchase, GitHub connect, tenant CMS UI                │
├────────────────────────────────────────────────────────────────────┤
│  L5  AGENT RUNTIME   Claude Agent SDK workers (cloud) /            │
│      Claude Code + skill pack (local) — both drive L1–L4           │
├────────────────────────────────────────────────────────────────────┤
│  L4  MODULES         cms/ integrations/ payments/ ads/ analytics/  │
│      video/ — pluggable, each with manifest + gates + skill notes  │
├────────────────────────────────────────────────────────────────────┤
│  L3  INTENT GRAPH    declared intent + generated code graph;       │
│      impact analysis, drift detection                              │
├────────────────────────────────────────────────────────────────────┤
│  L2  POLICY GATES    typecheck, lint, build, test, a11y, SEO/GEO,  │
│      perf budget, secret scan, link check — ship refuses on fail   │
├────────────────────────────────────────────────────────────────────┤
│  L1  HIVE ENGINE     Go CLI: init/new/add/check/graph/ship;        │
│      scaffolding, template registry, deploy drivers (Vercel, DO)   │
└────────────────────────────────────────────────────────────────────┘
```

The framework repo (this one) owns L1–L5. The product repo (later) owns L6 and the
cloud half of L5.

---

## 3. Language & stack decision

### The question
Java/Spring was recommended; you prefer Go or Rust. The answer depends on recognizing
that "the framework" is four different kinds of software:

### 3.1 The skill layer → **Markdown (Agent Skills open standard)**
Skills are plain markdown + optional scripts per the Agent Skills spec (open standard
since Oct 2025; portable across Claude Code, Codex CLI, Gemini CLI, Cursor, Copilot).
No language debate exists here — and portability is free distribution.

### 3.2 The engine/CLI → **Go** ✅ (the core decision)
The `hive` binary is a CLI + orchestrator: scaffolds projects, runs gates in parallel,
builds the graph, shells out to git/npm/vercel, calls deploy APIs.

- **Single static binary.** `hive` must run on Windows, WSL, macOS, Linux, and inside
  minimal cloud sandboxes with zero runtime installed. Go cross-compiles all targets
  from one machine; goreleaser automates release matrices. This is decisive for a
  public repo where "deploy it properly" is a README promise.
- **It's what the entire deploy-tooling world chose.** Docker, Kubernetes/kubectl,
  Terraform, gh, Caddy, Hugo, esbuild — the ecosystem of libraries (and hireable
  contributors) for exactly this shape of program is Go's.
- **Concurrency model fits gates.** Run 9 gates in parallel with goroutines +
  errgroup; stream results; fail fast. Trivial in Go.
- **Fast compile = fast agent iteration.** Claude editing the engine gets a
  sub-second feedback loop. Rust's compile times tax every iteration.

**Why not Rust:** Rust wins when you need maximum performance or memory safety in
long-running/parsing-heavy hot paths. Our CLI spends its life waiting on child
processes and network calls — Rust's advantages are wasted there, and its cost
(slower iteration, steeper contributor curve for a public repo) is real. If a hot
path ever appears (e.g., a massive graph engine), rewrite that one component.

**Why not Java/Spring:** Spring is the right tool for long-lived enterprise API
servers built by DI-oriented teams. It is the wrong shape for agent tooling: JVM
startup and memory footprint make a poor CLI, distribution requires a runtime, and
none of the agent/deploy ecosystem is there. The one place Spring could serve — the
SaaS control plane — Go also serves, with one language across engine and server.

### 3.3 Web code intelligence → **TypeScript analyzer (sidecar)**
The sites we generate/manage are Next.js/React/TS. "Find everything linked to this
component" needs *type-aware* analysis — only the TypeScript compiler does that
faithfully. So: a small TS analyzer package (ts-morph) that emits the code-side graph
as JSON; the Go engine consumes it. Go+tree-sitter handles the cheap 80% (imports,
routes, MDX links); the TS sidecar handles type-level truth.

### 3.4 Product & services → **Go backend + Next.js frontend + Claude Agent SDK (TS) workers**
- Control plane (tenants, projects, billing, deploy queue): Go (chi/echo + Postgres).
- Dashboard & prompt-to-site chat UI: Next.js on Vercel.
- Agent workers: Claude Agent SDK (TypeScript) — same skills the local plugin uses —
  running in sandboxed containers (Fly Machines / DO / Firecracker-style isolation).

### Verdict
**Go engine + Markdown skills + TS analyzer/agent-workers + Next.js surfaces.**
No Java. No Rust in v1.

---

## 4. Core design principles

1. **AI proposes, gates dispose.** Every deploy goes through `hive ship`. The model
   cannot skip a gate; gates are deterministic Go code. "All checks always ensured"
   is a property of the engine, never of the prompt.
2. **Everything is a module.** CMS, LinkedIn, Razorpay, GA4, OG-image generation —
   all conform to one `module.yaml` spec: what it provides, requires, its env vars,
   routes, components, migrations, gates, and a skill fragment teaching the agent
   how to use it. Build an integration once, `hive add` it forever.
3. **Intent is data.** Site intent, audience, user journeys, and keyword strategy
   live in `hive.yaml` + per-page front-matter — machine-readable, diffable,
   queryable. Changed intent → computed blast radius, not archaeology.
4. **One engine, two surfaces.** Local skill and cloud product run identical engine
   code. Dogfooding the CLI daily is QA for the product.
5. **Templates are products, not demos.** Each template (marketing site, blog,
   store, docs, portfolio) ships gate-passing, SEO/GEO-complete, lighthouse-green.
   The product's "minutes to launch" promise is only as good as the template floor.
6. **Public repo discipline.** Every feature lands with docs, tests, and an example.
   People must be able to clone, understand, and deploy without us.

---

## 5. System architecture

### 5.1 The `hive` engine (Go)

Command surface (v1):

```
hive init                      # adopt hive in an existing repo (writes hive.yaml, .hive/)
hive new <template> <name>     # scaffold a new site from a template
hive add <module>              # plug a module: hive add integrations/linkedin
hive check [--gate <g>]        # run all/one policy gates locally (parallel, cached)
hive graph [impact <node>]     # build graph; query blast radius of a change
hive intent diff               # what changed in declared intent vs current build
hive ship [--env prod]        # gates → build → deploy → verify → record release
hive content <sub>             # CMS ops: new post, seo-audit, geo-score, sitemap
hive doctor                    # env/tooling diagnosis (node, git, vercel token…)
hive module scaffold <name>    # create a new module skeleton conforming to spec
```

Internals (`internal/`):
- `engine/` — run plans: DAG of steps with caching (content-hash keyed, like a tiny
  Turborepo) so `hive ship` on an unchanged site is seconds.
- `graph/` — intent graph store (SQLite in `.hive/graph.db`), merges declared YAML
  + generated analyzer JSON; query API.
- `gates/` — gate interface + built-ins; each gate = `Check(ctx, project) Result`
  with machine-readable findings (file:line, severity, fix-hint for the agent).
- `modules/` — registry, resolver (semver), `module.yaml` loader, scaffolder.
- `deploy/` — driver interface; v1 drivers: **vercel** (API + token), **static**
  (any host via rsync/S3-compatible), **do-app**. Later: cloudflare, heroku.
- `templates/` — embedded (go:embed) + remote registry fetch.

### 5.2 Skill pack (Claude Code plugin, `plugin/`)

`.claude-plugin/plugin.json` + skills; installable via `/plugin install`. Skills are
thin: they teach Claude *when and how to call `hive`*, never to re-implement it.

| Skill | Purpose |
|---|---|
| `hive-launch` | prompt → pick template → scaffold → customize → `hive ship`. The golden path. |
| `hive-intent` | elicit/update intent (audience, tone, journeys, keywords) into `hive.yaml`; run `intent diff`; propose blast-radius edits |
| `hive-audit` | run `hive check`, interpret findings, fix, re-check until green |
| `hive-content` | blog/CMS workflow: brief → draft → SEO/GEO gates → publish |
| `hive-module` | build a new module conforming to spec (scaffold, tests, docs) |
| `hive-storyboard` | optional: user-journey/storyboard elicitation → pages plan before scaffold |

Each module also ships a `skill.md` fragment (e.g. "how to wire Razorpay webhooks")
that the plugin surfaces contextually — this is how integration knowledge compounds.

### 5.3 Intent graph

Two halves, continuously reconciled:

**Declared** (`hive.yaml` + page front-matter):
```yaml
site:
  intent: "Get Gujarat SMEs to book a forex consultation"
  audience: ["SME owners", "CFOs"]
  journeys:
    - name: book-consult
      steps: [home, /services/forex, /contact]
pages:
  /services/forex:
    intent: "convince: rates beat banks"
    keywords: [forex rates gujarat, sme currency exchange]
    sections: [hero, rate-table, testimonials, cta]
```

**Generated** (analyzers): component import graph, route graph, content→page usage,
integration touchpoints, internal links, env-var consumers.

Queries that kill the "bulky site" problem:
- `hive graph impact component:RateTable` → pages, journeys, keywords, tests affected.
- `hive graph impact intent:book-consult` → every artifact serving that journey.
- `hive intent diff` after editing hive.yaml → ordered TODO of what must change,
  which the skill turns into edits.
- **Drift detection**: declared says page targets keyword X, content no longer
  mentions X → gate warning.

### 5.4 Policy gates (v1 set)

| Gate | Tooling | Blocking? |
|---|---|---|
| types | tsc --noEmit | yes |
| lint | eslint (shared config) | yes |
| build | next build | yes |
| test | vitest/playwright if present | yes |
| secrets | gitleaks-style scan | yes |
| links | internal link checker | yes |
| a11y | axe on built pages | warn→yes later |
| seo | meta/OG/schema.org/sitemap/robots completeness | yes for product templates |
| geo | AI-citability score: standalone sections, FAQ schema, stats/citations present, llms.txt | warn |
| perf | Lighthouse budget (template-defined) | warn→yes later |

Gate output is JSON with fix-hints so the agent loop is: check → read findings →
edit → re-check. `hive ship` = gates + deploy + **post-deploy verification** (fetch
live URL, assert 200s, run smoke journey) + release record in `.hive/releases/`.

### 5.5 Module spec (the integrations library)

```yaml
# modules/integrations/linkedin/module.yaml
name: integrations/linkedin
version: 0.1.0
provides: [oauth-login, share-post, company-feed]
requires: { env: [LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET], node: ">=20" }
adds:
  routes: [app/api/linkedin/callback/route.ts]
  components: [components/linkedin/ShareButton.tsx]
  server: [lib/linkedin/client.ts]
gates:
  - name: linkedin-env
    check: env-present
docs: README.md
skill: skill.md          # teaches the agent usage patterns + pitfalls
tests: tests/
```

`hive add integrations/linkedin` copies/wires code, appends env template, registers
gates, updates the graph. Official registry lives in `modules/` here; third parties
can host their own (git URL install).

**v1 module targets** (chosen from what we already build repeatedly): cms/core,
integrations/{linkedin, postmark, do-spaces, ga4, google-search-console},
payments/{razorpay, stripe}, seo/og-images, ads/meta (phase 5), and
**systems/{rbac, ecom, credits, referrals}** — the business systems every project
rebuilds and where RBAC is always forgotten. `systems/rbac` is foundational:
modules adding authenticated/mutating routes must depend on it and annotate each
route's required role (registry lint enforces this).

**Versioning & compatibility (spec'd in docs/module-spec.md):** semver enforced by
manifest-surface diffing, mandatory per-module CHANGELOG, `hive.lock` in consumer
projects (module+version+content-hash), `hive module update` with changelog delta
and `--allow-major` guard, engine range via `requires.hive`, and an append-only
`.hive/journal.jsonl` audit trail of every module add/update/remove alongside the
`.hive/releases/` deploy records.

### 5.6 CMS + SEO/GEO engine

Git-based headless CMS first (content as MDX + JSON front-matter in the repo —
versioned, agent-editable, zero infra), DB-backed tenant CMS later for the product.

AI-managed SEO/GEO, so we "never rethink keywords/backlinks":
- **Keyword registry** per site in hive.yaml; every page declares targets; coverage
  and cannibalization computed by the graph.
- **Structural SEO automated**: sitemap, robots (AI crawlers allowed: GPTBot,
  ClaudeBot, PerplexityBot), schema.org (Article/Org/FAQ/HowTo/Breadcrumb), OG
  images, canonical, redirects ledger.
- **GEO scoring gate** built on 2026 best practice: standalone citable sections,
  named-source stats/quotes, comparison/best-of coverage, FAQ schema, llms.txt
  (cheap to emit even though Google says it ignores it — other engines differ),
  freshness tracking.
- **Content pipeline**: `hive content new` → brief (keyword + intent + journey) →
  agent drafts → content gates (keyword coverage, claim-has-source lint, reading
  level, internal links suggested from graph) → publish → GEO share-of-voice
  tracking later (phase 5).
- Backlinks: we don't automate acquisition (spam); we generate the *linkable asset
  plan* and track a backlink ledger.

### 5.7 The product (SaaS) — prompt → live site in minutes

Separate closed repo later (`alpha-hive-cloud`), but designed now:

**End-user journey:**
1. Landing → chat: "I run a bakery in Ahmedabad, I want orders on WhatsApp."
2. Agent (Agent SDK worker, sandboxed) elicits the 5 things that matter (name,
   audience, offer, tone, assets) → writes hive.yaml → `hive new` from best-fit
   template → customizes copy/sections/brand.
3. Preview URL (Vercel preview) in the chat within minutes; user iterates by prompt
   ("make it warmer", "add a menu page") — every iteration passes gates.
4. **Launch**: deploy to prod on our Vercel team (subdomain `*.alphahive.site` free
   tier) → optional **domain purchase** in-flow (reseller API: Namecheap/
   Cloudflare Registrar; we facilitate, user pays) → DNS + TLS automated.
5. **Dev handoff**: "Connect GitHub" (OAuth) → we push the repo to their account;
   from then on it's a normal repo they own — no lock-in, huge trust signal, and
   the hive CLI keeps working on it.
6. CMS tab: they edit content/blog through the dashboard; agent handles SEO/GEO.

**Control plane (Go + Postgres):** tenants, projects, agent-run queue, deploy
records, domain orders, billing (Razorpay for India + Stripe), usage metering per
agent-minute/deploy.
**Workers:** container per build; Agent SDK session with the hive skill pack; hard
resource/time limits; no tenant secrets in the model context (engine injects at
deploy time).
**Safety rails:** template floor + gates mean the worst prompt still yields a
correct, deployable site; content policy filter on prompts; per-tenant Vercel
project isolation.

"Every piece of software doable one by one": the expansion path is template + module
driven — v1 websites, then blogs/stores (modules already there), then web apps with
auth+DB (module: `stack/supabase` or our Go backend templates), then custom software.
The engine doesn't change; the template/module library grows.

**Launch target model (core product decision, 2026-08-20):** every product built
with hive chooses one of three launch targets — a choice any standard framework
must offer, and all three run the SAME engine through the SAME `deploy.Driver`
interface; what changes is who owns the credentials and where the engine runs:

| Target | Engine runs | Credentials | Cost model |
|---|---|---|---|
| **Launch with us** (managed) | our workers on our infra (DigitalOcean in our case — an implementation detail, not part of the framework contract) | ours | metered: cost modules attach here (build-minutes, agent-minutes, bandwidth, storage) |
| **Launch locally** (desktop/CLI) | user's machine via hive CLI or hive desktop (§5.8) | user's `.env` | free — their compute |
| **Launch on own infra** (BYO) | user's machine or CI | user's `.env` (their Vercel token, their droplet, their cloud) | free — their bill |

The platform is deliberately a THIN layer: it connects to infra and attaches cost
modules; it never becomes the only way to deploy. BYO uses the exact drivers the
managed path uses (vercel today; droplet next; more via the driver interface), so
leaving the managed tier is always possible — the anti-lock-in guarantee that
also makes "connect GitHub" credible.

**Launch surface:** the framework's public site ships on **nishgaba.com** (already
live on Vercel), replacing the personal homepage — the product carries the brand.
It includes an "About the creator" page (Nishchal Gaba) as the default; the
marketing template ships the same `/about` page so every deployer can put their own
identity there.

### 5.8 Desktop app (advanced local compute)

Browser sessions can't own heavy local compute (big builds, video render modules,
large graph analysis). Advanced users get **hive desktop** — Windows/macOS/Linux —
built with **Wails** (Go-native shell + webview): the Go engine is imported
directly as a library (same `internal/` packages in this monorepo, zero IPC), the
UI reuses the product's React components. Surfaces: visual intent-graph explorer,
gate dashboard with live findings, one-click ship, module manager. The CLI's
requirement that the engine be a clean importable library (thin cobra wrappers
only) is what keeps this cheap — hold that line in every phase. Ships as a
product track after P5 (the CLI already serves local power users until then).

---

## 6. Marketing AI & business modules (phase 5+)

- **ads/meta** — wraps Meta Ads API (we already have MCP access): campaign
  scaffolds from site intent + keywords, budget guardrails, weekly performance
  digest. Buying/selling optimization is *advisory first*, autonomous only with
  explicit budget caps.
- **payments/** — Razorpay + Stripe checkout/webhooks/receipts as modules.
- **trials/** — "genuine business trials with AI": template + metrics + a weekly
  report skill (traffic, conversions, GEO share-of-voice) that recommends the next
  experiment.
- **outreach/** — LinkedIn/email sequences built on the integrations, always
  human-approved sends.

## 7. Product tracks (dogfooding, from the original ToDo)

| Track | What ships | Framework pieces exercised |
|---|---|---|
| **Cover website launch** | Our own product/marketing site, built and shipped by hive | templates, gates, ship, SEO |
| **Blogging (CMS)** | Blog on that site, agent-run content pipeline | cms/core, content gates, GEO |
| **Paralympics coverage** | Content vertical (ties to ParaShakti) — news/athlete pages | CMS at scale, structured content types |
| **Video AI modularity** | video/ module family: script→render pipeline (ties to course-video-generator learnings) | module spec stress test — proves modules aren't web-only |

Rule: no framework feature is "done" until a product track uses it in production.

---

## 8. Repository structure (this repo)

```
ai-alpha-hive/
├── README.md                  # promise, quickstart, demo GIF
├── MASTER-PLAN.md             # this file
├── LICENSE                    # MIT (already present)
├── CONTRIBUTING.md
├── go.mod
├── cmd/hive/                  # CLI entrypoint (cobra)
├── internal/
│   ├── engine/  graph/  gates/  modules/  deploy/  scaffold/  config/
├── analyzers/ts/              # TS sidecar (npm pkg): ts-morph graph emitter
├── plugin/                    # Claude Code plugin
│   ├── .claude-plugin/plugin.json
│   └── skills/hive-launch/ hive-intent/ hive-audit/ hive-content/ hive-module/
├── modules/                   # official module registry
│   ├── cms/core/  integrations/  payments/  seo/  ads/
├── templates/
│   ├── marketing/  blog/  store/  docs/  portfolio/
├── examples/
│   └── bakery-demo/           # end-to-end example users can deploy
├── docs/
│   ├── quickstart.md architecture.md module-spec.md gates.md intent-graph.md
│   └── product-vision.md
├── scripts/install.sh         # curl-install for released binaries
└── .github/workflows/         # ci.yml (test matrix win/linux/mac), release.yml (goreleaser)
```

## 9. Testing & quality strategy

- **Engine:** table-driven Go unit tests; golden-file tests for scaffolds; gate
  contract tests (each gate: passing fixture + failing fixture + finding format).
- **E2E:** CI job that runs `hive new marketing demo && hive check && hive ship
  --driver static --dry-run` on all three OSes — the README quickstart *is* the test.
- **Modules:** spec conformance test (`hive module lint`) + per-module tests
  required to enter the registry.
- **Skills:** eval suite (`claude plugin eval`) for the golden path — prompt in,
  deployed preview out.
- **Templates:** every template must pass all gates + Lighthouse budget in CI.

## 10. Public-repo requirements (definition of "usable by strangers")

README with 90-second quickstart; versioned releases (binaries for
win/mac/linux/arm64) + `go install` + install.sh; docs/ complete; every command has
`--help` worth reading; examples/ deployable with a free Vercel account; CI badges;
CONTRIBUTING + module-authoring guide; no step that assumes our infra.

## 11. Roadmap

**Phase 0 — Skeleton (days).** Repo structure above, this plan, docs stubs, CI
scaffold, plugin skeleton. *Accept: clone → `go build ./...` green.*

**Phase 1 — Golden path (week 1–2). ✅ DONE 2026-08-20.** `hive new/check/ship` +
marketing template + Vercel driver + gates {secrets,deps,types,lint,build,test,
links,seo} + `hive-launch` + `hive-audit` skills + goreleaser releases +
examples/bakery-demo. Verified with a live Vercel deploy. *Deferred to phase 2:
content-hash gate caching (the <60 s unchanged re-ship target).*

**Phase 2 — Intent graph (week 3–4).** hive.yaml spec, TS analyzer, graph store,
`graph impact`, `intent diff`, drift gate, `hive-intent` skill. *Accept: change a
component in the example site → correct blast radius; change intent → actionable diff.*

**Phase 3 — Modules (week 5–6).** module.yaml spec + resolver + `hive add` +
`module scaffold` + first modules: cms/core, postmark, do-spaces, ga4, razorpay.
*Accept: `hive add payments/razorpay` on a fresh template → working checkout in
one session.*

**Phase 4 — CMS + SEO/GEO (week 7–8).** Content pipeline, content gates, GEO score,
llms.txt/schema/sitemap emitters, `hive-content` skill. **Ship product track 1+2:
our site + blog, built by hive.** *Accept: site live, first 3 articles published
through the pipeline, all gates green.*

**Phase 5 — Product alpha (week 9–12).** `alpha-hive-cloud` repo: control plane,
Agent SDK worker running the same skills, chat UI, Vercel team deploys, subdomains,
GitHub connect, waitlist billing. Domain purchase behind a manual concierge first,
reseller API after. *Accept: a non-dev goes prompt → live `*.alphahive.site` < 10 min
unassisted; GitHub export works.*

**Phase 6 — Business modules + tracks 3–4 (quarter 2).** ads/meta, trials reports,
paralympics content vertical, video/ module family, domain reseller API, Stripe+
Razorpay billing GA.

**Phase 7 — hive desktop.** Wails app over the same engine (see §5.8): graph
explorer, gate dashboard, one-click ship, module manager; goreleaser ships
win/mac/linux installers alongside the CLI binaries.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Scope explosion ("every software") | Hard rule: engine stays small; growth happens only in templates/modules |
| Gates too slow → agents bypass urge | content-hash caching; parallel gates; <60 s re-ship budget is a tracked metric |
| TS analyzer complexity | tree-sitter first (imports/routes), type-aware second; graph is additive |
| Vercel platform dependence | deploy driver interface from day 1; static driver proves it |
| Public repo + closed product tension | clean line: engine/modules/templates open; control plane/billing closed |
| Agent cost per customer site | template floor minimizes agent tokens; cache template customizations |

## 13. Open decisions (Nishchal)

1. Product name/domain for the SaaS (alphahive.site as free-tier subdomain?).
2. Domain reseller: Cloudflare Registrar (at-cost, cleaner API) vs Namecheap (reseller margin).
3. Module registry governance: monorepo-only v1 (recommended) vs git-URL installs from day 1.
4. Go module path: `github.com/nishgaba-ai/ai-alpha-hive` — confirm org name stays.
5. India-first billing (Razorpay) vs global (Stripe) at product alpha.
