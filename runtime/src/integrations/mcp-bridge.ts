// MCP client bridge: attach any MCP server as an integration. company.yaml:
//
//   integrations:
//     - mcp: "npx -y @modelcontextprotocol/server-filesystem ./workspace"   # stdio command
//       name: files
//       side_effect: write            # class for every tool unless overridden
//       overrides: { read_file: read, list_directory: read }
//     - mcp: "https://mcp.example.com/mcp"                                   # Streamable HTTP
//       name: crm
//       side_effect: send
//       headers: { Authorization: "Bearer vault:CRM_TOKEN" }                 # vault:NAME is resolved, never logged
//
// Tools surface as `<name>.<tool>` (e.g. files.read_file) and roles grant
// them like any other tool (`files.*`, `crm.create_lead`). Every call still
// passes the gate with the declared side-effect class, so an MCP server can
// never publish, spend or send without the same approvals as a built-in
// integration. Connections are lazy, cached per company + name, and
// re-opened when they drop.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpEnable, ResolvedTool, SecretResolver, SideEffect } from "../types.js";
import { stricter } from "./registry.js";

type Cached = { client: Client; tools: ResolvedTool[]; connectedAt: number; error?: string };
const cache = new Map<string, Cached>();
const pending = new Map<string, Promise<Cached>>();

function key(companyId: string, name: string) {
  return `${companyId}:${name}`;
}

export function toolName(server: string, tool: string): string {
  return `${server}.${tool.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
}

function resolveValue(v: string, secrets: SecretResolver): string {
  return v.replace(/vault:([A-Z0-9_]+)/g, (_, n) => secrets.get(n) ?? "");
}

function splitCommand(cmd: string): { command: string; args: string[] } {
  const parts = cmd.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const clean = parts.map((p) => p.replace(/^["']|["']$/g, ""));
  return { command: clean[0], args: clean.slice(1) };
}

export function isUrl(s: string): boolean {
  return /^https?:\/\//.test(s);
}

async function open(companyId: string, en: McpEnable, secrets: SecretResolver, cwd: string): Promise<Cached> {
  const client = new Client({ name: "hive-company", version: "0.1.0" });
  if (isUrl(en.mcp)) {
    const headers = Object.fromEntries(Object.entries(en.headers ?? {}).map(([k, v]) => [k, resolveValue(v, secrets)]));
    await client.connect(new StreamableHTTPClientTransport(new URL(en.mcp), { requestInit: { headers } }));
  } else {
    const { command, args } = splitCommand(en.mcp);
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    for (const [k, v] of Object.entries(en.env ?? {})) env[k] = resolveValue(v, secrets);
    await client.connect(new StdioClientTransport({ command, args, env, cwd, stderr: "ignore" }));
  }
  const listed = await client.listTools();
  const tools: ResolvedTool[] = listed.tools.map((t) => {
    const override = en.overrides?.[t.name];
    const sideEffect: SideEffect = override ? stricter(override, "read") : en.side_effect;
    const name = toolName(en.name, t.name);
    return {
      integration: `mcp:${en.name}`,
      spec: {
        name,
        description: `[${en.name} via MCP] ${t.description ?? t.name}`.slice(0, 1000),
        sideEffect,
        input: (t.inputSchema as { type: "object"; properties?: Record<string, unknown>; required?: string[] }) ?? { type: "object", properties: {} },
      },
      handler: async (_ctx, input) => {
        try {
          const r = await client.callTool({ name: t.name, arguments: input });
          const content = (r.content as { type: string; text?: string }[]) ?? [];
          const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
          if (r.isError) return { ok: false, error: { code: "mcp_error", hint: text.slice(0, 2000) } };
          let parsed: unknown = text;
          try { parsed = JSON.parse(text); } catch { /* text */ }
          return { ok: true, result: typeof parsed === "string" ? parsed.slice(0, 20000) : parsed, structured: r.structuredContent ?? undefined };
        } catch (e) {
          cache.delete(key(companyId, en.name));
          return { ok: false, error: { code: "mcp_unavailable", hint: (e as Error).message } };
        }
      },
    };
  });
  return { client, tools, connectedAt: Date.now() };
}

/** Connect (or reuse) and return the bridged tools. Errors are cached briefly so a dead server does not stall every run. */
export async function connectMcp(companyId: string, en: McpEnable, secrets: SecretResolver, cwd: string): Promise<Cached> {
  const k = key(companyId, en.name);
  const hit = cache.get(k);
  if (hit && (!hit.error || Date.now() - hit.connectedAt < 30_000)) return hit;
  const inflight = pending.get(k);
  if (inflight) return inflight;
  const p = open(companyId, en, secrets, cwd)
    .then((c) => { cache.set(k, c); return c; })
    .catch((e) => {
      const c: Cached = { client: new Client({ name: "hive-company", version: "0.1.0" }), tools: [], connectedAt: Date.now(), error: (e as Error).message };
      cache.set(k, c);
      return c;
    })
    .finally(() => pending.delete(k));
  pending.set(k, p);
  return p;
}

/** Tools already discovered for a company (sync view used by the tool resolver). */
export function bridgedTools(companyId: string, entries: McpEnable[]): ResolvedTool[] {
  return entries.flatMap((en) => cache.get(key(companyId, en.name))?.tools ?? []);
}

export function bridgeStatus(companyId: string, entries: McpEnable[]) {
  return entries.map((en) => {
    const c = cache.get(key(companyId, en.name));
    return { name: en.name, transport: isUrl(en.mcp) ? "http" : "stdio", side_effect: en.side_effect, connected: !!c && !c.error, error: c?.error ?? null, tools: c?.tools.map((t) => ({ name: t.spec.name, side_effect: t.spec.sideEffect })) ?? [] };
  });
}

export async function closeMcp(companyId: string): Promise<void> {
  for (const [k, c] of cache) {
    if (!k.startsWith(companyId + ":")) continue;
    cache.delete(k);
    await c.client.close().catch(() => {});
  }
}
