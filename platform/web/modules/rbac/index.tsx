import type { DashboardModule, ModuleContext } from "../types";
import { getDb } from "../../lib/db";
import { listSessions } from "../../lib/auth";

const methods = [
  { name: "email + password · verify · reset", tier: "standard", status: "active" },
  { name: "phone OTP · magic link", tier: "custom", status: "planned" },
  { name: "2FA · passkeys · SSO", tier: "advanced", status: "planned" },
];

async function Panel({ session }: ModuleContext) {
  const members = getDb()
    .prepare(
      "SELECT u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? AND m.status = 'active' ORDER BY m.created_at",
    )
    .all(session.orgId) as { email: string; role: string }[];
  const sessions = listSessions(session.userId);

  return (
    <div className="space-y-5 text-sm">
      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--muted)]">
          Members · {session.orgName}
        </p>
        <ul className="space-y-1.5">
          {members.map((m) => (
            <li key={m.email} className="flex justify-between">
              <span>{m.email}</span>
              <span className="font-mono text-xs text-[var(--brand)]">{m.role}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--muted)]">
          Your sessions · {sessions.length} active
        </p>
        <ul className="space-y-1.5">
          {sessions.slice(0, 3).map((s) => (
            <li key={s.id} className="flex justify-between text-xs text-[var(--muted)]">
              <span className="truncate pr-3">{s.user_agent?.split(" ")[0] ?? "unknown client"} · {s.ip ?? "ip n/a"}</span>
              <span>{new Date(s.last_seen_at).toISOString().slice(0, 16).replace("T", " ")}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--muted)]">Login presets</p>
        <ul className="space-y-1.5">
          {methods.map((m) => (
            <li key={m.name} className="flex justify-between">
              <span>
                {m.name} <span className="font-mono text-xs text-[var(--muted)]">{m.tier}</span>
              </span>
              <span className={m.status === "active" ? "text-[var(--good)]" : "text-[var(--muted)]"}>
                {m.status === "active" ? "● active" : m.status}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <a
        href="https://github.com/nishgaba-ai/ai-alpha-hive/blob/main/docs/specs/login-rbac.md"
        className="inline-block text-xs text-[var(--muted)] underline decoration-[var(--brand-dim)] underline-offset-4 hover:text-[var(--brand)]"
      >
        full design-architecture spec →
      </a>
    </div>
  );
}

const mod: DashboardModule = {
  id: "rbac",
  version: "0.3.0",
  title: "Access & Identity",
  description: "Members, roles, sessions, and login presets — the gold-standard library.",
  Panel,
};

export default mod;
