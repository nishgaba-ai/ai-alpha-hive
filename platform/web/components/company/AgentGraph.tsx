"use client";

// The organisation as a flow canvas (n8n-style): board on the left, teams
// as frames, agents as node cards with ports, hand-offs as animated edges.
// Layout is deterministic (dagre, left→right); the SSE stream refreshes
// data and pulses edges when work moves.

import { useEffect, useMemo, useState } from "react";
import { ReactFlow, Background, BackgroundVariant, Controls, MiniMap, Handle, Position, type Node, type Edge, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { displayName, sentence, type Graph } from "../../lib/hive";

type AgentData = { name: string; role: string; title: string; status: string; model: string; effort: string; task: string | null; run_id: string | null; since: number | null; spend_minor: number; budget_minor: number; available_minor: number; team: string | null; slug: string; currency: string };
type TeamData = { label: string; width: number; height: number; count: number };

const NODE_W = 272;
const NODE_H = 128;

const GLYPH: [RegExp, string][] = [
  [/ceo|head|principal|gm|general|cmo|chief|exec/, "◈"],
  [/eng|dev|ops|build/, "⌘"],
  [/market|growth|brand|paid|media/, "◎"],
  [/financ|analyst|quant|risk|account/, "¤"],
  [/writer|content|research/, "✎"],
  [/sales|bd|business/, "☎"],
  [/compliance|legal/, "⚖"],
];
function glyph(role: string, title: string) {
  const s = `${role} ${title}`.toLowerCase();
  return GLYPH.find(([re]) => re.test(s))?.[1] ?? "◇";
}
function fmt(minor: number, currency: string) {
  const n = minor / 100;
  return (currency === "INR" ? "₹" : "$") + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function elapsed(since: number | null) {
  if (!since) return "";
  const m = Math.floor((Date.now() - since) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
}

const STATUS: Record<string, { color: string; label: string }> = {
  running: { color: "var(--live)", label: "working" },
  parked: { color: "var(--parked)", label: "needs you" },
  failed: { color: "var(--failed)", label: "failed" },
  suspended: { color: "var(--failed)", label: "suspended" },
  idle: { color: "var(--idle)", label: "resting" },
};

const port = "!h-3 !w-3 !rounded-full !border-2 !border-[var(--surface-1)] !bg-[var(--brass)]";

function AgentNode({ data }: NodeProps<Node<AgentData>>) {
  const s = STATUS[data.status] ?? STATUS.idle;
  const pct = data.budget_minor ? Math.min(100, Math.round((data.spend_minor / data.budget_minor) * 100)) : 0;
  const live = data.status === "running";
  return (
    <div
      className="relative rounded-[14px] bg-[var(--surface-1)] shadow-[var(--shadow-1)] transition-shadow hover:shadow-[var(--shadow-2)]"
      style={{ width: NODE_W, height: NODE_H, boxShadow: `0 0 0 1.5px ${s.color}${live ? ", 0 0 24px rgba(22,185,129,0.18)" : data.status === "parked" ? ", 0 0 24px var(--brass-glow)" : ""}, var(--shadow-1)` }}
    >
      <Handle type="target" position={Position.Left} className={port} />
      <div className="flex h-full">
        <div className="flex w-[64px] shrink-0 flex-col items-center justify-center rounded-l-[14px] border-r border-[var(--hairline)] bg-[var(--surface-0)]">
          <span className="text-2xl" style={{ color: s.color }}>{glyph(data.role, data.title)}</span>
          <span className={`mt-2 h-1.5 w-1.5 rounded-full ${live ? "breathe" : ""}`} style={{ background: s.color }} />
        </div>
        <div className="min-w-0 flex-1 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[13px] font-semibold leading-tight">{displayName(data.name, data.title, data.role)}</p>
            <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ color: s.color, background: "var(--surface-0)" }}>{sentence(s.label)}</span>
          </div>
          <p className="truncate text-[11px] text-[var(--muted)]">{data.title}</p>
          <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-[var(--ink-2)]" style={{ minHeight: 28 }}>
            {data.task ? data.task : <span className="text-[var(--muted)]">no task assigned</span>}
            {data.task && data.since ? <span className="text-[var(--muted)]"> · {elapsed(data.since)}</span> : null}
          </p>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--surface-0)]">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--brass-dim), var(--brass-2))" }} />
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--muted)]">
            <span>{fmt(data.spend_minor, data.currency)} / {fmt(data.budget_minor, data.currency)}</span>
            <span className="font-mono">{(data.model || "").split("/").slice(-1)[0]}</span>
          </div>
        </div>
      </div>
      {data.run_id ? <a href={`/c/${data.slug}/runs/${data.run_id}`} className="absolute -bottom-5 right-1 text-[10px] text-[var(--brass)] hover:underline">open run →</a> : null}
      <Handle type="source" position={Position.Right} className={port} />
    </div>
  );
}

function BoardNode({ data }: NodeProps<Node<{ label: string; members: string[]; pending: number }>>) {
  return (
    <div className="glass relative flex items-center gap-3 px-4 py-3" style={{ width: 220, height: 84, borderRadius: "42px 14px 14px 42px", boxShadow: "0 0 0 1.5px var(--brass-dim), 0 0 32px var(--brass-glow), var(--shadow-2)" }}>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--brass)] text-lg text-white shadow-[0_0_16px_var(--brass-glow)]">☖</span>
      <div className="min-w-0">
        <p className="label">Board</p>
        <p className="font-display truncate text-lg leading-tight">{data.members.length > 1 ? `${data.members.length} humans` : data.members[0]?.split("@")[0] ?? "you"}</p>
        {data.pending ? <p className="text-[10px] text-[var(--parked)]">{data.pending} waiting</p> : <p className="text-[10px] text-[var(--muted)]">nothing waiting</p>}
      </div>
      <Handle type="source" position={Position.Right} className={port} />
    </div>
  );
}

function TeamNode({ data }: NodeProps<Node<TeamData>>) {
  return (
    <div className="rounded-[20px] border border-dashed border-[rgba(108,92,231,0.28)] bg-[rgba(108,92,231,0.04)]" style={{ width: data.width, height: data.height }}>
      <div className="absolute -top-3 left-4 rounded-full bg-[var(--surface-0)] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--brass)] ring-1 ring-[rgba(108,92,231,0.28)]">
        {data.label} · {data.count}
      </div>
    </div>
  );
}

const nodeTypes = { agent: AgentNode, board: BoardNode, team: TeamNode };

function layout(graph: Graph, slug: string, currency: string, pending: number): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 36, ranksep: 120, marginx: 40, marginy: 40 });
  for (const n of graph.nodes) g.setNode(n.id, { width: n.type === "board" ? 220 : NODE_W, height: n.type === "board" ? 84 : NODE_H + 16 });
  for (const e of graph.edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const agentNodes: Node[] = graph.nodes.map((n) => {
    const p = g.node(n.id);
    return {
      id: n.id,
      type: n.type,
      position: { x: p.x - p.width / 2, y: p.y - p.height / 2 },
      data: n.type === "board" ? { ...n.data, pending } : { ...n.data, slug, currency },
      draggable: false,
      zIndex: 2,
    };
  });

  // Team frames around their members' bounding boxes.
  const teamNodes: Node[] = graph.teams
    .map((t) => {
      const members = graph.nodes.filter((n) => n.type === "agent" && t.members.includes(String(n.data.role)));
      if (!members.length) return null;
      const boxes = members.map((m) => g.node(m.id));
      const x0 = Math.min(...boxes.map((b) => b.x - b.width / 2)) - 22;
      const y0 = Math.min(...boxes.map((b) => b.y - b.height / 2)) - 26;
      const x1 = Math.max(...boxes.map((b) => b.x + b.width / 2)) + 22;
      const y1 = Math.max(...boxes.map((b) => b.y + b.height / 2)) + 14;
      return { id: `team:${t.id}`, type: "team", position: { x: x0, y: y0 }, data: { label: t.id, width: x1 - x0, height: y1 - y0, count: members.length }, draggable: false, selectable: false, zIndex: 0 } as Node;
    })
    .filter((n): n is Node => n !== null);

  const edges: Edge[] = graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: "default", style: { stroke: "rgba(25,22,51,0.18)", strokeWidth: 1.5, strokeDasharray: e.kind === "team" ? "6 4" : undefined } }));
  return { nodes: [...teamNodes, ...agentNodes], edges };
}

export function AgentGraph({ slug, currency, initial, height = 560, pending = 0 }: { slug: string; currency: string; initial: Graph; height?: number; pending?: number }) {
  const [graph, setGraph] = useState(initial);
  const [pulse, setPulse] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const es = new EventSource(`/api/hive/companies/${slug}/events/stream?since=999999999`);
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const r = await fetch(`/api/hive/companies/${slug}/graph`, { cache: "no-store" });
        if (r.ok) setGraph(await r.json());
      }, 250);
    };
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as { type: string; agent_id: string | null };
        if (/^(run\.|task\.|approval\.|agent\.)/.test(ev.type)) refresh();
        if (ev.agent_id && /^(run\.started|run\.tool_call|task\.handoff|message\.sent|approval\.requested)$/.test(ev.type)) {
          setPulse(ev.agent_id);
          setTimeout(() => setPulse(null), 1400);
        }
      } catch {
        /* ignore */
      }
    };
    return () => {
      es.close();
      clearTimeout(timer);
    };
  }, [slug]);

  const { nodes, edges } = useMemo(() => layout(graph, slug, currency, pending), [graph, slug, currency, pending]);
  const running = new Set(graph.nodes.filter((n) => n.data.status === "running").map((n) => n.id));
  const liveEdges = edges.map((e) =>
    pulse === e.target || running.has(e.target)
      ? { ...e, animated: true, style: { stroke: pulse === e.target ? "var(--brass)" : "var(--live)", strokeWidth: 2 } }
      : e,
  );
  const counts = { running: running.size, parked: graph.nodes.filter((n) => n.data.status === "parked").length, idle: graph.nodes.filter((n) => n.type === "agent" && n.data.status === "idle").length };

  return (
    <div className="card relative overflow-hidden" style={{ height }}>
      <ReactFlow nodes={nodes} edges={liveEdges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.18 }} proOptions={{ hideAttribution: true }} nodesDraggable={false} minZoom={0.25} maxZoom={1.6} style={{ background: "var(--surface-0)" }}>
        <Background variant={BackgroundVariant.Dots} color="rgba(25,22,51,0.10)" gap={22} size={1.2} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap position="bottom-right" pannable zoomable nodeStrokeWidth={0} nodeColor={(n) => (n.type === "team" ? "rgba(108,92,231,0.10)" : n.type === "board" ? "var(--brass)" : (STATUS[String((n.data as AgentData).status)] ?? STATUS.idle).color)} maskColor="rgba(25,22,51,0.35)" style={{ width: 160, height: 100 }} />
      </ReactFlow>
      <div className="glass pointer-events-none absolute left-4 top-4 flex items-center gap-4 px-3 py-2 text-[11px]">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--live)]" />{counts.running} working</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--parked)]" />{counts.parked} need you</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--idle)]" />{counts.idle} resting</span>
        <span className="text-[var(--muted)]">flow: board → executive → teams</span>
      </div>
    </div>
  );
}
