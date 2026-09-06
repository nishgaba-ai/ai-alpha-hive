---
name: company-role
description: Define or refine a role in a company — title, harness, model, effort, tool list, budget, escalation, and the role prompt markdown. Use when adding an agent role (engineer, CMO, writer, sales, finance), tuning one that under-performs, or writing a role prompt for the hive company runtime.
---

# company-role

A role is a job description the runtime can execute. It has two halves: the
YAML entry (what it may do and what it costs) and the prompt (how it thinks).
Both are reviewed by the board, so write them for a human reader.

## YAML entry

```yaml
- id: cmo                       # lowercase, stable; agents are named from it
  title: Chief Marketing Officer
  harness: api                  # api for office roles; agent-sdk only if it needs files and a shell
  model: claude-opus-5          # executive: claude-fable-5-1 · office: claude-opus-5 · volume: claude-sonnet-5
  effort: high                  # executive xhigh · office high · volume medium
  reports_to: ceo               # exactly one role reports to board
  tools: [...]                  # narrowest set; patterns from docs/company/tools.md
  budget: { monthly: 15000, per_tx: 1000 }
  escalate: { on: [spend.denied, publish.denied], to: ceo }
  prompt: roles/cmo.md
```

Decide the tool list by walking the role's week: what does it read, what
does it write, what does it send, what does it spend on. Give `read` tools
freely, `write` tools inside its team, and exactly the `send`/`publish`/
`spend` tools its channels need. A role that never spends gets no
`card.*` tools and `budget.monthly` covers only its inference.

Coding roles: `harness: agent-sdk`, `workspace: true`, tools `hive.*` plus
`github.pr.open`. They never get `hive.ship` for prod without the deploy
policy set to `approve` — the template default.

## Role prompt (`roles/<id>.md`)

Structure, in this order, under 600 words:

1. **Who you are** — title, who you report to, what your team is for.
2. **What good looks like** — the outcome you are measured on this
   quarter, in the board's words, with the numbers.
3. **How you work** — plan before acting; prefer one careful tool call over
   three; write a `reason` a human will read on every gated call; when
   parked, do useful non-gated work or end the run cleanly.
4. **Your tools, in your words** — one line per tool family: when you reach
   for it and when you do not.
5. **Boundaries** — the gates you will hit and why they exist; what to
   escalate and to whom; never argue with a denial, re-plan.
6. **Voice** (customer-facing roles) — tone, banned phrases, examples of
   one good and one bad sentence.

Write it plainly and not over-prescriptively: current models do better
with the goal, the constraints, and the reason for each constraint than
with step lists. Put the stable parts first (this file is the cache prefix)
and nothing time-varying in it — dates and task context come from the
runtime.

## Tuning a role

Read the last five runs (`hive company runs --role <id>`). Common fixes:

- tool denied repeatedly → the tool list is wrong or the role is doing
  another role's job; fix the org, not the prompt;
- parks on every run → thresholds too low for the job, or the role should
  batch requests into one approval;
- spends its budget on inference by day ten → lower effort or move volume
  work to a `claude-sonnet-5` worker under this role;
- output is generic → the prompt lacks section 2 (numbers) or section 6
  (voice).

## Rules

- Never give a role `board`-class tools; the validator refuses anyway.
- Never write a prompt that tells the agent to ignore, work around, or
  retry a gate.
- Keep prompts free of secrets, emails of real customers, and anything the
  board would not want in a transcript.
