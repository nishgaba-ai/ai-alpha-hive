"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { assertCan } from "../../../../lib/rbac";
import { hive } from "../../../../lib/hive";

async function board() {
  const session = await getSession();
  if (!session) redirect("/login");
  assertCan(session, "product:create");
  return session;
}

export async function addCreator(form: FormData) {
  await board();
  const slug = String(form.get("slug"));
  try {
    await hive(`/api/companies/${slug}/creators`, { method: "POST", body: JSON.stringify({ name: form.get("name"), handle: form.get("handle") || undefined, platform: form.get("platform"), email: form.get("email") || undefined, commission_pct: form.get("commission_pct") ? Number(form.get("commission_pct")) : undefined, age_confirmed: form.get("age_confirmed") === "on" }) });
  } catch (e) {
    redirect(`/c/${slug}/creators?msg=${encodeURIComponent((e as Error).message)}`);
  }
  revalidatePath(`/c/${slug}/creators`);
}

export async function recordEvent(form: FormData) {
  await board();
  const slug = String(form.get("slug"));
  const id = String(form.get("id"));
  const kind = String(form.get("kind"));
  const raw = Number(String(form.get("value") ?? "0").replace(/[^\d.]/g, "")) || 0;
  const body = kind === "video" ? { kind, views: Math.round(raw) } : kind === "revenue" ? { kind, amount_minor: Math.round(raw * 100) } : { kind };
  await hive(`/api/companies/${slug}/creators/${id}/events`, { method: "POST", body: JSON.stringify(body) });
  revalidatePath(`/c/${slug}/creators`);
}

export async function requestPayout(form: FormData) {
  const session = await board();
  const slug = String(form.get("slug"));
  const id = String(form.get("id"));
  try {
    const r = await hive<{ amount_minor: number }>(`/api/companies/${slug}/creators/${id}/payout`, { method: "POST", body: JSON.stringify({ by: session.email }) });
    redirect(`/c/${slug}/creators?msg=${encodeURIComponent(`Payout filed as an expense (${(r.amount_minor / 100).toLocaleString("en-IN")}). Approve and pay it in ERP → Expenses.`)}`);
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    redirect(`/c/${slug}/creators?msg=${encodeURIComponent((e as Error).message)}`);
  }
}

export async function setCreatorStatus(form: FormData) {
  await board();
  const slug = String(form.get("slug"));
  await hive(`/api/companies/${slug}/creators/${form.get("id")}`, { method: "PATCH", body: JSON.stringify({ status: form.get("status") }) });
  revalidatePath(`/c/${slug}/creators`);
}
