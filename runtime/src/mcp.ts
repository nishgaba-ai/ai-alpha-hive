// MCP server over the control-plane API. Register it in Claude Desktop,
// Claude Code, or any MCP client — then talk (or speak, in the Claude apps'
// voice mode) to your company: status, approvals, missions, statements.
//
//   claude mcp add hive-company -- node runtime/dist/src/mcp.js --url http://localhost:4700 --company prodigal-ai
//
// Every call goes through the same API the web UI uses, so the worker's
// gate and audit trail apply unchanged.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const args = process.argv.slice(2);
const flag = (name: string, dflt?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const URL_ = (flag("url", process.env.HIVE_API_URL ?? "http://localhost:4700") as string).replace(/\/$/, "");
const DEFAULT = flag("company", process.env.HIVE_COMPANY);
const TOKEN = process.env.HIVE_API_TOKEN;

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL_}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...(init.headers ?? {}) } });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const company = z.string().optional().describe("company slug; defaults to the configured company");
const slugOf = (s?: string) => s ?? DEFAULT ?? "";

const server = new McpServer({ name: "hive-company", version: "0.1.0" });

server.tool("list_companies", "All companies running under this worker with status and pending approvals.", {}, async () => text(await api("/api/companies")));
server.tool("company_status", "Agents, tasks, spend and pending approvals for one company.", { company }, async ({ company: c }) => text(await api(`/api/companies/${slugOf(c)}`)));
server.tool("pending_approvals", "What the board needs to decide, with ids and reasons.", { company }, async ({ company: c }) => text(await api(`/api/companies/${slugOf(c)}/approvals?status=pending`)));
server.tool("decide_approval", "Approve or deny one approval. Only when the human explicitly asked.", { company, approval_id: z.string(), decision: z.enum(["approved", "denied"]), note: z.string().optional() },
  async ({ company: c, approval_id, decision, note }) => text(await api(`/api/companies/${slugOf(c)}/approvals/${approval_id}`, { method: "POST", body: JSON.stringify({ decision, note, by: "mcp" }) })));
server.tool("start_mission", "Give the company a mission; its executive plans and the team executes.", { company, text: z.string() },
  async ({ company: c, text: t }) => text(await api(`/api/companies/${slugOf(c)}/missions`, { method: "POST", body: JSON.stringify({ text: t, by: "mcp" }) })));
server.tool("recent_events", "Recent events in the company (what happened).", { company, since: z.number().optional() },
  async ({ company: c, since }) => text(await api(`/api/companies/${slugOf(c)}/events?since=${since ?? 0}&limit=50`)));
server.tool("ask_company", "Ask the board assistant a question in natural language; it can read everything and act on explicit instructions.", { company, question: z.string() },
  async ({ company: c, question }) => text(await api(`/api/companies/${slugOf(c)}/ask`, { method: "POST", body: JSON.stringify({ question, by: "mcp" }) })));
server.tool("treasury", "Wallets, holds and ledger for the company.", { company }, async ({ company: c }) => text(await api(`/api/companies/${slugOf(c)}/treasury`)));
server.tool("statement", "Monthly cash statement (YYYY-MM) for the CA.", { company, period: z.string() }, async ({ company: c, period }) => text(await api(`/api/companies/${slugOf(c)}/erp/statement/${period}`)));
server.tool("pause_company", "Pause dispatching new runs.", { company }, async ({ company: c }) => text(await api(`/api/companies/${slugOf(c)}/pause`, { method: "POST" })));
server.tool("resume_company", "Resume dispatching.", { company }, async ({ company: c }) => text(await api(`/api/companies/${slugOf(c)}/resume`, { method: "POST" })));

const transport = new StdioServerTransport();
await server.connect(transport);
