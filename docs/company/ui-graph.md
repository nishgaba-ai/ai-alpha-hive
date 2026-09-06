# Company UI — screens and the graph

All screens read from the control-plane tables and subscribe to
`/api/companies/:id/events` (SSE from the `events` table). Nothing in the
UI talks to the worker directly.

## Navigation

```
/companies                  list + "Launch a company"
/c/:slug                    Overview: floor (hero) + graph + stats + inbox drawer
/c/:slug/graph              Org graph full-screen
/c/:slug/missions/:id       Run graph for one mission (task DAG)
/c/:slug/agents/:id         Agent page: role, wallet, memory, runs
/c/:slug/runs/:id           Run stream
/c/:slug/inbox              Approvals
/c/:slug/treasury           Wallets, cards, ledger, weekly reports
/c/:slug/settings           company.yaml editor with validation, integrations, MCP attach
```

The inbox is also a drawer on every company page; a brass badge on the rail
shows pending count.

## Org graph

Library: `@xyflow/react` (React Flow 12). Layout: `dagre` top-down from the
board node; teams as group nodes with a glass background.

**AgentNode**

```
┌──────────────────────────────┐
│ ◉ Maya · CMO                 │  ← status ring (live/parked/idle/failed)
│ Drafting launch post · 4m    │  ← current task + elapsed
│ ▮▮▮▮▮▯▯▯  ₹6,200 / ₹15,000   │  ← spend meter for the month
│ claude-opus-5 · high         │  ← label row
└──────────────────────────────┘
```

Edges: reporting lines (hairline), active hand-offs (brass, animated pulse
on `task.handoff` and `message.sent`). Selecting a node opens a glass panel
with the last 20 events, wallet, and quick actions (message, pause, open
runs).

## Run graph

Nodes are tasks, edges are `task_deps`. Node fill grows with run progress
(events / expected); parked nodes get the brass beacon; failed nodes go
`--failed` with the failure reason on hover. A time scrubber at the bottom
replays the event log — the same component the landing page uses for the
demo.

## Run stream

A vertical timeline of events for one run: assistant text as prose, tool
calls collapsed to one line (`linkedin.post · parked · waiting for board`),
expandable to input/result JSON with secrets already redacted by the
worker. Cost and tokens in the header; a "resume with note" action for the
board.

## Inbox

One column, newest first. Each item shows: who, what tool, the class badge,
the amount or the content preview (post text, email body, diff summary for
deploys), the agent's `reason`, wallet after, and two buttons. Approving a
`publish` shows the exact text that will go out; approving a `spend` shows
vendor, amount, remaining cap. Decisions write `approvals` and the worker
resumes the run. Keyboard: `j/k` move, `a` approve, `d` deny, `r` reply.

## Treasury

Wallets as `Meter` cards, cards as `CardTile` (last4, limits, frozen
toggle), ledger as a table with journal grouping, weekly reports as
artifacts. Board-only actions (fund, raise cap) are buttons here that
open the provider's own page in a new tab — the app never collects payment
details.

## Settings

`company.yaml` in a code editor with schema validation inline, the org tree
preview updating as you type, a diff against the running version, and
"Apply" which bumps `yaml_hash` and tells the worker to reload. Integrations
and MCP attach live here; secrets are entered in a masked field that posts
straight to the vault endpoint.

## Data contracts the UI needs (C1 exposes these)

```
GET  /api/companies/:id                     company + roles + agents + teams
GET  /api/companies/:id/graph               nodes/edges for React Flow, precomputed
GET  /api/companies/:id/missions/:m/graph   task DAG
GET  /api/companies/:id/events?since=       page of events
GET  /api/companies/:id/events/stream       SSE
GET  /api/runs/:id                          run + events
POST /api/approvals/:id  {decision, note}   board only (RBAC product:deploy or org owner)
GET  /api/companies/:id/treasury            wallets, cards, ledger page
PUT  /api/companies/:id/yaml                validate + apply
POST /api/companies/:id/secrets             name + value → vault; value never returned
```

All routes are org-scoped through the existing session and `can()`; new
permissions: `company:read`, `company:write`, `company:approve`,
`company:treasury`.
