"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { assertCan } from "../../../lib/rbac";
import { audit } from "../../../lib/audit";
import { hive } from "../../../lib/hive";

async function board() {
  const session = await getSession();
  if (!session) redirect("/login");
  assertCan(session, "product:deploy"); // owner/admin/developer may decide; viewers cannot
  return session;
}

export async function decide(form: FormData) {
  const session = await board();
  const slug = String(form.get("slug"));
  const id = String(form.get("id"));
  const decision = String(form.get("decision")) as "approved" | "denied";
  const note = String(form.get("note") ?? "") || undefined;
  await hive(`/api/companies/${slug}/approvals/${id}`, { method: "POST", body: JSON.stringify({ decision, note, by: session.email }) });
  audit(`company.approval.${decision}`, { actorId: session.userId, orgId: session.orgId, resource: `${slug}/${id}` });
  revalidatePath(`/c/${slug}`, "layout");
}

export async function startMission(form: FormData) {
  const session = await board();
  const slug = String(form.get("slug"));
  const text = String(form.get("text") ?? "").trim();
  if (!text) return;
  await hive(`/api/companies/${slug}/missions`, { method: "POST", body: JSON.stringify({ text, by: session.email }) });
  audit("company.mission.start", { actorId: session.userId, orgId: session.orgId, resource: slug, meta: { text } });
  revalidatePath(`/c/${slug}`, "layout");
}

export async function setCompanyStatus(form: FormData) {
  const session = await board();
  const slug = String(form.get("slug"));
  const action = String(form.get("action")) === "pause" ? "pause" : "resume";
  await hive(`/api/companies/${slug}/${action}`, { method: "POST" });
  audit(`company.${action}`, { actorId: session.userId, orgId: session.orgId, resource: slug });
  revalidatePath(`/c/${slug}`, "layout");
}

export async function createTask(form: FormData) {
  await board();
  const slug = String(form.get("slug"));
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
  await board();
  const slug = String(form.get("slug"));
  const id = String(form.get("id"));
  const status = String(form.get("status") ?? "") || undefined;
  await hive(`/api/companies/${slug}/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
  revalidatePath(`/c/${slug}/tasks`);
  revalidatePath(`/c/${slug}`);
}
