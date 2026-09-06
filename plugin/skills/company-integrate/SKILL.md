---
name: company-integrate
description: Connect a company to an external API or service — an existing hive module (Postmark, LinkedIn, GA4, Meta ads, GitHub, Razorpay, Stripe), a new tool wrapper, or an MCP server — with the right side-effect class, secrets in the vault, and a gate test. Use when an agent needs a new capability, an API key has to be stored, or "can the agents use X" is asked.
---

# company-integrate

Every capability is a tool with a side-effect class. Integrating means
choosing the class honestly, keeping secrets out of model context, and
proving the gate works before an agent touches it.

## Decide the shape

| Situation | Do |
|---|---|
| A hive module exists (`modules/`) | add it under `integrations:` in `company.yaml`, list its secret names, enable the role's tool patterns |
| The service has an MCP server | attach it under `integrations:` with `mcp:`, a `name`, and a `side_effect` for the whole server; add `overrides` per tool if some are read-only |
| Neither | write a tool wrapper: row in `docs/company/tools.md`, schema in `runtime/tools/manifest.ts`, wrapper in `runtime/tools/<family>/`, gate fixture test |

## Choose the side-effect class

Ask: if this call ran a thousand times by mistake, who would notice?

- nobody outside the company → `read` or `write`;
- a human would receive something → `send`;
- the public would see something → `publish`;
- money would move or be committed → `spend`;
- something would go to production → `deploy`;
- the org itself would change → `hire`.

When two apply, the primary is the one with the larger blast radius and
the other goes in `alsoGates`. When unsure, pick the stricter class; the
board can relax policy, but a wrong `read` label cannot be caught by
policy at all.

## Secrets

1. Name them in the module manifest or the `secrets:` list.
2. The board stores values through the vault UI or
   `hive company secret set NAME` (prompts on stdin, never an argument).
3. Wrappers resolve by name at execution time and redact any stored value
   from results before the model sees them.
4. Never print, log, or echo a value. If a wrapper needs to send the value
   to a third party, it does so inside the worker only.

## Prove it

- Unit test the wrapper against a recorded fixture.
- Gate fixture: one call that should pass, one that should park, one that
  should deny (wrong role). `npm test` in `runtime/`.
- Run one real call from a run with `--once` and check the event log shows
  the class, the decision, and no secret text.

## Rules

- No wrapper may call the provider's account, payout, or settings
  endpoints; those are `board` and live outside the runtime.
- Web access for agents is Anthropic's server tools with the company's
  domain lists; do not add a general browser tool without the board.
- Every attached MCP server must have a class; unassigned servers are not
  exposed, and the validator says so.
