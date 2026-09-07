// Stripe — read-only finance view: balance, payments, customers and
// payouts through the same STRIPE_SECRET_KEY the cards module uses.
// Nothing here moves money (Checkout links are core payment-link.create;
// cards are card.*); results carry ids, minor-unit amounts and statuses,
// never card numbers or whole customer objects.

import { defineIntegration, strictSchema, fail } from "../../src/integrations/registry.js";
import { stripe } from "../../src/cards/stripe-issuing.js";
import type { ToolResult } from "../../src/types.js";

type Money = { amount: number; currency: string };
type Balance = { available?: Money[]; pending?: Money[]; livemode?: boolean };
type List<T> = { data?: T[]; has_more?: boolean };
type PaymentIntent = { id: string; amount: number; currency: string; status: string; customer?: string | { id: string } | null; description?: string | null; created: number };
type Customer = { id: string; email?: string | null; name?: string | null; created: number; delinquent?: boolean };
type Payout = { id: string; amount: number; currency: string; status: string; arrival_date: number; created: number; method?: string };

const iso = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null);
const lim = (v: unknown, d = 20) => Math.max(1, Math.min(Number(v ?? d) || d, 100));
const missing = () => fail("missing_secret", "STRIPE_SECRET_KEY is not in the vault (the same key the cards module uses)");
const errOf = (e: unknown): ToolResult => fail("stripe_error", e instanceof Error ? e.message : String(e));
/** ISO date, unix seconds or unix millis → unix seconds */
function sinceSeconds(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
}
const money = (m: Money[] | undefined) => (m ?? []).map((b) => ({ currency: b.currency.toUpperCase(), amount: b.amount }));

export default defineIntegration({
  id: "stripe",
  auth: { kind: "api_key", guide: "dashboard.stripe.com → Developers → API keys → Secret key (sk_live_… / sk_test_…). A restricted key with read access to Balance, PaymentIntents, Customers and Payouts is enough for this integration; cards and Checkout need the full key." },
  title: "Stripe (finance view)",
  description: "Read-only view of the Stripe account: balance, payments, customers and payouts.",
  website: "https://docs.stripe.com/api",
  guidance: `
## What it does
- **read** — \`stripe.balance\` shows available and pending balance per currency; \`stripe.payments\` lists payment intents (optionally since a date); \`stripe.customers\` searches or lists customers (id, email, name only); \`stripe.payouts\` lists payouts to the bank.

Everything is read-only and \`read\` class: no refunds, no charges, no customer edits, no card data. Amounts are integers in minor units (cents, paise) with a currency. Revenue that should land in the ledger arrives through the Stripe webhook (see treasury.md); this view is for the finance role's reports and reconciliation.

## Connecting
1. https://dashboard.stripe.com → **Developers → API keys**. Use the secret key the company already stores for cards and Checkout, or create a **restricted key** with read access to Balance, PaymentIntents, Customers and Payouts.
2. Store it as \`STRIPE_SECRET_KEY\` (one vault entry serves cards, payment links, the webhook and this view).
3. Run the healthcheck: it reads the balance.

## Enabling
\`\`\`yaml
integrations:
  - id: stripe
    modes: [read]
roles:
  - id: finance
    tools: [stripe.*, wallet.read, report.weekly]
\`\`\`
`,
  secrets: [
    { name: "STRIPE_SECRET_KEY", description: "Secret or restricted API key (sk_… / rk_…)", obtain: "https://dashboard.stripe.com → Developers → API keys" },
  ],
  modes: [
    { id: "read", title: "Read", description: "Balance, payments, customers, payouts", sideEffect: "read" },
  ],
  methods: [
    {
      name: "balance", mode: "read",
      description: "Available and pending balance per currency (minor units).",
      input: strictSchema({}),
      async handler(ctx) {
        if (!ctx.secrets.get("STRIPE_SECRET_KEY")) return missing();
        try {
          const b = await stripe<Balance>(ctx.secrets, "GET", "/balance");
          return { ok: true, available: money(b.available), pending: money(b.pending), livemode: !!b.livemode };
        } catch (e) {
          return errOf(e);
        }
      },
    },
    {
      name: "payments", mode: "read",
      description: "Recent payment intents, newest first. since: ISO date or unix seconds.",
      input: strictSchema({ limit: { type: "integer", minimum: 1, maximum: 100 }, since: { type: "string", description: "ISO date or unix seconds" } }, []),
      async handler(ctx, input) {
        if (!ctx.secrets.get("STRIPE_SECRET_KEY")) return missing();
        const q = new URLSearchParams({ limit: String(lim(input.limit)) });
        const since = sinceSeconds(input.since);
        if (since) q.set("created[gte]", String(since));
        try {
          const r = await stripe<List<PaymentIntent>>(ctx.secrets, "GET", `/payment_intents?${q}`);
          const payments = (r.data ?? []).map((p) => ({ id: p.id, amount: p.amount, currency: p.currency.toUpperCase(), status: p.status, customer: typeof p.customer === "string" ? p.customer : p.customer?.id ?? null, description: p.description ?? null, created: iso(p.created) }));
          return { ok: true, payments, has_more: !!r.has_more };
        } catch (e) {
          return errOf(e);
        }
      },
    },
    {
      name: "customers", mode: "read",
      description: "Customers (id, email, name). query: free text matched against email and name, or a Stripe search expression like email:'a@b.co'.",
      input: strictSchema({ query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, []),
      async handler(ctx, input) {
        if (!ctx.secrets.get("STRIPE_SECRET_KEY")) return missing();
        const limit = lim(input.limit);
        let path = `/customers?limit=${limit}`;
        if (input.query) {
          const q = String(input.query).trim();
          const esc = q.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
          const expr = q.includes(":") ? q : `email~'${esc}' OR name~'${esc}'`;
          path = `/customers/search?${new URLSearchParams({ query: expr, limit: String(limit) })}`;
        }
        try {
          const r = await stripe<List<Customer>>(ctx.secrets, "GET", path);
          const customers = (r.data ?? []).map((c) => ({ id: c.id, email: c.email ?? null, name: c.name ?? null, created: iso(c.created), delinquent: !!c.delinquent }));
          return { ok: true, customers, has_more: !!r.has_more };
        } catch (e) {
          return errOf(e);
        }
      },
    },
    {
      name: "payouts", mode: "read",
      description: "Payouts to the bank account, newest first.",
      input: strictSchema({ limit: { type: "integer", minimum: 1, maximum: 100 } }, []),
      async handler(ctx, input) {
        if (!ctx.secrets.get("STRIPE_SECRET_KEY")) return missing();
        try {
          const r = await stripe<List<Payout>>(ctx.secrets, "GET", `/payouts?limit=${lim(input.limit)}`);
          const payouts = (r.data ?? []).map((p) => ({ id: p.id, amount: p.amount, currency: p.currency.toUpperCase(), status: p.status, method: p.method ?? null, arrival_date: iso(p.arrival_date), created: iso(p.created) }));
          return { ok: true, payouts, has_more: !!r.has_more };
        } catch (e) {
          return errOf(e);
        }
      },
    },
  ],
  async healthcheck(ctx) {
    if (!ctx.secrets.get("STRIPE_SECRET_KEY")) return { ok: false, detail: "STRIPE_SECRET_KEY missing" };
    try {
      const b = await stripe<Balance>(ctx.secrets, "GET", "/balance");
      const avail = money(b.available).map((m) => `${m.currency} ${m.amount}`).join(", ") || "0";
      return { ok: true, detail: `${b.livemode ? "live" : "test"} mode; available: ${avail} (minor units)` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
});
