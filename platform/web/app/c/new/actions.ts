"use server";

import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { assertCan } from "../../../lib/rbac";
import { audit } from "../../../lib/audit";
import { hive } from "../../../lib/hive";

export async function launchCompany(form: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  assertCan(session, "product:create");
  const template = String(form.get("template") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const mission = String(form.get("mission") ?? "").trim() || undefined;
  const model = String(form.get("model") ?? "") || undefined;
  let slug: string;
  try {
    const r = await hive<{ slug: string }>("/api/companies", { method: "POST", body: JSON.stringify({ template, name, mission, model, board_email: session.email }) });
    slug = r.slug;
  } catch (e) {
    redirect(`/c/new?error=${encodeURIComponent((e as Error).message)}`);
  }
  audit("company.launch", { actorId: session.userId, orgId: session.orgId, resource: slug, meta: { template } });
  redirect(`/c/${slug}`);
}
