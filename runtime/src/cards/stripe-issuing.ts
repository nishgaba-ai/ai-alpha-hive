// Stripe Issuing. Secrets (vault, per company):
//   STRIPE_SECRET_KEY        sk_live_… / sk_test_…
//   STRIPE_CARDHOLDER_ID     ich_… — the board creates the cardholder once in
//                            the Stripe dashboard (legal name, address, KYC);
//                            the runtime never collects personal details.
//   STRIPE_WEBHOOK_SECRET    whsec_… for /api/webhooks/stripe/<slug>
// Cards are virtual, one per agent wallet, with spending_controls mirrored
// from the request (per authorization + monthly) and allowed categories.

import type { SecretResolver } from "../types.js";
import type { CardControls, CardProvider, CardTxn, IssuedCard } from "./types.js";

const API = "https://api.stripe.com/v1";

function form(obj: Record<string, unknown>, prefix = ""): URLSearchParams {
  const p = new URLSearchParams();
  const walk = (v: unknown, key: string) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${key}[${i}]`));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, key ? `${key}[${k}]` : k);
    else p.set(key, String(v));
  };
  walk(obj, prefix);
  return p;
}

export async function stripe<T = Record<string, unknown>>(secrets: SecretResolver, method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<T> {
  const key = secrets.get("STRIPE_SECRET_KEY") ?? process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY missing from the vault");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2025-08-27.basil" },
    body: body ? form(body) : undefined,
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`stripe ${path}: ${json.error?.message ?? res.status}`);
  return json;
}

function spendingControls(c: CardControls) {
  const limits: { amount: number; interval: string }[] = [];
  if (c.per_tx) limits.push({ amount: c.per_tx, interval: "per_authorization" });
  if (c.monthly) limits.push({ amount: c.monthly, interval: "monthly" });
  return { spending_limits: limits.length ? limits : undefined, allowed_categories: c.categories?.length ? c.categories : undefined };
}

export const stripeIssuing: CardProvider = {
  id: "stripe-issuing",
  requiredSecrets: ["STRIPE_SECRET_KEY", "STRIPE_CARDHOLDER_ID", "STRIPE_WEBHOOK_SECRET"],
  async issue(secrets, req): Promise<IssuedCard> {
    const cardholder = secrets.get("STRIPE_CARDHOLDER_ID");
    if (!cardholder) throw new Error("STRIPE_CARDHOLDER_ID missing: create the cardholder in the Stripe dashboard (Issuing → Cardholders) and store its id");
    const card = await stripe<{ id: string; last4?: string; status: IssuedCard["status"] }>(secrets, "POST", "/issuing/cards", {
      cardholder,
      currency: req.currency.toLowerCase(),
      type: "virtual",
      status: "active",
      spending_controls: spendingControls(req.controls),
      metadata: { hive_company: req.companyId, hive_card: req.cardId, hive_agent: req.agentName, purpose: req.controls.purpose ?? "" },
    });
    return { provider_card_id: card.id, last4: card.last4 ?? null, status: card.status };
  },
  async freeze(secrets, id) {
    await stripe(secrets, "POST", `/issuing/cards/${id}`, { status: "inactive" });
  },
  async unfreeze(secrets, id) {
    await stripe(secrets, "POST", `/issuing/cards/${id}`, { status: "active" });
  },
  async transactions(secrets, id, limit = 50): Promise<CardTxn[]> {
    const r = await stripe<{ data: { id: string; created: number; amount: number; currency: string; merchant_data?: { name?: string }; type: string }[] }>(secrets, "GET", `/issuing/transactions?card=${id}&limit=${limit}`);
    return r.data.map((t) => ({ id: t.id, ts: t.created * 1000, amount_minor: -t.amount, currency: t.currency.toUpperCase(), merchant: t.merchant_data?.name ?? "", status: t.type }));
  },
};
