import type { DashboardModule, ModuleContext } from "../types";
import { recentAudit } from "../../lib/audit";
import { can } from "../../lib/rbac";

function ago(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

async function Panel({ session }: ModuleContext) {
  if (!can(session, "audit:read")) {
    return <p className="text-sm text-[var(--muted)]">Audit history is visible to admins and owners.</p>;
  }
  const rows = recentAudit(session.orgId, 12);
  return (
    <ul className="space-y-2.5 text-sm">
      {rows.length === 0 ? <li className="text-[var(--muted)]">Nothing yet.</li> : null}
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between border-t border-[var(--line)] pt-2.5 first:border-t-0 first:pt-0">
          <div>
            <p className="font-mono text-[13px]">{r.action}</p>
            <p className="text-xs text-[var(--muted)]">{r.resource ?? "—"}</p>
          </div>
          <span className="text-xs text-[var(--muted)]">{ago(r.ts)}</span>
        </li>
      ))}
    </ul>
  );
}

const mod: DashboardModule = {
  id: "activity",
  version: "0.1.0",
  title: "Activity",
  description: "The audit trail — every mutation and auth event in this workspace.",
  Panel,
};

export default mod;
