// Ready tasks → runs, bounded by concurrency and wallets. Missions are
// tasks owned by the executive role; its plan fans out from there.

import { all, newId, one, run as sql } from "./db.js";
import { emit } from "./bus.js";
import * as ledger from "./ledger.js";
import { createRun, runLoop, type LoopDeps } from "./harness/loop.js";
import { runClaudeCode } from "./harness/claude-code.js";
import type { AgentRow, RunRow, TaskRow } from "./types.js";

const inflight = new Map<string, Set<string>>(); // companyId → run ids

export function startMission(deps: LoopDeps, text: string, by: string): TaskRow {
  const root = deps.config.roles.find((r) => r.reports_to === "board")!;
  const id = newId();
  const now = Date.now();
  sql(
    `INSERT INTO tasks (id, company_id, key, title, intent, acceptance, owner_role, status, budget_cap, priority, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,'ready',?,1,?,?,?)`,
    id, deps.company.id, "mission", text.slice(0, 120), text, "A task plan exists and every task reports done or a reason it could not be", root.id,
    deps.config.treasury.monthly_cap * 100, by, now, now,
  );
  sql("UPDATE tasks SET mission_id = ? WHERE id = ?", id, id);
  emit(deps.company.id, "task.planned", { task_id: id, title: text.slice(0, 120), mission: true, by });
  return one<TaskRow>("SELECT * FROM tasks WHERE id = ?", id)!;
}

function pickAgent(companyId: string, role: string): AgentRow | undefined {
  return one<AgentRow>(
    `SELECT a.* FROM agents a LEFT JOIN runs r ON r.agent_id = a.id AND r.status = 'running'
     WHERE a.company_id = ? AND a.role_key = ? AND a.status = 'idle' AND r.id IS NULL
     ORDER BY (SELECT MAX(started_at) FROM runs WHERE agent_id = a.id) ASC NULLS FIRST LIMIT 1`,
    companyId, role,
  );
}

const EVERY: Record<string, number> = { h: 3600_000, d: 86400_000, w: 7 * 86400_000 };

/** Fire recurring missions whose interval has elapsed (docs/company/runtime.md → automations). */
export function fireAutomations(deps: LoopDeps, now = Date.now()): number {
  let fired = 0;
  for (const a of deps.config.automations ?? []) {
    if (a.enabled === false) continue;
    const m = /^(\d+)([hdw])$/.exec(a.every);
    if (!m) continue;
    const interval = Number(m[1]) * EVERY[m[2]];
    const last = one<{ ts: number }>("SELECT ts FROM events WHERE company_id = ? AND type = 'automation.fired' AND payload_json LIKE ? ORDER BY seq DESC LIMIT 1", deps.company.id, `%"id":"${a.id}"%`);
    if (last && now - last.ts < interval) continue;
    if (a.at) {
      const tz = deps.config.policies?.quiet_hours?.tz ?? "Asia/Kolkata";
      const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(now)).replace(/[^\d:]/g, "");
      if (hhmm < a.at || (last && now - last.ts < interval + 3600_000 && hhmm > a.at)) {
        if (hhmm < a.at) continue;
      }
    }
    startMission(deps, a.mission, `automation:${a.id}`);
    emit(deps.company.id, "automation.fired", { id: a.id, every: a.every, mission: a.mission });
    fired++;
  }
  return fired;
}

/** One scheduler pass for one company. Returns runs started. */
export async function tick(deps: LoopDeps): Promise<number> {
  const cid = deps.company.id;
  const company = one<{ status: string }>("SELECT status FROM companies WHERE id = ?", cid);
  if (company?.status === "paused") return 0;
  fireAutomations(deps);
  const running = inflight.get(cid) ?? new Set<string>();
  inflight.set(cid, running);
  const limit = deps.config.company.concurrency ?? 4;
  const ready = all<TaskRow>("SELECT * FROM tasks WHERE company_id = ? AND status = 'ready' ORDER BY priority, created_at", cid);
  let started = 0;
  for (const task of ready) {
    if (running.size >= limit) break;
    const agent = pickAgent(cid, task.owner_role);
    if (!agent) continue;
    const avail = ledger.available(cid, ledger.walletAccount(agent.id));
    if (avail <= 0) {
      emit(cid, "task.parked", { task_id: task.id, reason: "budget", agent_id: agent.id });
      sql("UPDATE tasks SET status = 'parked', notes = 'wallet exhausted', updated_at = ? WHERE id = ?", Date.now(), task.id);
      continue;
    }
    const runRow = createRun(cid, task, agent);
    running.add(runRow.id);
    started++;
    dispatch(deps, runRow, agent).finally(() => running.delete(runRow.id));
  }
  return started;
}

async function dispatch(deps: LoopDeps, runRow: RunRow, agent: AgentRow): Promise<void> {
  const role = one<{ harness: string; model: string }>("SELECT harness, model FROM roles WHERE id = ?", agent.role_id)!;
  try {
    if (role.harness === "agent-sdk" || role.model === "claude-code") await runClaudeCode(deps, runRow);
    else await runLoop(deps, runRow);
  } catch (e) {
    sql("UPDATE runs SET status = 'failed', ended_at = ?, outcome_json = ? WHERE id = ?", Date.now(), JSON.stringify({ error: (e as Error).message }), runRow.id);
    sql("UPDATE agents SET status = 'idle' WHERE id = ?", agent.id);
    sql("UPDATE tasks SET status = 'failed', updated_at = ? WHERE id = ?", Date.now(), runRow.task_id);
    emit(deps.company.id, "run.ended", { status: "failed", error: (e as Error).message }, { runId: runRow.id, agentId: agent.id });
  }
}

/** On startup: runs left 'running' by a dead worker are interrupted and their tasks re-queued once. */
export function recover(deps: LoopDeps): void {
  const stale = all<RunRow>("SELECT * FROM runs WHERE company_id = ? AND status = 'running'", deps.company.id);
  for (const r of stale) {
    sql("UPDATE runs SET status = 'interrupted', ended_at = ? WHERE id = ?", Date.now(), r.id);
    sql("UPDATE tasks SET status = 'ready', updated_at = ? WHERE id = ? AND status = 'running'", Date.now(), r.task_id);
    sql("UPDATE agents SET status = 'idle' WHERE id = ?", r.agent_id);
    emit(deps.company.id, "run.ended", { status: "interrupted" }, { runId: r.id, agentId: r.agent_id });
  }
}

export function startScheduler(depsList: () => LoopDeps[], intervalMs = 2000): () => void {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      for (const d of depsList()) await tick(d);
    } finally {
      busy = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

export function inflightCount(companyId: string): number {
  return inflight.get(companyId)?.size ?? 0;
}
