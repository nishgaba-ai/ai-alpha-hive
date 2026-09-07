import Link from "next/link";
import { hive, hiveOr, money, ago, displayName, sentence, type Approval, type CompanySummary } from "../../../../lib/hive";
import { Card, Badge, sideEffectTone, Empty, PageTitle } from "../../../../components/ui";
import { decide, markInboundRead } from "../actions";
import { Conversations, type Thread, type Inbound } from "../../../../components/company/Conversations";

export const dynamic = "force-dynamic";

function Preview({ a, currency }: { a: Approval; currency: string }) {
  const i = a.request.input ?? {};
  if (a.tool === "linkedin.post" || a.tool === "content.publish" || i.text) return <blockquote className="mt-3 whitespace-pre-wrap rounded-[var(--r-1)] bg-[var(--surface-0)] p-3 text-sm leading-relaxed">{String(i.text ?? i.body_md ?? `draft ${i.draft_id ?? ""}`)}</blockquote>;
  if (a.tool === "email.send") return <div className="mt-3 rounded-[var(--r-1)] bg-[var(--surface-0)] p-3 text-sm"><p className="text-[var(--muted)]">to {(i.to as string[])?.join(", ")}</p><p className="mt-1 font-medium">{String(i.subject)}</p><p className="mt-1 whitespace-pre-wrap text-[var(--ink-2)]">{String(i.body_md)}</p></div>;
  if (a.side_effect === "spend" || a.request.amount) return <p className="mt-3 text-sm">Vendor <span className="font-medium">{String(i.vendor ?? i.name ?? "")}</span> · {money(a.request.amount ?? Number(i.amount ?? 0), currency)} · wallet after {money(a.wallet_available_minor - (a.request.amount ?? 0), currency)}</p>;
  return <pre className="mt-3 overflow-x-auto rounded-[var(--r-1)] bg-[var(--surface-0)] p-3 font-mono text-[11px] text-[var(--ink-2)]">{JSON.stringify(i, null, 2)}</pre>;
}

export default async function InboxPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ status?: string; tab?: string; channel?: string; thread?: string }> }) {
  const { slug } = await params;
  const { status = "pending", tab = "approvals", channel, thread } = await searchParams;
  const [c, items, threads, messages] = await Promise.all([
    hive<CompanySummary>(`/api/companies/${slug}`),
    hiveOr<Approval[]>(`/api/companies/${slug}/approvals?status=${status}`, []),
    hiveOr<Thread[]>(`/api/companies/${slug}/inbound/threads`, []),
    channel && thread ? hiveOr<Inbound[]>(`/api/companies/${slug}/inbound?channel=${channel}&thread_id=${encodeURIComponent(thread)}&limit=100`, []) : Promise.resolve([] as Inbound[]),
  ]);
  const unread = threads.reduce((s, t) => s + t.unread, 0);
  if (tab === "conversations") {
    return (
      <main>
        <PageTitle eyebrow="The board's job" title="Inbox">
          <Link href={`/c/${slug}/inbox`} className="btn btn-ghost">Approvals</Link>
          <Link href={`/c/${slug}/inbox?tab=conversations`} className="btn btn-glass">Conversations{unread ? ` · ${unread}` : ""}</Link>
        </PageTitle>
        <Conversations slug={slug} threads={threads} open={channel && thread ? { channel, thread_id: thread } : undefined} messages={messages} markRead={markInboundRead} />
      </main>
    );
  }
  return (
    <main>
      <PageTitle eyebrow="The board's job" title="Inbox">
        {["pending", "approved", "denied"].map((s) => (
          <Link key={s} href={`/c/${slug}/inbox?status=${s}`} className={`btn ${s === status ? "btn-glass" : "btn-ghost"}`}>{sentence(s)}</Link>
        ))}
        <Link href={`/c/${slug}/inbox?tab=conversations`} className="btn btn-ghost">Conversations{unread ? ` · ${unread}` : ""}</Link>
      </PageTitle>
      {items.length === 0 ? <Empty>Nothing {status}.</Empty> : null}
      <div className="space-y-4">
        {items.map((a) => (
          <Card key={a.id} className="rise">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{displayName(a.agent_name, c.roles.find((r) => r.id === a.role_key)?.title, a.role_key)}</span>
                  <span className="text-xs text-[var(--muted)]">{sentence(a.role_key)}</span>
                  <Badge tone={sideEffectTone(a.side_effect)}>{a.side_effect}</Badge>
                </div>
                <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">{a.tool} · {ago(a.created_at)} ago · task “{a.request.task}”</p>
              </div>
              <Link href={`/c/${slug}/runs/${a.run_id}`} className="text-xs text-[var(--brass)] hover:underline">open run →</Link>
            </div>
            <p className="mt-3 text-sm text-[var(--ink-2)]"><span className="label mr-2">why</span>{a.request.reason}</p>
            <Preview a={a} currency={c.currency} />
            {status === "pending" ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <form action={decide} className="contents"><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={a.id} /><input type="hidden" name="decision" value="approved" /><button className="btn btn-primary" type="submit">Approve</button></form>
                <form action={decide} className="flex items-center gap-2"><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={a.id} /><input type="hidden" name="decision" value="denied" /><input name="note" className="field w-56 py-1.5 text-sm" placeholder="note to the agent (optional)" /><button className="btn btn-danger" type="submit">Deny</button></form>
              </div>
            ) : (
              <p className="mt-3 text-xs text-[var(--muted)]">{a.status} by {a.decided_by} · {a.decided_at ? ago(a.decided_at) + " ago" : ""}{a.reason ? ` · “${a.reason}”` : ""}</p>
            )}
          </Card>
        ))}
      </div>
      <div className="mt-6 text-xs text-[var(--muted)]"><span className="label mr-2">policy</span>Approvals come from gates in company.yaml: spend above the threshold, first contact, anything public, production deploys, hires. Change the policy, not the habit.</div>
    </main>
  );
}
