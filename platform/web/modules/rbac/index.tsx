import type { DashboardModule } from "../types";

const methods = [
  { name: "email + password", tier: "standard", status: "active" },
  { name: "forgot / reset", tier: "standard", status: "stage B" },
  { name: "phone OTP", tier: "custom", status: "planned" },
  { name: "2FA · passkeys · SSO", tier: "advanced", status: "planned" },
];

function Panel() {
  return (
    <div className="text-sm">
      <ul className="space-y-2.5">
        {methods.map((m) => (
          <li
            key={m.name}
            className="flex items-center justify-between border-t border-[var(--line)] pt-2.5 first:border-t-0 first:pt-0"
          >
            <div>
              <p>{m.name}</p>
              <p className="font-mono text-xs text-[var(--muted)]">{m.tier}</p>
            </div>
            <span
              className={
                m.status === "active"
                  ? "text-[var(--good)]"
                  : "text-[var(--muted)]"
              }
            >
              {m.status === "active" ? "● active" : m.status}
            </span>
          </li>
        ))}
      </ul>
      <a
        href="https://github.com/nishgaba-ai/ai-alpha-hive/blob/main/docs/specs/login-rbac.md"
        className="mt-4 inline-block text-xs text-[var(--muted)] underline decoration-[var(--brand-dim)] underline-offset-4 hover:text-[var(--brand)]"
      >
        full design-architecture spec →
      </a>
    </div>
  );
}

const mod: DashboardModule = {
  id: "rbac",
  version: "0.2.0",
  title: "Access & Identity",
  description: "Login presets, sessions, and roles — the gold-standard library.",
  Panel,
};

export default mod;
