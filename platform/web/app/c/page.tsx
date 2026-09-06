import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import { canCompany } from "../../lib/rbac";
import { hiveOr, money, workerUp, sentence, type CompanySummary } from "../../lib/hive";
import { Card, Label, Meter, PageTitle, Stat, Empty } from "../../components/ui";

export const dynamic = "force-dynamic";

// Every vertical under one roof.
export default async function GroupPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login?next=/c");
  const up = await workerUp();
  // Only the verticals this user may view (lib/rbac.ts company_access).
  const companies = (up ? await hiveOr<CompanySummary[]>("/api/companies", []) : []).filter((c) => canCompany(session, c.slug, "company:view"));
  const totals = companies.reduce(
    (t, c) => ({ agents: t.agents + c.agents, running: t.running + c.running, pending: t.pending + c.pending_approvals, cost: t.cost + c.cost_minor, cap: t.cap + c.monthly_cap * 100, avail: t.avail + c.available_minor }),
    { agents: 0, running: 0, pending: 0, cost: 0, cap: 0, avail: 0 },
  );
  const currency = companies[0]?.currency ?? "INR";

  return (
    <main className="ground-glow mx-auto max-w-[1400px] px-5 py-8">
      <PageTitle eyebrow="The group" title="Every vertical, one board">
        <Link href="/c/statement" className="btn btn-ghost">Group statement</Link>
        <Link href="/c/new" className="btn btn-primary">Launch a company</Link>
      </PageTitle>
      {msg ? <p className="mb-4 rounded-[var(--r-1)] bg-[var(--surface-2)] px-3 py-2 text-sm">{msg}</p> : null}

      {!up ? (
        <Card className="mb-6">
          <p className="font-medium">The company worker is not running.</p>
          <p className="mt-1 text-sm text-[var(--muted)]">Start it from a directory of companies and this page fills in:</p>
          <pre className="mt-3 overflow-x-auto rounded-[var(--r-1)] bg-[var(--surface-0)] p-3 font-mono text-xs text-[var(--ink-2)]">hive company run --group ./companies --port 4700</pre>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Companies" value={companies.length} hint={companies.filter((c) => c.status === "running").length + " running"} />
        <Stat label="Agents" value={totals.agents} hint={`${totals.running} working now`} tone={totals.running ? "live" : undefined} />
        <Stat label="Awaiting you" value={totals.pending} hint="approvals across verticals" tone={totals.pending ? "parked" : undefined} />
        <Stat label="Spend · month" value={money(totals.cost, currency)} hint={`of ${money(totals.cap, currency)} cap`} />
        <Stat label="Available" value={money(totals.avail, currency)} hint="unallocated company wallets" />
      </div>

      <section className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {companies.map((c) => {
          const open = (c.tasks.ready ?? 0) + (c.tasks.running ?? 0) + (c.tasks.parked ?? 0) + (c.tasks.planned ?? 0);
          return (
            <Link key={c.slug} href={`/c/${c.slug}`} className="card card-hover block p-6 rise">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label>{sentence(c.status)}</Label>
                  <h2 className="font-display mt-1 text-2xl">{c.name}</h2>
                </div>
                <span className={`mt-1 h-2.5 w-2.5 rounded-full ${c.running ? "bg-[var(--live)] breathe" : c.status === "paused" ? "bg-[var(--parked)]" : "bg-[var(--idle)]"}`} />
              </div>
              <p className="mt-3 line-clamp-2 text-sm text-[var(--ink-2)]">{c.mission}</p>
              <div className="mt-5 flex flex-wrap gap-1.5">
                {c.roles.map((r) => (
                  <span key={r.id} className="raised px-2 py-0.5 text-[11px] text-[var(--ink-2)]">{r.title}</span>
                ))}
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <Label>Agents</Label>
                  <p className="mt-0.5 tabular-nums">{c.agents} <span className="text-[var(--muted)]">· {c.running} live</span></p>
                </div>
                <div>
                  <Label>Tasks</Label>
                  <p className="mt-0.5 tabular-nums">{open} open <span className="text-[var(--muted)]">· {c.tasks.done ?? 0} done</span></p>
                </div>
                <div>
                  <Label>Inbox</Label>
                  <p className={`mt-0.5 tabular-nums ${c.pending_approvals ? "text-[var(--parked)]" : ""}`}>{c.pending_approvals} waiting</p>
                </div>
              </div>
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-[var(--muted)]">
                  <span>{money(c.cost_minor, c.currency)} spent</span>
                  <span>{money(c.monthly_cap * 100, c.currency)} cap</span>
                </div>
                <Meter value={c.cost_minor} max={c.monthly_cap * 100} />
              </div>
            </Link>
          );
        })}
        {up && companies.length === 0 ? <Empty>{session.role === "owner" || session.role === "admin" ? "No companies loaded. Launch one from a template." : "No companies assigned to you yet. Ask the board for access."}</Empty> : null}
      </section>
    </main>
  );
}
