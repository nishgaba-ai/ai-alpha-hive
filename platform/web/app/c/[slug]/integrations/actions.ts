"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import YAML from "yaml";
import { requireCompany } from "../../../../lib/company-access";
import { audit } from "../../../../lib/audit";
import { hive } from "../../../../lib/hive";

// Secrets and integration toggles are company:secrets (owner only).

export async function storeSecret(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:secrets");
  const name = String(form.get("name"));
  const value = String(form.get("value") ?? "");
  const id = String(form.get("id") ?? "");
  if (!value) return;
  try {
    await hive(`/api/companies/${slug}/secrets`, { method: "POST", body: JSON.stringify({ name, value }) });
  } catch (e) {
    redirect(`/c/${slug}/integrations?open=${id}&msg=${encodeURIComponent((e as Error).message)}`);
  }
  audit("company.secret.set", { actorId: session.userId, orgId: session.orgId, resource: `${slug}/${name}` }); // name only, never the value
  revalidatePath(`/c/${slug}/integrations`);
  redirect(`/c/${slug}/integrations?open=${id}&msg=${encodeURIComponent(`${name} stored in the vault`)}`);
}

export async function enableIntegration(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:secrets");
  const id = String(form.get("id"));
  const modes = form.getAll("modes").map(String);
  const current = await hive<{ yaml: string }>(`/api/companies/${slug}`);
  const doc = YAML.parseDocument(current.yaml);
  const list = (doc.get("integrations") as YAML.YAMLSeq | undefined) ?? new YAML.YAMLSeq();
  const items = (list.items as YAML.YAMLMap[]).filter((m) => !(m instanceof YAML.YAMLMap && m.get("id") === id));
  const entry = new YAML.YAMLMap();
  entry.set("id", id);
  entry.set("modes", modes);
  entry.flow = false;
  list.items = [...items, entry];
  doc.set("integrations", list);
  try {
    await hive(`/api/companies/${slug}/yaml`, { method: "PUT", body: JSON.stringify({ yaml: String(doc) }) });
  } catch (e) {
    redirect(`/c/${slug}/integrations?open=${id}&msg=${encodeURIComponent((e as Error).message)}`);
  }
  audit("company.integration.enable", { actorId: session.userId, orgId: session.orgId, resource: `${slug}/${id}`, meta: { modes } });
  revalidatePath(`/c/${slug}`, "layout");
  redirect(`/c/${slug}/integrations?open=${id}&msg=${encodeURIComponent(`${id} enabled in ${modes.join(", ")}. Grant its tools to roles in Settings.`)}`);
}

export async function checkIntegration(form: FormData) {
  const slug = String(form.get("slug"));
  await requireCompany(slug, "company:secrets");
  const id = String(form.get("id"));
  const r = await hive<{ ok: boolean; detail: string }>(`/api/companies/${slug}/integrations/${id}/health`, { method: "POST" });
  redirect(`/c/${slug}/integrations?open=${id}&msg=${encodeURIComponent(`${id}: ${r.ok ? "ok" : "failed"} — ${r.detail}`)}`);
}

export async function connectIntegration(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:secrets");
  const id = String(form.get("id"));
  let url: string;
  try {
    const r = await hive<{ url: string }>(`/api/companies/${slug}/integrations/${id}/oauth/start`);
    url = r.url;
  } catch (e) {
    redirect(`/c/${slug}/integrations?open=${id}&msg=${encodeURIComponent((e as Error).message)}`);
  }
  audit("company.integration.connect", { actorId: session.userId, orgId: session.orgId, resource: `${slug}/${id}` });
  redirect(url);
}
