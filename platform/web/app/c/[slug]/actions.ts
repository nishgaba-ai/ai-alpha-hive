"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "../../../lib/company-access";
import { audit } from "../../../lib/audit";
import { hive } from "../../../lib/hive";

// Every action names the company permission it needs (lib/rbac.ts
// COMPANY_MATRIX): owners do everything, reviewers approve and steer
// missions, viewers only look.

export async function decide(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:approve");
  const id = String(form.get("id"));
  const decision = String(form.get("decision")) as "approved" | "denied";
  const note = String(form.get("note") ?? "") || undefined;
  await hive(`/api/companies/${slug}/approvals/${id}`, { method: "POST", body: JSON.stringify({ decision, note, by: session.email }) });
  audit(`company.approval.${decision}`, { actorId: session.userId, orgId: session.orgId, resource: `${slug}/${id}` });
  revalidatePath(`/c/${slug}`, "layout");
}

export async function startMission(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:mission");
  const text = String(form.get("text") ?? "").trim();
  if (!text) return;
  await hive(`/api/companies/${slug}/missions`, { method: "POST", body: JSON.stringify({ text, by: session.email }) });
  audit("company.mission.start", { actorId: session.userId, orgId: session.orgId, resource: slug, meta: { text } });
  revalidatePath(`/c/${slug}`, "layout");
}

export async function setCompanyStatus(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:config");
  const action = String(form.get("action")) === "pause" ? "pause" : "resume";
  await hive(`/api/companies/${slug}/${action}`, { method: "POST" });
  audit(`company.${action}`, { actorId: session.userId, orgId: session.orgId, resource: slug });
  revalidatePath(`/c/${slug}`, "layout");
}

export async function createTask(form: FormData) {
  const slug = String(form.get("slug"));
  await requireCompany(slug, "company:mission");
  const body = {
    title: String(form.get("title") ?? "").trim(),
    intent: String(form.get("intent") ?? "").trim() || undefined,
    owner_role: String(form.get("owner_role") ?? "") || undefined,
    assignee_person_id: String(form.get("assignee_person_id") ?? "") || undefined,
    due_at: form.get("due") ? new Date(String(form.get("due"))).getTime() : undefined,
    priority: Number(form.get("priority") ?? 3),
  };
  if (!body.title) return;
  await hive(`/api/companies/${slug}/tasks`, { method: "POST", body: JSON.stringify(body) });
  revalidatePath(`/c/${slug}/tasks`);
}

export async function updateTask(form: FormData) {
  const slug = String(form.get("slug"));
  await requireCompany(slug, "company:mission");
  const id = String(form.get("id"));
  const status = String(form.get("status") ?? "") || undefined;
  await hive(`/api/companies/${slug}/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
  revalidatePath(`/c/${slug}/tasks`);
  revalidatePath(`/c/${slug}`);
}

export async function markInboundRead(form: FormData) {
  const slug = String(form.get("slug"));
  await requireCompany(slug, "company:view");
  await hive(`/api/companies/${slug}/inbound/read`, { method: "POST", body: JSON.stringify({ channel: form.get("channel"), thread_id: form.get("thread_id") }) });
  revalidatePath(`/c/${slug}/inbox`);
}
