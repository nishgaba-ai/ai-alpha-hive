// Mini org chart for a company template: board → executive(s) → members.
// Pure SVG, no hooks, so the template gallery can render it on the server.
// Layout is in a fixed viewBox and scales with the card width.

import type { TemplateTreeNode } from "../../lib/hive";

const W = 400;
const H = 150;
const PAD = 8;
const GAP = 8;
const FONT = "var(--font-ui), Inter, system-ui, sans-serif";
const PX_PER_CHAR = 5.4; // ~10px Geist/Inter, used only to decide where to wrap

type Box = { id: string; title: string; x: number; y: number; w: number; h: number; parent: string };

/** Greedy word wrap into at most `maxLines` lines of ~`maxChars`; the last line gets an ellipsis if it overflows. */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= maxChars) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  const out = lines.slice(0, maxLines).map((l) => (l.length > maxChars ? `${l.slice(0, Math.max(1, maxChars - 1))}…` : l));
  if (lines.length > maxLines && out.length) {
    const last = out[out.length - 1];
    out[out.length - 1] = last.endsWith("…") ? last : `${last.slice(0, Math.max(1, maxChars - 1))}…`;
  }
  return out.length ? out : [""];
}

function edge(x1: number, y1: number, x2: number, y2: number): string {
  const my = (y1 + y2) / 2;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${my.toFixed(1)}, ${x2.toFixed(1)} ${my.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function rowBoxes(nodes: TemplateTreeNode[], y: number, h: number, w: number): Box[] {
  const total = nodes.length * w + (nodes.length - 1) * GAP;
  const x0 = (W - total) / 2;
  return nodes.map((n, i) => ({ id: n.id, title: n.count && n.count > 1 ? `${n.title} ×${n.count}` : n.title, x: x0 + i * (w + GAP), y, w, h, parent: n.reports_to }));
}

export function TemplatePreview({ tree, accent, className = "" }: { tree: TemplateTreeNode[]; accent: string; className?: string }) {
  const ids = new Set(tree.map((n) => n.id));
  const execs = tree.filter((n) => n.reports_to === "board" || !ids.has(n.reports_to));
  const execIds = new Set(execs.map((n) => n.id));
  const members = tree.filter((n) => !execIds.has(n.id));

  // Board
  const board = { x: W / 2 - 28, y: 6, w: 56, h: 18 };

  // Executive row
  const execCount = Math.max(1, execs.length);
  const execW = Math.min(170, (W - 2 * PAD - (execCount - 1) * GAP) / execCount);
  const execBoxes = rowBoxes(execs, 40, 22, execW);

  // Members: one row up to six, otherwise two rows
  const twoRows = members.length > 6;
  const first = twoRows ? Math.ceil(members.length / 2) : members.length;
  const perRow = Math.max(1, first);
  const memberW = Math.min(120, (W - 2 * PAD - (perRow - 1) * GAP) / perRow);
  const memberH = 26;
  const memberBoxes = twoRows
    ? [...rowBoxes(members.slice(0, first), 80, memberH, memberW), ...rowBoxes(members.slice(first), 116, memberH, memberW)]
    : rowBoxes(members, 98, memberH, memberW);
  const memberChars = Math.max(6, Math.floor((memberW - 8) / PX_PER_CHAR));
  const execChars = Math.max(8, Math.floor((execW - 10) / (PX_PER_CHAR * 1.1)));

  const parentOf = (b: Box) => execBoxes.find((e) => e.id === b.parent) ?? execBoxes[0];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Reporting tree: board, ${execs.map((e) => e.title).join(", ") || "no executive"}, ${members.length} team roles`}
      className={className}
      style={{ display: "block", fontFamily: FONT }}
    >
      {/* edges first so nodes sit on top */}
      <g fill="none" stroke={accent} strokeOpacity={0.35} strokeWidth={1.25} strokeLinecap="round">
        {execBoxes.map((e) => (
          <path key={`b-${e.id}`} d={edge(W / 2, board.y + board.h, e.x + e.w / 2, e.y)} />
        ))}
        {memberBoxes.map((m) => {
          const p = parentOf(m);
          if (!p) return null;
          return <path key={`e-${m.id}`} d={edge(p.x + p.w / 2, p.y + p.h, m.x + m.w / 2, m.y)} />;
        })}
      </g>

      {/* board */}
      <g>
        <rect x={board.x} y={board.y} width={board.w} height={board.h} rx={6} fill="var(--surface-2)" stroke="var(--hairline)" />
        <text x={W / 2} y={board.y + board.h / 2 + 3.5} textAnchor="middle" fontSize={10} fontWeight={500} fill="var(--muted)">
          Board
        </text>
      </g>

      {/* executives */}
      {execBoxes.map((e) => {
        const label = wrap(e.title, execChars, 1)[0];
        return (
          <g key={e.id}>
            <title>{`${e.title} — reports to the board`}</title>
            <rect x={e.x} y={e.y} width={e.w} height={e.h} rx={7} fill={accent} fillOpacity={0.16} stroke={accent} strokeOpacity={0.5} />
            <text x={e.x + e.w / 2} y={e.y + e.h / 2 + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)">
              {label}
            </text>
          </g>
        );
      })}

      {/* members */}
      {memberBoxes.map((m) => {
        const lines = wrap(m.title, memberChars, 2);
        const cx = m.x + m.w / 2;
        const firstY = lines.length === 1 ? m.y + m.h / 2 + 3.5 : m.y + m.h / 2 - 2;
        return (
          <g key={m.id}>
            <title>{`${m.title} — reports to ${parentOf(m)?.title ?? m.parent}`}</title>
            <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={6} fill={accent} fillOpacity={0.08} stroke={accent} strokeOpacity={0.28} />
            <text x={cx} y={firstY} textAnchor="middle" fontSize={10} fill="var(--ink-2)">
              {lines.map((l, i) => (
                <tspan key={i} x={cx} dy={i === 0 ? 0 : 11}>
                  {l}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
