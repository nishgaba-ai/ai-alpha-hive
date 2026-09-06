# Company schema

Two artefacts: `company.yaml` (declared intent, versioned in the company's
repo, edited by the board or by skills) and the control-plane tables
(runtime state). The YAML is the source of truth for structure; the tables
are the source of truth for what happened. JSON Schema for the YAML lives in
[`runtime/company.schema.json`](../../runtime/company.schema.json).

## company.yaml

```yaml
company:
  name: "Alpha Hive"
  slug: alpha-hive
  mission: "Get 100 founders to launch a company on the platform by December"
  currency: INR                  # ISO 4217; drives ledger + card currency
  board:
    - email: nishchal@prodigalai.com
      role: owner                # RBAC role in the platform org
  workspace:
    repo: github.com/nishgaba-ai/ai-alpha-hive   # coding roles work here
    hive_project: platform/web                    # hive.yaml lives here
  concurrency: 4                 # max simultaneous runs

treasury:
  monthly_cap: 50000             # company-wide, minor units NOT used — whole currency units
  approval_threshold: 2000       # any single spend above this asks the board
  card_provider: none            # none | stripe-issuing
  reserve: 10000                 # never allocated to agent wallets

policies:                        # gate defaults; roles may be stricter, never looser
  spend:   { under_threshold: allow, otherwise: approve }
  send:    { first_contact: approve, reply: allow }        # email/DM to humans
  publish: { default: approve }                            # public posts, ads live
  deploy:  { preview: allow, prod: approve }
  hire:    { default: approve }                            # new agents beyond plan
  quiet_hours: { tz: Asia/Kolkata, from: "22:00", to: "08:00", block: [send, publish] }

roles:
  - id: ceo
    title: Chief Executive
    harness: api                 # api | agent-sdk
    model: claude-fable-5-1
    effort: xhigh
    reports_to: board
    tools: [task.*, agent.*, message.*, web.*, report.*]
    budget: { monthly: 0 }       # plans, does not spend
    prompt: roles/ceo.md         # relative to company dir; templates ship defaults
  - id: cmo
    title: Chief Marketing Officer
    harness: api
    model: claude-opus-5
    effort: high
    reports_to: ceo
    tools: [task.*, message.*, web.*, linkedin.*, email.*, ads.meta.*, analytics.*, wallet.read, card.request]
    budget: { monthly: 15000, per_tx: 1000 }
    escalate: { on: [spend.denied, publish.denied], to: ceo }
  - id: engineer
    title: Software Engineer
    harness: agent-sdk
    effort: xhigh
    reports_to: ceo
    tools: [hive.*, github.*, web.fetch]
    workspace: true              # gets a checkout of company.workspace.repo
    count: 2

teams:
  - id: growth
    lead: cmo
    members: [cmo, writer]
  - id: product
    lead: engineer
    members: [engineer]

integrations:                    # tool families switched on; secrets live in the vault by name
  - module: integrations/postmark
    secrets: [POSTMARK_SERVER_TOKEN]
  - module: integrations/linkedin
    secrets: [LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET]
  - mcp: https://mcp.example.com/sse
    name: crm
    side_effect: send            # board assigns the class at attach time
```

Rules the loader enforces:

- Exactly one role has `reports_to: board`; the tree must be acyclic.
- Sum of role `budget.monthly × count` plus `treasury.reserve` ≤
  `treasury.monthly_cap`.
- Every tool pattern must match the catalogue; unknown patterns fail the
  load (fail closed, same as RBAC permissions).
- A role with `harness: agent-sdk` must set `workspace: true`.
- Policies in a role can only be stricter than company policies.

## Control-plane tables

All ids are ULIDs. Timestamps are epoch milliseconds. Money is stored in
minor units (paise, cents) as integers. Every row that belongs to a company
carries `company_id`; every company belongs to an `org_id` from the existing
RBAC schema, and every query is org-scoped by construction.

| Table | Key columns | Notes |
|---|---|---|
| `companies` | id, org_id, slug, name, yaml_hash, status (draft/running/paused/archived), created_at | `yaml_hash` detects drift between file and DB |
| `roles` | id, company_id, role_key, title, harness, model, effort, tools_json, budget_json, prompt_hash | one row per role in the YAML |
| `agents` | id, company_id, role_id, name, status (idle/running/parked/suspended), wallet_id, memory_ref, created_at | N per role (`count`) |
| `teams` / `team_members` | id, company_id, lead_agent_id / team_id, agent_id | |
| `tasks` | id, company_id, parent_id, title, intent, acceptance, owner_agent_id, status (planned/ready/running/parked/done/failed/cancelled), budget_cap, priority, due_at, created_by (agent or user) | DAG via `task_deps(task_id, depends_on)` |
| `runs` | id, company_id, task_id, agent_id, status, started_at, ended_at, input_tokens, output_tokens, cache_read_tokens, cost_minor, outcome_json | one per attempt |
| `events` | id, company_id, run_id, agent_id, ts, type, payload_json | append-only; the bus persists here |
| `approvals` | id, company_id, run_id, tool, side_effect, request_json, status (pending/approved/denied/expired), decided_by, decided_at, reason | the inbox |
| `wallets` | id, company_id, owner_type (company/agent), owner_id, currency, card_id | balances derived from ledger |
| `ledger_accounts` / `ledger_entries` | account per wallet + system accounts; entry = (journal_id, account_id, debit, credit, memo, ref) | double-entry; sum of debits = credits per journal |
| `cards` | id, wallet_id, provider, provider_card_id, last4, controls_json, status | never stores PAN |
| `artifacts` | id, company_id, run_id, task_id, kind (file/url/post/pr/report/campaign), ref, meta_json | |
| `messages` | id, company_id, from_agent_id, to_agent_id/to_user_id, thread_id, body, ts | agent-to-agent and agent-to-board |
| `secrets` | id, company_id, name, ciphertext, key_version | AES-GCM with `VAULT_KEY`; value never leaves the worker |
| `memory` | id, agent_id, kind (fact/preference/summary), body, ts | per-agent memory the role reads at run start |

### Event types (v1)

```
company.started company.paused
task.planned task.ready task.assigned task.done task.failed
run.started run.tool_call run.tool_result run.parked run.resumed run.ended
approval.requested approval.decided
spend.authorized spend.declined ledger.posted card.issued
message.sent artifact.created
agent.hired agent.suspended
```

Payloads are JSON with a stable `v: 1` field; the UI and the audit export
read only these.
