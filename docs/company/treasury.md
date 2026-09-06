# Treasury — how agents hold and spend money

The treasury is the part everyone wants and the part that must be boring.
Three layers, each one depending only on the one below it:

```
cards        Stripe Issuing virtual cards with engine-set controls   (C3)
ledger       double-entry accounts and journals; balances derived     (C3)
policy       spend gate: thresholds, merchant rules, approvals        (C1 gate, C3 rules)
```

## What Claude does and does not do

Claude never enters card numbers, bank details, government IDs or passwords
anywhere, and never initiates a transfer of funds itself. Concretely, the
board does these by hand, once:

1. Creates the Stripe account and completes Issuing onboarding.
2. Funds the Issuing balance (a bank transfer the board makes).
3. Puts the restricted API key in the company vault through the UI.

From then on agents *request* cards and *spend* through tools, and the
engine enforces controls Stripe applies at authorization time. Agents never
see a card number: the `card.request` tool returns a card id and last4; the
worker uses the Stripe API with the id when a merchant needs card details
for an API purchase, and only for merchants the policy allows.

## Ledger

Double-entry, in the control plane, as the `systems/credits` module from
the master plan. Accounts per company:

| Account | Type | Purpose |
|---|---|---|
| `funding` | equity | board top-ups (mirror of Issuing balance or an INR budget promise) |
| `reserve` | asset | never allocated to agents |
| `wallet:<agent>` | asset | each agent's spendable balance |
| `wallet:company` | asset | unallocated |
| `api-spend` | expense | model inference cost, posted per run |
| `external` | expense | card and payment spend, posted per authorization |
| `revenue` | income | Razorpay/Stripe Checkout receipts (sales agents) |

Invariants, tested: every journal balances; no account goes below zero
except `funding`; a wallet's `available` = balance − holds (pending
authorizations). Balances are computed from entries, never stored.

Monthly cycle: on the first of the month the scheduler posts each role's
`budget.monthly` from `wallet:company` to the agent wallets; leftover from
last month stays unless the role sets `rollover: false`.

## Cards (Stripe Issuing)

One virtual card per agent wallet that needs to buy things (API credits,
domains, ad spend, SaaS). Created by the worker with controls that mirror
the ledger:

```ts
stripe.issuing.cards.create({
  cardholder,                       // the company's cardholder, board-verified
  currency, type: "virtual",
  spending_controls: {
    spending_limits: [
      { amount: role.budget.per_tx,   interval: "per_authorization" },
      { amount: role.budget.monthly,  interval: "monthly" },
    ],
    allowed_categories: role.card?.allowed_categories,   // e.g. computer_software_stores, advertising_services
    blocked_categories: ["cash_advance", "wire_transfer", "gambling"],
  },
  metadata: { company_id, agent_id, wallet_id },
});
```

**Authorization webhook (`issuing_authorization.request`):** Stripe holds
the transaction until we answer. The worker's webhook endpoint (on the web
app, forwarded to the worker via the DB) checks: wallet available ≥ amount,
merchant not on the company's block list, policy threshold. It approves or
declines within Stripe's window; on decline it raises an approval so the
board can allow that merchant going forward. Every decision is an event and
a ledger hold.

**Board-only card actions** (`sideEffect: board`): create cardholder, fund
balance, raise any limit, unfreeze. Agents can call `card.request` (approval
by default) and `card.freeze` on their own card (allowed).

### India

Stripe Issuing is not generally available in India. INR companies run
**ledger-only**: budgets and spend are tracked and gated identically, but
payment happens through a board-held instrument the board uses when an
approval arrives, or through Razorpay-collected revenue. The policy layer,
approvals inbox and reports are the same; only the `card.*` family is off.
When a card provider becomes available for INR, the company flips
`treasury.card_provider` and nothing else changes.

## Spend policy

```yaml
policies:
  spend:
    under_threshold: allow          # ≤ treasury.approval_threshold and ≤ role per_tx
    otherwise: approve
    merchants:
      allow: [namecheap.com, api.openai.com, ads.meta.com]
      block: [anything not in allow when strict: true]
    strict: false
```

Order of checks in the gate for any `spend` tool call:

1. Role allowed to call the tool.
2. Wallet available ≥ amount (hold placed).
3. Amount ≤ role `per_tx` and ≤ company `approval_threshold` → allow;
   otherwise approve.
4. Merchant/vendor in block list → deny; not in allow list with
   `strict: true` → approve.

## Revenue

Sales roles get `payment-link.create` (Razorpay Payment Links for INR,
Stripe Checkout for others) with `sideEffect: send` when delivered to a
prospect. Webhooks post receipts to `revenue`. Agents never touch payouts,
refunds above threshold, or account settings — those are `board`.

## Reports

The finance role runs weekly (`report.weekly`): spend by agent and by
category, cost per completed task, revenue, runway at current burn, and a
proposed reallocation. It writes an artifact and messages the board. It
cannot apply the reallocation; the board edits `company.yaml`.

## Threats considered

| Threat | Control |
|---|---|
| Prompt injection tells an agent to buy something | Injected text cannot change policy; spend above threshold parks for a human; merchant lists are data |
| Agent raises its own budget | `budget.*` fields are in YAML the board owns; `hire`/`board` classes deny agents |
| Card details leak into a transcript | Worker never returns PAN/CVC to the model; redaction pass on tool results |
| Runaway inference cost | Per-run task budget, per-agent wallet, company cap, and the concurrency ceiling |
| Webhook forgery | Stripe signature verification; idempotent by authorization id |
