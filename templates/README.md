# Templates

## Site templates

Scaffolded by `hive new` (phase 1): marketing, blog, store, docs,
portfolio. Templates are products, not demos — every template must pass
all gates, ship SEO/GEO-complete, and stay Lighthouse-green in CI.

## Company templates (`companies/`)

Scaffolded by `hive company init <template> "<Name>"` or from the
**Launch a company** gallery in the product. Each is a `company.yaml` plus
the role prompts it references under `roles/`; `init` copies both into
the new company directory, and every template validates against
`runtime/company.schema.json` and resolves every tool pattern
(`npm run check:manifest`).

| Template | Shape | Use |
|---|---|---|
| `startup` | CEO, engineer (Claude Code), marketer, finance | ship a product through gates; the runtime's end-to-end test fixture |
| `cmo` | CMO, writers ×2, researcher, paid media, analyst | "AI CMO" — marketing for a product that exists |
| `ugc-growth` | growth lead, format tester, recruiters ×2, creator ops, analyst | creators on 30% lifetime commission, the Submagic route ([playbook](../docs/company/playbooks/ugc-creators.md)) |
| `trading-research` | head of research, quants ×2, risk, writer | research desk; **no execution tools exist by design** — the board trades |
| `real-estate` | principal broker, sales ×2, researcher, marketer | pipeline, gated outreach, deals the board signs |
| `waste-management` | GM, business development, ops planner, compliance, researcher | market entry with a costed ops plan and a compliance file |

Every template ships with: providers declared (Anthropic default, Ollama
and OpenRouter ready), policies that park anything public or above the
spend threshold, quiet hours, Telegram notifications, and the `content`
draft store. Swap models per role (`mock` runs with no API key).

Role prompts in `companies/roles/` are the shared library; a company may
override any of them in its own `roles/` directory. Spec:
[COMPANY-PLAN.md](../COMPANY-PLAN.md), schema:
[docs/company/schema.md](../docs/company/schema.md).

### Adding a template

Copy the closest YAML, change name/slug/mission/roles, add any new role
prompts to `roles/`, run `npm run check:manifest` in `runtime/`, and add
a row above plus a visual entry in the gallery
(`platform/web/app/c/new/page.tsx`).
