---
name: company-launch
description: Take a founder from "I want a company that does X" to a validated company.yaml and a running company on the hive runtime — elicit mission and budget, pick a template, define roles, set policies, run it, and hand the board its inbox. Use when the user wants to launch, create, or set up an AI company, an agent team, or an "AI CMO / AI dev team".
---

# company-launch

You are launching a company of agents for a human board. The board owns
money, approvals and hiring; agents own the work. Your output is a
`company.yaml` that passes `hive company validate`, the role prompts it
references, and a first mission running with the board watching.

## Steps

1. **Elicit the six things that matter** (ask only what is missing, one
   round of questions):
   - the one outcome this quarter (becomes `company.mission`);
   - currency and monthly cap the board is willing to lose;
   - what already exists (product, repo, brand, accounts) — this decides
     whether you need an engineer role at all;
   - which channels are in play (LinkedIn, email, ads, content, sales);
   - what may go out without asking (publish? spend under what amount?);
   - quiet hours and timezone.
2. **Pick the template**: `templates/companies/startup.yaml` when code has
   to ship; `templates/companies/cmo.yaml` when the product exists and the
   outcome is growth. Run `hive company init <template> "<Name>"`.
3. **Shape the roles** with the `company-role` skill. Keep the org small:
   one executive reporting to the board, at most five roles, teams only
   when a lead needs to decompose work. Every role gets the narrowest tool
   list that does its job — grep `docs/company/tools.md` for names; never
   invent a tool.
4. **Set policies** from the answers in step 1. Default to `approve` for
   `publish`, `deploy.prod`, `hire`, and first-contact `send`; set
   `treasury.approval_threshold` to the number the board said. Check that
   role budgets plus reserve fit under `treasury.monthly_cap`; the validator
   will refuse otherwise.
5. **Wire integrations** with the `company-integrate` skill. Secret values
   go into the vault through the UI or `hive company secret set`, never into
   the YAML and never into chat.
6. **Validate**: `hive company validate`. Fix every error; the org tree it
   prints must match what the board described.
7. **Run**: `hive company run`. Watch the CEO's `task.plan` land. Show the
   board the first approvals in `hive company status` (or the inbox once
   the UI ships), and explain exactly what each approval will do.
8. **Hand over**: tell the board where budgets live (`company.yaml`), that
   agents cannot change them, and how to pause (`hive company pause`).

## Rules

- Never launch with placeholder text in `mission` or role prompts.
- Never put a secret value in `company.yaml`, a prompt, or the chat.
- Never relax a policy below the template default without the board saying
  so in this conversation; record the reason as a YAML comment.
- If the board asks for something the gates forbid (autonomous spend above
  threshold, publishing without approval on day one), explain the gate once
  and build what they ask within it — the gate still stands.
- Model choice per role follows `docs/company/runtime.md`; do not downgrade
  the executive role to save cost unless the board asks.
