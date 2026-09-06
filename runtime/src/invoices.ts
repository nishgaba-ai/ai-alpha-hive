// Invoices with the Indian GST split and the monthly GST summary. Intra-state
// supply splits tax into CGST + SGST, inter-state charges IGST. Numbers are
// per company and sequential (PAI-2026-0001). Payment links come from
// payment-link.create (Razorpay / Stripe); the matching webhook marks the
// invoice paid and posts revenue.

import { all, getDb, newId, one, run } from "./db.js";
import { emit } from "./bus.js";
import { periodRange, type Expense } from "./erp.js";

export type InvoiceItem = { id: string; invoice_id: string; description: string; hsn_sac: string | null; quantity: number; unit_minor: number; gst_rate: number; amount_minor: number };
export type Invoice = {
  id: string; company_id: string; number: string; customer_name: string; customer_email: string | null; customer_gstin: string | null; customer_state: string | null; place_of_supply: string | null;
  currency: string; issued_on: string; due_on: string | null; subtotal_minor: number; cgst_minor: number; sgst_minor: number; igst_minor: number; total_minor: number;
  status: "draft" | "sent" | "paid" | "void"; notes: string | null; payment_link: string | null; paid_at: number | null; created_by: string | null; created_at: number;
  items?: InvoiceItem[];
};

export type NewInvoice = {
  customer_name: string; customer_email?: string; customer_gstin?: string; customer_state?: string;
  /** state code of the company (from kv gst_state) decides intra vs inter-state */
  place_of_supply?: string;
  currency: string; issued_on?: string; due_on?: string; notes?: string; created_by?: string;
  items: { description: string; hsn_sac?: string; quantity?: number; unit_minor: number; gst_rate?: number }[];
};

/** Local calendar day (invoices are dated where the company sits, not in UTC). */
export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function nextNumber(companyId: string, prefix: string, on = new Date()): string {
  const year = on.getFullYear();
  const n = one<{ n: number }>("SELECT COUNT(*) AS n FROM invoices WHERE company_id = ? AND number LIKE ?", companyId, `${prefix}-${year}-%`)?.n ?? 0;
  return `${prefix}-${year}-${String(n + 1).padStart(4, "0")}`;
}

export function invoices(companyId: string, status?: string): Invoice[] {
  const rows = status
    ? all<Invoice>("SELECT * FROM invoices WHERE company_id = ? AND status = ? ORDER BY issued_on DESC, created_at DESC", companyId, status)
    : all<Invoice>("SELECT * FROM invoices WHERE company_id = ? ORDER BY issued_on DESC, created_at DESC LIMIT 500", companyId);
  return rows.map((r) => ({ ...r, items: all<InvoiceItem>("SELECT * FROM invoice_items WHERE invoice_id = ?", r.id) }));
}

export function invoiceById(companyId: string, id: string): Invoice | undefined {
  const r = one<Invoice>("SELECT * FROM invoices WHERE company_id = ? AND id = ?", companyId, id);
  return r ? { ...r, items: all<InvoiceItem>("SELECT * FROM invoice_items WHERE invoice_id = ?", r.id) } : undefined;
}

/** GST split: same state → CGST + SGST (half each); different or unknown state → IGST. Exports (currency != INR) carry no GST. */
export function gstSplit(taxMinor: number, companyState: string | undefined, placeOfSupply: string | undefined, currency: string): { cgst: number; sgst: number; igst: number } {
  if (currency !== "INR") return { cgst: 0, sgst: 0, igst: 0 };
  if (companyState && placeOfSupply && companyState.toUpperCase() === placeOfSupply.toUpperCase()) {
    const half = Math.round(taxMinor / 2);
    return { cgst: half, sgst: taxMinor - half, igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: taxMinor };
}

export function createInvoice(companyId: string, inv: NewInvoice, opts: { prefix?: string; companyState?: string } = {}): Invoice {
  if (!inv.items?.length) throw new Error("an invoice needs at least one line");
  const id = newId();
  const number = nextNumber(companyId, opts.prefix ?? "INV");
  const issued = inv.issued_on ?? localDay();
  const lines = inv.items.map((it) => {
    const qty = Math.max(1, Math.round(it.quantity ?? 1));
    const rate = it.gst_rate ?? 18;
    return { ...it, quantity: qty, gst_rate: rate, amount_minor: qty * Math.round(it.unit_minor) };
  });
  const subtotal = lines.reduce((s, l) => s + l.amount_minor, 0);
  const tax = lines.reduce((s, l) => s + Math.round((l.amount_minor * l.gst_rate) / 100), 0);
  const split = gstSplit(inv.currency === "INR" ? tax : 0, opts.companyState, inv.place_of_supply ?? inv.customer_state, inv.currency);
  const total = subtotal + split.cgst + split.sgst + split.igst;
  const tx = getDb().transaction(() => {
    run(
      `INSERT INTO invoices (id, company_id, number, customer_name, customer_email, customer_gstin, customer_state, place_of_supply, currency, issued_on, due_on, subtotal_minor, cgst_minor, sgst_minor, igst_minor, total_minor, status, notes, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)`,
      id, companyId, number, inv.customer_name, inv.customer_email ?? null, inv.customer_gstin ?? null, inv.customer_state ?? null, inv.place_of_supply ?? inv.customer_state ?? null,
      inv.currency, issued, inv.due_on ?? null, subtotal, split.cgst, split.sgst, split.igst, total, inv.notes ?? null, inv.created_by ?? null, Date.now(),
    );
    for (const l of lines) {
      run("INSERT INTO invoice_items (id, invoice_id, description, hsn_sac, quantity, unit_minor, gst_rate, amount_minor) VALUES (?,?,?,?,?,?,?,?)",
        newId(), id, l.description, l.hsn_sac ?? null, l.quantity, Math.round(l.unit_minor), l.gst_rate, l.amount_minor);
    }
  });
  tx();
  emit(companyId, "erp.invoice.created", { invoice_id: id, number, total_minor: total, customer: inv.customer_name });
  return invoiceById(companyId, id)!;
}

export function setInvoiceStatus(companyId: string, id: string, status: Invoice["status"], extra: { payment_link?: string } = {}): void {
  const sets = ["status = ?"];
  const vals: unknown[] = [status];
  if (extra.payment_link) { sets.push("payment_link = ?"); vals.push(extra.payment_link); }
  if (status === "paid") { sets.push("paid_at = ?"); vals.push(Date.now()); }
  run(`UPDATE invoices SET ${sets.join(", ")} WHERE company_id = ? AND id = ?`, ...vals, companyId, id);
  emit(companyId, `erp.invoice.${status}`, { invoice_id: id });
}

/** Called by the revenue webhooks with the provider's payment link id or url. */
export function markInvoicePaidByLink(companyId: string, link: string, ref: string): Invoice | undefined {
  const inv = one<Invoice>("SELECT * FROM invoices WHERE company_id = ? AND payment_link = ? AND status != 'paid'", companyId, link);
  if (!inv) return undefined;
  run("UPDATE invoices SET status = 'paid', paid_at = ?, notes = COALESCE(notes, '') || ? WHERE id = ?", Date.now(), `\npaid ref ${ref}`, inv.id);
  emit(companyId, "erp.invoice.paid", { invoice_id: inv.id, ref });
  return invoiceById(companyId, inv.id);
}

/** Printable HTML (the board saves it as PDF from the browser). */
export function invoiceHtml(inv: Invoice, company: { name: string; gstin?: string; address?: string; state?: string }): string {
  const money = (m: number) => (m / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const rows = (inv.items ?? []).map((it) => `<tr><td>${esc(it.description)}</td><td>${esc(it.hsn_sac ?? "")}</td><td class="r">${it.quantity}</td><td class="r">${money(it.unit_minor)}</td><td class="r">${it.gst_rate}%</td><td class="r">${money(it.amount_minor)}</td></tr>`).join("");
  const taxRows = [inv.cgst_minor ? `<tr><td colspan="5" class="r">CGST</td><td class="r">${money(inv.cgst_minor)}</td></tr>` : "", inv.sgst_minor ? `<tr><td colspan="5" class="r">SGST</td><td class="r">${money(inv.sgst_minor)}</td></tr>` : "", inv.igst_minor ? `<tr><td colspan="5" class="r">IGST</td><td class="r">${money(inv.igst_minor)}</td></tr>` : ""].join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#1b1b1f;margin:40px;max-width:820px}h1{font-size:22px;margin:0}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:8px;border-bottom:1px solid #e4e4ea;text-align:left}.r{text-align:right}.muted{color:#6b6b76}.total td{font-weight:600;border-top:2px solid #1b1b1f}.grid{display:flex;justify-content:space-between;gap:24px;margin-top:24px}@media print{body{margin:0}}</style></head><body>
<div class="grid"><div><h1>${esc(company.name)}</h1><p class="muted">${esc(company.address ?? "")}<br>${company.gstin ? "GSTIN " + esc(company.gstin) : ""}</p></div>
<div style="text-align:right"><h1>Tax invoice</h1><p>${esc(inv.number)}<br><span class="muted">Issued ${esc(inv.issued_on)}${inv.due_on ? " · due " + esc(inv.due_on) : ""}</span></p></div></div>
<div class="grid"><div><p class="muted">Bill to</p><p><strong>${esc(inv.customer_name)}</strong><br>${esc(inv.customer_email ?? "")}<br>${inv.customer_gstin ? "GSTIN " + esc(inv.customer_gstin) : ""}${inv.place_of_supply ? "<br>Place of supply: " + esc(inv.place_of_supply) : ""}</p></div><div style="text-align:right"><p class="muted">Status</p><p><strong>${esc(inv.status)}</strong></p></div></div>
<table><thead><tr><th>Description</th><th>HSN/SAC</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">GST</th><th class="r">Amount (${esc(inv.currency)})</th></tr></thead><tbody>${rows}
<tr><td colspan="5" class="r">Subtotal</td><td class="r">${money(inv.subtotal_minor)}</td></tr>${taxRows}
<tr class="total"><td colspan="5" class="r">Total</td><td class="r">${money(inv.total_minor)}</td></tr></tbody></table>
${inv.notes ? `<p class="muted" style="margin-top:20px">${esc(inv.notes)}</p>` : ""}
${inv.payment_link ? `<p>Pay online: <a href="${esc(inv.payment_link)}">${esc(inv.payment_link)}</a></p>` : ""}
</body></html>`;
}

// ------------------------------------------------------------- GST summary

/** Output tax from invoices issued in the period, input tax credit from expenses carrying GST. A GSTR-3B style summary, not a filing. */
export function gstSummary(companyId: string, period: string) {
  const [from, to] = periodRange(period);
  const fromDay = new Date(from).toISOString().slice(0, 10);
  const toDay = new Date(to).toISOString().slice(0, 10);
  const out = all<Invoice>("SELECT * FROM invoices WHERE company_id = ? AND status IN ('sent','paid') AND issued_on >= ? AND issued_on < ?", companyId, fromDay, toDay);
  const exp = all<Expense & { gst_minor: number; vendor_gstin: string | null }>("SELECT * FROM expenses WHERE company_id = ? AND status IN ('approved','paid') AND submitted_at >= ? AND submitted_at < ?", companyId, from, to);
  const output = { taxable_minor: out.reduce((s, i) => s + i.subtotal_minor, 0), cgst_minor: out.reduce((s, i) => s + i.cgst_minor, 0), sgst_minor: out.reduce((s, i) => s + i.sgst_minor, 0), igst_minor: out.reduce((s, i) => s + i.igst_minor, 0) };
  const inputCredit = exp.reduce((s, e) => s + (e.gst_minor ?? 0), 0);
  const outputTotal = output.cgst_minor + output.sgst_minor + output.igst_minor;
  return {
    period,
    invoices: out.length,
    output,
    input_credit_minor: inputCredit,
    expenses_with_gst: exp.filter((e) => e.gst_minor > 0).length,
    net_payable_minor: Math.max(0, outputTotal - inputCredit),
    carry_forward_minor: Math.max(0, inputCredit - outputTotal),
    note: "Summary for the CA (GSTR-3B shape). Input credit counts approved or paid expenses with a GST amount and a vendor GSTIN check is the CA's job.",
  };
}
