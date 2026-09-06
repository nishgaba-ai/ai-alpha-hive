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

## Who can do what

Access is per company, on top of the organisation roles. Org owners and
admins own every vertical implicitly; everyone else gets a row in
`company_access(user_id, org_id, slug, role)` from the company's
**Access** page (owners only). Three company roles:

| Role     | Can                                                                 |
| -------- | ------------------------------------------------------------------- |
| owner    | everything: approve, missions and tasks, `company.yaml`, secrets and integrations, ERP pay/approve, manage access |
| reviewer | view, approve or deny, start missions and edit tasks                |
| viewer   | view only                                                           |

So Nishchal (org owner) runs the group, Surabhi is a reviewer on the
verticals she co-reviews, and an intern is a viewer on the one company
they are assigned to and cannot see the others in the switcher or on `/c`.
Server actions and the `/api/hive` proxy check the same matrix
(`platform/web/lib/rbac.ts`), and every grant, removal and gated action is
an audit event.

To bring someone new in, an organisation owner opens the company's
**Access** page, fills in **Invite someone** (their email, an organisation
role — viewer by default — and reviewer or viewer on this company) and
copies the link the page shows, `/register?invite=<token>`, which is valid
for seven days and is never emailed by the app. The invitee registers or
signs in through that link with the same email; the invite is accepted at
their first sign-in, which puts them in your organisation with the
company_access rows already applied and makes it their current
organisation. Anyone in more than one organisation gets an **Organisation**
menu in the header to switch, and every create, accept and revoke is an
audit event (`org.invite.*`).

## Next

- Group statement CSV (company column) and inter-company transfers.
- One Telegram chat for the whole group with `/status <slug>`.
- Email the invite link from the app (today the owner copies and sends it).
