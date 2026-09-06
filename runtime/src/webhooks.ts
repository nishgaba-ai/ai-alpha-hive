// Inbound webhooks. Two providers today:
//   POST /api/webhooks/stripe/<slug>    Issuing authorizations (real-time,
//                                       answered from the ledger), settled
//                                       Issuing transactions, and Checkout /
//                                       Payment Link revenue.
//   POST /api/webhooks/razorpay/<slug>  payment_link.paid → revenue.
// Signatures are verified with the per-company vault secret; every event
// is recorded once in webhook_events (idempotent on provider + event id).

import { createHmac, timingSafeEqual } from "node:crypto";
import { newId, one, run } from "./db.js";
import * as ledger from "./ledger.js";
import { emit } from "./bus.js";
import { resolver } from "./vault.js";
import { authorize, settle, reverse } from "./cards/index.js";
import { markInvoicePaidByLink } from "./invoices.js";
import type { CompanyConfig, CompanyRow } from "./types.js";

export type WebhookEntry = { company: CompanyRow; config: CompanyConfig };

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Stripe-Signature: t=<ts>,v1=<hex>[,v1=…]; HMAC-SHA256(`${t}.${payload}`) with tolerance. */
export function verifyStripeSignature(payload: string, header: string | undefined, secret: string, toleranceSec = 300, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const sigs = header.split(",").filter((p) => p.trim().startsWith("v1=")).map((p) => p.trim().slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length) return false;
  if (Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return sigs.some((s) => safeEqual(s, expected));
}

/** X-Razorpay-Signature: HMAC-SHA256(payload) hex with the webhook secret. */
export function verifyRazorpaySignature(payload: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  return safeEqual(header, expected);
}

function recordOnce(provider: string, eventId: string, type: string, companyId: string): boolean {
  const seen = one("SELECT 1 FROM webhook_events WHERE provider = ? AND event_id = ?", provider, eventId);
  if (seen) return false;
  run("INSERT INTO webhook_events (id, provider, event_id, type, company_id, received_at) VALUES (?,?,?,?,?,?)", newId(), provider, eventId, type, companyId, Date.now());
  return true;
}

function outcome(provider: string, eventId: string, text: string) {
  run("UPDATE webhook_events SET outcome = ? WHERE provider = ? AND event_id = ?", text.slice(0, 500), provider, eventId);
}

function revenue(e: WebhookEntry, amountMinor: number, currency: string, memo: string, ref: string, paymentLink?: string) {
  if (currency.toUpperCase() !== e.company.currency.toUpperCase()) {
    emit(e.company.id, "revenue.foreign_currency", { amount_minor: amountMinor, currency, ref });
  }
  const journal = ledger.post(e.company.id, [{ account: "cash", debit: amountMinor }, { account: "revenue", credit: amountMinor }], memo, ref);
  const invoice = paymentLink ? markInvoicePaidByLink(e.company.id, paymentLink, ref) : undefined;
  emit(e.company.id, "revenue.received", { amount_minor: amountMinor, currency, ref, journal, invoice_id: invoice?.id ?? null, memo });
  return journal;
}

type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };

/**
 * Returns the JSON body to answer Stripe with. For issuing_authorization.request
 * the answer must be synchronous: { approved: boolean } within two seconds.
 */
export async function handleStripe(e: WebhookEntry, rawBody: string, signature: string | undefined): Promise<{ status: number; body: Record<string, unknown> }> {
  const secrets = resolver(e.company.id);
  const secret = secrets.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return { status: 400, body: { error: "STRIPE_WEBHOOK_SECRET missing from the vault" } };
  if (!verifyStripeSignature(rawBody, signature, secret)) return { status: 400, body: { error: "bad signature" } };
  const ev = JSON.parse(rawBody) as StripeEvent;
  const obj = ev.data.object;
  const first = recordOnce("stripe", ev.id, ev.type, e.company.id);

  switch (ev.type) {
    case "issuing_authorization.request": {
      // Stripe retries a request we already answered; answer the same way from the recorded outcome.
      if (!first) {
        const prev = one<{ outcome: string | null }>("SELECT outcome FROM webhook_events WHERE provider = 'stripe' AND event_id = ?", ev.id)?.outcome ?? "";
        return { status: 200, body: { approved: prev.startsWith("approved") } };
      }
      const card = obj.card as { id: string };
      const pending = (obj.pending_request as { amount?: number; currency?: string } | undefined) ?? {};
      const merchant = (obj.merchant_data as { name?: string; category?: string } | undefined) ?? {};
      const d = authorize(e.company, e.config, {
        provider_card_id: card.id,
        amount_minor: Math.abs(Number(pending.amount ?? obj.amount ?? 0)),
        currency: String(pending.currency ?? obj.currency ?? e.company.currency),
        merchant: merchant.name ?? "unknown",
        category: merchant.category,
        provider_auth_id: String(obj.id),
      });
      outcome("stripe", ev.id, `${d.approved ? "approved" : "declined"}: ${d.reason}`);
      if (!d.approved) emit(e.company.id, "card.declined", { card_id: d.card?.id ?? null, merchant: merchant.name, amount_minor: pending.amount, reason: d.reason });
      return { status: 200, body: { approved: d.approved, metadata: { hive_reason: d.reason } } };
    }
    case "issuing_authorization.updated": {
      if (!first) return { status: 200, body: { received: true } };
      if (obj.status === "reversed" || (obj.status === "closed" && obj.approved === false)) reverse(e.company, String(obj.id));
      outcome("stripe", ev.id, String(obj.status));
      return { status: 200, body: { received: true } };
    }
    case "issuing_transaction.created": {
      if (!first) return { status: 200, body: { received: true } };
      const card = obj.card as { id: string } | string;
      const merchant = (obj.merchant_data as { name?: string } | undefined) ?? {};
      const r = settle(e.company, {
        provider_card_id: typeof card === "string" ? card : card.id,
        provider_auth_id: obj.authorization ? String(obj.authorization) : undefined,
        amount_minor: Math.abs(Number(obj.amount ?? 0)),
        merchant: merchant.name ?? "unknown",
        provider_txn_id: String(obj.id),
      });
      outcome("stripe", ev.id, "journal" in r ? `settled ${r.journal}` : r.skipped);
      return { status: 200, body: { received: true } };
    }
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (!first) return { status: 200, body: { received: true } };
      if (obj.payment_status && obj.payment_status !== "paid") return { status: 200, body: { received: true, pending: true } };
      const link = obj.payment_link ? String(obj.payment_link) : undefined;
      const journal = revenue(e, Number(obj.amount_total ?? 0), String(obj.currency ?? e.company.currency), `stripe checkout ${obj.id}`, String(obj.id), link);
      outcome("stripe", ev.id, `revenue ${journal}`);
      return { status: 200, body: { received: true } };
    }
    default:
      outcome("stripe", ev.id, "ignored");
      return { status: 200, body: { received: true, ignored: ev.type } };
  }
}

type RazorpayEvent = { event: string; payload: { payment?: { entity: { id: string; amount: number; currency: string } }; payment_link?: { entity: { id: string; short_url?: string } } } };

export async function handleRazorpay(e: WebhookEntry, rawBody: string, signature: string | undefined, eventId: string | undefined): Promise<{ status: number; body: Record<string, unknown> }> {
  const secrets = resolver(e.company.id);
  const secret = secrets.get("RAZORPAY_WEBHOOK_SECRET");
  if (!secret) return { status: 400, body: { error: "RAZORPAY_WEBHOOK_SECRET missing from the vault" } };
  if (!verifyRazorpaySignature(rawBody, signature, secret)) return { status: 400, body: { error: "bad signature" } };
  const ev = JSON.parse(rawBody) as RazorpayEvent;
  const payment = ev.payload.payment?.entity;
  const id = eventId ?? payment?.id ?? newId();
  if (!recordOnce("razorpay", id, ev.event, e.company.id)) return { status: 200, body: { received: true, duplicate: true } };
  if ((ev.event === "payment_link.paid" || ev.event === "payment.captured") && payment) {
    const link = ev.payload.payment_link?.entity;
    const journal = revenue(e, payment.amount, payment.currency, `razorpay ${ev.event} ${payment.id}`, payment.id, link?.id ?? link?.short_url);
    outcome("razorpay", id, `revenue ${journal}`);
    return { status: 200, body: { received: true } };
  }
  outcome("razorpay", id, "ignored");
  return { status: 200, body: { received: true, ignored: ev.event } };
}
