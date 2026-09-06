// Event bus: every event is persisted to `events` and fanned out to SSE
// subscribers. If the UI shows it, it came through here.

import { EventEmitter } from "node:events";
import { all, newId, one, run } from "./db.js";
import type { EventRow } from "./types.js";

const emitter = new EventEmitter();
emitter.setMaxListeners(1000);

export type Emitted = EventRow & { payload: Record<string, unknown> };

export function emit(
  companyId: string,
  type: string,
  payload: Record<string, unknown>,
  ctx: { runId?: string | null; agentId?: string | null } = {},
): Emitted {
  const seqRow = one<{ s: number }>("SELECT COALESCE(MAX(seq),0) AS s FROM events WHERE company_id = ?", companyId);
  const row: EventRow = {
    id: newId(),
    seq: (seqRow?.s ?? 0) + 1,
    company_id: companyId,
    run_id: ctx.runId ?? null,
    agent_id: ctx.agentId ?? null,
    ts: Date.now(),
    type,
    payload_json: JSON.stringify({ v: 1, ...payload }),
  };
  run(
    "INSERT INTO events (id, seq, company_id, run_id, agent_id, ts, type, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    row.id, row.seq, row.company_id, row.run_id, row.agent_id, row.ts, row.type, row.payload_json,
  );
  const out: Emitted = { ...row, payload: { v: 1, ...payload } };
  emitter.emit(companyId, out);
  return out;
}

export function subscribe(companyId: string, fn: (e: Emitted) => void): () => void {
  emitter.on(companyId, fn);
  return () => emitter.off(companyId, fn);
}

export function since(companyId: string, seq: number, limit = 500): Emitted[] {
  return all<EventRow>(
    "SELECT * FROM events WHERE company_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
    companyId, seq, limit,
  ).map((r) => ({ ...r, payload: JSON.parse(r.payload_json) }));
}

export function forRun(runId: string): Emitted[] {
  return all<EventRow>("SELECT * FROM events WHERE run_id = ? ORDER BY seq ASC", runId).map((r) => ({
    ...r,
    payload: JSON.parse(r.payload_json),
  }));
}
