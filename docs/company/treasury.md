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
domains, ad spend, SaaS). `runtime/src/cards/` holds the provider contract
and the Stripe Issuing implementation; the ledger stays the source of truth.

**Flow.** An agent calls `card.request` (class `hire`, always parks). The
board approves it in the Inbox. The handler then records the card and calls
the provider: `POST /v1/issuing/cards` with `type: virtual`, the company's
cardholder, and `spending_controls` mirrored from the request
(per-authorization and monthly limits, allowed categories). The card row
carries `provider_card_id` and `last4`; the number stays with Stripe.
Retry or freeze from **Treasury → Cards**.

**Vault secrets (per company):** `STRIPE_SECRET_KEY`,
`STRIPE_CARDHOLDER_ID` (the board creates the cardholder once in the Stripe
dashboard: legal name, address, KYC — the runtime never collects personal
details), `STRIPE_WEBHOOK_SECRET`. Set `treasury.card_provider:
stripe-issuing` in company.yaml.

**Authorization webhook** `POST /api/webhooks/stripe/<slug>` (signature
verified, idempotent on event id). For `issuing_authorization.request`
the worker answers synchronously from the ledger:

1. card exists and is `active`; currency matches the company
2. amount ≤ the card's per-transaction control
3. merchant passes `policies.spend.merchants` (block list, allow list)
4. month-to-date spend + amount ≤ the monthly control
5. wallet available ≥ amount → **hold** placed under `auth:<authorization id>`

Approved → `{ approved: true }`; otherwise `{ approved: false }` and a
`card.declined` event the board sees. `issuing_transaction.created`
captures the hold (or posts the spend when no hold exists);
`issuing_authorization.updated` with a reversal releases it. Stripe retries
are answered from the recorded outcome.

**Board-only card actions:** create the cardholder, fund the Issuing
balance, raise any limit. Agents can `card.request` (parks), `card.freeze`
their own card (allowed) and read `card.transactions` (ledger + provider).

### India

Stripe Issuing is not generally available in India. INR companies run
**ledger-only**: budgets and spend are tracked and gated identically, but
payment happens through a board-held instrument when an approval arrives,
or through Razorpay-collected revenue. When a card provider becomes
available for INR, the company flips `treasury.card_provider` and nothing
else changes.

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

Sales and finance roles get `payment-link.create` (Razorpay Payment Links
for INR, Stripe Checkout for others) and `invoice.create` / `invoice.send`
(GST-split invoices, see erp.md). Two webhooks post receipts:

- `POST /api/webhooks/stripe/<slug>` — `checkout.session.completed` with
  `payment_status: paid` posts `cash ← revenue` and marks the invoice whose
  `payment_link` matches as paid.
- `POST /api/webhooks/razorpay/<slug>` — `payment_link.paid` /
  `payment.captured`, verified with `RAZORPAY_WEBHOOK_SECRET` from the vault.

Both are exempt from the bearer token (the signature is the auth), recorded
once in `webhook_events`, and visible under **Treasury → Webhooks received**.
Agents never touch payouts, refunds above threshold, or account settings —
those are `board`.

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
