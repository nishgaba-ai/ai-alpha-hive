// Card lifecycle on top of the ledger: request → (board approves) → issue
// with the provider → authorizations ask the ledger → transactions capture.

import { all, newId, one, run } from "../db.js";
import * as ledger from "../ledger.js";
import { emit } from "../bus.js";
import { resolver } from "../vault.js";
import { stripeIssuing } from "./stripe-issuing.js";
import type { CardControls, CardProvider } from "./types.js";
import type { CompanyConfig, CompanyRow, Policies } from "../types.js";

export type { CardControls, CardProvider } from "./types.js";

export type CardRow = {
  id: string; company_id: string; wallet_id: string; agent_id: string | null; provider: string; provider_card_id: string | null; last4: string | null;
  controls_json: string; status: "requested" | "active" | "frozen" | "canceled" | "failed"; created_at: number;
};

export function providerFor(config: CompanyConfig): CardProvider | null {
  const id = config.treasury.card_provider ?? "none";
  if (id === "stripe-issuing") return stripeIssuing;
  return null;
}

export function cards(companyId: string): CardRow[] {
  return all<CardRow>("SELECT * FROM cards WHERE company_id = ? ORDER BY created_at DESC", companyId);
}

export function cardById(companyId: string, id: string): CardRow | undefined {
  return one<CardRow>("SELECT * FROM cards WHERE company_id = ? AND id = ?", companyId, id);
}

/** Record a request. Called from the card.request tool after the gate (hire class → the board already approved). */
export function requestCard(company: CompanyRow, config: CompanyConfig, agent: { id: string; wallet_id: string }, controls: CardControls): CardRow {
  const id = newId();
  run("INSERT INTO cards (id, company_id, wallet_id, agent_id, provider, controls_json, status, created_at) VALUES (?,?,?,?,?,?,'requested',?)",
    id, company.id, agent.wallet_id, agent.id, config.treasury.card_provider ?? "none", JSON.stringify(controls), Date.now());
  emit(company.id, "card.requested", { card_id: id, agent_id: agent.id, controls });
  return cardById(company.id, id)!;
}

/** Issue a requested card with the provider. Idempotent for active cards. */
export async function issueCard(company: CompanyRow, config: CompanyConfig, cardId: string): Promise<CardRow> {
  const card = cardById(company.id, cardId);
  if (!card) throw new Error("no such card");
  if (card.status === "active" && card.provider_card_id) return card;
  const provider = providerFor(config);
  if (!provider) throw new Error("this company runs ledger-only; set treasury.card_provider: stripe-issuing and store the Stripe secrets first");
  const secrets = resolver(company.id);
  const missing = provider.requiredSecrets.filter((n) => !secrets.get(n));
  if (missing.length) throw new Error(`missing secrets: ${missing.join(", ")}`);
  const agent = card.agent_id ? one<{ name: string }>("SELECT name FROM agents WHERE id = ?", card.agent_id) : undefined;
  try {
    const issued = await provider.issue(secrets, { companyId: company.id, cardId: card.id, agentName: agent?.name ?? "agent", currency: company.currency, controls: JSON.parse(card.controls_json) as CardControls });
    run("UPDATE cards SET provider_card_id = ?, last4 = ?, status = 'active' WHERE id = ?", issued.provider_card_id, issued.last4, card.id);
    run("UPDATE wallets SET card_id = ? WHERE id = ?", card.id, card.wallet_id);
    emit(company.id, "card.issued", { card_id: card.id, last4: issued.last4, provider: provider.id });
  } catch (e) {
    run("UPDATE cards SET status = 'failed' WHERE id = ?", card.id);
    emit(company.id, "card.failed", { card_id: card.id, error: (e as Error).message });
    throw e;
  }
  return cardById(company.id, cardId)!;
}

export async function setCardFrozen(company: CompanyRow, config: CompanyConfig, cardId: string, frozen: boolean): Promise<void> {
  const card = cardById(company.id, cardId);
  if (!card) throw new Error("no such card");
  const provider = providerFor(config);
  if (provider && card.provider_card_id) {
    if (frozen) await provider.freeze(resolver(company.id), card.provider_card_id);
    else await provider.unfreeze(resolver(company.id), card.provider_card_id);
  }
  run("UPDATE cards SET status = ? WHERE id = ?", frozen ? "frozen" : "active", card.id);
  emit(company.id, frozen ? "card.frozen" : "card.unfrozen", { card_id: card.id });
}

// ------------------------------------------------------- authorizations

export type AuthRequest = { provider_card_id: string; amount_minor: number; currency: string; merchant: string; category?: string; provider_auth_id: string };
export type AuthDecision = { approved: boolean; reason: string; hold_ref?: string; card?: CardRow };

function merchantBlocked(policies: Policies, merchant: string): boolean {
  const m = merchant.toLowerCase();
  const block = policies.spend?.merchants?.block ?? [];
  const allow = policies.spend?.merchants?.allow ?? [];
  if (block.some((b) => m.includes(b.toLowerCase()))) return true;
  if (allow.length && !allow.some((a) => m.includes(a.toLowerCase()))) return true;
  return false;
}

/**
 * Real-time authorization: the provider asks before the merchant is paid.
 * Approve only when the card is active, the merchant passes policy, the
 * amount is within the card's per-transaction control and the agent wallet
 * has that much available; then place a hold so parallel spends cannot
 * double-book the wallet.
 */
export function authorize(company: CompanyRow, config: CompanyConfig, req: AuthRequest): AuthDecision {
  const card = one<CardRow>("SELECT * FROM cards WHERE company_id = ? AND provider_card_id = ?", company.id, req.provider_card_id);
  if (!card) return { approved: false, reason: "unknown card" };
  if (card.status !== "active") return { approved: false, reason: `card ${card.status}` };
  if (req.currency.toUpperCase() !== company.currency.toUpperCase()) return { approved: false, reason: "currency mismatch", card };
  const controls = JSON.parse(card.controls_json) as CardControls;
  if (controls.per_tx && req.amount_minor > controls.per_tx) return { approved: false, reason: "over per-transaction limit", card };
  if (merchantBlocked(config.policies ?? {}, req.merchant)) return { approved: false, reason: "merchant blocked by policy", card };
  const wallet = one<{ owner_type: string; owner_id: string }>("SELECT owner_type, owner_id FROM wallets WHERE id = ?", card.wallet_id);
  const account = wallet?.owner_type === "company" ? "wallet:company" : ledger.walletAccount(wallet?.owner_id ?? "");
  if (controls.monthly && ledger.monthToDateSpend(company.id, account) + req.amount_minor > controls.monthly) return { approved: false, reason: "over monthly limit", card };
  if (ledger.available(company.id, account) < req.amount_minor) return { approved: false, reason: "insufficient available balance", card };
  try {
    const holdRef = ledger.hold(company.id, account, req.amount_minor, `card auth: ${req.merchant}`, `auth:${req.provider_auth_id}`);
    emit(company.id, "card.authorized", { card_id: card.id, merchant: req.merchant, amount_minor: req.amount_minor, hold_ref: holdRef });
    return { approved: true, reason: "within limits", hold_ref: holdRef, card };
  } catch (e) {
    return { approved: false, reason: (e as Error).message, card };
  }
}

/** A settled transaction: capture the hold placed at authorization (or post directly when none exists). */
export function settle(company: CompanyRow, req: { provider_card_id: string; provider_auth_id?: string; amount_minor: number; merchant: string; provider_txn_id: string }): { journal: string } | { skipped: string } {
  const card = one<CardRow>("SELECT * FROM cards WHERE company_id = ? AND provider_card_id = ?", company.id, req.provider_card_id);
  if (!card) return { skipped: "unknown card" };
  const wallet = one<{ owner_type: string; owner_id: string }>("SELECT owner_type, owner_id FROM wallets WHERE id = ?", card.wallet_id);
  const account = wallet?.owner_type === "company" ? "wallet:company" : ledger.walletAccount(wallet?.owner_id ?? "");
  const memo = `card: ${req.merchant}`;
  let journal: string;
  const holdRef = req.provider_auth_id ? `auth:${req.provider_auth_id}` : undefined;
  const open = holdRef ? one("SELECT 1 FROM ledger_entries WHERE company_id = ? AND hold_ref = ? AND kind = 'hold' AND released = 0", company.id, holdRef) : undefined;
  if (holdRef && open) journal = ledger.capture(company.id, holdRef, req.amount_minor, memo);
  else journal = ledger.post(company.id, [{ account: "external", debit: req.amount_minor }, { account, credit: req.amount_minor }], memo, req.provider_txn_id);
  emit(company.id, "spend.settled", { card_id: card.id, merchant: req.merchant, amount_minor: req.amount_minor, journal });
  return { journal };
}

/** Authorization reversed or expired: release the hold. */
export function reverse(company: CompanyRow, providerAuthId: string): void {
  ledger.release(company.id, `auth:${providerAuthId}`);
  emit(company.id, "card.auth_released", { provider_auth_id: providerAuthId });
}
