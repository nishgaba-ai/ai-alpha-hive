import Link from "next/link";
import { hive, money, type CompanySummary, type Task } from "../../../../../lib/hive";
import { Label, PageTitle, StatusDot } from "../../../../../components/ui";
import { MissionGraph } from "../../../../../components/company/MissionGraph";

export const dynamic = "force-dynamic";

type MissionGraphData = { nodes: { id: string; data: Task & { runs: { id: string; status: string; cost_minor: number; turns: number }[] } }[]; edges: { id: string; source: string; target: string }[] };

export default async function MissionPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const [c, g] = await Promise.all([hive<CompanySummary>(`/api/companies/${slug}`), hive<MissionGraphData>(`/api/companies/${slug}/missions/${id}/graph`)]);
  const root = g.nodes.find((n) => n.id === id);
  const tasks = g.nodes.filter((n) => n.id !== id);
  return (
    <main>
      <PageTitle eyebrow="Mission" title={root?.data.intent ?? "Mission"} />
      <Label className="mb-2">Task graph · fills as runs complete · brass beacon = waiting for you</Label>
      <MissionGraph slug={slug} graph={{ nodes: tasks.map((n) => ({ id: n.id, title: n.data.title, status: n.data.status, owner: n.data.owner_role, runs: n.data.runs })), edges: g.edges.filter((e) => e.source !== id && e.target !== id) }} />
      <div className="mt-6 space-y-2">
        {tasks.map((n) => {
          const t = n.data;
          const cost = t.runs.reduce((s, r) => s + r.cost_minor, 0);
          return (
            <div key={t.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <StatusDot status={t.status} pulse />
                <div>
                  <p className="font-medium">{t.title}</p>
                  <p className="text-xs text-[var(--muted)]">{t.owner_role} · {t.acceptance}</p>
                  {t.notes ? <p className="mt-1 text-xs text-[var(--ink-2)]">{t.notes}</p> : null}
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-[var(--muted)]">
                <span>{money(cost, c.currency)} / cap {money(t.budget_cap, c.currency)}</span>
                {t.runs.map((r) => (
                  <Link key={r.id} href={`/c/${slug}/runs/${r.id}`} className="text-[var(--brass)] hover:underline">run · {r.status}</Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
