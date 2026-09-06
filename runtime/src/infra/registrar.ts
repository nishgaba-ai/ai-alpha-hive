// Registrars behind infra.domain.search / infra.domain.buy.
//
//   search  RDAP for availability (no key) + Porkbun's public price list for
//           an honest first-year cost, so the gate can hold the amount.
//   buy     a spend-class tool: the gate parks it above the threshold. Two
//           providers: `porkbun` (API key + secret in the vault; registers
//           through the registrar API) and `manual` (creates a board task with
//           the exact name, price and nameservers; the human buys it). Cards
//           are never typed by an agent — registrar purchases draw on the
//           account balance the board funded at the registrar.
//
// Vault: PORKBUN_API_KEY, PORKBUN_SECRET_KEY

import type { SecretResolver } from "../types.js";

export type DomainQuote = { name: string; available: boolean; registrar: string; price_minor?: number; currency?: string; note?: string };

export interface Registrar {
  id: string;
  requiredSecrets: string[];
  quote(secrets: SecretResolver, name: string): Promise<DomainQuote>;
  buy(secrets: SecretResolver, name: string, years: number, nameservers?: string[]): Promise<{ ok: boolean; order_id?: string; detail: string }>;
}

const PORKBUN = "https://api.porkbun.com/api/json/v3";
let priceCache: { at: number; prices: Record<string, { registration: string }> } | null = null;

async function porkbunPrices(): Promise<Record<string, { registration: string }>> {
  if (priceCache && Date.now() - priceCache.at < 6 * 3600_000) return priceCache.prices;
  const res = await fetch(`${PORKBUN}/pricing/get`);
  const body = (await res.json()) as { status: string; pricing?: Record<string, { registration: string }> };
  priceCache = { at: Date.now(), prices: body.pricing ?? {} };
  return priceCache.prices;
}

export async function rdapAvailable(name: string): Promise<boolean> {
  const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(name)}`, { redirect: "follow" });
  return res.status === 404;
}

export const porkbun: Registrar = {
  id: "porkbun",
  requiredSecrets: ["PORKBUN_API_KEY", "PORKBUN_SECRET_KEY"],
  async quote(_secrets, name) {
    const tld = name.split(".").slice(1).join(".");
    const [available, prices] = await Promise.all([rdapAvailable(name), porkbunPrices().catch(() => ({}) as Record<string, { registration: string }>)]);
    const usd = prices[tld]?.registration;
    return { name, available, registrar: "porkbun", price_minor: usd ? Math.round(Number(usd) * 100) : undefined, currency: usd ? "USD" : undefined, note: usd ? "first-year registration at Porkbun list price" : "no list price for this TLD" };
  },
  async buy(secrets, name, years) {
    const apikey = secrets.get("PORKBUN_API_KEY");
    const secretapikey = secrets.get("PORKBUN_SECRET_KEY");
    if (!apikey || !secretapikey) return { ok: false, detail: "PORKBUN_API_KEY and PORKBUN_SECRET_KEY missing from the vault" };
    const res = await fetch(`${PORKBUN}/domain/create`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apikey, secretapikey, domain: name, years }) });
    const body = (await res.json()) as { status: string; message?: string; orderId?: string };
    return body.status === "SUCCESS" ? { ok: true, order_id: body.orderId, detail: `registered ${name} for ${years} year(s)` } : { ok: false, detail: body.message ?? "registrar rejected the order" };
  },
};

export const manual: Registrar = {
  id: "manual",
  requiredSecrets: [],
  quote: porkbun.quote,
  async buy(_secrets, name, years) {
    return { ok: false, detail: `no registrar credentials in the vault; the board buys ${name} (${years}y) by hand and stores DNS credentials (CLOUDFLARE_API_TOKEN) so agents can set records` };
  },
};

export function registrar(secrets: SecretResolver): Registrar {
  return secrets.get("PORKBUN_API_KEY") ? porkbun : manual;
}
