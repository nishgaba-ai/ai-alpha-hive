// Bank statement CSV import into cash_txns. Indian banks export wildly
// different CSVs (HDFC, ICICI, SBI, Kotak, Razorpay X); the importer takes a
// column mapping, tolerates quoted fields and BOMs, parses dd/mm/yyyy and
// ISO dates, and dedupes on (account, date, amount, reference/narration) so
// re-importing an overlapping statement is safe.

import { createHash } from "node:crypto";
import { all, getDb, newId, one, run } from "./db.js";
import { emit } from "./bus.js";

export type ColumnMap = {
  date: string;
  /** one signed amount column … */
  amount?: string;
  /** … or separate debit / credit columns */
  debit?: string;
  credit?: string;
  narration?: string;
  reference?: string;
  /** dd/mm/yyyy (default for Indian banks) | mm/dd/yyyy | iso */
  dateFormat?: "dmy" | "mdy" | "iso";
};

export const PRESETS: Record<string, ColumnMap> = {
  hdfc: { date: "Date", narration: "Narration", reference: "Chq./Ref.No.", debit: "Withdrawal Amt.", credit: "Deposit Amt.", dateFormat: "dmy" },
  icici: { date: "Transaction Date", narration: "Transaction Remarks", reference: "Cheque Number", debit: "Withdrawal Amount (INR )", credit: "Deposit Amount (INR )", dateFormat: "dmy" },
  sbi: { date: "Txn Date", narration: "Description", reference: "Ref No./Cheque No.", debit: "Debit", credit: "Credit", dateFormat: "dmy" },
  kotak: { date: "Date", narration: "Description", reference: "Chq / Ref number", amount: "Amount", dateFormat: "dmy" },
  razorpayx: { date: "created_at", narration: "description", reference: "id", amount: "amount", dateFormat: "iso" },
  generic: { date: "date", narration: "description", reference: "reference", amount: "amount", dateFormat: "iso" },
};

export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { cur.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      cur.push(field); field = "";
      if (cur.some((f) => f.trim() !== "")) rows.push(cur);
      cur = [];
    } else field += c;
  }
  if (field !== "" || cur.length) { cur.push(field); if (cur.some((f) => f.trim() !== "")) rows.push(cur); }
  if (!rows.length) return [];
  // header: first row that has ≥ 2 non-empty cells (bank CSVs carry preambles)
  const hi = rows.findIndex((r) => r.filter((f) => f.trim()).length >= 2);
  const header = rows[hi].map((h) => h.trim());
  return rows.slice(hi + 1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

export function parseAmount(s: string | undefined): number {
  if (!s) return 0;
  const neg = /\(.*\)|-|\bDR\b|\bDebit\b/i.test(s) && !/\bCR\b/i.test(s);
  const n = Number(s.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) * (neg ? -1 : 1);
}

export function parseDate(s: string, fmt: ColumnMap["dateFormat"] = "dmy"): number {
  const t = s.trim();
  if (fmt === "iso" || /^\d{4}-\d{2}-\d{2}/.test(t)) {
    const d = new Date(t.length === 10 ? t + "T00:00:00Z" : t);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  const m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(t);
  if (m) {
    const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3].length === 2 ? "20" + m[3] : m[3])];
    const [day, month] = fmt === "mdy" ? [b, a] : [a, b];
    return Date.UTC(y, month - 1, day);
  }
  const m2 = /^(\d{1,2})[\s\-]([A-Za-z]{3})[\s\-](\d{2,4})/.exec(t);
  if (m2) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    return Date.UTC(Number(m2[3].length === 2 ? "20" + m2[3] : m2[3]), months.indexOf(m2[2].toLowerCase()), Number(m2[1]));
  }
  throw new Error(`unparseable date: ${s}`);
}

/** Guess a category from the narration; the board can recategorise later. */
export function guessCategory(narration: string, amount: number): string {
  const n = narration.toLowerCase();
  if (/salary|payroll/.test(n)) return "salary";
  if (/gst|tds|income tax|advance tax/.test(n)) return "tax";
  if (/aws|google|vercel|digitalocean|github|openai|anthropic|cloudflare|godaddy|namecheap/.test(n)) return "software";
  if (/razorpay|stripe|upi.*cr|neft.*cr|imps.*cr/.test(n) && amount > 0) return "revenue";
  if (/rent/.test(n)) return "rent";
  if (/bank charge|sms charge|annual fee/.test(n)) return "bank-charges";
  if (/interest/.test(n)) return "interest";
  return amount > 0 ? "inflow" : "outflow";
}

export type ImportResult = { imported: number; duplicates: number; skipped: { row: number; reason: string }[]; preview: { ts: number; amount_minor: number; narration: string; category: string }[] };

export function importBankCsv(companyId: string, accountId: string, csv: string, map: ColumnMap, by = "import", dryRun = false): ImportResult {
  const acc = one("SELECT 1 FROM cash_accounts WHERE company_id = ? AND id = ?", companyId, accountId);
  if (!acc) throw new Error("no such cash account");
  const rows = parseCsv(csv);
  const result: ImportResult = { imported: 0, duplicates: 0, skipped: [], preview: [] };
  const existing = new Set(all<{ ref: string }>("SELECT ref FROM cash_txns WHERE company_id = ? AND account_id = ? AND ref LIKE 'csv:%'", companyId, accountId).map((r) => r.ref));
  const tx = getDb().transaction(() => {
    rows.forEach((r, i) => {
      const dateRaw = r[map.date];
      if (!dateRaw) { result.skipped.push({ row: i + 1, reason: "no date" }); return; }
      let ts: number;
      try { ts = parseDate(dateRaw, map.dateFormat); } catch (e) { result.skipped.push({ row: i + 1, reason: (e as Error).message }); return; }
      const amount = map.amount ? parseAmount(r[map.amount]) : parseAmount(r[map.credit ?? ""]) - Math.abs(parseAmount(r[map.debit ?? ""]));
      if (!amount) { result.skipped.push({ row: i + 1, reason: "zero amount" }); return; }
      const narration = (map.narration ? r[map.narration] : "") || "";
      const reference = (map.reference ? r[map.reference] : "") || "";
      const key = "csv:" + createHash("sha1").update(`${accountId}|${ts}|${amount}|${reference || narration}`).digest("hex").slice(0, 16);
      if (existing.has(key)) { result.duplicates++; return; }
      existing.add(key);
      const category = guessCategory(narration, amount);
      if (result.preview.length < 20) result.preview.push({ ts, amount_minor: amount, narration, category });
      if (!dryRun) {
        run("INSERT INTO cash_txns (id, company_id, account_id, ts, amount_minor, counterparty, category, memo, ref, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
          newId(), companyId, accountId, ts, amount, null, category, narration.slice(0, 500), key, by);
      }
      result.imported++;
    });
  });
  tx();
  if (!dryRun && result.imported) emit(companyId, "erp.bank.imported", { account_id: accountId, imported: result.imported, duplicates: result.duplicates });
  return result;
}
