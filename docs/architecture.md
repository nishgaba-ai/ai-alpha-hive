# Architecture

One engine, two surfaces: a local CLI + Claude Code plugin for developers, and
(later, separate repo) a SaaS where the same engine is driven by Agent SDK
workers. Full rationale and roadmap: [MASTER-PLAN.md](../MASTER-PLAN.md).

```
L6 product (SaaS)      chat UI, billing, domains, GitHub connect   [later repo]
L5 agent runtime       Claude Code + plugin/ (local) · Agent SDK (cloud)
L4 modules             modules/ — cms, integrations, payments, ads, video
L3 intent graph        hive.yaml (declared) + analyzers/ts (generated)
L2 policy gates        internal/gates — ship refuses on blocking failure
L1 hive engine         cmd/hive + internal/{cli,config,engine,deploy,scaffold}
```

## Language choices (locked)

- **Engine/CLI: Go** — single static binary, cross-platform, parallel gates,
  the deploy-tooling ecosystem's language.
- **Skills: Markdown** — Agent Skills open standard; portable across agents.
- **Code intelligence: TypeScript sidecar** (`analyzers/ts`, ts-morph) — only
  the TS compiler gives type-aware "what links to this component" answers.
- **Product: Go control plane + Next.js UI + Agent SDK (TS) workers.**

## Portability contract

No machine-specific state outside environment variables (`.env.example`
documents them all). `hive doctor` diagnoses the environment. Migration to a
new machine = install Go+Node, clone, copy `.env`.
