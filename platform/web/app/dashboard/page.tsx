import type { Metadata } from "next";
import { registry } from "../../modules/registry";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your products, deployments, and connected infrastructure.",
  robots: { index: false },
};

const stats = [
  { label: "Products", value: "3", hint: "2 live · 1 preview" },
  { label: "Releases today", value: "4", hint: "all gates green" },
  { label: "Infrastructure", value: "3/3", hint: "targets healthy" },
  { label: "Modules", value: String(registry.length), hint: "one line each" },
];

export default function Dashboard() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3"
          >
            <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--muted)]">
              {s.label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
            <p className="text-xs text-[var(--muted)]">{s.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        {registry.map((m) => (
          <section
            key={m.id}
            className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5"
          >
            <div className="mb-4 flex items-baseline justify-between">
              <div>
                <h2 className="font-semibold">{m.title}</h2>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{m.description}</p>
              </div>
              <span className="ml-4 shrink-0 font-mono text-[11px] text-[var(--muted)]">
                {m.id}@{m.version}
              </span>
            </div>
            <m.Panel />
          </section>
        ))}
      </div>

      <p className="mt-8 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 text-sm text-[var(--muted)]">
        Every panel is a self-contained module under{" "}
        <code className="text-[var(--brand)]">modules/&lt;name&gt;/</code>,
        rendered from{" "}
        <code className="text-[var(--brand)]">modules/registry.ts</code> — one
        line to add or remove a capability. Access &amp; Identity arrived
        exactly that way, and each module follows a public design-architecture
        spec before it ships.
      </p>
    </main>
  );
}
