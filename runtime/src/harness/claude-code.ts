// Claude Code harness for coding roles: the Claude Agent SDK runs inside
// the company workspace with its built-in tools, and our catalogue tools
// are exposed to it as an in-process MCP server. Every catalogue call still
// goes through the gate; built-in tools are confined to the workspace.
//
// Requires `claude` login on the worker machine (Claude Code UI mode) or
// ANTHROPIC_API_KEY. Loaded dynamically so the rest of the runtime does
// not depend on the SDK being installed/authenticated.

import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { one, run as sql } from "../db.js";
import { emit } from "../bus.js";
import { decide } from "../gate.js";
import { toolsForRole } from "../tools/resolve.js";
import { redact, resolver } from "../vault.js";
import type { LoopDeps } from "./loop.js";
import { readyDependents } from "./loop.js";
import type { AgentRow, RoleRow, RunRow, TaskRow, ToolContext } from "../types.js";

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

export async function runClaudeCode(deps: LoopDeps, runRow: RunRow): Promise<void> {
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

  sql("UPDATE agents SET status = 'running' WHERE id = ?", agent.id);
  sql("UPDATE tasks SET status = 'running', owner_agent_id = ? WHERE id = ?", agent.id, task.id);
  emit(deps.company.id, "run.started", { task_id: task.id, title: task.title, model: "claude-code", cwd }, { runId: runRow.id, agentId: agent.id });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sdk: any;
  try {
    sdk = await import("@anthropic-ai/claude-agent-sdk");
  } catch (e) {
    fail(`Claude Agent SDK not available: ${(e as Error).message}`);
    return;
  }

  const mcpTools = [...tools.byName.values()]
    .filter((t) => !t.spec.server)
    .map((t) =>
      sdk.tool(t.spec.name.replace(/[.-]/g, "_"), t.spec.description, zodFromSchema(t.spec.input as Record<string, unknown>), async (input: Record<string, unknown>) => {
        const g = decide({ config: deps.config, role: rc, companyId: deps.company.id, agentId: agent.id, spec: t.spec, input, allowedNames: tools.allowedNames });
        emit(deps.company.id, "run.tool_call", { tool: t.spec.name, side_effect: g.sideEffect, decision: g.decision, reason: g.reason }, { runId: runRow.id, agentId: agent.id });
        if (g.decision === "deny") return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code: "denied_by_policy", hint: g.reason } }) }], isError: true };
        if (g.decision !== "allow") {
          // Coding roles cannot be resumed mid-SDK-session yet: record the approval and tell the agent to end its turn.
          const { newId } = await import("../db.js");
          const approvalId = newId();
          sql("INSERT INTO approvals (id, company_id, run_id, agent_id, tool, side_effect, request_json, status, created_at) VALUES (?,?,?,?,?,?,?,'pending',?)",
            approvalId, deps.company.id, runRow.id, agent.id, t.spec.name, g.sideEffect, JSON.stringify({ input, reason: g.reason, amount: g.amount, task: task.title, harness: "claude-code" }), Date.now());
          emit(deps.company.id, "approval.requested", { approval_id: approvalId, tool: t.spec.name, side_effect: g.sideEffect, reason: g.reason, amount: g.amount }, { runId: runRow.id, agentId: agent.id });
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, parked: true, approval_id: approvalId, hint: "Waiting for the board. Finish what does not depend on this and end your turn; a new run continues after the decision." }) }] };
        }
        const result = await t.handler(ctx, g.holdRef ? { ...input, _hold_ref: g.holdRef } : input);
        const text = redact(JSON.stringify(result).slice(0, 24000), secrets);
        emit(deps.company.id, "run.tool_result", { tool: t.spec.name, preview: text.slice(0, 300) }, { runId: runRow.id, agentId: agent.id });
        return { content: [{ type: "text", text }] };
      }),
    );
  const server = sdk.createSdkMcpServer({ name: "hive-company", version: "0.1.0", tools: mcpTools });

  const prompt = [
    `Task: ${task.title}`, `Intent: ${task.intent}`, `Acceptance: ${task.acceptance}`, task.notes ? `Notes: ${task.notes}` : "",
    "", "Company tools are on the hive-company MCP server (names use underscores: hive_check, hive_ship, task_update…). Deploys only through hive_ship. Call task_update with status done when the acceptance criteria are met.",
  ].filter(Boolean).join("\n");

  let summary = "";
  try {
    const q = sdk.query({
      prompt,
      options: {
        cwd,
        systemPrompt: role.prompt,
        allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "mcp__hive-company__*"],
        mcpServers: { "hive-company": server },
        permissionMode: "acceptEdits",
        maxTurns: 60,
        canUseTool: async (name: string, input: Record<string, unknown>) => {
          // Built-in tools stay inside the workspace; no network deploys except through hive_ship.
          const p = String(input.file_path ?? input.path ?? input.command ?? "");
          if (name === "Bash" && /(vercel|netlify|gh\s+release|curl\s+-X\s*POST)/i.test(p)) return { behavior: "deny", message: "deploy only through hive_ship" };
          if (["Write", "Edit", "Read"].includes(name) && p && path.isAbsolute(p) && !p.startsWith(cwd)) return { behavior: "deny", message: "outside the workspace" };
          return { behavior: "allow", updatedInput: input };
        },
      },
    });
    for await (const msg of q) {
      if (msg.type === "assistant" && msg.message?.content) {
        const text = msg.message.content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
        if (text) emit(deps.company.id, "run.turn", { text: text.slice(0, 600) }, { runId: runRow.id, agentId: agent.id });
      }
      if (msg.type === "result") {
        summary = String(msg.result ?? "").slice(0, 2000);
        const usage = msg.usage ?? {};
        sql("UPDATE runs SET input_tokens = ?, output_tokens = ?, cost_minor = ?, turns = ? WHERE id = ?",
          usage.input_tokens ?? 0, usage.output_tokens ?? 0, Math.round((msg.total_cost_usd ?? 0) * (deps.company.currency === "INR" ? 84 : 1) * 100), msg.num_turns ?? 0, runRow.id);
      }
    }
  } catch (e) {
    fail((e as Error).message);
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

  function fail(error: string) {
    sql("UPDATE runs SET status = 'failed', ended_at = ?, outcome_json = ? WHERE id = ?", Date.now(), JSON.stringify({ error }), runRow.id);
    sql("UPDATE agents SET status = 'idle' WHERE id = ?", agent.id);
    sql("UPDATE tasks SET status = 'failed', notes = ?, updated_at = ? WHERE id = ?", error.slice(0, 2000), Date.now(), task.id);
    emit(deps.company.id, "run.ended", { status: "failed", error }, { runId: runRow.id, agentId: agent.id });
  }
}
