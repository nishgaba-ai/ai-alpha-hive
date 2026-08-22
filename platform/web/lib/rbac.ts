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
