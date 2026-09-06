"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompany } from "../../../../lib/company-access";
import { audit } from "../../../../lib/audit";
import { hive } from "../../../../lib/hive";

export async function submitIntake(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:mission");
  const channels = form.getAll("channels").map(String);
  const payload = {
    website: String(form.get("website") ?? "").trim(),
    product: String(form.get("product") ?? "").trim(),
    audience: String(form.get("audience") ?? "").trim(),
    goals: String(form.get("goals") ?? "").trim(),
    competitors: String(form.get("competitors") ?? "").trim() || undefined,
    tone: String(form.get("tone") ?? "").trim() || undefined,
    channels: channels.length ? channels : undefined,
    budget_note: String(form.get("budget_note") ?? "").trim() || undefined,
    deadline: String(form.get("deadline") ?? "").trim() || undefined,
    start: form.get("start") !== "no",
    by: session.email,
  };
  let r: { id: string; mission_id: string | null };
  try {
    r = await hive(`/api/companies/${slug}/intake`, { method: "POST", body: JSON.stringify(payload) });
  } catch (e) {
    redirect(`/c/${slug}/intake?msg=${encodeURIComponent((e as Error).message)}`);
  }
  audit("company.intake.submit", { actorId: session.userId, orgId: session.orgId, resource: `${slug}/${r.id}` });
  revalidatePath(`/c/${slug}`, "layout");
  if (r.mission_id) redirect(`/c/${slug}/missions/${r.mission_id}`);
  redirect(`/c/${slug}/intake?msg=${encodeURIComponent("Intake saved. Start a mission from it whenever you are ready.")}`);
}
