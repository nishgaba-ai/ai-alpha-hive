"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, switchSessionOrg } from "../../../lib/auth";

// POST /c/switch-org: point the current session at another organisation
// the user actively belongs to, then start over from the group view (the
// companies and roles under the new org are different).
export async function switchOrg(form: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login?next=/c");
  const orgId = String(form.get("org_id") ?? "");
  if (orgId && orgId !== session.orgId) {
    const ok = switchSessionOrg(session.id, session.userId, orgId);
    if (!ok) redirect("/c?msg=" + encodeURIComponent("You are not a member of that organisation."));
    revalidatePath("/c", "layout");
  }
  redirect("/c");
}
