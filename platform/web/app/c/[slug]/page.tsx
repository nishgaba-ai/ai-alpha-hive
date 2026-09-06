import Link from "next/link";
import { hive, hiveOr, money, ago, displayName, sentence, type Approval, type CompanySummary, type Graph, type HiveEvent } from "../../../lib/hive";
import { Card, Label, Stat, Badge, sideEffectTone, Empty, PageTitle } from "../../../components/ui";
import { AgentGraph } from "../../../components/company/AgentGraph";
import { LiveEvents } from "../../../components/company/LiveEvents";
import { decide, startMission, setCompanyStatus } from "./actions";

export const dynamic = "force-dynamic";

export default async function CompanyOverview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [c, graph, approvals, events] = await Promise.all([
    hive<CompanySummary>(`/api/companies/${slug}`),
    hive<Graph>(`/api/companies/${slug}/graph`),
    hiveOr<Approval[]>(`/api/companies/${slug}/approvals?status=pending`, []),
    hiveOr<HiveEvent[]>(`/api/companies/${slug}/events?since=0&limit=60`, []),
  ]);
  const names = Object.fromEntries(graph.nodes.filter((n) => n.type === "agent").map((n) => [n.id, displayName(String(n.data.name), String(n.data.title), String(n.data.role))]));
  const open = (c.tasks.ready ?? 0) + (c.tasks.running ?? 0) + (c.tasks.parked ?? 0) + (c.tasks.planned ?? 0);

  return (
    <main>
      <PageTitle eyebrow={sentence(c.status)} title={c.name}>
        <form action={setCompanyStatus}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="action" value={c.status === "paused" ? "resume" : "pause"} />
          <button className="btn btn-glass" type="submit">{c.status === "paused" ? "Resume" : "Pause"}</button>
        </form>
        <Link href={`/c/${slug}/voice`} className="btn btn-primary">Talk to the company</Link>
      </PageTitle>
      <p className="-mt-3 mb-6 max-w-3xl text-[var(--ink-2)]">{c.mission}</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Agents" value={c.agents} hint={`${c.running} working now`} tone={c.running ? "live" : undefined} />
        <Stat label="Tasks" value={open} hint={`${c.tasks.done ?? 0} done · ${c.tasks.failed ?? 0} failed`} />
        <Stat label="Awaiting the board" value={c.pending_approvals} hint="approvals" tone={c.pending_approvals ? "parked" : undefined} />
        <Stat label="Spend · month" value={money(c.cost_minor, c.currency)} hint={`cap ${money(c.monthly_cap * 100, c.currency)} · available ${money(c.available_minor, c.currency)}`} />
      </div>

      <section className="mt-6 grid gap-5 xl:grid-cols-[1fr_360px]">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>Organisation · live</Label>
            <Link href={`/c/${slug}/graph`} className="text-xs text-[var(--brass)] hover:underline">full graph & 3D floor →</Link>
          </div>
          <AgentGraph slug={slug} currency={c.currency} initial={graph} height={580} pending={c.pending_approvals} />
        </div>
        <div className="space-y-4">
          <Card>
            <Label className="mb-2">Give a mission</Label>
            <form action={startMission} className="space-y-2">
              <input type="hidden" name="slug" value={slug} />
              <textarea name="text" className="field min-h-20 text-sm" placeholder="What should the company achieve next? The executive plans it." required />
              <button className="btn btn-primary w-full justify-center" type="submit">Start</button>
            </form>
          </Card>
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <Label>Inbox</Label>
              <Link href={`/c/${slug}/inbox`} className="text-xs text-[var(--brass)] hover:underline">all →</Link>
            </div>
            {approvals.length === 0 ? <Empty>Nothing waiting for you.</Empty> : null}
            <ul className="space-y-3">
              {approvals.slice(0, 3).map((a) => (
                <li key={a.id} className="raised p-3 text-sm rise">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{displayName(a.agent_name, c.roles.find((r) => r.id === a.role_key)?.title, a.role_key)}</span>
                    <Badge tone={sideEffectTone(a.side_effect)}>{a.side_effect}</Badge>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">{a.tool} · {ago(a.created_at)} ago</p>
                  <p className="mt-1.5 text-[var(--ink-2)]">{a.request.reason}</p>
                  {a.request.input?.text ? <p className="mt-1.5 line-clamp-3 text-xs text-[var(--ink-2)]">“{String(a.request.input.text)}”</p> : null}
                  {a.request.amount ? <p className="mt-1 text-xs">{money(a.request.amount, c.currency)} · wallet after {money(a.wallet_available_minor - a.request.amount, c.currency)}</p> : null}
                  <div className="mt-2 flex gap-2">
                    <form action={decide}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={a.id} /><input type="hidden" name="decision" value="approved" /><button className="btn btn-primary py-1.5" type="submit">Approve</button></form>
                    <form action={decide}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={a.id} /><input type="hidden" name="decision" value="denied" /><button className="btn btn-danger py-1.5" type="submit">Deny</button></form>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </section>

      <section className="mt-6">
        <Card>
          <Label className="mb-3">What is happening</Label>
          <LiveEvents slug={slug} initial={events} names={names} />
        </Card>
      </section>
    </main>
  );
}
