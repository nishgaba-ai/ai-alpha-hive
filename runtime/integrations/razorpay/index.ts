// Razorpay — read-only finance view for INR: payments, settlements,
// payment links and orders with the same RAZORPAY_KEY_ID / _KEY_SECRET
// the core payment-link tool uses. Nothing here creates, captures or
// refunds; results carry ids, paise amounts and statuses, never card
// details.

import { defineIntegration, strictSchema, fail } from "../../src/integrations/registry.js";
import type { ToolResult } from "../../src/types.js";

const API = "https://api.razorpay.com/v1";

type Json = Record<string, unknown>;
type Payment = { id: string; amount: number; currency: string; status: string; method?: string; email?: string | null; description?: string | null; order_id?: string | null; captured?: boolean; created_at: number };
type Settlement = { id: string; amount: number; fees?: number; tax?: number; status: string; utr?: string | null; created_at: number };
type PaymentLink = { id: string; amount: number; amount_paid?: number; currency: string; status: string; short_url?: string; description?: string | null; created_at: number };
type Order = { id: string; amount: number; amount_paid?: number; amount_due?: number; currency: string; status: string; receipt?: string | null; created_at: number };

async function rz(id: string, secret: string, path: string) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), Accept: "application/json" } });
  const body = (await res.json().catch(() => ({}))) as Json;
  return { ok: res.ok, status: res.status, body };
}
const err = (r: { status: number; body: Json }): ToolResult => fail("razorpay_error", String((r.body.error as { description?: string } | undefined)?.description ?? `HTTP ${r.status}`), { status: r.status });
const missing = () => fail("missing_secret", "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not both in the vault (Dashboard → Account & Settings → API Keys)");
const keys = (s: { get(n: string): string | undefined }) => {
  const id = s.get("RAZORPAY_KEY_ID");
  const secret = s.get("RAZORPAY_KEY_SECRET");
  return id && secret ? { id, secret } : undefined;
};
const iso = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null);
const lim = (v: unknown, d = 20) => Math.max(1, Math.min(Number(v ?? d) || d, 100));
/** ISO date, unix seconds or unix millis → unix seconds */
function sinceSeconds(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
}
const items = <T,>(body: Json, key = "items"): T[] => (body[key] as T[] | undefined) ?? [];

export default defineIntegration({
  id: "razorpay",
  auth: { kind: "api_key", guide: "dashboard.razorpay.com → Account & Settings → API Keys → Generate key → Key Id (rzp_live_… / rzp_test_…) and Key Secret. The same pair the core payment-link tool uses." },
  title: "Razorpay (finance view)",
  description: "Read-only view of the Razorpay account: payments, settlements, payment links and orders in INR.",
  website: "https://razorpay.com/docs/api",
  guidance: `
## What it does
- **read** — \`razorpay.payments\` lists payments (optionally since a date); \`razorpay.settlements\` shows what was settled to the bank with fees and UTR; \`razorpay.payment_links\` lists links and whether they were paid; \`razorpay.orders\` lists orders with amount due.

Everything is read-only and \`read\` class: no captures, no refunds, no link creation (that is core \`payment-link.create\`). Amounts are integers in paise with a currency. Paid links post revenue to the ledger through the Razorpay webhook (see treasury.md); this view is for the finance role's reports and reconciliation.

## Connecting
1. https://dashboard.razorpay.com → **Account & Settings → API Keys** → Generate key (or reuse the pair already stored for payment links).
2. Store \`RAZORPAY_KEY_ID\` and \`RAZORPAY_KEY_SECRET\` (one pair serves payment links, the webhook and this view).
3. Run the healthcheck: it reads the latest payment.

## Enabling
\`\`\`yaml
integrations:
  - id: razorpay
    modes: [read]
roles:
  - id: finance
    tools: [razorpay.*, wallet.read, report.weekly]
\`\`\`
`,
  secrets: [
    { name: "RAZORPAY_KEY_ID", description: "Key Id (rzp_live_… / rzp_test_…)", obtain: "https://dashboard.razorpay.com → Account & Settings → API Keys" },
    { name: "RAZORPAY_KEY_SECRET", description: "Key Secret", obtain: "shown once when the key is generated" },
  ],
  modes: [
    { id: "read", title: "Read", description: "Payments, settlements, payment links, orders", sideEffect: "read" },
  ],
  methods: [
    {
      name: "payments", mode: "read",
      description: "Recent payments, newest first (paise). since: ISO date or unix seconds.",
      input: strictSchema({ limit: { type: "integer", minimum: 1, maximum: 100 }, since: { type: "string", description: "ISO date or unix seconds" } }, []),
      async handler(ctx, input) {
        const k = keys(ctx.secrets);
        if (!k) return missing();
        const q = new URLSearchParams({ count: String(lim(input.limit)) });
        const since = sinceSeconds(input.since);
        if (since) q.set("from", String(since));
        const r = await rz(k.id, k.secret, `/payments?${q}`);
        if (!r.ok) return err(r);
        const payments = items<Payment>(r.body).map((p) => ({ id: p.id, amount: p.amount, currency: p.currency, status: p.status, method: p.method ?? null, email: p.email ?? null, description: p.description ?? null, order_id: p.order_id ?? null, captured: !!p.captured, created_at: iso(p.created_at) }));
        return { ok: true, count: r.body.count ?? payments.length, payments };
      },
    },
    {
      name: "settlements", mode: "read",
      description: "Settlements to the bank account, newest first (paise, with fees, tax and UTR).",
      input: strictSchema({ limit: { type: "integer", minimum: 1, maximum: 100 } }, []),
      async handler(ctx, input) {
        const k = keys(ctx.secrets);
        if (!k) return missing();
        const r = await rz(k.id, k.secret, `/settlements?count=${lim(input.limit)}`);
        if (!r.ok) return err(r);
        const settlements = items<Settlement>(r.body).map((s) => ({ id: s.id, amount: s.amount, fees: s.fees ?? 0, tax: s.tax ?? 0, status: s.status, utr: s.utr ?? null, created_at: iso(s.created_at) }));
        return { ok: true, count: r.body.count ?? settlements.length, settlements };
      },
    },
    {
      name: "payment_links", mode: "read",
      description: "Payment links with status and amount paid, newest first (paise).",
      input: strictSchema({ limit: { type: "integer", minimum: 1, maximum: 100 } }, []),
      async handler(ctx, input) {
        const k = keys(ctx.secrets);
        if (!k) return missing();
        const r = await rz(k.id, k.secret, `/payment_links?count=${lim(input.limit)}`);
        if (!r.ok) return err(r);
        const links = items<PaymentLink>(r.body, "payment_links").map((l) => ({ id: l.id, amount: l.amount, amount_paid: l.amount_paid ?? 0, currency: l.currency, status: l.status, short_url: l.short_url ?? null, description: l.description ?? null, created_at: iso(l.created_at) }));
        return { ok: true, payment_links: links };
      },
    },
    {
      name: "orders", mode: "read",
      description: "Orders with amount paid and due, newest first (paise).",
      input: strictSchema({ limit: { type: "integer", minimum: 1, maximum: 100 } }, []),
      async handler(ctx, input) {
        const k = keys(ctx.secrets);
        if (!k) return missing();
        const r = await rz(k.id, k.secret, `/orders?count=${lim(input.limit)}`);
        if (!r.ok) return err(r);
        const orders = items<Order>(r.body).map((o) => ({ id: o.id, amount: o.amount, amount_paid: o.amount_paid ?? 0, amount_due: o.amount_due ?? 0, currency: o.currency, status: o.status, receipt: o.receipt ?? null, created_at: iso(o.created_at) }));
        return { ok: true, count: r.body.count ?? orders.length, orders };
      },
    },
  ],
  async healthcheck(ctx) {
    const k = keys(ctx.secrets);
    if (!k) return { ok: false, detail: "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing" };
    const r = await rz(k.id, k.secret, "/payments?count=1");
    if (!r.ok) return { ok: false, detail: String((r.body.error as { description?: string } | undefined)?.description ?? `rejected (HTTP ${r.status})`) };
    const latest = items<Payment>(r.body)[0];
    return { ok: true, detail: `${k.id.startsWith("rzp_test") ? "test" : "live"} keys accepted${latest ? `; latest payment ${latest.id} ${latest.status}` : "; no payments yet"}` };
  },
});
