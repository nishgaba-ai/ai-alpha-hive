import Link from "next/link";
import { hive, money, ago, type CompanySummary, type Task } from "../../../../lib/hive";
import { Card, Label, StatusDot, Empty, PageTitle } from "../../../../components/ui";
import { startMission } from "../actions";

export const dynamic = "force-dynamic";

export default async function MissionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [c, { tasks }] = await Promise.all([hive<CompanySummary>(`/api/companies/${slug}`), hive<{ tasks: Task[] }>(`/api/companies/${slug}/tasks`)]);
  const missions = tasks.filter((t) => t.key === "mission");
  return (
    <main>
      <PageTitle eyebrow="What the company is for" title="Missions" />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {missions.length === 0 ? <Empty>No missions yet. The executive plans the first one you give.</Empty> : null}
          {missions.map((m) => {
            const children = tasks.filter((t) => t.mission_id === m.id && t.id !== m.id);
            const done = children.filter((t) => t.status === "done").length;
            return (
              <Link key={m.id} href={`/c/${slug}/missions/${m.id}`} className="card card-hover block p-5 rise">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2"><StatusDot status={m.status} pulse /><Label>{m.status}</Label></div>
                    <h2 className="font-display mt-1 text-xl">{m.intent}</h2>
                  </div>
                  <span className="text-xs text-[var(--muted)]">{ago(m.created_at)} ago</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {children.map((t) => (
                    <span key={t.id} className="raised flex items-center gap-1.5 px-2 py-0.5 text-[11px] text-[var(--ink-2)]"><StatusDot status={t.status} />{t.title}</span>
                  ))}
                </div>
                <p className="mt-3 text-xs text-[var(--muted)]">{done}/{children.length} tasks done · cap {money(m.budget_cap, c.currency)}</p>
              </Link>
            );
          })}
        </div>
        <Card className="h-fit">
          <Label className="mb-2">New mission</Label>
          <form action={startMission} className="space-y-2">
            <input type="hidden" name="slug" value={slug} />
            <textarea name="text" className="field min-h-28 text-sm" placeholder="One outcome, with a number and a date." required />
            <button className="btn btn-primary w-full justify-center" type="submit">Start</button>
          </form>
          <p className="mt-3 text-xs text-[var(--muted)]">The executive role writes a task DAG; leads decompose their team&apos;s part; gated actions land in your inbox.</p>
        </Card>
      </div>
    </main>
  );
}
