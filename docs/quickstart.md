# Quickstart

## Install

Released binary (linux/macos):

```bash
curl -fsSL https://raw.githubusercontent.com/nishgaba-ai/ai-alpha-hive/main/scripts/install.sh | sh
```

Windows: download the zip from
[GitHub releases](https://github.com/nishgaba-ai/ai-alpha-hive/releases) and
put `hive.exe` on your PATH. Or from source on any OS (Go ≥ 1.26):

```bash
go install github.com/nishgaba-ai/ai-alpha-hive/cmd/hive@latest
```

Requirements at runtime: Node ≥ 20, git. Run `hive doctor` to verify.

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
