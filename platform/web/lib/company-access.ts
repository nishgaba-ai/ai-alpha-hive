import { redirect } from "next/navigation";
import { getSession, type Session } from "./auth";
import { getDb } from "./db";
import { assertCompany, isCompanyRole, type CompanyPermission, type CompanyRole } from "./rbac";

// Server-action doorway for anything under /c/[slug]: a session, then the
// named company permission. Throws CompanyForbidden (fail closed).
export async function requireCompany(slug: string, permission: CompanyPermission): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  assertCompany(session, slug, permission);
  return session;
}

export type AccessRow = {
  user_id: string;
  email: string;
  name: string | null;
  org_role: string;
  company_role: CompanyRole | null;
  implicit: boolean; // org owner/admin: company owner everywhere, no row
  created_at: number | null;
};

/** Every active member of the org with their effective role on one company. */
export function listCompanyAccess(orgId: string, slug: string): AccessRow[] {
  const rows = getDb()
    .prepare(
      `SELECT u.id AS user_id, u.email, u.name, m.role AS org_role, a.role AS company_role, a.created_at
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN company_access a ON a.user_id = m.user_id AND a.org_id = m.org_id AND a.slug = ?
        WHERE m.org_id = ? AND m.status = 'active' AND u.status = 'active'
        ORDER BY u.email`,
    )
    .all(slug, orgId) as { user_id: string; email: string; name: string | null; org_role: string; company_role: string | null; created_at: number | null }[];
  return rows.map((r) => {
    const implicit = r.org_role === "owner" || r.org_role === "admin";
    const explicit = r.company_role && isCompanyRole(r.company_role) ? r.company_role : null;
    return { ...r, implicit, company_role: implicit ? "owner" : explicit };
  });
}
