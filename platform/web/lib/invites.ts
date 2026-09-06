import { createHash } from "node:crypto";
import { getDb } from "./db";
import { newId, newSecret } from "./ids";
import { audit } from "./audit";
import { isCompanyRole, type CompanyRole, type Role } from "./rbac";

// Organisation invites (docs/company/group.md "Who can do what"). An owner
// mints a link for one email; whoever registers or signs in through it with
// that email joins the org with `orgRole` and gets a company_access row per
// grant. The raw token is returned once and only its sha256 is stored, the
// same shape as the verify/reset tokens in lib/auth.ts.

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const INVITE_ORG_ROLES = ["admin", "developer", "viewer"] as const;
export type InviteOrgRole = (typeof INVITE_ORG_ROLES)[number];

export type CompanyGrant = { slug: string; role: CompanyRole };

export type InviteRow = {
  id: string;
  org_id: string;
  email: string;
  org_role: string;
  company_grants_json: string;
  token_hash: string;
  invited_by: string;
  created_at: number;
  expires_at: number;
  accepted_at: number | null;
};

export type PendingInvite = {
  id: string;
  email: string;
  orgRole: InviteOrgRole;
  grants: CompanyGrant[];
  invitedBy: string; // inviter's email
  createdAt: number;
  expiresAt: number;
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function isInviteOrgRole(s: string): s is InviteOrgRole {
  return (INVITE_ORG_ROLES as readonly string[]).includes(s);
}

function parseGrants(json: string): CompanyGrant[] {
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((g) => {
      if (!g || typeof g !== "object") return [];
      const { slug, role } = g as { slug?: unknown; role?: unknown };
      return typeof slug === "string" && slug && typeof role === "string" && isCompanyRole(role) ? [{ slug, role }] : [];
    });
  } catch {
    return [];
  }
}

// ---------- create ----------

export function createInvite(
  orgId: string,
  email: string,
  orgRole: InviteOrgRole,
  grants: CompanyGrant[],
  invitedBy: string,
): { ok: true; id: string; token: string; expiresAt: number } | { ok: false; error: string } {
  email = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Enter a valid email." };
  if (!isInviteOrgRole(orgRole)) return { ok: false, error: "Pick an organisation role: admin, developer or viewer." };
  const clean = grants.filter((g) => g.slug && isCompanyRole(g.role)).map((g) => ({ slug: g.slug, role: g.role }));

  const db = getDb();
  const member = db
    .prepare(
      `SELECT m.role FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.org_id = ? AND m.status = 'active' AND u.email = ?`,
    )
    .get(orgId, email) as { role: string } | undefined;
  if (member) return { ok: false, error: `${email} is already a member of this organisation (${member.role}). Grant company access directly.` };

  const now = Date.now();
  const id = newId();
  const token = newSecret();
  const expiresAt = now + INVITE_TTL_MS;
  db.prepare(
    `INSERT INTO invites (id, org_id, email, org_role, company_grants_json, token_hash, invited_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, orgId, email, orgRole, JSON.stringify(clean), sha256(token), invitedBy, now, expiresAt);
  audit("org.invite.create", {
    actorId: invitedBy,
    orgId,
    resource: "invite:" + id,
    meta: { email, orgRole, grants: clean },
  });
  return { ok: true, id, token, expiresAt };
}

// ---------- read ----------

function liveInviteByToken(token: string): InviteRow | null {
  if (!token) return null;
  const row = getDb().prepare("SELECT * FROM invites WHERE token_hash = ?").get(sha256(token)) as InviteRow | undefined;
  if (!row || row.accepted_at || row.expires_at < Date.now()) return null;
  return row;
}

/** What a login/register page shows before the invitee authenticates. Never consumes. */
export function peekInvite(token: string): { email: string; orgId: string; orgName: string; orgRole: string; expiresAt: number } | null {
  const row = liveInviteByToken(token);
  if (!row) return null;
  const org = getDb().prepare("SELECT name FROM orgs WHERE id = ?").get(row.org_id) as { name: string } | undefined;
  if (!org) return null;
  return { email: row.email, orgId: row.org_id, orgName: org.name, orgRole: row.org_role, expiresAt: row.expires_at };
}

/** Pending (unaccepted, unexpired) invites for one organisation, newest first. */
export function listInvites(orgId: string): PendingInvite[] {
  const rows = getDb()
    .prepare(
      `SELECT i.*, u.email AS inviter_email FROM invites i
         LEFT JOIN users u ON u.id = i.invited_by
        WHERE i.org_id = ? AND i.accepted_at IS NULL AND i.expires_at > ?
        ORDER BY i.created_at DESC`,
    )
    .all(orgId, Date.now()) as (InviteRow & { inviter_email: string | null })[];
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    orgRole: isInviteOrgRole(r.org_role) ? r.org_role : "viewer",
    grants: parseGrants(r.company_grants_json),
    invitedBy: r.inviter_email ?? r.invited_by,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }));
}

// ---------- accept / revoke ----------

export type AcceptResult = { ok: true; orgId: string; orgName: string; role: Role } | { ok: false; error: string };

/**
 * Bind the invite to an authenticated user: activate the membership, apply
 * the company grants, mark accepted. Single-use and race-safe (the UPDATE
 * that stamps accepted_at is the lock). The invitee's email must match.
 */
export function acceptInvite(token: string, user: { id: string; email: string }): AcceptResult {
  const db = getDb();
  const row = liveInviteByToken(token);
  if (!row) return { ok: false, error: "This invite link is invalid, expired or already used." };
  if (row.email.toLowerCase() !== user.email.trim().toLowerCase()) {
    return { ok: false, error: `This invite was sent to ${row.email}. Sign in with that email to accept it.` };
  }
  const org = db.prepare("SELECT name FROM orgs WHERE id = ?").get(row.org_id) as { name: string } | undefined;
  if (!org) return { ok: false, error: "The organisation behind this invite no longer exists." };
  const orgRole: Role = isInviteOrgRole(row.org_role) ? row.org_role : "viewer";
  const grants = parseGrants(row.company_grants_json);
  const now = Date.now();

  const applied = db.transaction((): boolean => {
    const stamped = db.prepare("UPDATE invites SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL").run(now, row.id);
    if (stamped.changes !== 1) return false;

    const existing = db
      .prepare("SELECT role, status FROM memberships WHERE user_id = ? AND org_id = ?")
      .get(user.id, row.org_id) as { role: string; status: string } | undefined;
    if (!existing) {
      db.prepare("INSERT INTO memberships (user_id, org_id, role, status, created_at) VALUES (?, ?, ?, 'active', ?)").run(user.id, row.org_id, orgRole, now);
    } else if (existing.status !== "active") {
      // A lapsed member comes back with the role the invite carries.
      db.prepare("UPDATE memberships SET status = 'active', role = ? WHERE user_id = ? AND org_id = ?").run(orgRole, user.id, row.org_id);
    }
    // else: already active — never downgrade an existing role via an invite.

    const effectiveRole = existing?.status === "active" ? existing.role : orgRole;
    if (effectiveRole !== "owner" && effectiveRole !== "admin") {
      const upsert = db.prepare(
        `INSERT INTO company_access (user_id, org_id, slug, role, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, org_id, slug) DO UPDATE SET role = excluded.role`,
      );
      for (const g of grants) upsert.run(user.id, row.org_id, g.slug, g.role, now);
    }
    return true;
  })();

  if (!applied) return { ok: false, error: "This invite link is invalid, expired or already used." };
  audit("org.invite.accept", {
    actorId: user.id,
    orgId: row.org_id,
    resource: "invite:" + row.id,
    meta: { orgRole, grants, invitedBy: row.invited_by },
  });
  return { ok: true, orgId: row.org_id, orgName: org.name, role: orgRole };
}

/** Delete a pending invite. Accepted invites stay as history. */
export function revokeInvite(orgId: string, inviteId: string, actorId: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT email FROM invites WHERE id = ? AND org_id = ? AND accepted_at IS NULL").get(inviteId, orgId) as { email: string } | undefined;
  if (!row) return false;
  const res = db.prepare("DELETE FROM invites WHERE id = ? AND org_id = ? AND accepted_at IS NULL").run(inviteId, orgId);
  if (res.changes !== 1) return false;
  audit("org.invite.revoke", { actorId, orgId, resource: "invite:" + inviteId, meta: { email: row.email } });
  return true;
}
