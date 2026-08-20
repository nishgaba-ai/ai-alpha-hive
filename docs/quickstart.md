# Quickstart

## Install

Until binary releases ship (phase 1), build from source:

```bash
git clone https://github.com/nishgaba-ai/ai-alpha-hive
cd ai-alpha-hive
go build -o hive ./cmd/hive        # produces ./hive (hive.exe on Windows)
```

Requirements: Go ≥ 1.26, Node ≥ 20, git. Run `hive doctor` to verify.

## Portability

hive keeps no machine-specific state outside environment variables. To move
to a new machine: install Go+Node, clone the repo, copy your filled `.env`
(from `.env.example`). That is the entire migration.

## First project

```bash
hive init --name my-site --intent "Get visitors to book a call"
# edit hive.yaml: audience, journeys, pages
hive check          # policy gates; --json for machine-readable findings
```

Phase 1 adds `hive new` (templates) and `hive ship` (Vercel/static deploys).
Track progress in [MASTER-PLAN.md](../MASTER-PLAN.md) §11.
