---
name: company-treasury
description: Set up and operate a company's money — budgets, wallets, spend policy, virtual cards with limits, payment links, and the weekly finance report. Use when the user asks how agents can spend, wants to give an agent a card or budget, needs to approve or investigate a spend, or wants revenue collection wired.
---

# company-treasury

Money in a hive company is ledger-backed and gate-capped. Read
`docs/company/treasury.md` once; this skill is the operating procedure.

## What only the board does (tell them, never do it for them)

- Create the Stripe (or Razorpay) account and complete onboarding.
- Fund the Issuing balance or the INR budget.
- Paste restricted API keys into the vault through the UI.
- Approve card issuance and raise any cap.

Never ask for, accept, or type card numbers, bank details, IDs or
passwords. If the user offers them in chat, stop them and point at the
vault UI or the provider's own page.

## Setting budgets

1. Ask for the monthly amount the board can lose and the single-transaction
   amount they are happy to never see. Those become `treasury.monthly_cap`
   and `treasury.approval_threshold`.
2. Allocate per role: inference for every role, plus spending budgets only
   for roles with `spend` tools. Leave `treasury.reserve` ≥ 10% of the cap.
3. `hive company validate` — it refuses over-allocation.

## Giving an agent a card

Only when `treasury.card_provider: stripe-issuing` and the entity supports
Issuing. Otherwise explain ledger-only mode: budgets and gates work the
same; the board pays approved items by hand from the inbox.

1. The role gets `card.request`, `card.purchase`, `card.transactions`,
   `card.freeze`, and a `card.allowed_categories` list.
2. The agent calls `card.request` in a run; it parks. The board approves
   from the inbox; the worker creates the card with spending controls equal
   to the role's `per_tx` and `monthly`, blocked categories always
   including cash advance and transfers.
3. Verify in the treasury screen: last4 shown, limits match, PAN never
   displayed anywhere.

## Handling a parked spend

Show the board: vendor, amount, wallet after, the agent's `reason`, and
how many similar approvals happened this month. If the same vendor keeps
parking under a sensible amount, propose adding it to
`policies.spend.merchants.allow` — the board edits the YAML; you do not.

## Revenue

Sales roles get `payment-link.create` and `payment-link.send`. Wire the
module (`payments/razorpay` for INR, `payments/stripe` otherwise) with the
`company-integrate` skill. Receipts post to `revenue` by webhook; never
give an agent refund or payout tools.

## Weekly report

The finance role's `report.weekly` produces: spend by agent and category,
cost per completed task, revenue, runway at current burn, and a proposed
reallocation. Read it with the board; apply changes only by editing
`company.yaml`.

## Investigating

`hive company ledger --wallet <id> --period 2026-09` prints journals.
Every entry has a `ref` to the run and event. If the ledger and the
provider disagree, the provider is right about money and the ledger is
right about intent; file the discrepancy as an approval item for the board.
