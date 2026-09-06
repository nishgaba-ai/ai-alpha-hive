# Agent runtime

The runtime is a long-lived TypeScript worker (`runtime/`) that turns a
`company.yaml` into running agents. It owns four things: the role loops,
the scheduler, the event bus, and the side-effect gate. It never owns
policy decisions that belong to the board, and it never owns deploys —
those go through the Go engine.

## Processes

```
hive company run [--company <dir>] [--concurrency N]
   └─ spawns runtime/worker (node) with DATA_DIR, VAULT_KEY, ANTHROPIC_API_KEY
        ├─ loader      company.yaml → validated Company (JSON schema + rules)
        ├─ scheduler   ready tasks → runs, bounded by concurrency + budgets
        ├─ harness/api      office roles: Anthropic SDK tool runner
        ├─ harness/agent-sdk coding roles: Claude Agent SDK in a workspace
        ├─ gate        side-effect classification → allow / approve / deny
        ├─ bus         events → SQLite `events` + SSE for the UI
        └─ treasury    ledger postings, card authorization webhook client
```

The worker connects to the same database the web app uses. Locally that is
the SQLite file; on Vercel it is libSQL. There is no second API between
them — the tables are the contract, and the web app exposes SSE from the
`events` table.

## Two harnesses, one contract

Every role runs through the same interface:

```ts
interface Harness {
  start(run: Run, role: Role, agent: Agent, task: Task): AsyncIterable<RunEvent>;
  resume(run: Run, decision: ApprovalDecision): AsyncIterable<RunEvent>;
}
```

| Harness | Roles | Implementation | Why |
|---|---|---|---|
| `api` | CEO, CMO, PM, sales, finance, writer, researcher | `client.beta.messages.toolRunner` from `@anthropic-ai/sdk` with the role's tools built from `runtime/tools/manifest.ts`. Per-turn hook runs the gate before executing any tool. | No filesystem needed; cheapest loop we can fully control |
| `agent-sdk` | engineer, devops, data | `query()` from `@anthropic-ai/claude-agent-sdk` with `cwd` = the agent's workspace checkout, built-in tools, plus our `hive.*` tools as MCP. `canUseTool` hook runs the same gate. | Coding needs real file and shell tools; the Agent SDK already has the harness |

Both harnesses emit the same `RunEvent` union, so the UI, ledger and audit
do not know which one produced a run.

### Request shape for `api` roles

- `model` from the role (`claude-fable-5-1` executive, `claude-opus-5`
  office, `claude-sonnet-5` workers). Thinking left adaptive; `effort` from
  the role via `output_config.effort`.
- `betas: ["server-side-fallback-2026-07-01"]` and `fallbacks: "default"` on
  every request — a refusal degrades to a fallback model instead of parking
  the company. The event log records `usage.fallback` when it happens.
- Streaming always (`.stream()` + `finalMessage()`); `max_tokens` 64000.
- `tool_choice: auto` only. Forced tool use is rejected on Fable 5.1, and we
  do not need it: the system prompt names the expected tool and every tool is
  `strict: true`.
- Prompt caching: `system` = role prompt + company brief (stable, one
  `cache_control` breakpoint on the last block); tools sorted by name; task
  context and inbox are the first user message, after the breakpoint.
  Cache hit rate is a dashboard metric; zero on repeated turns is a bug.
- History is append-only. Nothing edits earlier turns; compaction uses the
  server-side `compact-2026-01-12` beta and preserves compaction blocks.
- Task budgets (`task-budgets-2026-03-13`) give each run a token ceiling
  derived from the task's budget cap so agents pace themselves.

### Memory

Each agent has a `memory` table. At run start the harness prepends the
agent's facts and last summary to the first user message (not the system
prompt — the system prompt is the cache prefix). At run end the harness asks
the model for a two-paragraph summary and stores it. Long-term, the
`memory_20250818` tool replaces this with model-managed memory; the table
stays the backing store.

## Scheduler

```
loop every 2s:
  for task in tasks where status = ready, ordered by priority, due_at:
    if running_runs >= company.concurrency: break
    agent = pick idle agent for task.owner role (least recent run first)
    if none: continue
    if wallet(agent).available < task.budget_cap: park task with reason budget; continue
    create run; harness.start(...)
```

Task readiness: all `task_deps` done, not cancelled, owner assigned. The
CEO role is the only one allowed to call `task.plan`, which writes a DAG
in one transaction; leads can call `task.create` inside their team.

Retries: a failed run retries once with the failure appended; a second
failure marks the task failed and raises `task.failed` to the owner's
manager as a message, never silently.

## Side-effect gate

Every tool in the manifest declares `sideEffect`:

| Class | Meaning | Default policy |
|---|---|---|
| `read` | no external effect | allow |
| `write` | changes the company workspace or DB | allow |
| `spend` | moves money or commits to a charge | allow under threshold, else approve |
| `send` | message to a human outside the company | first contact approve, replies allow |
| `publish` | public content or ads going live | approve |
| `deploy` | preview allow; prod approve | per `policies.deploy` |
| `hire` | new agent, new card, cap change | approve |
| `board` | only humans may call | deny for agents, always |

Decision function, in this order, fail closed:

1. Tool not in the role's `tools` patterns → deny, event `run.tool_denied`.
2. Quiet hours block the class → park until window opens.
3. Class-specific rule (spend: wallet available and thresholds; send:
   contact history; publish: always policy) → allow / approve.
4. `approve` → run parks (`run.parked`), `approvals` row created, agent gets
   a tool result saying it is waiting. On decision the harness resumes with
   the result or a denial the agent must plan around.

The gate is the same function for both harnesses and is unit-tested with a
fixture per class. Nothing in a prompt can change its answer.

## Secrets

Tools receive a `SecretResolver`. A tool wrapper asks for a secret by name
at execution time; the resolver decrypts from the `secrets` table with
`VAULT_KEY` inside the worker process. The model's tool input never
contains a secret and the model's tool result never echoes one — wrappers
redact any value that matches a stored secret before returning text to the
model. Agents may call `infra.secret.set` (write-only) so they can save a
credential a board member pasted into the vault UI, but never read it.

## Cost accounting

Every run stores token usage and the cost computed from the model price
table at run end. Ledger posting: model spend is a journal from the
company's `api-spend` account to the agent's wallet (agents pay for their
own inference — this is what makes "budget" mean something). Card spend
posts from the wallet to `external`. Weekly report reads the ledger only.

## Engine commands (Go, C1)

```
hive company init <template> "<Name>"   # scaffold company dir from templates/companies
hive company validate                   # schema + rules, prints the org tree
hive company run [--once]               # start the worker (or a single scheduler pass)
hive company status                     # agents, running/parked runs, wallet balances
hive company approve <id> | deny <id>   # CLI approvals before the UI exists
```

The Go side stays thin: it validates, spawns the Node worker with the right
environment, and reads the tables for status. It does not run agents.

## Failure modes to design for

- Worker dies mid-run: runs are marked `interrupted` on restart and re-queued
  once; tool calls with side effects are idempotent by `run_id + call_index`.
- Model refusal with no fallback: run parks with class `refusal`, board sees
  it in the inbox with the category.
- Budget exhausted: task parks with reason `budget`; the finance role's
  weekly report proposes reallocation; nothing auto-raises.
- Runaway loop: per-run wall clock and token ceilings from the task budget;
  exceeding either ends the run as `failed:budget`.
