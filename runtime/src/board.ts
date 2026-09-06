// The board assistant: how a human talks (or speaks) to the company. It
// reads everything, can start missions, and can decide approvals — but
// only with an explicit instruction naming the item, and it says what it
// did. Same provider layer as agents; default is the executive's model.

import { all, one } from "./db.js";
import * as ledger from "./ledger.js";
import { providerFor } from "./providers/index.js";
import type { ChatMessage, ToolDef } from "./providers/types.js";
import { resolver } from "./vault.js";
import { decideApproval, type LoopDeps } from "./harness/loop.js";
import { startMission } from "./scheduler.js";
import { statement } from "./erp.js";
import type { ApprovalRow } from "./types.js";

const TOOLS: ToolDef[] = [
  { name: "company_status", description: "Agents, tasks, pending approvals, wallet balances.", input: { type: "object", properties: {}, additionalProperties: false } },
  { name: "list_approvals", description: "Pending approvals with ids, tools, reasons and amounts.", input: { type: "object", properties: {}, additionalProperties: false } },
  { name: "decide_approval", description: "Approve or deny one pending approval by id. Only when the board explicitly said to.", input: { type: "object", properties: { approval_id: { type: "string" }, decision: { type: "string", enum: ["approved", "denied"] }, note: { type: "string" } }, required: ["approval_id", "decision"], additionalProperties: false } },
  { name: "start_mission", description: "Give the company a new mission (the executive plans it).", input: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } },
  { name: "recent_events", description: "Last N events (what happened).", input: { type: "object", properties: { n: { type: "integer" } }, additionalProperties: false } },
  { name: "statement", description: "Monthly cash statement summary (YYYY-MM).", input: { type: "object", properties: { period: { type: "string" } }, required: ["period"], additionalProperties: false } },
];

export async function askBoard(deps: LoopDeps, question: string, by: string, history: ChatMessage[] = []): Promise<{ text: string; actions: string[] }> {
  const cid = deps.company.id;
  const secrets = resolver(cid);
  const root = deps.config.roles.find((r) => r.reports_to === "board")!;
  const ref = deps.config.providers?.default ? `${deps.config.providers.default}/${root.model?.split("/").slice(-1)[0] ?? ""}` : root.model ?? "anthropic/claude-opus-5";
  const { provider, model } = providerFor(root.model ?? ref, deps.config, secrets);
  const actions: string[] = [];
  const system = [
    `You are the board assistant for ${deps.config.company.name}. You speak to the board (humans) about the company of agents.`,
    `Mission: ${deps.config.company.mission}. Currency ${deps.config.company.currency}; amounts from tools are in minor units — say them in whole units.`,
    "Answer in two to five short sentences suitable for reading aloud. No lists, no markdown.",
    "Decide an approval only when the board explicitly names it (by id, or 'the LinkedIn post', 'the domain purchase') and says approve or deny. If ambiguous, read the pending approvals back and ask which.",
    "After any action, state plainly what you did.",
  ].join("\n");
  const messages: ChatMessage[] = [...history, { role: "user", content: question }];
  for (let turn = 0; turn < 6; turn++) {
    const resp = provider.kind === "mock"
      ? { text: mockAnswer(cid), toolCalls: [], stop: "end" as const, usage: { input: 0, output: 0, cacheRead: 0 } }
      : await provider.chat({ model, system, messages, tools: TOOLS, effort: "medium", maxTokens: 2000 });
    messages.push({ role: "assistant", content: resp.text, toolCalls: resp.toolCalls });
    if (!resp.toolCalls.length) return { text: resp.text, actions };
    for (const call of resp.toolCalls) {
      let result: unknown;
      try {
        result = await execBoardTool(deps, call.name, call.input, by);
        if (["decide_approval", "start_mission"].includes(call.name)) actions.push(`${call.name}:${JSON.stringify(call.input)}`);
      } catch (e) {
        result = { ok: false, error: (e as Error).message };
      }
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(result).slice(0, 12000) });
    }
  }
  return { text: "I could not finish answering that; please ask again more specifically.", actions };
}

async function execBoardTool(deps: LoopDeps, name: string, input: Record<string, unknown>, by: string): Promise<unknown> {
  const cid = deps.company.id;
  switch (name) {
    case "company_status": {
      const agents = all<{ name: string; role_key: string; status: string; id: string }>("SELECT id, name, role_key, status FROM agents WHERE company_id = ?", cid);
      const tasks = all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM tasks WHERE company_id = ? GROUP BY status", cid);
      const pending = one<{ n: number }>("SELECT COUNT(*) AS n FROM approvals WHERE company_id = ? AND status='pending'", cid)?.n ?? 0;
      return {
        agents: agents.map((a) => ({ name: a.name, role: a.role_key, status: a.status, available_minor: ledger.available(cid, ledger.walletAccount(a.id)) })),
        tasks: Object.fromEntries(tasks.map((t) => [t.status, t.n])),
        pending_approvals: pending,
        company_available_minor: ledger.available(cid, "wallet:company"),
      };
    }
    case "list_approvals":
      return all<ApprovalRow>("SELECT * FROM approvals WHERE company_id = ? AND status='pending' ORDER BY created_at", cid).map((a) => ({ id: a.id, tool: a.tool, side_effect: a.side_effect, ...JSON.parse(a.request_json) }));
    case "decide_approval":
      await decideApproval(deps, String(input.approval_id), input.decision as "approved" | "denied", by, input.note ? String(input.note) : undefined);
      return { ok: true };
    case "start_mission":
      return { ok: true, task_id: startMission(deps, String(input.text), by).id };
    case "recent_events":
      return all<{ type: string; payload_json: string; ts: number }>("SELECT type, payload_json, ts FROM events WHERE company_id = ? ORDER BY seq DESC LIMIT ?", cid, Number(input.n ?? 20)).map((e) => ({ type: e.type, ts: e.ts, ...JSON.parse(e.payload_json) }));
    case "statement": {
      const s = statement(cid, String(input.period));
      return { period: s.period, totals: s.totals, by_category: s.by_category, accounts: s.accounts.map((a) => ({ name: a.name, closing_minor: a.closing_minor })), payroll: s.payroll ? { status: s.payroll.status, total_minor: s.payroll.total_minor } : null };
    }
    default:
      return { ok: false, error: "unknown tool" };
  }
}

function mockAnswer(cid: string): string {
  const pending = one<{ n: number }>("SELECT COUNT(*) AS n FROM approvals WHERE company_id = ? AND status='pending'", cid)?.n ?? 0;
  const agents = all<{ name: string; status: string }>("SELECT name, status FROM agents WHERE company_id = ?", cid);
  return `The company has ${agents.length} agents, ${agents.filter((a) => a.status === "running").length} running right now, and ${pending} approvals waiting for you. Say approve or deny with the item and I will do it.`;
}
