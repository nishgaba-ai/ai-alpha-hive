"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "../../../../lib/company-access";
import { audit } from "../../../../lib/audit";
import { hive } from "../../../../lib/hive";

// Book-keeping entries (people, expenses, time) are company:mission work;
// anything that moves or approves money is company:erp:pay (owner only).
const minor = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? "0").replace(/[^\d.-]/g, "")) * 100);

export async function addPerson(form: FormData) {
  const slug = String(form.get("slug"));
  await requireCompany(slug, "company:mission");
  await hive(`/api/companies/${slug}/erp/people`, { method: "POST", body: JSON.stringify({ name: form.get("name"), email: form.get("email") || undefined, title: form.get("title") || undefined, kind: form.get("kind"), monthly_salary_minor: minor(form.get("salary")), telegram_chat_id: form.get("telegram") || undefined }) });
  revalidatePath(`/c/${slug}/erp`);
}

export async function draftPayroll(form: FormData) {
  const slug = String(form.get("slug"));
  await requireCompany(slug, "company:erp:pay");
  await hive(`/api/companies/${slug}/erp/payroll`, { method: "POST", body: JSON.stringify({ period: form.get("period") }) });
  revalidatePath(`/c/${slug}/erp`);
}

export async function payrollAction(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:erp:pay");
  const id = String(form.get("id"));
  const action = String(form.get("action"));
  await hive(`/api/companies/${slug}/erp/payroll/${id}/${action}`, { method: "POST", body: JSON.stringify({ by: session.email, account_id: form.get("account_id") }) });
  audit(`erp.payroll.${action}`, { actorId: session.userId, orgId: session.orgId, resource: `${slug}/${id}` });
  revalidatePath(`/c/${slug}/erp`);
}

export async function submitExpense(form: FormData) {
  const slug = String(form.get("slug"));
  await requireCompany(slug, "company:mission");
  await hive(`/api/companies/${slug}/erp/expenses`, { method: "POST", body: JSON.stringify({ person_id: form.get("person_id") || undefined, category: form.get("category"), amount_minor: minor(form.get("amount")), description: form.get("description"), receipt_ref: form.get("receipt") || undefined }) });
  revalidatePath(`/c/${slug}/erp`);
}

export async function expenseAction(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:erp:pay");
  const id = String(form.get("id"));
  const action = String(form.get("action"));
  if (action === "pay") await hive(`/api/companies/${slug}/erp/expenses/${id}/pay`, { method: "POST", body: JSON.stringify({ by: session.email, account_id: form.get("account_id") }) });
  else await hive(`/api/companies/${slug}/erp/expenses/${id}/decide`, { method: "POST", body: JSON.stringify({ by: session.email, decision: action }) });
  revalidatePath(`/c/${slug}/erp`);
}

export async function logTime(form: FormData) {
  const slug = String(form.get("slug"));
  await requireCompany(slug, "company:mission");
  await hive(`/api/companies/${slug}/erp/time`, { method: "POST", body: JSON.stringify({ person_id: form.get("person_id"), task_id: form.get("task_id") || undefined, date: form.get("date"), minutes: Number(form.get("hours") ?? 0) * 60, note: form.get("note") || undefined }) });
  revalidatePath(`/c/${slug}/erp`);
}

export async function addCashAccount(form: FormData) {
  const slug = String(form.get("slug"));
  await requireCompany(slug, "company:erp:pay");
  await hive(`/api/companies/${slug}/erp/cash/accounts`, { method: "POST", body: JSON.stringify({ name: form.get("name"), kind: form.get("kind"), opening_minor: minor(form.get("opening")) }) });
  revalidatePath(`/c/${slug}/erp`);
}

export async function addCashTxn(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:erp:pay");
  const sign = String(form.get("direction")) === "out" ? -1 : 1;
  await hive(`/api/companies/${slug}/erp/cash/txns`, { method: "POST", body: JSON.stringify({ account_id: form.get("account_id"), amount_minor: sign * Math.abs(minor(form.get("amount"))), category: form.get("category"), counterparty: form.get("counterparty") || undefined, memo: form.get("memo") || undefined, created_by: session.email }) });
  revalidatePath(`/c/${slug}/erp`);
}

// ------------------------------------------------------------ invoices, GST, bank import

export async function createInvoice(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:erp:pay");
  const items = [];
  for (let i = 0; i < 6; i++) {
    const d = String(form.get(`item_desc_${i}`) ?? "").trim();
    if (!d) continue;
    items.push({ description: d, hsn_sac: String(form.get(`item_hsn_${i}`) ?? "") || undefined, quantity: Number(form.get(`item_qty_${i}`) || 1), unit_minor: minor(form.get(`item_unit_${i}`)), gst_rate: Number(form.get(`item_gst_${i}`) ?? 18) });
  }
  await hive(`/api/companies/${slug}/erp/invoices`, {
    method: "POST",
    body: JSON.stringify({
      customer_name: form.get("customer_name"), customer_email: form.get("customer_email") || undefined, customer_gstin: form.get("customer_gstin") || undefined,
      place_of_supply: String(form.get("place_of_supply") ?? "").toUpperCase() || undefined, due_on: form.get("due_on") || undefined, notes: form.get("notes") || undefined, created_by: session.email, items,
    }),
  });
  audit("erp.invoice.create", { actorId: session.userId, orgId: session.orgId, resource: slug });
  revalidatePath(`/c/${slug}/erp`);
}

export async function invoiceStatus(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:erp:pay");
  const id = String(form.get("id"));
  const status = String(form.get("status"));
  await hive(`/api/companies/${slug}/erp/invoices/${id}/status`, { method: "POST", body: JSON.stringify({ status, payment_link: form.get("payment_link") || undefined }) });
  audit(`erp.invoice.${status}`, { actorId: session.userId, orgId: session.orgId, resource: `${slug}/${id}` });
  revalidatePath(`/c/${slug}/erp`);
}

export async function importBank(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:erp:pay");
  const file = form.get("file");
  const csv = file instanceof File ? await file.text() : String(form.get("csv") ?? "");
  const r = await hive<{ imported: number; duplicates: number; skipped: unknown[] }>(`/api/companies/${slug}/erp/bank/import`, {
    method: "POST",
    body: JSON.stringify({ account_id: form.get("account_id"), preset: form.get("preset"), csv, dry_run: form.get("dry_run") === "yes", by: session.email }),
  });
  audit("erp.bank.import", { actorId: session.userId, orgId: session.orgId, resource: slug, meta: { imported: r.imported, duplicates: r.duplicates } });
  revalidatePath(`/c/${slug}/erp`);
  const { redirect } = await import("next/navigation");
  redirect(`/c/${slug}/erp?tab=import&msg=${encodeURIComponent(`${form.get("dry_run") === "yes" ? "Preview: " : ""}${r.imported} rows${form.get("dry_run") === "yes" ? " would be imported" : " imported"}, ${r.duplicates} duplicates skipped, ${r.skipped.length} rows unreadable`)}`);
}
