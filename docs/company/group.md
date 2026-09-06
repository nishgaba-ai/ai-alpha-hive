# The group — many verticals, one board

Prodigal AI is the holding: the AI CMO product, Prodigal Realty, later
waste management. Each vertical is a **company** (its own `company.yaml`,
agents, treasury, ERP books); the **group** is the directory that holds
them and the board that runs them.

```
companies/
├── prodigal-ai/        company.yaml, roles/, workspace/
├── prodigal-realty/
└── prodigal-waste/
```

```bash
hive company run --group ./companies --port 4700     # one worker, every vertical
```

## What is shared

- The worker process, the control-plane database, the vault key.
- The board: platform users with RBAC roles (owner, admin, developer,
  viewer). Nishchal as owner, Surabhi as admin (approves, reviews, pulls
  statements), interns as developer or viewer.
- The integrations library and the templates gallery.
- The group overview (`/c`), the inbox badge across companies, Telegram
  commands (per company chat, or one chat with `/status` per company next).

## What is separate

- Every table row carries `company_id`; queries are company-scoped.
- Secrets are per company (`secrets(company_id, name)`): Realty's Meta ads
  token is not visible to the AI CMO's agents.
- Wallets, ledgers, payroll, cash accounts, statements.
- `company.yaml` — budgets and policies per vertical.

## Adding a vertical

From the UI: Launch a company → pick a template → name and mission. From a
terminal: `hive company init <template> "Prodigal Waste"` inside the group
directory, then restart or let the worker pick it up on next run. Either
way the new company appears in the header switcher and the group totals.

## Migrating the whole group

`hive company export --group ./companies` writes one bundle with every
company directory and every table; `hive company import bundle.json --into
./companies` on the new machine restores it. Carry `VAULT_KEY` and
re-clone workspaces (they are git repositories). Nothing references a
host outside `.env`.

## Next

- Group statement CSV (company column) and inter-company transfers.
- One Telegram chat for the whole group with `/status <slug>`.
- Per-company platform permissions (a viewer for Realty who cannot see the
  AI CMO's inbox).
