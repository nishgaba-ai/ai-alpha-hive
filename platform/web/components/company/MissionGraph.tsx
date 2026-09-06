"use client";

import { useMemo } from "react";
import { ReactFlow, Background, Handle, Position, type Node, type Edge, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";

type T = { id: string; title: string; status: string; owner: string; runs: { id: string; status: string; cost_minor: number; turns: number }[]; slug: string };

function TaskNode({ data }: NodeProps<Node<T>>) {
  const s = data.status;
  const ring = s === "running" ? "status-live" : s === "parked" ? "status-parked" : s === "failed" ? "status-failed" : s === "done" ? "status-live" : "status-idle";
  const fill = s === "done" ? 100 : s === "running" ? 55 : s === "parked" ? 70 : 0;
  return (
    <div className={`card ring-status ${ring} relative w-[230px] overflow-hidden p-3.5`}>
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--surface-0)]"><div className="h-full" style={{ width: `${fill}%`, background: s === "failed" ? "var(--failed)" : "var(--live)" }} /></div>
      <Handle type="target" position={Position.Top} className="!bg-[var(--hairline)] !border-0" />
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{data.title}</p>
        {s === "parked" ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--brass)] shadow-[0_0_10px_var(--brass-glow)]" /> : null}
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted)]">{data.owner} · {s}</p>
      {data.runs[0] ? <a href={`/c/${data.slug}/runs/${data.runs.at(-1)!.id}`} className="mt-1 block text-[11px] text-[var(--brass)] hover:underline">run →</a> : null}
      <Handle type="source" position={Position.Bottom} className="!bg-[var(--hairline)] !border-0" />
    </div>
  );
}
const nodeTypes = { task: TaskNode };

export function MissionGraph({ slug, graph }: { slug: string; graph: { nodes: Omit<T, "slug">[]; edges: { id: string; source: string; target: string }[] } }) {
  const { nodes, edges } = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "LR", nodesep: 30, ranksep: 80 });
    for (const n of graph.nodes) g.setNode(n.id, { width: 230, height: 90 });
    for (const e of graph.edges) g.setEdge(e.source, e.target);
    dagre.layout(g);
    const nodes: Node[] = graph.nodes.map((n) => {
      const p = g.node(n.id);
      return { id: n.id, type: "task", position: { x: p.x - 115, y: p.y - 45 }, data: { ...n, slug } };
    });
    const edges: Edge[] = graph.edges.map((e) => ({ ...e, className: graph.nodes.find((n) => n.id === e.target)?.status === "running" ? "active" : "" }));
    return { nodes, edges };
  }, [graph, slug]);
  return (
    <div className="card overflow-hidden" style={{ height: 320 }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.3 }} proOptions={{ hideAttribution: true }} nodesDraggable={false} style={{ background: "var(--surface-0)" }}>
        <Background color="rgba(25,22,51,0.06)" gap={24} size={1} />
      </ReactFlow>
    </div>
  );
}
