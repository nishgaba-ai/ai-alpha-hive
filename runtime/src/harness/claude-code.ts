// Claude Code harness for coding roles: the Claude Agent SDK runs inside
// the company workspace with its built-in tools, and our catalogue tools
// are exposed to it as an in-process MCP server. Every catalogue call still
// goes through the gate; built-in tools are confined to the workspace.
//
// Parked runs resume: the SDK session id is captured from the `init`
// message and stored in runs.state_json; when the board decides, the
// session is resumed with `options.resume` and the tool wrapper honours
// the decision (approved: the re-call passes once; denied: the re-call
// returns denied_by_board once and the agent re-plans).
//
// Requires `claude` login on the worker machine (Claude Code UI mode) or
// ANTHROPIC_API_KEY. Loaded dynamically so the rest of the runtime does
// not depend on the SDK being installed/authenticated.

import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { all, newId, one, run as sql } from "../db.js";
import { emit } from "../bus.js";
import { decide } from "../gate.js";
import { toolsForRole, type ToolSet } from "../tools/resolve.js";
import { redact, resolver } from "../vault.js";
import type { LoopDeps } from "./loop.js";
import { readyDependents } from "./loop.js";
import type { AgentRow, RoleConfig, RoleRow, RunRow, TaskRow, ToolContext } from "../types.js";

/** What a Claude Code run keeps in runs.state_json. */
export type ClaudeCodeState = { session_id: string; cwd: string };

export type ResumeDecision = { approvalId: string; tool: string; decision: "approved" | "denied"; note?: string; input: Record<string, unknown> };

// Approval ids already honoured by a tool wrapper in this process. Column-
// free: the approvals table is untouched; a worker restart simply lets a
// decided-but-unconsumed approval be honoured once more.
const consumed = new Set<string>();

/**
 * First approval for this run + tool with the given status that has not
 * been consumed yet. Marks it consumed and returns its id. Pure lookup over
 * the approvals table plus the in-memory consumed set.
 */
export function takeApproval(runId: string, tool: string, status: "approved" | "denied" = "approved"): string | undefined {
  const rows = all<{ id: string }>("SELECT id FROM approvals WHERE run_id = ? AND tool = ? AND status = ? ORDER BY decided_at, created_at", runId, tool, status);
  const hit = rows.find((r) => !consumed.has(r.id));
  if (!hit) return undefined;
  consumed.add(hit.id);
  return hit.id;
}

/** Mark every decided approval of a run consumed so nothing stale leaks into a later resume. */
export function drainApprovals(runId: string): void {
  for (const r of all<{ id: string }>("SELECT id FROM approvals WHERE run_id = ? AND status IN ('approved','denied')", runId)) consumed.add(r.id);
}

function zodFromSchema(schema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const props = (schema.properties ?? {}) as Record<string, { type?: string; description?: string; enum?: string[] }>;
  const required = new Set((schema.required as string[]) ?? []);
  const out: Record<string, z.ZodTypeAny> = {};
  for (const [k, v] of Object.entries(props)) {
    let t: z.ZodTypeAny =
      v.enum ? z.enum(v.enum as [string, ...string[]])
      : v.type === "integer" || v.type === "number" ? z.number()
      : v.type === "boolean" ? z.boolean()
      : v.type === "array" ? z.array(z.any())
      : v.type === "object" ? z.record(z.string(), z.any())
      : z.string();
    if (v.description) t = t.describe(v.description);
    out[k] = required.has(k) ? t : t.optional();
  }
  return out;
}

type Session = {
  task: TaskRow;
  agent: AgentRow;
  role: RoleRow;
  rc: RoleConfig;
  tools: ToolSet;
  cwd: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sdk: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: any;
  canUseTool: (name: string, input: Record<string, unknown>) => Promise<{ behavior: "allow" | "deny"; updatedInput?: Record<string, unknown>; message?: string }>;
};

/** Everything both the first run and a resume need: rows, tools, MCP server, workspace guard. */
async function openSession(deps: LoopDeps, runRow: RunRow): Promise<Session> {
  const task = one<TaskRow>("SELECT * FROM tasks WHERE id = ?", runRow.task_id)!;
  const agent = one<AgentRow>("SELECT * FROM agents WHERE id = ?", runRow.agent_id)!;
  const role = one<RoleRow>("SELECT * FROM roles WHERE id = ?", agent.role_id)!;
  const rc = deps.config.roles.find((r) => r.id === role.role_key)!;
  const secrets = resolver(deps.company.id);
  const tools = toolsForRole(deps.config, rc);
  const cwd = deps.config.company.workspace?.path ?? path.join(deps.companyDir, "workspace");
  fs.mkdirSync(cwd, { recursive: true });
  const ctx: ToolContext = {
    company: deps.company, config: deps.config, companyDir: deps.companyDir, agent, role, run: runRow, secrets,
    emit: (type, payload) => emit(deps.company.id, type, payload, { runId: runRow.id, agentId: agent.id }),
  };

  const sdk = await import("@anthropic-ai/claude-agent-sdk");

  const mcpTools = [...tools.byName.values()]
    .filter((t) => !t.spec.server)
    .map((t) =>
      sdk.tool(t.spec.name.replace(/[.-]/g, "_"), t.spec.description, zodFromSchema(t.spec.input as Record<string, unknown>), async (input: Record<string, unknown>) => {
        const g = decide({ config: deps.config, role: rc, companyId: deps.company.id, agentId: agent.id, spec: t.spec, input, allowedNames: tools.allowedNames });
        let holdRef = g.holdRef;
        let preApproved: string | undefined;
        if (g.decision === "deny") {
          emit(deps.company.id, "run.tool_call", { tool: t.spec.name, side_effect: g.sideEffect, decision: g.decision, reason: g.reason }, { runId: runRow.id, agentId: agent.id });
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code: "denied_by_policy", hint: g.reason } }) }], isError: true };
        }
        if (g.decision !== "allow") {
          // The board may already have decided this exact request (resumed session): honour it once.
          preApproved = takeApproval(runRow.id, t.spec.name, "approved");
          if (preApproved) {
            holdRef = undefined;
            emit(deps.company.id, "run.tool_call", { tool: t.spec.name, side_effect: g.sideEffect, decision: "allow", reason: `board approved ${preApproved}`, approval_id: preApproved }, { runId: runRow.id, agentId: agent.id });
          } else {
            const denied = takeApproval(runRow.id, t.spec.name, "denied");
            if (denied) {
              const note = one<{ reason: string | null }>("SELECT reason FROM approvals WHERE id = ?", denied)?.reason;
              emit(deps.company.id, "run.tool_call", { tool: t.spec.name, side_effect: g.sideEffect, decision: "deny", reason: `board denied ${denied}`, approval_id: denied }, { runId: runRow.id, agentId: agent.id });
              return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code: "denied_by_board", hint: note ?? "The board denied this action. Re-plan without it." } }) }], isError: true };
            }
            emit(deps.company.id, "run.tool_call", { tool: t.spec.name, side_effect: g.sideEffect, decision: g.decision, reason: g.reason }, { runId: runRow.id, agentId: agent.id });
            const approvalId = newId();
            sql("INSERT INTO approvals (id, company_id, run_id, agent_id, tool, side_effect, request_json, status, created_at) VALUES (?,?,?,?,?,?,?,'pending',?)",
              approvalId, deps.company.id, runRow.id, agent.id, t.spec.name, g.sideEffect, JSON.stringify({ input, reason: g.reason, amount: g.amount, task: task.title, harness: "claude-code" }), Date.now());
            emit(deps.company.id, "approval.requested", { approval_id: approvalId, tool: t.spec.name, side_effect: g.sideEffect, reason: g.reason, amount: g.amount, input }, { runId: runRow.id, agentId: agent.id });
            return { content: [{ type: "text", text: JSON.stringify({ ok: false, parked: true, approval_id: approvalId, hint: "Waiting for the board. Finish what does not depend on this and end your turn; this session resumes after the decision." }) }] };
          }
        } else {
          emit(deps.company.id, "run.tool_call", { tool: t.spec.name, side_effect: g.sideEffect, decision: g.decision, reason: g.reason }, { runId: runRow.id, agentId: agent.id });
        }
        const result = await t.handler(ctx, holdRef ? { ...input, _hold_ref: holdRef } : input);
        const text = redact(JSON.stringify(result).slice(0, 24000), secrets);
        emit(deps.company.id, "run.tool_result", { tool: t.spec.name, preview: text.slice(0, 300), ...(preApproved ? { approved: true } : {}) }, { runId: runRow.id, agentId: agent.id });
        return { content: [{ type: "text", text }] };
      }),
    );
  const server = sdk.createSdkMcpServer({ name: "hive-company", version: "0.1.0", tools: mcpTools });

  const canUseTool = async (name: string, input: Record<string, unknown>) => {
    // Built-in tools stay inside the workspace; no network deploys except through hive_ship.
    const p = String(input.file_path ?? input.path ?? input.command ?? "");
    if (name === "Bash" && /(vercel|netlify|gh\s+release|curl\s+-X\s*POST)/i.test(p)) return { behavior: "deny" as const, message: "deploy only through hive_ship" };
    if (["Write", "Edit", "Read"].includes(name) && p && path.isAbsolute(p) && !p.startsWith(cwd)) return { behavior: "deny" as const, message: "outside the workspace" };
    return { behavior: "allow" as const, updatedInput: input };
  };

  return { task, agent, role, rc, tools, cwd, sdk, server, canUseTool };
}

/** Stream one SDK query to completion and settle the run (done / parked / failed). */
async function drive(deps: LoopDeps, runRow: RunRow, s: Session, prompt: string, resume?: string): Promise<void> {
  const { task, agent, role, cwd } = s;
  let summary = "";
  try {
    const q = s.sdk.query({
      prompt,
      options: {
        cwd,
        systemPrompt: role.prompt,
        allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "mcp__hive-company__*"],
        mcpServers: { "hive-company": s.server },
        permissionMode: "acceptEdits",
        maxTurns: 60,
        canUseTool: s.canUseTool,
        ...(resume ? { resume } : {}),
      },
    });
    for await (const msg of q) {
      if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
        const state: ClaudeCodeState = { session_id: String(msg.session_id), cwd };
        sql("UPDATE runs SET state_json = ? WHERE id = ?", JSON.stringify(state), runRow.id);
      }
      if (msg.type === "assistant" && msg.message?.content) {
        const text = msg.message.content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
        if (text) emit(deps.company.id, "run.turn", { text: text.slice(0, 600) }, { runId: runRow.id, agentId: agent.id });
      }
      if (msg.type === "result") {
        summary = String(msg.result ?? "").slice(0, 2000);
        const usage = msg.usage ?? {};
        sql("UPDATE runs SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cost_minor = cost_minor + ?, turns = turns + ? WHERE id = ?",
          usage.input_tokens ?? 0, usage.output_tokens ?? 0, Math.round((msg.total_cost_usd ?? 0) * (deps.company.currency === "INR" ? 84 : 1) * 100), msg.num_turns ?? 0, runRow.id);
      }
    }
  } catch (e) {
    fail(deps, runRow, s, (e as Error).message);
    return;
  }
  const parked = one("SELECT 1 FROM approvals WHERE run_id = ? AND status = 'pending'", runRow.id);
  const status = parked ? "parked" : "done";
  sql("UPDATE runs SET status = ?, ended_at = ?, outcome_json = ? WHERE id = ?", status, Date.now(), JSON.stringify({ summary }), runRow.id);
  sql("UPDATE agents SET status = ? WHERE id = ?", parked ? "parked" : "idle", agent.id);
  if (!parked) {
    const t = one<TaskRow>("SELECT status FROM tasks WHERE id = ?", task.id)!;
    if (t.status === "running") sql("UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?", Date.now(), task.id);
    readyDependents(deps.company.id, task.id);
  } else sql("UPDATE tasks SET status = 'parked', updated_at = ? WHERE id = ?", Date.now(), task.id);
  emit(deps.company.id, parked ? "run.parked" : "run.ended", { status, summary }, { runId: runRow.id, agentId: agent.id });
}

function fail(deps: LoopDeps, runRow: RunRow, s: Pick<Session, "task" | "agent">, error: string) {
  sql("UPDATE runs SET status = 'failed', ended_at = ?, outcome_json = ? WHERE id = ?", Date.now(), JSON.stringify({ error }), runRow.id);
  sql("UPDATE agents SET status = 'idle' WHERE id = ?", s.agent.id);
  sql("UPDATE tasks SET status = 'failed', notes = ?, updated_at = ? WHERE id = ?", error.slice(0, 2000), Date.now(), s.task.id);
  emit(deps.company.id, "run.ended", { status: "failed", error }, { runId: runRow.id, agentId: s.agent.id });
}

export async function runClaudeCode(deps: LoopDeps, runRow: RunRow): Promise<void> {
  const task = one<TaskRow>("SELECT * FROM tasks WHERE id = ?", runRow.task_id)!;
  const agentRow = one<AgentRow>("SELECT * FROM agents WHERE id = ?", runRow.agent_id)!;
  const cwd = deps.config.company.workspace?.path ?? path.join(deps.companyDir, "workspace");

  sql("UPDATE agents SET status = 'running' WHERE id = ?", agentRow.id);
  sql("UPDATE tasks SET status = 'running', owner_agent_id = ? WHERE id = ?", agentRow.id, task.id);
  emit(deps.company.id, "run.started", { task_id: task.id, title: task.title, model: "claude-code", cwd }, { runId: runRow.id, agentId: agentRow.id });

  let s: Session;
  try {
    s = await openSession(deps, runRow);
  } catch (e) {
    fail(deps, runRow, { task, agent: agentRow }, `Claude Agent SDK not available: ${(e as Error).message}`);
    return;
  }

  const prompt = [
    `Task: ${task.title}`, `Intent: ${task.intent}`, `Acceptance: ${task.acceptance}`, task.notes ? `Notes: ${task.notes}` : "",
    "", "Company tools are on the hive-company MCP server (names use underscores: hive_check, hive_ship, task_update…). Deploys only through hive_ship. Call task_update with status done when the acceptance criteria are met.",
    "If a tool result says it is parked for the board, finish what does not depend on it and end your turn; this session is resumed with the board's decision.",
  ].filter(Boolean).join("\n");

  await drive(deps, runRow, s, prompt);
}

/**
 * Board decision on a parked Claude Code run: resume the SDK session and
 * tell the agent what happened. The tool wrapper lets the approved re-call
 * through once (see takeApproval); a denied one comes back as
 * denied_by_board once.
 */
export async function resumeClaudeCode(deps: LoopDeps, runRow: RunRow, d: ResumeDecision): Promise<void> {
  const task = one<TaskRow>("SELECT * FROM tasks WHERE id = ?", runRow.task_id)!;
  const agentRow = one<AgentRow>("SELECT * FROM agents WHERE id = ?", runRow.agent_id)!;
  const state = runRow.state_json ? (JSON.parse(runRow.state_json) as Partial<ClaudeCodeState>) : {};
  if (!state.session_id) {
    fail(deps, runRow, { task, agent: agentRow }, `cannot resume run ${runRow.id}: no Claude Code session id recorded (approval ${d.approvalId} ${d.decision})`);
    return;
  }

  sql("UPDATE runs SET status = 'running', ended_at = NULL WHERE id = ?", runRow.id);
  sql("UPDATE agents SET status = 'running' WHERE id = ?", agentRow.id);
  sql("UPDATE tasks SET status = 'running', owner_agent_id = ? WHERE id = ?", agentRow.id, task.id);
  emit(deps.company.id, "run.resumed", { decision: d.decision, approval_id: d.approvalId, tool: d.tool, session_id: state.session_id }, { runId: runRow.id, agentId: agentRow.id });

  let s: Session;
  try {
    s = await openSession(deps, runRow);
  } catch (e) {
    fail(deps, runRow, { task, agent: agentRow }, `Claude Agent SDK not available: ${(e as Error).message}`);
    return;
  }

  const verdict = d.decision === "approved" ? "APPROVED" : "DENIED";
  const note = d.note ? ` Board note: ${d.note}.` : "";
  const wire = d.tool.replace(/[.-]/g, "_");
  const prompt = [
    `The board ${verdict} your request to call ${d.tool} (approval ${d.approvalId}).${note}`,
    d.decision === "approved"
      ? `Call ${wire} again now with the same input; it will be allowed this time. Then continue the task.`
      : "Do not retry that call; re-plan without it and continue the task.",
    `Original input: ${JSON.stringify(d.input ?? {}).slice(0, 1500)}`,
  ].join("\n");

  try {
    await drive(deps, runRow, s, prompt, state.session_id);
  } finally {
    // Whatever the agent did, nothing decided in this round may be honoured by a later resume.
    drainApprovals(runRow.id);
  }
}
