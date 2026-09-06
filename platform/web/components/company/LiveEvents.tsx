"use client";

import { useEffect, useState } from "react";
import type { HiveEvent } from "../../lib/hive";

const LABEL: Record<string, string> = {
  "run.started": "started", "run.turn": "thinking", "run.tool_call": "called", "run.tool_result": "got", "run.parked": "parked", "run.resumed": "resumed", "run.ended": "finished",
  "approval.requested": "needs the board", "approval.decided": "board decided", "task.planned": "planned", "task.ready": "ready", "task.done": "done", "task.failed": "failed", "task.handoff": "handed off",
  "message.sent": "messaged", "artifact.created": "produced", "spend.authorized": "spent", "ledger.posted": "ledger", "company.started": "company online", "agent.hired": "hired",
  "erp.payroll.drafted": "payroll drafted", "erp.payroll.paid": "payroll paid", "erp.expense.submitted": "expense filed", "erp.cash.posted": "cash moved",
};

function tone(type: string) {
  if (type.startsWith("approval.requested") || type === "run.parked") return "text-[var(--parked)]";
  if (type.endsWith(".failed")) return "text-[var(--failed)]";
  if (type === "task.done" || type === "run.ended" || type === "approval.decided") return "text-[var(--live)]";
  return "text-[var(--ink-2)]";
}

function describe(e: HiveEvent, names: Record<string, string>): string {
  const p = e.payload as Record<string, unknown>;
  const who = e.agent_id ? names[e.agent_id] ?? "agent" : "";
  switch (e.type) {
    case "run.started": return `${who} started “${p.title}”`;
    case "run.turn": return `${who}: ${String(p.text ?? "").slice(0, 140) || (Array.isArray(p.tool_calls) ? `→ ${(p.tool_calls as string[]).join(", ")}` : "…")}`;
    case "run.tool_call": return `${who} → ${p.tool} · ${p.decision}${p.reason ? ` (${p.reason})` : ""}`;
    case "run.tool_result": return `${who} ← ${p.tool}`;
    case "approval.requested": return `${who} needs the board: ${p.tool} — ${p.reason}`;
    case "approval.decided": return `board ${p.decision} ${p.tool}`;
    case "run.parked": return `${who} parked`;
    case "run.ended": return `${who} ${p.status}${p.summary ? `: ${String(p.summary).slice(0, 120)}` : ""}`;
    case "task.planned": return `planned “${p.title ?? p.key ?? ""}”`;
    case "task.done": return `task done`;
    case "task.handoff": return `${who} handed off to ${p.to_role}`;
    case "message.sent": return `${who} → ${p.to}: ${String(p.preview ?? "").slice(0, 100)}`;
    case "artifact.created": return `${who} produced ${p.kind}: ${p.ref}`;
    default: return `${e.type}${p.title ? ` ${p.title}` : ""}`;
  }
}

export function LiveEvents({ slug, initial, names, max = 40 }: { slug: string; initial: HiveEvent[]; names: Record<string, string>; max?: number }) {
  const [events, setEvents] = useState<HiveEvent[]>(initial);
  useEffect(() => {
    const last = initial.at(-1)?.seq ?? 0;
    const es = new EventSource(`/api/hive/companies/${slug}/events/stream?since=${last}`);
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as HiveEvent;
        setEvents((prev) => (prev.some((p) => p.seq === ev.seq) ? prev : [...prev, ev].slice(-200)));
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [slug, initial]);

  const shown = [...events].reverse().filter((e) => e.type !== "run.tool_result").slice(0, max);
  return (
    <ol className="space-y-1.5 text-sm">
      {shown.map((e) => (
        <li key={e.id} className="rise flex gap-3 rounded-[var(--r-1)] px-2 py-1.5 hover:bg-[var(--surface-0)]">
          <span className="w-12 shrink-0 font-mono text-[11px] text-[var(--muted)]">{new Date(e.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
          <span className={`min-w-0 flex-1 truncate ${tone(e.type)}`}>
            <span className="mr-2 text-[11px] uppercase tracking-wider text-[var(--muted)]">{LABEL[e.type] ?? e.type}</span>
            {e.run_id ? <a href={`/c/${slug}/runs/${e.run_id}`} className="hover:underline">{describe(e, names)}</a> : describe(e, names)}
          </span>
        </li>
      ))}
      {shown.length === 0 ? <li className="px-2 text-[var(--muted)]">Quiet. Give the company a mission.</li> : null}
    </ol>
  );
}
