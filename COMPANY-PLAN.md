# Launch your AI company — Plan

> **One human, a company of agents, one engine that refuses to ship anything
> unchecked.** This is the plan to rebrand and extend AI Alpha Hive from
> "coding agent inside Claude Code" into a framework where a single person
> launches and runs a whole company of AI agents — engineers, marketers,
> product managers, sales, finance — each with real tools, real budgets and
> real infrastructure, and watches it run as a live graph.
>
> Status: **BUILT through C4, first pass (2026-09-06).** The runtime,
> the integrations library, ERP, voice/MCP, Telegram and the company UI
> exist and run locally on the mock provider end to end; real providers
> (Anthropic, OpenRouter, Ollama, Claude Code) are wired and need keys or
> logins to exercise. Section 13 lists exactly what is done and what is
> not. Supersedes the L5/L6 sections of [MASTER-PLAN.md](MASTER-PLAN.md);
> everything about the engine (L1–L4) stands. "AI CMO" is a company
> template (`templates/companies/cmo.yaml`), a strict subset of this.
>
> **Scope added the same day (Nishchal):** voice interaction, Prodigal AI
> as a group of verticals (AI CMO, Prodigal Realty, waste management)
> with Nishchal and Surabhi as the board and occasional interns, ERP
> under one roof (payroll, cash, expenses, time, task tracker, CA export),
> Telegram for statements and approvals, and a templates gallery with
> visuals (AI trading firm and others). All of it is designed and, except
> where §13 says otherwise, implemented.

---

## 0. Straight answer to "why hasn't this been built already"

Nothing about the model or the tooling blocks it. What was missing is four
components that were never scoped, because the earlier framing was "Claude
Code drives the hive CLI". They are:

| Missing piece | What it is | Where it lands |
|---|---|---|
| **Agent runtime** | A long-lived process that runs many agents concurrently against the Claude API, with roles, tools, budgets and an event log — not a chat UI | `runtime/` (TypeScript) |
| **Company model** | Data: company, roles, agents, teams, tasks, runs, approvals, wallets, policies, artifacts — the org chart as a graph in a database | `docs/company/schema.md`, `platform/web/lib/db.ts` |
| **Treasury + gates** | Money agents can actually spend (virtual cards with hard limits), and the "AI proposes, gates dispose" rule extended to spend, send, publish, deploy | `docs/company/treasury.md`, `runtime/gates/` |
| **Graph UI** | The company rendered live as a graph and a 3D floor, with a designed, modern interface instead of flat panels | `docs/company/design-system.md`, `docs/company/ui-graph.md`, `platform/web/` |

Two honest constraints, designed around rather than ignored:

1. **Money moves only through a human-created account.** Claude never enters
   card numbers, bank details or passwords, and never initiates a funds
   transfer itself. The board (you) creates the Stripe account and funds the
   Issuing balance; agents then *request* cards and *spend* within limits the
   engine enforces, and every card issuance and every top-up is a board
   approval. That is the guardrail that makes handing an agent a card sane.
2. **The runtime is a worker, not a serverless function.** Vercel hosts the
   UI and API; the agent loop runs as a long-lived worker (your laptop via
   `hive company run` today, the droplet next). Runs that take forty minutes
   do not fit in a request/response.

---

## 1. Product framing

**Name (working):** *Launch your AI company* — the product line. The engine
keeps its name (`hive`). Domains come later; everything runs on localhost
and Vercel preview URLs until then.

**Promise:** describe the company you want; get a running organisation of
agents in minutes — an org chart you can see, tasks you can watch move,
money you control, code that ships through gates, and a board seat that is
yours.

**Who it is for:** solo founders and tiny teams who want to run a company
larger than themselves; agencies that want one AI company per client; us —
the CMO template is the first thing we dogfood.

**What it is not:** a chatbot with plugins, and not an autonomous money
machine. Every external side effect (spend, send, publish, deploy to prod)
is a gate, and the board sets who may pass each gate without asking.

---

## 2. Architecture (updated layers)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ L7  COMPANY UI      graph view, 3D floor, approvals inbox, treasury,      │
│                     run timeline, agent chat — Next.js on Vercel/local     │
├──────────────────────────────────────────────────────────────────────────┤
│ L6  CONTROL PLANE   companies, roles, agents, tasks, runs, wallets,        │
│                     approvals, audit — SQLite now, libSQL/Postgres later   │
├──────────────────────────────────────────────────────────────────────────┤
│ L5  AGENT RUNTIME   runtime/ worker: role loops (API tool-runner for       │
│                     office roles, Agent SDK for coding roles), scheduler,  │
│                     event bus, side-effect gates, secrets injection        │
├──────────────────────────────────────────────────────────────────────────┤
│ L4  CAPABILITIES    modules/ + tools: email, LinkedIn, Meta ads, GitHub,   │
│                     Stripe Issuing, Razorpay, web, hive.* engine tools     │
├──────────────────────────────────────────────────────────────────────────┤
│ L3  INTENT GRAPH    hive.yaml + company.yaml — declared intent for both    │
│                     the product being built and the company building it   │
├──────────────────────────────────────────────────────────────────────────┤
│ L2  POLICY GATES    ship gates (types/lint/build/test/secrets/links/seo)   │
│                     + company gates (spend/send/publish/deploy/hire)       │
├──────────────────────────────────────────────────────────────────────────┤
│ L1  HIVE ENGINE     Go CLI — unchanged; gains `hive company` commands      │
└──────────────────────────────────────────────────────────────────────────┘
```

The engine stays Go and stays small. The runtime is TypeScript because the
Claude Agent SDK (coding roles) and the Anthropic SDK tool runner (office
roles) are TypeScript-first, and because the UI shares its types.

---

## 3. Core concepts

| Concept | Definition | Notes |
|---|---|---|
| **Company** | The tenant. Mission, board, currency, policies, treasury. | One `company.yaml`, one row in `companies`. |
| **Board** | The human(s). Owns approvals, budgets, hiring. | Maps to RBAC `owner`/`admin`. Never an agent. |
| **Role** | A job description: title, system prompt, harness, model, effort, allowed tools, budget, escalation rules. | Reusable across companies; templates ship a role library. |
| **Agent** | A running instance of a role inside a company, with its own wallet, memory and inbox. | One role can have N agents ("three engineers"). |
| **Team** | A named group of agents with a lead. | The lead decomposes team-scoped tasks. |
| **Task** | Unit of work with intent, acceptance criteria, owner, dependencies, budget cap. | Forms a DAG; the run graph is the task DAG lit up. |
| **Run** | One agent executing one task: messages, tool calls, cost, artifacts, outcome. | Append-only event stream; replayable. |
| **Event** | Everything that happened, typed. | The single source for UI, audit and metrics. |
| **Tool** | A typed capability with a side-effect class and a gate requirement. | Catalogue in `docs/company/tools.md`; code in `runtime/tools/manifest.ts`. |
| **Wallet** | Budget holder (company or agent) in the double-entry ledger; optionally backed by a virtual card. | See treasury. |
| **Policy** | Rule that turns a tool call into allow / approve / deny. | Spend, send, publish, deploy, hire. |
| **Approval** | A board decision requested by a policy, with full context. | Inbox in the UI; email/Slack later. |
| **Artifact** | Output: file, deployed URL, post, campaign, report, PR. | Linked to the run and task that produced it. |

Field-level schema: [docs/company/schema.md](docs/company/schema.md).

---

## 4. Runtime (how a company actually runs)

Full spec: [docs/company/runtime.md](docs/company/runtime.md). The shape:

1. **Board writes intent.** `company.yaml` (mission, roles, policies,
   budgets) — elicited by the `company-launch` skill, never typed from
   scratch.
2. **CEO agent plans.** The top role decomposes the mission into a task DAG,
   assigns owners by role, sets per-task budgets under the company cap.
   Anything it cannot assign becomes a *hire* request (an approval).
3. **Scheduler dispatches.** Ready tasks (dependencies met, budget
   available, owner idle) become runs. Concurrency is a company setting.
4. **Agents work.** Office roles (CMO, PM, sales, finance) run on the
   Anthropic SDK tool runner with the tools their role allows. Coding roles
   (engineer, devops) run on the Claude Agent SDK inside a checked-out repo
   and can only ship through `hive ship`.
5. **Gates dispose.** Every tool call carries a side-effect class. `read`
   passes. `write` passes inside the company workspace. `spend`, `send`,
   `publish`, `deploy:prod`, `hire` consult policy: auto-allow under
   thresholds the board set, otherwise park the run and raise an approval.
6. **Events stream.** The UI subscribes; the graph lights up; the ledger
   moves; the audit trail grows.
7. **Reports.** A finance role closes the week: spend by agent, outcomes by
   task, recommendation for next week's budgets. The board adjusts
   `company.yaml`; the loop continues.

**Model policy (defaults, overridable per role):**

| Role tier | Model | Effort | Why |
|---|---|---|---|
| Executive (CEO, architect) | `claude-fable-5-1` | `xhigh` | Long-horizon planning; decides what everyone else does |
| Office roles (CMO, PM, sales, finance) | `claude-opus-5` | `high` | Judgement-heavy, tool-heavy |
| Workers (research, drafting, extraction) | `claude-sonnet-5` | `medium` | Volume work under a lead's review |
| Coding roles | Agent SDK default (Opus-class) | `xhigh` | Ship through gates anyway |

Every request enables server-side refusal fallbacks (`fallbacks: "default"`)
so a declined request degrades instead of stalling a company. Prompt caching
is mandatory: role system prompts and tool lists are the stable prefix; task
context comes after the last cache breakpoint.

---

## 5. Treasury — money agents can hold

Full spec: [docs/company/treasury.md](docs/company/treasury.md). Summary:

- **Ledger first.** Double-entry ledger in the control plane (the
  `systems/credits` module the master plan already promised). Every wallet
  is an account; every spend is a journal entry; balances are derived, never
  stored.
- **Cards second.** Stripe Issuing virtual cards, one per agent wallet that
  needs one, created with **spending controls set by the engine**:
  per-transaction cap, monthly cap, allowed and blocked merchant categories.
  The card cannot exceed what the ledger says the wallet holds. India:
  Issuing is not generally available, so INR companies hold budget in the
  ledger and pay through board-held instruments or Razorpay-collected
  revenue; the policy layer is identical.
- **Authorization webhook.** Stripe asks before every card transaction; the
  runtime answers from policy in real time. Unknown merchant or over cap:
  decline and raise an approval.
- **Board-only actions:** create the Stripe account, fund the Issuing
  balance, approve card issuance, raise any cap. Never tools an agent can
  call unattended.
- **Revenue in:** Razorpay (India) and Stripe Checkout (global) as modules;
  sales agents create payment links, never touch payout settings.

---

## 6. Capabilities agents get (APIs, infra)

Everything an agent can do is a **tool** in the catalogue with a side-effect
class and a gate. Catalogue: [docs/company/tools.md](docs/company/tools.md).
Families:

- `hive.*` — new/check/ship/graph; the only path to production.
- `task.*`, `agent.*`, `message.*` — the org itself (plan, delegate, report).
- `web.search`, `web.fetch` — Anthropic server tools with domain allowlists.
- `email.*` (Postmark), `linkedin.*`, `ads.meta.*`, `github.*`,
  `analytics.ga4.*`, `search-console.*` — modules from the existing registry
  with tool wrappers.
- `wallet.*`, `card.*`, `payment-link.*` — treasury.
- `infra.*` — deploy targets, secrets (write-only for agents), domains.

**Secrets never enter model context.** Tools resolve credentials from the
company vault at execution time in the worker; the model sees names, never
values. This is the existing portability contract applied per company.

**MCP.** Any MCP server can be attached to a company as a tool family, with
a side-effect class assigned by the board at attach time. This is how "any
API" happens without a hand-written wrapper per API.

---

## 7. The UI — designed, dimensional, alive

Direction: [docs/company/design-system.md](docs/company/design-system.md).
Screens: [docs/company/ui-graph.md](docs/company/ui-graph.md).

- **Company graph** (React Flow): org chart with agents as living nodes —
  status ring, current task, spend meter; edges are reporting lines and
  active hand-offs. Click a node: the run stream.
- **Run graph:** the task DAG for a mission, nodes filling as runs complete,
  parked nodes glowing for approval.
- **3D floor** (react-three-fiber): the company as a space — agents as orbs
  on a floor plan, activity as light, a camera you can orbit. A hero, but a
  truthful one: it renders the same event stream.
- **Approvals inbox:** the board's job in one column; context, diff, cost,
  one-tap decide.
- **Treasury:** wallets, cards, ledger, forecast.
- **Design system:** dark obsidian ground, brass accent kept, depth via
  layered elevation and glass, motion with springs, display serif for
  headlines, grain and gradient light. No flat bordered rectangles.

---

## 8. Deployment for now

| Piece | Local | Vercel |
|---|---|---|
| UI + control-plane API (Next.js) | `npm run dev` in `platform/web` | Vercel project, preview URLs |
| Database | SQLite file under `DATA_DIR` | Vercel cannot hold a SQLite file; use Turso (libSQL) — decision 12.2 |
| Runtime worker | `hive company run` (spawns the TS worker) | Not on Vercel — runs on your machine or the droplet, connects to the same DB |
| Secrets | `.env` | Vercel env + company vault rows encrypted with `VAULT_KEY` |

**Recommendation:** libSQL/Turso for the Vercel path. It keeps the SQLite
schema and nearly the whole data layer unchanged, and a worker on a laptop
can reach it.

---

## 9. Phases and acceptance

| Phase | Ships | Accept when |
|---|---|---|
| **C0 Spec** (this round) | plan, schema, runtime, treasury, tools, design system, skills, templates | Reviewed by the board; a stranger can read and understand the product |
| **C1 Runtime core** | `runtime/` worker: company loader, role loops (API + Agent SDK), scheduler, event log, side-effect gate with approve/deny; `hive company {init,run,status}` | `templates/companies/startup.yaml` runs locally: CEO plans, engineer scaffolds via `hive new`, marketer drafts a launch post, both parked at their gates, board approves in CLI, run completes |
| **C2 UI + graph** | Design system implemented; company graph, run graph, approvals inbox, run stream; 3D floor v1 | Watching C1's run live in the browser, approving from the inbox |
| **C3 Treasury** | Ledger module, wallets, Stripe Issuing cards with controls, authorization webhook, policies, weekly finance report | An agent buys an API credit under cap without asking; an over-cap attempt is declined and appears in the inbox |
| **C4 Capabilities** | Tool wrappers for email, LinkedIn, Meta ads, GitHub, GA4; MCP attach; vault | CMO template runs a real (board-approved) LinkedIn post and reads its analytics |
| **C5 CMO product track** | `cmo.yaml` runs for our own product for four weeks | Weekly reports land; the board changes budgets only via `company.yaml` |
| **C6 Multi-tenant on Vercel** | Companies per org, Turso, worker on droplet | A second person launches a company with no help |
| **C7 Demo** | Hackathon / public demo build | Five-minute story from prompt to running company with a live graph |

Rule carried over: no runtime feature is done until a company template uses
it for real.

---

## 10. Repository layout (additions)

```
ai-alpha-hive/
├── COMPANY-PLAN.md                 # this file
├── docs/company/
│   ├── schema.md  runtime.md  treasury.md  tools.md
│   ├── design-system.md  ui-graph.md
├── runtime/                        # TS worker (C1)
│   ├── package.json
│   ├── tools/manifest.ts           # tool contracts as code (C0)
│   ├── company.schema.json         # company.yaml JSON schema (C0)
│   ├── roles/  gates/  harness/  scheduler/  events/   (C1)
├── templates/companies/
│   ├── startup.yaml  cmo.yaml
├── plugin/skills/
│   ├── company-launch/  company-role/  company-treasury/
│   ├── company-integrate/  company-infra/  hive-design/
└── platform/web/                   # gains the company UI (C2)
```

---

## 11. Non-negotiables

1. Every external side effect is a gate. No tool bypasses policy; policy is
   engine code, not prompt text.
2. Money is ledger-backed and card-capped. An agent cannot spend what its
   wallet does not hold, and cannot raise its own cap.
3. Secrets never enter model context.
4. Production deploys go through `hive ship`. Coding agents get no other
   deploy tool.
5. Board actions are human-only: fund, issue cards, raise caps, hire beyond
   plan, delete a company.
6. Everything is an event. If the UI shows it, it came from the event log.

---

## 12a. Model backends (added)

Roles name a backend as `<provider>/<model>`; the runtime resolves it:

| Ref | Backend | Needs |
|---|---|---|
| `anthropic/claude-opus-5`, or a bare `claude-*` id | Anthropic SDK; adaptive thinking, effort per role, strict tools, prompt caching, refusal fallbacks | `ANTHROPIC_API_KEY` |
| `claude-code` | Claude Agent SDK in the company workspace, catalogue tools exposed as an in-process MCP server, built-ins confined to the workspace | Claude Code login on the worker (UI mode) or an API key |
| `openrouter/<vendor>/<model>` | OpenAI-compatible chat completions with tools | `OPENROUTER_API_KEY` |
| `ollama/<model>` | same, local, no key | Ollama running with a tool-capable model |
| `mock` | deterministic demo: plans, drafts, parks a publish | nothing |

Providers are declared under `providers:` in `company.yaml`; keys are
referenced as `env:NAME` or `vault:NAME`, never literal.

## 12b. The group, ERP, voice, Telegram, templates (added)

- **Group of verticals** — one worker runs a directory of companies;
  `/c` sums them; each company keeps its own secrets, wallets, books.
  [docs/company/group.md](docs/company/group.md).
- **ERP under one roof** — people, payroll, expenses, time, cash
  accounts, monthly statement (JSON/CSV) for the CA; human tasks in the
  same tracker as agent tasks. [docs/company/erp.md](docs/company/erp.md).
- **Voice** — MCP server for Claude's apps (voice mode included) and an
  in-product console with browser or server speech; the board assistant
  reads everything and acts only on explicit instruction.
  [docs/company/voice.md](docs/company/voice.md).
- **Telegram** — approvals pushed with Approve/Deny buttons; `/status`,
  `/approvals`, `/approve`, `/deny`, `/statement YYYY-MM`, `/mission`,
  `/ask` from allowed chats only.
- **Templates gallery** — startup, cmo, trading-research (no execution
  tools by design), real-estate, waste-management; each with roles,
  policies, integrations and role prompts; visual cards in the product.

## 12c. Integrations: keys or OAuth, Postiz, automations (added)

- Every integration declares `auth`: `api_key` (masked fields, healthcheck)
  or `oauth2` (Connect button; the runtime runs authorize → callback →
  token, stores tokens in the vault, refreshes them). Live today: LinkedIn,
  Reddit, X (PKCE), Slack, Meta, Google (one connection for GA4 and Search
  Console). Guide: [docs/company/integrations.md](docs/company/integrations.md).
- **Postiz** is the social scheduling backbone: the board connects channels
  inside Postiz (its own OAuth per network) and the company schedules
  through one API key; every schedule parks as `publish`.
- **Automations** in `company.yaml` fire recurring missions (`every: 1d`,
  `at: "09:00"`), the base for social automations: daily conversation
  sweeps, weekly GEO probes, monthly statements.
- Roadmap order the board set: Postiz → social automations → the Okara v2
  shape (website intake, strategy docs, SEO/GEO/social/influencer roles in
  parallel), all inside the AI CMO template.

## 13. What is built and what is not (2026-09-07)

**Built and exercised end to end (mock provider, unit tests):** company
loader and validation; scheduler; gate with holds; ledger; vault with
redaction; API + SSE; approvals resume for both harnesses (Claude Code
resumes its SDK session on the board's decision); ERP flows including
invoices with the GST split, the monthly GST summary, bank CSV import with
dedupe, the group statement; cards: request → approve → issue, real-time
authorization answered from the ledger, settlement, reversal; Stripe and
Razorpay webhooks with signature checks and idempotency; export → import
on a fresh database (round trip covered by a test); CLI; `hive company` in
the Go binary; MCP server; MCP client bridge; Telegram bridge with voice
notes; website intake; per-company access (owner / reviewer / viewer) with
invites; template gallery with org-chart previews; all UI screens against
live data.

**Built, not yet exercised against the real service (needs keys or
accounts):** Anthropic provider (the live key's account needs credits),
OpenRouter and Ollama providers, the Claude Code harness on the worker,
every integration's API calls, Stripe Issuing, Cloudflare DNS, Porkbun
registration, server STT/TTS, attaching a real MCP server.

**Designed, not built:** Vercel hosting of the UI (the web app keeps
users, sessions and audit in SQLite; Vercel needs a hosted database —
see docs/company/deploy.md); TDS and the quarterly pack; inter-company
transfers; emailing invite links (the owner copies the link today);
WhatsApp, Google Drive and Notion integrations.

**Known limits:** inference cost is converted to INR at a fixed rate for
visibility; the board assistant on the mock provider answers with a canned
status line; a Claude Code approval honoured once is remembered in memory,
so a worker restart could honour it a second time on the same run.

## 12. Open decisions for the board

1. Product name and domain (working title above).
2. Vercel DB: Turso (recommended) vs Neon Postgres.
3. Stripe Issuing entity and country — needed before C3; INR companies run
   ledger-only until Issuing is available in India.
4. First real company to run: the CMO for this product (recommended) or
   Nishi Forex outreach.
5. Whether the 3D floor ships in C2 or waits for C5 (it is a hero, not a
   dependency).
