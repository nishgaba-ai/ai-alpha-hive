// Card providers. A company runs ledger-only (the board pays approved items
// by hand) or with a provider that issues virtual cards to agents with
// spending controls mirrored from the role budget. The ledger stays the
// source of truth: the provider's real-time authorization webhook asks the
// ledger before money moves, and settled transactions capture the hold.

import type { SecretResolver } from "../types.js";

export type CardControls = {
  /** minor units per authorization */
  per_tx?: number;
  /** minor units per calendar month */
  monthly?: number;
  /** provider merchant categories (Stripe: e.g. "advertising_services") */
  categories?: string[];
  purpose?: string;
};

export type IssuedCard = { provider_card_id: string; last4: string | null; status: "active" | "inactive" | "canceled" };

export type CardTxn = { id: string; ts: number; amount_minor: number; currency: string; merchant: string; status: string };

export interface CardProvider {
  readonly id: "none" | "stripe-issuing";
  /** Create a virtual card for one agent wallet. */
  issue(secrets: SecretResolver, req: { companyId: string; cardId: string; agentName: string; currency: string; controls: CardControls }): Promise<IssuedCard>;
  freeze(secrets: SecretResolver, providerCardId: string): Promise<void>;
  unfreeze(secrets: SecretResolver, providerCardId: string): Promise<void>;
  transactions(secrets: SecretResolver, providerCardId: string, limit?: number): Promise<CardTxn[]>;
  /** Names the board must store before issue() can work. */
  requiredSecrets: string[];
}
