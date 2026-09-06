"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompany } from "../../../../lib/company-access";
import { getDb } from "../../../../lib/db";
import { can, isCompanyRole } from "../../../../lib/rbac";
import { audit } from "../../../../lib/audit";
import { createInvite, isInviteOrgRole, revokeInvite } from "../../../../lib/invites";

// A function declaration with an explicit `never` return so TS narrows
// after each guard below (an arrow const would not).
function back(slug: string, msg: string): never {
  redirect(`/c/${slug}/access?msg=${encodeURIComponent(msg)}`);
}

// Grant or change one user's role on this company. The user must already
// hold an account and a membership in this organisation.
export async function setAccess(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:access:manage");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role = String(form.get("role") ?? "");
  if (!email) back(slug, "Enter an email.");
  if (!isCompanyRole(role)) back(slug, "Pick a role: owner, reviewer or viewer.");

  const db = getDb();
  const user = db.prepare("SELECT id, status FROM users WHERE email = ?").get(email) as { id: string; status: string } | undefined;
  if (!user || user.status !== "active") back(slug, `No account for ${email}. Ask them to register first, then grant access here.`);
  const member = db
    .prepare("SELECT role FROM memberships WHERE user_id = ? AND org_id = ? AND status = 'active'")
    .get(user.id, session.orgId) as { role: string } | undefined;
  if (!member) back(slug, `${email} is not a member of ${session.orgName} yet. Invite them to the organisation first, then grant access here.`);
  if (member.role === "owner" || member.role === "admin") back(slug, `${email} is an organisation ${member.role} and already owns every company.`);

  db.prepare(
    `INSERT INTO company_access (user_id, org_id, slug, role, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, org_id, slug) DO UPDATE SET role = excluded.role`,
  ).run(user.id, session.orgId, slug, role, Date.now());
  audit("company.access.set", { actorId: session.userId, orgId: session.orgId, resource: `${slug}/user:${user.id}`, meta: { role } });
  revalidatePath(`/c/${slug}`, "layout");
  revalidatePath("/c");
  back(slug, `${email} is now ${role === "owner" ? "an owner" : "a " + role} of this company.`);
}

// Mint an invite link for someone who is not in this organisation yet. The
// company owner gate is the doorway; on top of it the org-level
// member:invite permission (owner/admin) is required, since an invite
// hands out an organisation role and can name an admin.
export async function inviteMember(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:access:manage");
  if (!can(session, "member:invite")) back(slug, "Only organisation owners and admins can invite people.");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const orgRole = String(form.get("org_role") ?? "viewer");
  const companyRole = String(form.get("company_role") ?? "");
  if (!isInviteOrgRole(orgRole)) back(slug, "Pick an organisation role: admin, developer or viewer.");
  if (!isCompanyRole(companyRole) || companyRole === "owner") back(slug, "Pick a company role: reviewer or viewer.");

  const res = createInvite(session.orgId, email, orgRole, [{ slug, role: companyRole }], session.userId);
  if (!res.ok) back(slug, res.error);
  revalidatePath(`/c/${slug}/access`);
  // The raw token is shown once, on the page, for the owner to copy and send.
  redirect(`/c/${slug}/access?invite=${encodeURIComponent(res.token)}&to=${encodeURIComponent(email)}`);
}

export async function revokeInviteAction(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:access:manage");
  if (!can(session, "member:invite")) back(slug, "Only organisation owners and admins manage invites.");
  const id = String(form.get("invite_id") ?? "");
  const ok = revokeInvite(session.orgId, id, session.userId);
  revalidatePath(`/c/${slug}/access`);
  back(slug, ok ? "Invite revoked." : "That invite is already gone.");
}

export async function removeAccess(form: FormData) {
  const slug = String(form.get("slug"));
  const session = await requireCompany(slug, "company:access:manage");
  const userId = String(form.get("user_id") ?? "");
  const res = getDb().prepare("DELETE FROM company_access WHERE user_id = ? AND org_id = ? AND slug = ?").run(userId, session.orgId, slug);
  if (res.changes) audit("company.access.remove", { actorId: session.userId, orgId: session.orgId, resource: `${slug}/user:${userId}` });
  revalidatePath(`/c/${slug}`, "layout");
  revalidatePath("/c");
  back(slug, res.changes ? "Access removed." : "Nothing to remove.");
}
