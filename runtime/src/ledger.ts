// Double-entry ledger. Accounts are strings scoped by company:
//   funding, reserve, wallet:company, wallet:<agentId>, api-spend, external, revenue
// Balances are derived; holds are entries with kind='hold' until released or
// captured. Every journal balances (sum debits = sum credits) or it throws.

import { getDb, newId, all, one, run } from "./db.js";

export type Line = { account: string; debit?: number; credit?: number };

export function post(companyId: string, lines: Line[], memo: string, ref?: string): string {
  const debits = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
  const credits = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
  if (debits !== credits) throw new Error(`journal does not balance: ${debits} != ${credits}`);
  if (lines.some((l) => (l.debit ?? 0) < 0 || (l.credit ?? 0) < 0)) throw new Error("negative amounts");
  const journal = newId();
  const ts = Date.now();
  const tx = getDb().transaction(() => {
    for (const l of lines) {
      run(
        "INSERT INTO ledger_entries (id, company_id, journal_id, account, debit, credit, kind, memo, ref, ts) VALUES (?, ?, ?, ?, ?, ?, 'post', ?, ?, ?)",
        newId(), companyId, journal, l.account, l.debit ?? 0, l.credit ?? 0, memo, ref ?? null, ts,
      );
    }
  });
  tx();
  return journal;
}

/** Asset accounts (wallets, reserve) carry debit balances: debits − credits. */
export function balance(companyId: string, account: string): number {
  const r = one<{ d: number; c: number }>(
    "SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c FROM ledger_entries WHERE company_id = ? AND account = ? AND kind = 'post'",
    companyId, account,
  );
  return (r?.d ?? 0) - (r?.c ?? 0);
}

export function openHolds(companyId: string, account: string): number {
  const r = one<{ h: number }>(
    "SELECT COALESCE(SUM(credit),0) AS h FROM ledger_entries WHERE company_id = ? AND account = ? AND kind = 'hold' AND released = 0",
    companyId, account,
  );
  return r?.h ?? 0;
}

export function available(companyId: string, account: string): number {
  return balance(companyId, account) - openHolds(companyId, account);
}

/** Place a hold on a wallet account. Returns the hold ref. */
export function hold(companyId: string, account: string, amount: number, memo: string, ref?: string): string {
  if (amount <= 0) throw new Error("hold amount must be positive");
  if (available(companyId, account) < amount) throw new Error("insufficient available balance");
  const holdRef = ref ?? newId();
  run(
    "INSERT INTO ledger_entries (id, company_id, journal_id, account, debit, credit, kind, hold_ref, memo, ref, ts) VALUES (?, ?, ?, ?, 0, ?, 'hold', ?, ?, ?, ?)",
    newId(), companyId, newId(), account, amount, holdRef, memo, holdRef, Date.now(),
  );
  return holdRef;
}

export function release(companyId: string, holdRef: string): void {
  run("UPDATE ledger_entries SET released = 1 WHERE company_id = ? AND hold_ref = ? AND kind = 'hold'", companyId, holdRef);
}

/** Convert a hold into a posted spend from the wallet to `external`. */
export function capture(companyId: string, holdRef: string, amount?: number, memo = "captured"): string {
  const h = one<{ account: string; credit: number }>(
    "SELECT account, credit FROM ledger_entries WHERE company_id = ? AND hold_ref = ? AND kind = 'hold' AND released = 0",
    companyId, holdRef,
  );
  if (!h) throw new Error("no open hold " + holdRef);
  const amt = amount ?? h.credit;
  release(companyId, holdRef);
  return post(companyId, [{ account: "external", debit: amt }, { account: h.account, credit: amt }], memo, holdRef);
}

export function walletAccount(agentId: string | "company"): string {
  return agentId === "company" ? "wallet:company" : `wallet:${agentId}`;
}

export function monthToDateSpend(companyId: string, account: string): number {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const r = one<{ c: number }>(
    "SELECT COALESCE(SUM(credit),0) AS c FROM ledger_entries WHERE company_id = ? AND account = ? AND kind = 'post' AND ts >= ?",
    companyId, account, start.getTime(),
  );
  return r?.c ?? 0;
}

export type LedgerEntry = {
  id: string; journal_id: string; account: string; debit: number; credit: number;
  kind: string; hold_ref: string | null; released: number; memo: string | null; ref: string | null; ts: number;
};

export function entries(companyId: string, limit = 200, account?: string): LedgerEntry[] {
  return account
    ? all<LedgerEntry>("SELECT * FROM ledger_entries WHERE company_id = ? AND account = ? ORDER BY ts DESC LIMIT ?", companyId, account, limit)
    : all<LedgerEntry>("SELECT * FROM ledger_entries WHERE company_id = ? ORDER BY ts DESC LIMIT ?", companyId, limit);
}

export function accounts(companyId: string): { account: string; balance: number; holds: number }[] {
  const names = all<{ account: string }>("SELECT DISTINCT account FROM ledger_entries WHERE company_id = ?", companyId).map((r) => r.account);
  return names.map((account) => ({ account, balance: balance(companyId, account), holds: openHolds(companyId, account) }));
}
