// ERP under one roof: people, payroll, expenses, time, cash accounts and
// the monthly statement pack for the CA. Humans (board, interns) live here;
// agents live in `agents`. Everything is per company; the group view in the
// UI sums across companies.

import { all, getDb, newId, one, run } from "./db.js";
import * as ledger from "./ledger.js";
import { emit } from "./bus.js";

const now = () => Date.now();

export type Person = {
  id: string; company_id: string; name: string; email: string | null; title: string | null;
  kind: "employee" | "intern" | "contractor" | "board"; monthly_salary_minor: number; currency: string;
  telegram_chat_id: string | null; status: "active" | "inactive"; created_at: number;
};

export function people(companyId: string): Person[] {
  return all<Person>("SELECT * FROM people WHERE company_id = ? ORDER BY created_at", companyId);
}

export function addPerson(companyId: string, p: Partial<Person> & { name: string; currency: string }): Person {
  const id = newId();
  run(
    "INSERT INTO people (id, company_id, name, email, title, kind, monthly_salary_minor, currency, telegram_chat_id, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,'active',?)",
    id, companyId, p.name, p.email ?? null, p.title ?? null, p.kind ?? "employee", p.monthly_salary_minor ?? 0, p.currency, p.telegram_chat_id ?? null, now(),
  );
  emit(companyId, "erp.person.added", { person_id: id, name: p.name, kind: p.kind ?? "employee" });
  return one<Person>("SELECT * FROM people WHERE id = ?", id)!;
}

export function updatePerson(companyId: string, id: string, patch: Partial<Person>): void {
  const allowed = ["name", "email", "title", "kind", "monthly_salary_minor", "telegram_chat_id", "status"] as const;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed) if (patch[k] !== undefined) { sets.push(`${k} = ?`); vals.push(patch[k]); }
  if (!sets.length) return;
  run(`UPDATE people SET ${sets.join(", ")} WHERE company_id = ? AND id = ?`, ...vals, companyId, id);
}

// ------------------------------------------------------------- payroll

export type PayrollRun = { id: string; company_id: string; period: string; total_minor: number; status: "draft" | "approved" | "paid"; created_at: number; approved_by: string | null; approved_at: number | null; paid_at: number | null };
export type PayrollItem = { id: string; payroll_run_id: string; person_id: string; gross_minor: number; deductions_minor: number; net_minor: number; notes: string | null; name?: string };

export function payrollRuns(companyId: string): PayrollRun[] {
  return all<PayrollRun>("SELECT * FROM payroll_runs WHERE company_id = ? ORDER BY period DESC", companyId);
}
export function payrollItems(runId: string): PayrollItem[] {
  return all<PayrollItem>("SELECT pi.*, p.name FROM payroll_items pi JOIN people p ON p.id = pi.person_id WHERE pi.payroll_run_id = ?", runId);
}

/** Draft a payroll run for YYYY-MM from active people with a salary. Idempotent per period. */
export function draftPayroll(companyId: string, period: string): PayrollRun {
  const existing = one<PayrollRun>("SELECT * FROM payroll_runs WHERE company_id = ? AND period = ?", companyId, period);
  if (existing) return existing;
  const staff = people(companyId).filter((p) => p.status === "active" && p.monthly_salary_minor > 0);
  const id = newId();
  const total = staff.reduce((s, p) => s + p.monthly_salary_minor, 0);
  const tx = getDb().transaction(() => {
    run("INSERT INTO payroll_runs (id, company_id, period, total_minor, status, created_at) VALUES (?,?,?,?,'draft',?)", id, companyId, period, total, now());
    for (const p of staff) {
      run("INSERT INTO payroll_items (id, payroll_run_id, person_id, gross_minor, deductions_minor, net_minor) VALUES (?,?,?,?,0,?)", newId(), id, p.id, p.monthly_salary_minor, p.monthly_salary_minor);
    }
  });
  tx();
  emit(companyId, "erp.payroll.drafted", { payroll_run_id: id, period, total_minor: total, people: staff.length });
  return one<PayrollRun>("SELECT * FROM payroll_runs WHERE id = ?", id)!;
}

export function approvePayroll(companyId: string, runId: string, by: string): void {
  run("UPDATE payroll_runs SET status = 'approved', approved_by = ?, approved_at = ? WHERE company_id = ? AND id = ? AND status = 'draft'", by, now(), companyId, runId);
  emit(companyId, "erp.payroll.approved", { payroll_run_id: runId, by });
}

/** Mark paid: writes one cash transaction per person from the chosen account and mirrors the expense in the ledger. */
export function payPayroll(companyId: string, runId: string, accountId: string, by: string): void {
  const pr = one<PayrollRun>("SELECT * FROM payroll_runs WHERE company_id = ? AND id = ?", companyId, runId);
  if (!pr || pr.status !== "approved") throw new Error("payroll must be approved first");
  const items = payrollItems(runId);
  const tx = getDb().transaction(() => {
    for (const it of items) {
      run("INSERT INTO cash_txns (id, company_id, account_id, ts, amount_minor, counterparty, category, memo, ref, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
        newId(), companyId, accountId, now(), -it.net_minor, it.name ?? it.person_id, "salary", `salary ${pr.period}`, runId, by);
    }
    run("UPDATE payroll_runs SET status = 'paid', paid_at = ? WHERE id = ?", now(), runId);
  });
  tx();
  ledger.post(companyId, [{ account: "salaries", debit: pr.total_minor }, { account: "cash", credit: pr.total_minor }], `payroll ${pr.period}`, runId);
  emit(companyId, "erp.payroll.paid", { payroll_run_id: runId, period: pr.period, total_minor: pr.total_minor });
}

// ------------------------------------------------------------ expenses

export type Expense = { id: string; company_id: string; person_id: string | null; agent_id: string | null; category: string; amount_minor: number; currency: string; description: string; receipt_ref: string | null; status: "submitted" | "approved" | "rejected" | "paid"; submitted_at: number; decided_by: string | null; decided_at: number | null; paid_at: number | null };

export function expenses(companyId: string, status?: string): Expense[] {
  return status
    ? all<Expense>("SELECT * FROM expenses WHERE company_id = ? AND status = ? ORDER BY submitted_at DESC", companyId, status)
    : all<Expense>("SELECT * FROM expenses WHERE company_id = ? ORDER BY submitted_at DESC LIMIT 500", companyId);
}

export function submitExpense(companyId: string, e: { person_id?: string; agent_id?: string; category: string; amount_minor: number; currency: string; description: string; receipt_ref?: string }): Expense {
  const id = newId();
  run("INSERT INTO expenses (id, company_id, person_id, agent_id, category, amount_minor, currency, description, receipt_ref, status, submitted_at) VALUES (?,?,?,?,?,?,?,?,?,'submitted',?)",
    id, companyId, e.person_id ?? null, e.agent_id ?? null, e.category, e.amount_minor, e.currency, e.description, e.receipt_ref ?? null, now());
  emit(companyId, "erp.expense.submitted", { expense_id: id, amount_minor: e.amount_minor, category: e.category });
  return one<Expense>("SELECT * FROM expenses WHERE id = ?", id)!;
}

export function decideExpense(companyId: string, id: string, decision: "approved" | "rejected", by: string): void {
  run("UPDATE expenses SET status = ?, decided_by = ?, decided_at = ? WHERE company_id = ? AND id = ? AND status = 'submitted'", decision, by, now(), companyId, id);
  emit(companyId, "erp.expense.decided", { expense_id: id, decision, by });
}

export function payExpense(companyId: string, id: string, accountId: string, by: string): void {
  const e = one<Expense>("SELECT * FROM expenses WHERE company_id = ? AND id = ?", companyId, id);
  if (!e || e.status !== "approved") throw new Error("expense must be approved first");
  run("INSERT INTO cash_txns (id, company_id, account_id, ts, amount_minor, counterparty, category, memo, ref, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
    newId(), companyId, accountId, now(), -e.amount_minor, e.person_id ?? e.agent_id ?? "expense", e.category, e.description, id, by);
  run("UPDATE expenses SET status = 'paid', paid_at = ? WHERE id = ?", now(), id);
  ledger.post(companyId, [{ account: `expense:${e.category}`, debit: e.amount_minor }, { account: "cash", credit: e.amount_minor }], `expense: ${e.description}`, id);
  emit(companyId, "erp.expense.paid", { expense_id: id, amount_minor: e.amount_minor });
}

// ---------------------------------------------------------------- time

export type TimeEntry = { id: string; company_id: string; person_id: string; task_id: string | null; date: string; minutes: number; note: string | null; created_at: number };

export function logTime(companyId: string, t: { person_id: string; task_id?: string; date: string; minutes: number; note?: string }): TimeEntry {
  const id = newId();
  run("INSERT INTO time_entries (id, company_id, person_id, task_id, date, minutes, note, created_at) VALUES (?,?,?,?,?,?,?,?)",
    id, companyId, t.person_id, t.task_id ?? null, t.date, t.minutes, t.note ?? null, now());
  return one<TimeEntry>("SELECT * FROM time_entries WHERE id = ?", id)!;
}

export function timeEntries(companyId: string, period?: string): TimeEntry[] {
  return period
    ? all<TimeEntry>("SELECT * FROM time_entries WHERE company_id = ? AND date LIKE ? ORDER BY date DESC", companyId, `${period}%`)
    : all<TimeEntry>("SELECT * FROM time_entries WHERE company_id = ? ORDER BY date DESC LIMIT 500", companyId);
}

// ---------------------------------------------------------------- cash

export type CashAccount = { id: string; company_id: string; name: string; kind: "bank" | "cash" | "upi" | "card" | "wallet"; currency: string; opening_minor: number; created_at: number; balance_minor?: number };
export type CashTxn = { id: string; company_id: string; account_id: string; ts: number; amount_minor: number; counterparty: string | null; category: string; memo: string | null; ref: string | null; created_by: string | null };

export function cashAccounts(companyId: string): CashAccount[] {
  return all<CashAccount>("SELECT * FROM cash_accounts WHERE company_id = ? ORDER BY created_at", companyId).map((a) => ({
    ...a,
    balance_minor: a.opening_minor + (one<{ s: number }>("SELECT COALESCE(SUM(amount_minor),0) AS s FROM cash_txns WHERE account_id = ?", a.id)?.s ?? 0),
  }));
}

export function addCashAccount(companyId: string, a: { name: string; kind: CashAccount["kind"]; currency: string; opening_minor?: number }): CashAccount {
  const id = newId();
  run("INSERT INTO cash_accounts (id, company_id, name, kind, currency, opening_minor, created_at) VALUES (?,?,?,?,?,?,?)", id, companyId, a.name, a.kind, a.currency, a.opening_minor ?? 0, now());
  return cashAccounts(companyId).find((x) => x.id === id)!;
}

export function addCashTxn(companyId: string, t: { account_id: string; amount_minor: number; category: string; counterparty?: string; memo?: string; ref?: string; ts?: number; created_by?: string }): CashTxn {
  const id = newId();
  run("INSERT INTO cash_txns (id, company_id, account_id, ts, amount_minor, counterparty, category, memo, ref, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
    id, companyId, t.account_id, t.ts ?? now(), t.amount_minor, t.counterparty ?? null, t.category, t.memo ?? null, t.ref ?? null, t.created_by ?? null);
  emit(companyId, "erp.cash.posted", { txn_id: id, amount_minor: t.amount_minor, category: t.category });
  return one<CashTxn>("SELECT * FROM cash_txns WHERE id = ?", id)!;
}

export function cashTxns(companyId: string, period?: string): CashTxn[] {
  if (!period) return all<CashTxn>("SELECT * FROM cash_txns WHERE company_id = ? ORDER BY ts DESC LIMIT 500", companyId);
  const [from, to] = periodRange(period);
  return all<CashTxn>("SELECT * FROM cash_txns WHERE company_id = ? AND ts >= ? AND ts < ? ORDER BY ts", companyId, from, to);
}

export function periodRange(period: string): [number, number] {
  const [y, m] = period.split("-").map(Number);
  return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)];
}

// ----------------------------------------------------------- statement

/** Monthly statement pack for the CA: cash by account, categories, payroll, expenses, agent spend, revenue. */
export function statement(companyId: string, period: string) {
  const [from, to] = periodRange(period);
  const txns = cashTxns(companyId, period);
  const byCategory: Record<string, number> = {};
  for (const t of txns) byCategory[t.category] = (byCategory[t.category] ?? 0) + t.amount_minor;
  const accounts = cashAccounts(companyId).map((a) => ({
    id: a.id, name: a.name, kind: a.kind, currency: a.currency,
    opening_minor: a.opening_minor + (one<{ s: number }>("SELECT COALESCE(SUM(amount_minor),0) AS s FROM cash_txns WHERE account_id = ? AND ts < ?", a.id, from)?.s ?? 0),
    movement_minor: txns.filter((t) => t.account_id === a.id).reduce((s, t) => s + t.amount_minor, 0),
  })).map((a) => ({ ...a, closing_minor: a.opening_minor + a.movement_minor }));
  const payroll = one<PayrollRun>("SELECT * FROM payroll_runs WHERE company_id = ? AND period = ?", companyId, period);
  const exp = all<Expense>("SELECT * FROM expenses WHERE company_id = ? AND submitted_at >= ? AND submitted_at < ?", companyId, from, to);
  const agentSpend = one<{ s: number }>("SELECT COALESCE(SUM(debit),0) AS s FROM ledger_entries WHERE company_id = ? AND account IN ('api-spend','external') AND kind='post' AND ts >= ? AND ts < ?", companyId, from, to)?.s ?? 0;
  const revenue = one<{ s: number }>("SELECT COALESCE(SUM(credit),0) AS s FROM ledger_entries WHERE company_id = ? AND account = 'revenue' AND kind='post' AND ts >= ? AND ts < ?", companyId, from, to)?.s ?? 0;
  const inflow = txns.filter((t) => t.amount_minor > 0).reduce((s, t) => s + t.amount_minor, 0);
  const outflow = txns.filter((t) => t.amount_minor < 0).reduce((s, t) => s + t.amount_minor, 0);
  return {
    period, generated_at: now(),
    accounts, transactions: txns, by_category: byCategory,
    totals: { inflow_minor: inflow, outflow_minor: outflow, net_minor: inflow + outflow },
    payroll: payroll ? { ...payroll, items: payrollItems(payroll.id) } : null,
    expenses: exp,
    agents: { spend_minor: agentSpend, revenue_minor: revenue },
  };
}

export function statementCsv(companyId: string, period: string): string {
  const s = statement(companyId, period);
  const accName = new Map(s.accounts.map((a) => [a.id, a.name]));
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = ["date,account,amount,counterparty,category,memo,ref"];
  for (const t of s.transactions) {
    lines.push([new Date(t.ts).toISOString().slice(0, 10), accName.get(t.account_id), (t.amount_minor / 100).toFixed(2), t.counterparty, t.category, t.memo, t.ref].map(esc).join(","));
  }
  lines.push("", "summary,,,,,,");
  for (const [k, v] of Object.entries(s.by_category)) lines.push([k, "", (v / 100).toFixed(2)].map(esc).join(","));
  lines.push(["net", "", (s.totals.net_minor / 100).toFixed(2)].map(esc).join(","));
  if (s.payroll) lines.push(["payroll " + s.payroll.status, "", (s.payroll.total_minor / 100).toFixed(2)].map(esc).join(","));
  lines.push(["agent spend", "", (s.agents.spend_minor / 100).toFixed(2)].map(esc).join(","));
  return lines.join("\n");
}
