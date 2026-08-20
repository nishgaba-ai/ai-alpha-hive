import type { Metadata } from "next";
import { registry } from "../../modules/registry";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your products, deployments, and connected infrastructure.",
  robots: { index: false },
};

export default function Dashboard() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Demo preview — sign-in arrives with the RBAC module (email,
            phone, 2FA presets). Every panel below is a self-contained module.
          </p>
        </div>
        <p className="font-mono text-xs text-[var(--muted)]">
          {registry.length} modules loaded
        </p>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        {registry.map((m) => (
          <section
            key={m.id}
            className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5"
          >
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-semibold">{m.title}</h2>
              <span className="font-mono text-[11px] text-[var(--muted)]">
                {m.id}@{m.version}
              </span>
            </div>
            <m.Panel />
          </section>
        ))}
      </div>

      <p className="mt-8 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 text-sm text-[var(--muted)]">
        How this is modular: each panel lives in{" "}
        <code className="text-[var(--brand)]">modules/&lt;name&gt;/</code> with
        its own manifest and UI, and the dashboard renders whatever{" "}
        <code className="text-[var(--brand)]">modules/registry.ts</code> lists —
        one line to add or remove a capability. The engine&apos;s{" "}
        <code className="text-[var(--brand)]">hive add</code> will inject
        registry entries the same way (payments, CMS, analytics, referrals).
      </p>
    </main>
  );
}
