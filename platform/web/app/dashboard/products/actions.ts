"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "../../../lib/auth";
import { getDb } from "../../../lib/db";
import { newId } from "../../../lib/ids";
import { assertCan } from "../../../lib/rbac";
import { audit } from "../../../lib/audit";

const TARGETS = new Set(["managed", "own-infra", "local"]);

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]+/g, "").replace(/^-+|-+$/g, "") || "product";
}

export async function createProduct(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  // enforcement point (spec §7): the doorway, not the UI
  assertCan(session, "product:create");

  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const target = String(formData.get("target") ?? "managed");
  if (!name || !TARGETS.has(target)) redirect("/dashboard?error=" + encodeURIComponent("Name and a valid target are required."));

  const db = getDb();
  const id = newId();
  let slug = slugify(name);
  const taken = db.prepare("SELECT 1 FROM products WHERE org_id = ? AND slug = ?").get(session.orgId, slug);
  if (taken) slug = `${slug}-${id.slice(0, 6)}`;

  db.prepare(
    "INSERT INTO products (id, org_id, name, slug, target, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)",
  ).run(id, session.orgId, name, slug, target, session.userId, Date.now());
  audit("product.create", { actorId: session.userId, orgId: session.orgId, resource: "product:" + id, meta: { name, target } });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function deleteProduct(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  assertCan(session, "product:delete");
  const id = String(formData.get("id") ?? "");
  // org-scoped by construction (spec §8): the WHERE includes org_id
  const res = getDb().prepare("DELETE FROM products WHERE id = ? AND org_id = ?").run(id, session.orgId);
  if (res.changes === 1) {
    audit("product.delete", { actorId: session.userId, orgId: session.orgId, resource: "product:" + id });
  }
  revalidatePath("/dashboard");
  redirect("/dashboard");
}
