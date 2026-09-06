import Link from "next/link";
import { hive, money, displayName, type HiveEvent } from "../../../../../lib/hive";
import { Card, Label, Badge, sideEffectTone, PageTitle, StatusDot } from "../../../../../components/ui";

export const dynamic = "force-dynamic";

type RunDetail = {
  run: { id: string; status: string; started_at: number; ended_at: number | null; input_tokens: number; output_tokens: number; cache_read_tokens: number; cost_minor: number; turns: number; outcome_json: string | null };
  task: { id: string; title: string; intent: string; acceptance: string; mission_id: string | null };
  agent: { id: string; name: string; role_key: string };
  events: HiveEvent[];
  messages: ({ role: "user"; content: string } | { role: "assistant"; content: string; toolCalls?: { name: string; input: Record<string, unknown> }[] } | { role: "tool"; name: string; content: string; isError?: boolean })[];
};

export default async function RunPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const d = await hive<RunDetail>(`/api/runs/${id}`);
  const outcome = d.run.outcome_json ? (JSON.parse(d.run.outcome_json) as Record<string, unknown>) : {};
  const cur = "INR";
  return (
    <main>
      <PageTitle eyebrow={`Run · ${displayName(d.agent.name, null, d.agent.role_key)}`} title={d.task.title}>
        {d.task.mission_id ? <Link href={`/c/${slug}/missions/${d.task.mission_id}`} className="btn btn-ghost">mission →</Link> : null}
      </PageTitle>
      <div className="grid gap-4 sm:grid-cols-4">
        <Card><Label>Status</Label><p className="mt-1 flex items-center gap-2 text-lg"><StatusDot status={d.run.status} pulse />{d.run.status}</p></Card>
        <Card><Label>Turns</Label><p className="mt-1 text-lg tabular-nums">{d.run.turns}</p></Card>
        <Card><Label>Tokens</Label><p className="mt-1 text-lg tabular-nums">{(d.run.input_tokens + d.run.output_tokens).toLocaleString()}</p><p className="text-xs text-[var(--muted)]">{d.run.cache_read_tokens.toLocaleString()} cached</p></Card>
        <Card><Label>Cost</Label><p className="mt-1 text-lg tabular-nums">{money(d.run.cost_minor, cur)}</p></Card>
      </div>
      {outcome.summary || outcome.error ? <Card className="mt-4"><Label>Outcome</Label><p className={`mt-1 text-sm ${outcome.error ? "text-[var(--failed)]" : ""}`}>{String(outcome.summary ?? outcome.error)}</p></Card> : null}

      <Label className="mb-2 mt-6">Transcript · secrets redacted by the worker</Label>
      <div className="space-y-2">
        {d.messages.map((m, i) => {
          if (m.role === "user") return <div key={i} className="raised whitespace-pre-wrap p-4 text-sm text-[var(--ink-2)]"><Label className="mb-1">Brief</Label>{m.content}</div>;
          if (m.role === "assistant")
            return (
              <div key={i} className="card p-4 text-sm">
                <Label className="mb-1">{displayName(d.agent.name, null, d.agent.role_key)}</Label>
                {m.content ? <p className="whitespace-pre-wrap">{m.content}</p> : null}
                {m.toolCalls?.map((c, j) => (
                  <details key={j} className="mt-2 rounded-[var(--r-1)] bg-[var(--surface-0)] p-2">
                    <summary className="cursor-pointer font-mono text-xs text-[var(--brass)]">→ {c.name.replace(/__/g, ".").replace(/_/g, "-")}</summary>
                    <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-[var(--ink-2)]">{JSON.stringify(c.input, null, 2)}</pre>
                  </details>
                ))}
              </div>
            );
          return (
            <details key={i} className={`rounded-[var(--r-1)] p-3 text-sm ${m.isError ? "bg-[rgba(239,71,111,0.08)]" : "bg-[var(--surface-0)]"}`}>
              <summary className="cursor-pointer font-mono text-xs text-[var(--muted)]">← {m.name.replace(/__/g, ".")} {m.isError ? "· error" : ""}</summary>
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-[var(--ink-2)]">{m.content}</pre>
            </details>
          );
        })}
      </div>

      <Label className="mb-2 mt-6">Events</Label>
      <ol className="space-y-1 text-sm">
        {d.events.map((e) => (
          <li key={e.id} className="flex gap-3 px-2 py-1">
            <span className="w-16 shrink-0 font-mono text-[11px] text-[var(--muted)]">{new Date(e.ts).toLocaleTimeString("en-IN")}</span>
            <span className="text-[var(--ink-2)]">
              {e.type}
              {e.payload.tool ? <> · <Badge tone={sideEffectTone(String(e.payload.side_effect ?? "read"))}>{String(e.payload.tool)}</Badge> {String(e.payload.decision ?? "")}</> : null}
              {e.payload.reason ? <span className="text-[var(--muted)]"> — {String(e.payload.reason)}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </main>
  );
}
