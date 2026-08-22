import { getDb } from "./db";
import { newId } from "./ids";

// Append-only audit trail (spec §10). Action names are stable constants.
export function audit(
  action: string,
  opts: {
    actorId?: string | null;
    orgId?: string | null;
    resource?: string;
    meta?: unknown;
    ip?: string | null;
  } = {},
): void {
  getDb()
    .prepare(
      "INSERT INTO audit_events (id, ts, actor_id, org_id, action, resource, meta, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      newId(),
      Date.now(),
      opts.actorId ?? null,
      opts.orgId ?? null,
      action,
      opts.resource ?? null,
      opts.meta === undefined ? null : JSON.stringify(opts.meta),
      opts.ip ?? null,
    );
}

export type AuditRow = {
  id: string;
  ts: number;
  actor_id: string | null;
  org_id: string | null;
  action: string;
  resource: string | null;
  meta: string | null;
};

export function recentAudit(orgId: string, limit = 20): AuditRow[] {
  return getDb()
    .prepare("SELECT * FROM audit_events WHERE org_id = ? ORDER BY ts DESC LIMIT ?")
    .all(orgId, limit) as AuditRow[];
}
