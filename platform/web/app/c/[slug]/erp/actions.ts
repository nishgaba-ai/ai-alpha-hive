"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { assertCan } from "../../../../lib/rbac";
import { audit } from "../../../../lib/audit";
import { hive } from "../../../../lib/hive";

async function board(perm: "product:create" | "org:billing" = "product:create") {
  const session = await getSession();
  if (!session) redirect("/login");
  assertCan(session, perm);
  return session;
}
const minor = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? "0").replace(/[^\d.-]/g, "")) * 100);

export async function addPerson(form: FormData) {
  await board();
  const slug = String(form.get("slug"));
  await hive(`/api/companies/${slug}/erp/people`, { method: "POST", body: JSON.stringify({ name: form.get("name"), email: form.get("email") || undefined, title: form.get("title") || undefined, kind: form.get("kind"), monthly_salary_minor: minor(form.get("salary")), telegram_chat_id: form.get("telegram") || undefined }) });
  revalidatePath(`/c/${slug}/erp`);
}

export async function draftPayroll(form: FormData) {
  await board("org:billing");
  const slug = String(form.get("slug"));
  await hive(`/api/companies/${slug}/erp/payroll`, { method: "POST", body: JSON.stringify({ period: form.get("period") }) });
  revalidatePath(`/c/${slug}/erp`);
}

export async function payrollAction(form: FormData) {
  const session = await board("org:billing");
  const slug = String(form.get("slug"));
  const id = String(form.get("id"));
  const action = String(form.get("action"));
  await hive(`/api/companies/${slug}/erp/payroll/${id}/${action}`, { method: "POST", body: JSON.stringify({ by: session.email, account_id: form.get("account_id") }) });
  audit(`erp.payroll.${action}`, { actorId: session.userId, orgId: session.orgId, resource: `${slug}/${id}` });
  revalidatePath(`/c/${slug}/erp`);
}

export async function submitExpense(form: FormData) {
  await board();
  const slug = String(form.get("slug"));
  await hive(`/api/companies/${slug}/erp/expenses`, { method: "POST", body: JSON.stringify({ person_id: form.get("person_id") || undefined, category: form.get("category"), amount_minor: minor(form.get("amount")), description: form.get("description"), receipt_ref: form.get("receipt") || undefined }) });
  revalidatePath(`/c/${slug}/erp`);
}

export async function expenseAction(form: FormData) {
  const session = await board("org:billing");
  const slug = String(form.get("slug"));
  const id = String(form.get("id"));
  const action = String(form.get("action"));
  if (action === "pay") await hive(`/api/companies/${slug}/erp/expenses/${id}/pay`, { method: "POST", body: JSON.stringify({ by: session.email, account_id: form.get("account_id") }) });
  else await hive(`/api/companies/${slug}/erp/expenses/${id}/decide`, { method: "POST", body: JSON.stringify({ by: session.email, decision: action }) });
  revalidatePath(`/c/${slug}/erp`);
}

export async function logTime(form: FormData) {
  await board();
  const slug = String(form.get("slug"));
  await hive(`/api/companies/${slug}/erp/time`, { method: "POST", body: JSON.stringify({ person_id: form.get("person_id"), task_id: form.get("task_id") || undefined, date: form.get("date"), minutes: Number(form.get("hours") ?? 0) * 60, note: form.get("note") || undefined }) });
  revalidatePath(`/c/${slug}/erp`);
}

export async function addCashAccount(form: FormData) {
  await board("org:billing");
  const slug = String(form.get("slug"));
  await hive(`/api/companies/${slug}/erp/cash/accounts`, { method: "POST", body: JSON.stringify({ name: form.get("name"), kind: form.get("kind"), opening_minor: minor(form.get("opening")) }) });
  revalidatePath(`/c/${slug}/erp`);
}

export async function addCashTxn(form: FormData) {
  const session = await board("org:billing");
  const slug = String(form.get("slug"));
  const sign = String(form.get("direction")) === "out" ? -1 : 1;
  await hive(`/api/companies/${slug}/erp/cash/txns`, { method: "POST", body: JSON.stringify({ account_id: form.get("account_id"), amount_minor: sign * Math.abs(minor(form.get("amount"))), category: form.get("category"), counterparty: form.get("counterparty") || undefined, memo: form.get("memo") || undefined, created_by: session.email }) });
  revalidatePath(`/c/${slug}/erp`);
}
