"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompany } from "../../../../lib/company-access";
import { audit } from "../../../../lib/audit";
import { hive } from "../../../../lib/hive";

export async function cardAction(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:erp:pay");
  const id = String(form.get("id"));
  const action = String(form.get("action"));
  try {
    if (action === "issue") await hive(`/api/companies/${slug}/cards/${id}/issue`, { method: "POST" });
    else if (action === "freeze" || action === "unfreeze") await hive(`/api/companies/${slug}/cards/${id}/freeze`, { method: "POST", body: JSON.stringify({ frozen: action === "freeze" }) });
  } catch (e) {
    redirect(`/c/${slug}/treasury?msg=${encodeURIComponent((e as Error).message)}`);
  }
  audit(`treasury.card.${action}`, { actorId: session.userId, orgId: session.orgId, resource: `${slug}/${id}` });
  revalidatePath(`/c/${slug}/treasury`);
}
