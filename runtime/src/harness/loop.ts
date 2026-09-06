// The agent loop for `api` roles (and the shared resume path). Provider-
// agnostic: Anthropic, OpenRouter, Ollama and mock all run this. Every tool
// call goes through the gate; parked runs persist their state and resume
// when the board decides.

import { all, getDb, newId, one, run as sql } from "../db.js";
import { emit } from "../bus.js";
import * as ledger from "../ledger.js";
import { decide } from "../gate.js";
import { providerFor } from "../providers/index.js";
import type { ChatMessage, ToolCall } from "../providers/types.js";
import { toolsForRole, type ToolSet } from "../tools/resolve.js";
import { redact, resolver } from "../vault.js";
import type { AgentRow, CompanyConfig, CompanyRow, RoleConfig, RoleRow, RunRow, TaskRow, ToolContext } from "../types.js";

export type LoopDeps = {
  company: CompanyRow;
  config: CompanyConfig;
  companyDir: string;
};

type State = { messages: ChatMessage[]; pending?: { call: ToolCall; approvalId: string; holdRef?: string } };

const MAX_TURNS = 24;

function roleConfig(config: CompanyConfig, key: string): RoleConfig {
  const r = config.roles.find((x) => x.id === key);
  if (!r) throw new Error(`role ${key} missing from config`);
  return r;
}

function brief(deps: LoopDeps, role: RoleRow, agent: AgentRow, task: TaskRow): string {
  const cfg = deps.config;
  const roles = cfg.roles.map((r) => `- ${r.id} (${r.title}) reports to ${r.reports_to}`).join("\n");
  const memory = all<{ body: string }>("SELECT body FROM memory WHERE agent_id = ? ORDER BY ts DESC LIMIT 5", agent.id).map((m) => m.body);
  const unread = all<{ from_id: string; body: string }>("SELECT from_id, body FROM messages WHERE company_id = ? AND to_id = ? AND read_at IS NULL ORDER BY ts LIMIT 10", deps.company.id, agent.id);
  const wallet = ledger.available(deps.company.id, ledger.walletAccount(agent.id));
  return [
    `Company: ${cfg.company.name}`,
    `Mission: ${cfg.company.mission}`,
    `Currency: ${cfg.company.currency}. Your wallet available: ${wallet} minor units.`,
    `Roles:\n${roles}`,
    `You are agent "${agent.name}" in role ${role.role_key}.`,
    "",
    `Task: ${task.title}`,
    `Intent: ${task.intent}`,
    `Acceptance: ${task.acceptance}`,
    task.notes ? `Notes: ${task.notes}` : "",
    task.budget_cap ? `Task budget cap: ${task.budget_cap} minor units.` : "",
    memory.length ? `\nYour memory:\n${memory.map((m) => `- ${m}`).join("\n")}` : "",
    unread.length ? `\nUnread messages:\n${unread.map((m) => `- from ${m.from_id}: ${m.body}`).join("\n")}` : "",
    "",
    "When you have met the acceptance criteria, call task.update with status done and a short note, then reply with a two-sentence summary. If a tool result says it is parked for the board, stop and end your turn; you will be resumed.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function systemPrompt(deps: LoopDeps, role: RoleRow, tools: ToolSet): string {
  const gated = [...tools.byName.values()].filter((t) => !["read", "write"].includes(t.spec.sideEffect)).map((t) => `${t.spec.name} (${t.spec.sideEffect})`);
  return [
    role.prompt.trim(),
    "",
    "## Runtime rules",
    "- Tools are named with double underscores where the catalogue uses dots (linkedin__post is linkedin.post).",
    "- Every tool call passes a policy gate. Gated tools in your set: " + (gated.join(", ") || "none") + ".",
    "- A gated call may return `parked: true`; that means the board must approve. End your turn; do not retry or work around it.",
    "- A denial is a decision. Re-plan; never retry the same call.",
    "- Never include secrets in tool inputs or messages. Ask the board by name for anything missing.",
  ].join("\n");
}

async function execTool(ctx: ToolContext, tools: ToolSet, call: ToolCall, holdRef?: string): Promise<string> {
  const t = tools.byWire.get(call.name);
  if (!t) return JSON.stringify({ ok: false, error: { code: "unknown_tool", hint: `no tool ${call.name}` } });
  try {
    const input = holdRef ? { ...call.input, _hold_ref: holdRef } : call.input;
    const result = await t.handler(ctx, input);
    return redact(JSON.stringify(result).slice(0, 24000), ctx.secrets);
  } catch (e) {
    return JSON.stringify({ ok: false, error: { code: "tool_threw", hint: redact((e as Error).message, ctx.secrets) } });
  }
}

function saveState(runId: string, state: State) {
  sql("UPDATE runs SET state_json = ? WHERE id = ?", JSON.stringify(state), runId);
}

function accrueCost(deps: LoopDeps, runRow: RunRow, agent: AgentRow, usage: { input: number; output: number; cacheRead: number }, price: [number, number], currency: string) {
  const usd = (usage.input * price[0] + usage.output * price[1]) / 1_000_000;
  const rate = currency === "INR" ? 84 : 1; // coarse conversion for cost visibility; the board sets FX in a later tier
  const minor = Math.round(usd * rate * 100);
  sql("UPDATE runs SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cache_read_tokens = cache_read_tokens + ?, cost_minor = cost_minor + ?, turns = turns + 1 WHERE id = ?",
    usage.input, usage.output, usage.cacheRead, minor, runRow.id);
  if (minor > 0) {
    try {
      ledger.post(deps.company.id, [{ account: "api-spend", debit: minor }, { account: ledger.walletAccount(agent.id), credit: minor }], `inference: run ${runRow.id}`, runRow.id);
    } catch {
      /* wallet can go negative on inference only in accounting; the scheduler stops dispatch when available <= 0 */
    }
  }
}

export async function runLoop(deps: LoopDeps, runRow: RunRow, resume?: { decision: "approved" | "denied"; note?: string }): Promise<void> {
  const task = one<TaskRow>("SELECT * FROM tasks WHERE id = ?", runRow.task_id)!;
  const agent = one<AgentRow>("SELECT * FROM agents WHERE id = ?", runRow.agent_id)!;
  const role = one<RoleRow>("SELECT * FROM roles WHERE id = ?", agent.role_id)!;
  const rc = roleConfig(deps.config, role.role_key);
  const secrets = resolver(deps.company.id);
  const tools = toolsForRole(deps.config, rc);
  const { provider, model } = providerFor(role.model, deps.config, secrets);
  const ctx: ToolContext = {
    company: deps.company,
    config: deps.config,
    companyDir: deps.companyDir,
    agent, role, run: runRow, secrets,
    emit: (type, payload) => emit(deps.company.id, type, payload, { runId: runRow.id, agentId: agent.id }),
  };
  const system = systemPrompt(deps, role, tools);
  const state: State = runRow.state_json ? JSON.parse(runRow.state_json) : { messages: [{ role: "user", content: brief(deps, role, agent, task) }] };

  sql("UPDATE runs SET status = 'running' WHERE id = ?", runRow.id);
  sql("UPDATE agents SET status = 'running' WHERE id = ?", agent.id);
  sql("UPDATE tasks SET status = 'running', owner_agent_id = ? WHERE id = ?", agent.id, task.id);
  if (!resume) emit(deps.company.id, "run.started", { task_id: task.id, title: task.title, model: role.model }, { runId: runRow.id, agentId: agent.id });

  // Resume a parked call.
  if (resume && state.pending) {
    const { call, holdRef } = state.pending;
    let content: string;
    if (resume.decision === "approved") {
      content = await execTool(ctx, tools, call, holdRef);
      emit(deps.company.id, "run.tool_result", { tool: call.name, approved: true, preview: content.slice(0, 300) }, { runId: runRow.id, agentId: agent.id });
    } else {
      if (holdRef) ledger.release(deps.company.id, holdRef);
      content = JSON.stringify({ ok: false, error: { code: "denied_by_board", hint: resume.note ?? "The board denied this action. Re-plan without it." } });
    }
    state.messages.push({ role: "tool", toolCallId: call.id, name: call.name, content });
    state.pending = undefined;
    emit(deps.company.id, "run.resumed", { decision: resume.decision }, { runId: runRow.id, agentId: agent.id });
  }

  let turns = runRow.turns;
  const finish = (status: RunRow["status"], outcome: Record<string, unknown>) => {
    sql("UPDATE runs SET status = ?, ended_at = ?, outcome_json = ?, state_json = ? WHERE id = ?", status, Date.now(), JSON.stringify(outcome), JSON.stringify(state), runRow.id);
    sql("UPDATE agents SET status = ? WHERE id = ?", status === "parked" ? "parked" : "idle", agent.id);
    if (status === "done") {
      const t = one<TaskRow>("SELECT status FROM tasks WHERE id = ?", task.id)!;
      if (t.status === "running") sql("UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?", Date.now(), task.id);
      readyDependents(deps.company.id, task.id);
      remember(agent.id, `Task "${task.title}": ${String(outcome.summary ?? "").slice(0, 300)}`);
    }
    if (status === "failed") sql("UPDATE tasks SET status = 'failed', notes = ?, updated_at = ? WHERE id = ?", String(outcome.error ?? "").slice(0, 2000), Date.now(), task.id);
    if (status === "parked") sql("UPDATE tasks SET status = 'parked', updated_at = ? WHERE id = ?", Date.now(), task.id);
    emit(deps.company.id, status === "parked" ? "run.parked" : "run.ended", { status, ...outcome }, { runId: runRow.id, agentId: agent.id });
  };

  while (turns < MAX_TURNS) {
    turns++;
    let resp;
    try {
      resp = await provider.chat({ model, system, messages: state.messages, tools: tools.defs, effort: rc.effort });
    } catch (e) {
      finish("failed", { error: `provider ${provider.id}: ${(e as Error).message}` });
      return;
    }
    accrueCost(deps, runRow, agent, resp.usage, provider.price(model), deps.company.currency);
    if (resp.fallbackModel) emit(deps.company.id, "run.fallback", { model: resp.fallbackModel }, { runId: runRow.id, agentId: agent.id });
    state.messages.push({ role: "assistant", content: resp.text, toolCalls: resp.toolCalls });
    emit(deps.company.id, "run.turn", { turn: turns, text: resp.text.slice(0, 600), tool_calls: resp.toolCalls.map((c) => c.name), usage: resp.usage }, { runId: runRow.id, agentId: agent.id });

    if (resp.stop === "refusal") {
      finish("parked", { reason: "refusal", category: resp.refusalCategory });
      return;
    }
    if (!resp.toolCalls.length) {
      finish("done", { summary: resp.text.slice(0, 2000) });
      return;
    }

    for (const call of resp.toolCalls) {
      const t = tools.byWire.get(call.name);
      if (!t) {
        state.messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify({ ok: false, error: { code: "unknown_tool", hint: "not in your tool list" } }), isError: true });
        continue;
      }
      const g = decide({ config: deps.config, role: rc, companyId: deps.company.id, agentId: agent.id, spec: t.spec, input: call.input, allowedNames: tools.allowedNames });
      emit(deps.company.id, "run.tool_call", { tool: t.spec.name, side_effect: g.sideEffect, decision: g.decision, reason: g.reason, input: summarise(call.input) }, { runId: runRow.id, agentId: agent.id });

      if (g.decision === "deny") {
        state.messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify({ ok: false, error: { code: "denied_by_policy", hint: g.reason } }), isError: true });
        continue;
      }
      if (g.decision === "approve" || g.decision === "park") {
        const approvalId = newId();
        sql("INSERT INTO approvals (id, company_id, run_id, agent_id, tool, side_effect, request_json, status, created_at) VALUES (?,?,?,?,?,?,?,'pending',?)",
          approvalId, deps.company.id, runRow.id, agent.id, t.spec.name, g.sideEffect, JSON.stringify({ input: call.input, reason: g.reason, amount: g.amount, task: task.title }), Date.now());
        state.pending = { call, approvalId, holdRef: g.holdRef };
        saveState(runRow.id, state);
        emit(deps.company.id, "approval.requested", { approval_id: approvalId, tool: t.spec.name, side_effect: g.sideEffect, reason: g.reason, amount: g.amount, input: summarise(call.input) }, { runId: runRow.id, agentId: agent.id });
        finish("parked", { approval_id: approvalId, tool: t.spec.name });
        return;
      }
      const content = await execTool(ctx, tools, call, g.holdRef);
      emit(deps.company.id, "run.tool_result", { tool: t.spec.name, preview: content.slice(0, 300) }, { runId: runRow.id, agentId: agent.id });
      state.messages.push({ role: "tool", toolCallId: call.id, name: call.name, content });
    }
    saveState(runRow.id, state);
  }
  finish("failed", { error: `exceeded ${MAX_TURNS} turns` });
}

function summarise(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) out[k] = typeof v === "string" ? v.slice(0, 500) : v;
  return out;
}

function remember(agentId: string, body: string) {
  sql("INSERT INTO memory (id, agent_id, kind, body, ts) VALUES (?,?,?,?,?)", newId(), agentId, "summary", body, Date.now());
}

/** Tasks whose dependencies are all done become ready. */
export function readyDependents(companyId: string, doneTaskId: string): void {
  const dependents = all<{ task_id: string }>("SELECT task_id FROM task_deps WHERE depends_on = ?", doneTaskId);
  for (const d of dependents) {
    const open = one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM task_deps td JOIN tasks t ON t.id = td.depends_on WHERE td.task_id = ? AND t.status != 'done'",
      d.task_id,
    )!.n;
    if (open === 0) {
      sql("UPDATE tasks SET status = 'ready', updated_at = ? WHERE id = ? AND status = 'planned'", Date.now(), d.task_id);
      emit(companyId, "task.ready", { task_id: d.task_id });
    }
  }
}

/** Board decision → resume the parked run. */
export async function decideApproval(deps: LoopDeps, approvalId: string, decision: "approved" | "denied", by: string, note?: string): Promise<void> {
  const a = one<{ id: string; run_id: string; status: string; tool: string }>("SELECT id, run_id, status, tool FROM approvals WHERE id = ? AND company_id = ?", approvalId, deps.company.id);
  if (!a) throw new Error("no such approval");
  if (a.status !== "pending") throw new Error(`approval already ${a.status}`);
  sql("UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, reason = ? WHERE id = ?", decision, by, Date.now(), note ?? null, a.id);
  emit(deps.company.id, "approval.decided", { approval_id: a.id, decision, by, tool: a.tool }, { runId: a.run_id });
  const runRow = one<RunRow>("SELECT * FROM runs WHERE id = ?", a.run_id)!;
  await runLoop(deps, runRow, { decision, note });
}

export function createRun(companyId: string, task: TaskRow, agent: AgentRow): RunRow {
  const id = newId();
  sql("INSERT INTO runs (id, company_id, task_id, agent_id, status, started_at) VALUES (?,?,?,?,'running',?)", id, companyId, task.id, agent.id, Date.now());
  return one<RunRow>("SELECT * FROM runs WHERE id = ?", id)!;
}

export { getDb };
