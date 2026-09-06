import { getDb } from "./db";

// The RBAC core (spec §7): named permissions, a data-driven role matrix,
// and ONE doorway — can(). Unknown permissions throw (fail closed).

export const ROLES = ["owner", "admin", "developer", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "product:create",
  "product:deploy",
  "product:delete",
  "product:read",
  "member:invite",
  "member:role:set",
  "org:billing",
  "org:delete",
  "audit:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  admin: new Set<Permission>([
    "product:create",
    "product:deploy",
    "product:delete",
    "product:read",
    "member:invite",
    "member:role:set",
    "audit:read",
  ]),
  developer: new Set<Permission>(["product:create", "product:deploy", "product:read"]),
  viewer: new Set<Permission>(["product:read"]),
};

export type Actor = { userId: string; orgId: string; role: Role };

export function can(actor: Actor, permission: Permission): boolean {
  if (!(PERMISSIONS as readonly string[]).includes(permission)) {
    throw new Error(`unknown permission "${permission}" — fail closed`);
  }
  return MATRIX[actor.role]?.has(permission) ?? false;
}

export class Forbidden extends Error {
  constructor(permission: Permission) {
    super(`forbidden: ${permission}`);
  }
}

export function assertCan(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw new Forbidden(permission);
}

// ---------- per-company access ----------
// One board, many verticals. Org owners/admins are company owners
// everywhere; everyone else needs a company_access row. Same doorway
// shape as can(): unknown permissions throw (fail closed).

export const COMPANY_ROLES = ["owner", "reviewer", "viewer"] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const COMPANY_PERMISSIONS = [
  "company:view",
  "company:approve",
  "company:mission",
  "company:config",
  "company:secrets",
  "company:erp:pay",
  "company:access:manage",
] as const;
export type CompanyPermission = (typeof COMPANY_PERMISSIONS)[number];

const COMPANY_MATRIX: Record<CompanyRole, ReadonlySet<CompanyPermission>> = {
  owner: new Set(COMPANY_PERMISSIONS),
  reviewer: new Set<CompanyPermission>(["company:view", "company:approve", "company:mission"]),
  viewer: new Set<CompanyPermission>(["company:view"]),
};

export function isCompanyRole(s: string): s is CompanyRole {
  return (COMPANY_ROLES as readonly string[]).includes(s);
}

/** The actor's role on one company, or null when they have no access at all. */
export function companyRole(actor: Actor, slug: string): CompanyRole | null {
  if (actor.role === "owner" || actor.role === "admin") return "owner";
  const row = getDb()
    .prepare("SELECT role FROM company_access WHERE user_id = ? AND org_id = ? AND slug = ?")
    .get(actor.userId, actor.orgId, slug) as { role: string } | undefined;
  return row && isCompanyRole(row.role) ? row.role : null;
}

export function canCompany(actor: Actor, slug: string, permission: CompanyPermission): boolean {
  if (!(COMPANY_PERMISSIONS as readonly string[]).includes(permission)) {
    throw new Error(`unknown company permission "${permission}" — fail closed`);
  }
  const role = companyRole(actor, slug);
  return role ? COMPANY_MATRIX[role].has(permission) : false;
}

export class CompanyForbidden extends Error {
  constructor(slug: string, permission: CompanyPermission) {
    super(`forbidden: ${permission} on ${slug}`);
  }
}

export function assertCompany(actor: Actor, slug: string, permission: CompanyPermission): void {
  if (!canCompany(actor, slug, permission)) throw new CompanyForbidden(slug, permission);
}
