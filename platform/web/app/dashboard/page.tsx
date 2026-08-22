import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { registry } from "../../modules/registry";
import type { DashboardModule } from "../../modules/types";
import { getSession, type Session } from "../../lib/auth";
import { getDb } from "../../lib/db";
import { Notice } from "../../modules/rbac/ui";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your products, deployments, and connected infrastructure.",
  robots: { index: false },
};

async function ModulePanel({ mod, session }: { mod: DashboardModule; session: Session }) {
  const panel = await mod.Panel({ session });
  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="font-semibold">{mod.title}</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{mod.description}</p>
        </div>
        <span className="ml-4 shrink-0 font-mono text-[11px] text-[var(--muted)]">{mod.id}@{mod.version}</span>
      </div>
      {panel}
    </section>
  );
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { error } = await searchParams;

  const db = getDb();
  const products = (db.prepare("SELECT COUNT(*) AS n FROM products WHERE org_id = ?").get(session.orgId) as { n: number }).n;
  const live = (db.prepare("SELECT COUNT(*) AS n FROM products WHERE org_id = ? AND status = 'live'").get(session.orgId) as { n: number }).n;
  const members = (db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND status = 'active'").get(session.orgId) as { n: number }).n;
  const events = (db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE org_id = ? AND ts > ?").get(session.orgId, Date.now() - 86_400_000) as { n: number }).n;

  const stats = [
    { label: "Products", value: String(products), hint: `${live} live` },
    { label: "Members", value: String(members), hint: session.orgName },
    { label: "Events · 24h", value: String(events), hint: "audited" },
    { label: "Modules", value: String(registry.length), hint: "one line each" },
  ];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      {error ? <div className="mt-4"><Notice tone="error">{error}</Notice></div> : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
            <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--muted)]">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
            <p className="text-xs text-[var(--muted)]">{s.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        {registry.map((m) => (
          <ModulePanel key={m.id} mod={m} session={session} />
        ))}
      </div>

      <p className="mt-8 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 text-sm text-[var(--muted)]">
        Every panel is a self-contained module under{" "}
        <code className="text-[var(--brand)]">modules/&lt;name&gt;/</code>, rendered from{" "}
        <code className="text-[var(--brand)]">modules/registry.ts</code> with your session as context — one line to add
        or remove a capability. Each follows a public design-architecture spec before it ships.
      </p>
    </main>
  );
}
