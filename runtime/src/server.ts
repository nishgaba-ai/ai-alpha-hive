// Control-plane HTTP API + SSE. The web app (local or Vercel), the MCP
// server, and the CLI all talk to this. Node http, no framework.
// Auth: if HIVE_API_TOKEN is set, every request needs `Authorization: Bearer`.

import http from "node:http";
import { URL } from "node:url";
import { all, one, run as sql } from "./db.js";
import { subscribe, since, forRun } from "./bus.js";
import * as ledger from "./ledger.js";
import * as erp from "./erp.js";
import * as cr from "./creators.js";
import { decideApproval } from "./harness/loop.js";
import { startMission, inflightCount } from "./scheduler.js";
import { askBoard } from "./board.js";
import { INTEGRATIONS, integrationById } from "../integrations/index.js";
import { describe, missingSecrets } from "./integrations/registry.js";
import { resolver, secretNames, setSecret, deleteSecret, vaultConfigured } from "./vault.js";
import { readCompany, syncCompany, validateConfig, LoadError } from "./loader.js";
import { exportBundle } from "./migrate.js";
import { transcribe, synthesize, type VoiceConfig } from "./voice.js";
import { catalogue } from "./tools/resolve.js";
import { startOAuth, handleCallback, connected as oauthConnected, redirectUri, uiUrl } from "./oauth.js";
import { listTemplates, scaffoldCompany, slugify } from "./init.js";
import { recover } from "./scheduler.js";
import type { Registry, Entry } from "./registry.js";
import type { AgentRow, ApprovalRow, RunRow, TaskRow } from "./types.js";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>, url: URL) => Promise<void> | void;
type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

function route(method: string, pathPattern: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = new RegExp("^" + pathPattern.replace(/:([a-zA-Z]+)/g, (_, k) => {
    keys.push(k);
    return "([^/]+)";
  }) + "/?$");
  return { method, pattern, keys, handler };
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}

async function body<T = Record<string, unknown>>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks);
  if (!raw.length) return {} as T;
  return JSON.parse(raw.toString("utf8")) as T;
}

async function rawBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function graphFor(e: Entry) {
  const cid = e.company.id;
  const agents = all<AgentRow>("SELECT * FROM agents WHERE company_id = ? AND status != 'suspended'", cid);
  const roles = new Map(e.loaded.config.roles.map((r) => [r.id, r]));
  const running = all<RunRow & { title: string }>("SELECT r.*, t.title FROM runs r JOIN tasks t ON t.id = r.task_id WHERE r.company_id = ? AND r.status IN ('running','parked')", cid);
  const byAgent = new Map(running.map((r) => [r.agent_id, r]));
  const nodes = [
    { id: "board", type: "board", data: { label: "Board", members: e.loaded.config.company.board.map((b) => b.email) } },
    ...agents.map((a) => {
      const r = roles.get(a.role_key);
      const cur = byAgent.get(a.id);
      const acct = ledger.walletAccount(a.id);
      return {
        id: a.id,
        type: "agent",
        data: {
          name: a.name, role: a.role_key, title: r?.title ?? a.role_key, status: a.status, model: r?.model ?? "", effort: r?.effort ?? "",
          task: cur?.title ?? null, run_id: cur?.id ?? null, since: cur?.started_at ?? null,
          spend_minor: ledger.monthToDateSpend(cid, acct), budget_minor: (r?.budget.monthly ?? 0) * 100, available_minor: ledger.available(cid, acct),
          team: e.loaded.config.teams?.find((t) => t.members.includes(a.role_key))?.id ?? null,
        },
      };
    }),
  ];
  // Edges follow the org: board → executive → team lead → members. A member
  // whose team has a different lead hangs off that lead (kind "team");
  // everyone else hangs off the role they report to.
  const teams = e.loaded.config.teams ?? [];
  const edges = agents.map((a) => {
    const r = roles.get(a.role_key);
    const team = teams.find((t) => t.members.includes(a.role_key) && t.lead !== a.role_key);
    const leadAgent = team ? agents.find((x) => x.role_key === team.lead) : undefined;
    if (leadAgent) return { id: `${leadAgent.id}->${a.id}`, source: leadAgent.id, target: a.id, kind: "team" };
    const target = r?.reports_to === "board" ? "board" : agents.find((x) => x.role_key === r?.reports_to)?.id ?? "board";
    return { id: `${target}->${a.id}`, source: target, target: a.id, kind: "reports" };
  });
  return { nodes, edges, teams: e.loaded.config.teams ?? [] };
}

function summary(e: Entry) {
  const cid = e.company.id;
  const tasks = Object.fromEntries(all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM tasks WHERE company_id = ? GROUP BY status", cid).map((t) => [t.status, t.n]));
  const pending = one<{ n: number }>("SELECT COUNT(*) AS n FROM approvals WHERE company_id = ? AND status='pending'", cid)?.n ?? 0;
  const cost = one<{ c: number }>("SELECT COALESCE(SUM(cost_minor),0) AS c FROM runs WHERE company_id = ?", cid)?.c ?? 0;
  const agents = one<{ n: number; running: number }>("SELECT COUNT(*) AS n, SUM(status='running') AS running FROM agents WHERE company_id = ? AND status != 'suspended'", cid);
  return {
    id: cid, slug: e.company.slug, name: e.company.name, mission: e.company.mission, currency: e.company.currency, status: e.company.status,
    agents: agents?.n ?? 0, running: agents?.running ?? 0, inflight: inflightCount(cid), tasks, pending_approvals: pending,
    cost_minor: cost, available_minor: ledger.available(cid, "wallet:company"), monthly_cap: e.loaded.config.treasury.monthly_cap,
    roles: e.loaded.config.roles.map((r) => ({ id: r.id, title: r.title, model: r.model, harness: r.harness })),
    integrations: (e.loaded.config.integrations ?? []).filter((i) => "id" in i).map((i) => (i as { id: string }).id),
    yaml_hash: e.company.yaml_hash,
  };
}

export function startServer(registry: Registry, port: number, opts: { onReload?: (slug: string) => void; companiesRoot?: string } = {}): http.Server {
  const token = process.env.HIVE_API_TOKEN;
  const need = (slug: string): Entry => {
    const e = registry.bySlug(slug);
    if (!e) throw Object.assign(new Error("no such company"), { status: 404 });
    return e;
  };

  const routes: Route[] = [
    route("GET", "/api/health", (_r, res) => json(res, 200, { ok: true, companies: registry.all().length, vault: vaultConfigured(), providers: { anthropic: !!process.env.ANTHROPIC_API_KEY, openrouter: !!process.env.OPENROUTER_API_KEY }, public_url: process.env.HIVE_PUBLIC_URL ?? null })),
    route("GET", "/api/companies", (_r, res) => json(res, 200, registry.all().map(summary))),
    route("GET", "/api/catalogue", (_r, res) => json(res, 200, { ...catalogue(), integrations: INTEGRATIONS.map(describe) })),
    route("GET", "/api/templates", (_r, res) => json(res, 200, listTemplates())),
    route("POST", "/api/companies", async (req, res) => {
      const b = await body<{ template: string; name: string; mission?: string; board_email?: string; model?: string }>(req);
      if (!b.template || !b.name) return json(res, 400, { error: "template and name required" });
      const root = opts.companiesRoot ?? path.join(process.env.DATA_DIR ?? path.join(process.cwd(), "data"), "companies");
      const dir = path.join(root, slugify(b.name));
      try {
        scaffoldCompany(b.template, b.name, dir, { mission: b.mission, boardEmail: b.board_email, model: b.model });
        const loaded = readCompany(dir);
        const company = syncCompany(loaded);
        registry.add({ company, loaded, deps: { company, config: loaded.config, companyDir: dir } });
        recover(registry.bySlug(company.slug)!.deps);
        json(res, 200, { slug: company.slug, dir });
      } catch (err) {
        json(res, 400, { error: (err as Error).message, problems: (err as LoadError).problems });
      }
    }),
    route("GET", "/api/companies/:slug", (_r, res, p) => json(res, 200, { ...summary(need(p.slug)), config: need(p.slug).loaded.config, yaml: need(p.slug).loaded.yamlText, prompts: need(p.slug).loaded.prompts, dir: need(p.slug).loaded.dir })),
    route("GET", "/api/companies/:slug/graph", (_r, res, p) => json(res, 200, graphFor(need(p.slug)))),
    route("GET", "/api/companies/:slug/tasks", (_r, res, p) => {
      const e = need(p.slug);
      const tasks = all<TaskRow>("SELECT * FROM tasks WHERE company_id = ? ORDER BY created_at DESC LIMIT 500", e.company.id);
      const deps = all<{ task_id: string; depends_on: string }>("SELECT td.* FROM task_deps td JOIN tasks t ON t.id = td.task_id WHERE t.company_id = ?", e.company.id);
      json(res, 200, { tasks, deps });
    }),
    route("POST", "/api/companies/:slug/tasks", async (req, res, p) => {
      const e = need(p.slug);
      const b = await body<{ title: string; intent?: string; acceptance?: string; owner_role?: string; assignee_person_id?: string; due_at?: number; priority?: number }>(req);
      const { newId } = await import("./db.js");
      const id = newId();
      sql(`INSERT INTO tasks (id, company_id, title, intent, acceptance, owner_role, status, budget_cap, priority, created_by, created_at, updated_at, assignee_person_id, due_at)
           VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?,?)`,
        id, e.company.id, b.title, b.intent ?? b.title, b.acceptance ?? "done when the assignee says so", b.owner_role ?? "human", b.owner_role ? "ready" : "planned", b.priority ?? 3, "board", Date.now(), Date.now(), b.assignee_person_id ?? null, b.due_at ?? null);
      json(res, 200, { id });
    }),
    route("PATCH", "/api/companies/:slug/tasks/:id", async (req, res, p) => {
      const e = need(p.slug);
      const b = await body<{ status?: string; notes?: string; assignee_person_id?: string; due_at?: number }>(req);
      const sets: string[] = []; const vals: unknown[] = [];
      for (const k of ["status", "notes", "assignee_person_id", "due_at"] as const) if (b[k] !== undefined) { sets.push(`${k} = ?`); vals.push(b[k]); }
      if (sets.length) sql(`UPDATE tasks SET ${sets.join(", ")}, updated_at = ? WHERE company_id = ? AND id = ?`, ...vals, Date.now(), e.company.id, p.id);
      json(res, 200, { ok: true });
    }),
    route("GET", "/api/companies/:slug/missions/:id/graph", (_r, res, p) => {
      const e = need(p.slug);
      const tasks = all<TaskRow>("SELECT * FROM tasks WHERE company_id = ? AND (mission_id = ? OR id = ?)", e.company.id, p.id, p.id);
      const ids = new Set(tasks.map((t) => t.id));
      const deps = all<{ task_id: string; depends_on: string }>("SELECT * FROM task_deps").filter((d) => ids.has(d.task_id) && ids.has(d.depends_on));
      const runs = all<{ task_id: string; id: string; status: string; cost_minor: number; turns: number }>("SELECT task_id, id, status, cost_minor, turns FROM runs WHERE company_id = ?", e.company.id).filter((r) => ids.has(r.task_id));
      json(res, 200, { nodes: tasks.map((t) => ({ id: t.id, data: { ...t, runs: runs.filter((r) => r.task_id === t.id) } })), edges: deps.map((d) => ({ id: `${d.depends_on}->${d.task_id}`, source: d.depends_on, target: d.task_id })) });
    }),
    route("POST", "/api/companies/:slug/missions", async (req, res, p) => {
      const e = need(p.slug);
      const b = await body<{ text: string; by?: string }>(req);
      if (!b.text) return json(res, 400, { error: "text required" });
      if (e.company.status !== "running") sql("UPDATE companies SET status = 'running' WHERE id = ?", e.company.id), (e.company.status = "running");
      json(res, 200, { task: startMission(e.deps, b.text, b.by ?? "board") });
    }),
    route("POST", "/api/companies/:slug/pause", (_r, res, p) => {
      const e = need(p.slug);
      sql("UPDATE companies SET status = 'paused' WHERE id = ?", e.company.id);
      e.company.status = "paused";
      json(res, 200, { ok: true });
    }),
    route("POST", "/api/companies/:slug/resume", (_r, res, p) => {
      const e = need(p.slug);
      sql("UPDATE companies SET status = 'running' WHERE id = ?", e.company.id);
      e.company.status = "running";
      json(res, 200, { ok: true });
    }),
    route("GET", "/api/companies/:slug/events", (_r, res, p, url) => json(res, 200, since(need(p.slug).company.id, Number(url.searchParams.get("since") ?? 0), Number(url.searchParams.get("limit") ?? 200)))),
    route("GET", "/api/companies/:slug/events/stream", (req, res, p, url) => {
      const e = need(p.slug);
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" });
      const from = Number(url.searchParams.get("since") ?? 0);
      for (const ev of since(e.company.id, from, 100)) res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
      const off = subscribe(e.company.id, (ev) => res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`));
      const ping = setInterval(() => res.write(": ping\n\n"), 15000);
      req.on("close", () => { off(); clearInterval(ping); });
    }),
    route("GET", "/api/companies/:slug/runs", (_r, res, p) => {
      const e = need(p.slug);
      json(res, 200, all("SELECT r.*, t.title, a.name AS agent_name, a.role_key FROM runs r JOIN tasks t ON t.id = r.task_id JOIN agents a ON a.id = r.agent_id WHERE r.company_id = ? ORDER BY r.started_at DESC LIMIT 100", e.company.id));
    }),
    route("GET", "/api/runs/:id", (_r, res, p) => {
      const r = one<RunRow>("SELECT * FROM runs WHERE id = ?", p.id);
      if (!r) return json(res, 404, { error: "no such run" });
      const task = one<TaskRow>("SELECT * FROM tasks WHERE id = ?", r.task_id);
      const agent = one<AgentRow>("SELECT * FROM agents WHERE id = ?", r.agent_id);
      json(res, 200, { run: { ...r, state_json: undefined }, task, agent, events: forRun(r.id), messages: r.state_json ? (JSON.parse(r.state_json) as { messages: unknown[] }).messages : [] });
    }),
    route("GET", "/api/companies/:slug/approvals", (_r, res, p, url) => {
      const e = need(p.slug);
      const status = url.searchParams.get("status") ?? "pending";
      const rows = all<ApprovalRow & { agent_name: string; role_key: string }>("SELECT ap.*, a.name AS agent_name, a.role_key FROM approvals ap JOIN agents a ON a.id = ap.agent_id WHERE ap.company_id = ? AND ap.status = ? ORDER BY ap.created_at DESC LIMIT 100", e.company.id, status);
      json(res, 200, rows.map((r) => ({ ...r, request: JSON.parse(r.request_json), wallet_available_minor: ledger.available(e.company.id, ledger.walletAccount(r.agent_id)) })));
    }),
    route("POST", "/api/companies/:slug/approvals/:id", async (req, res, p) => {
      const e = need(p.slug);
      const b = await body<{ decision: "approved" | "denied"; note?: string; by?: string }>(req);
      try {
        await decideApproval(e.deps, p.id, b.decision, b.by ?? "board", b.note);
        json(res, 200, { ok: true });
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
    }),
    route("GET", "/api/companies/:slug/treasury", (_r, res, p) => {
      const e = need(p.slug);
      const cid = e.company.id;
      const wallets = all<{ id: string; owner_type: string; owner_id: string; currency: string }>("SELECT * FROM wallets WHERE company_id = ?", cid).map((w) => {
        const acct = w.owner_type === "company" ? "wallet:company" : ledger.walletAccount(w.owner_id);
        const agent = w.owner_type === "agent" ? one<AgentRow>("SELECT name, role_key FROM agents WHERE id = ?", w.owner_id) : undefined;
        return { ...w, name: agent?.name ?? "company", role: agent?.role_key ?? null, balance_minor: ledger.balance(cid, acct), holds_minor: ledger.openHolds(cid, acct), available_minor: ledger.available(cid, acct), mtd_spend_minor: ledger.monthToDateSpend(cid, acct) };
      });
      json(res, 200, { currency: e.company.currency, wallets, accounts: ledger.accounts(cid), entries: ledger.entries(cid, 200), cards: all("SELECT * FROM cards WHERE company_id = ?", cid), config: e.loaded.config.treasury });
    }),
    route("GET", "/api/companies/:slug/artifacts", (_r, res, p) => json(res, 200, all("SELECT * FROM artifacts WHERE company_id = ? ORDER BY created_at DESC LIMIT 200", need(p.slug).company.id))),
    route("GET", "/api/companies/:slug/messages", (_r, res, p) => json(res, 200, all("SELECT m.*, a.name AS from_name FROM messages m LEFT JOIN agents a ON a.id = m.from_id WHERE m.company_id = ? ORDER BY ts DESC LIMIT 200", need(p.slug).company.id))),

    // integrations + secrets
    route("GET", "/api/companies/:slug/integrations", (_r, res, p) => {
      const e = need(p.slug);
      const present = new Set(secretNames(e.company.id));
      const enabled = new Map(all<{ integration_id: string; modes_json: string }>("SELECT * FROM integrations_enabled WHERE company_id = ?", e.company.id).map((r) => [r.integration_id, JSON.parse(r.modes_json) as string[]]));
      const secrets = resolver(e.company.id);
      json(res, 200, INTEGRATIONS.map((i) => {
        const d = describe(i);
        const oauth = d.auth.kind === "oauth2" ? { ...oauthConnected(secrets, d.auth), redirect_uri: redirectUri() } : null;
        return { ...d, oauth, enabled: enabled.has(i.id), enabled_modes: enabled.get(i.id) ?? [], missing_secrets: missingSecrets(i, enabled.get(i.id) ?? i.modes.map((m) => m.id), present), secrets_present: i.secrets.map((s) => s.name).filter((n) => present.has(n)) };
      }));
    }),
    route("GET", "/api/companies/:slug/integrations/:id/oauth/start", (_r, res, p) => {
      const e = need(p.slug);
      const i = integrationById(p.id);
      const auth = i?.auth;
      if (!i || !auth || auth.kind !== "oauth2") return json(res, 400, { error: "this integration does not use OAuth" });
      try {
        json(res, 200, startOAuth(e.company.id, e.company.slug, i.id, auth, resolver(e.company.id)));
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
    }),
    route("GET", "/api/oauth/callback", async (_r, res, _p, url) => {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const err = url.searchParams.get("error_description") ?? url.searchParams.get("error");
      const back = (slug: string, id: string, msg: string) => {
        res.writeHead(302, { Location: `${uiUrl()}/c/${slug}/integrations?open=${id}&msg=${encodeURIComponent(msg)}` });
        res.end();
      };
      if (!code || !state) return json(res, 400, { error: err ?? "missing code/state" });
      try {
        const r = await handleCallback(state, code, (cid) => resolver(cid));
        back(r.slug, r.integrationId, `${r.integrationId} connected`);
      } catch (e2) {
        json(res, 400, { error: (e2 as Error).message });
      }
    }),
    route("POST", "/api/companies/:slug/integrations/:id/health", async (_r, res, p) => {
      const e = need(p.slug);
      const i = integrationById(p.id);
      if (!i?.healthcheck) return json(res, 200, { ok: false, detail: "no healthcheck" });
      try {
        json(res, 200, await i.healthcheck({ secrets: resolver(e.company.id) }));
      } catch (err) {
        json(res, 200, { ok: false, detail: (err as Error).message });
      }
    }),
    route("GET", "/api/companies/:slug/secrets", (_r, res, p) => json(res, 200, { names: secretNames(need(p.slug).company.id), vault: vaultConfigured() })),
    route("POST", "/api/companies/:slug/secrets", async (req, res, p) => {
      const e = need(p.slug);
      const b = await body<{ name: string; value: string }>(req);
      try {
        setSecret(e.company.id, b.name, b.value);
        json(res, 200, { ok: true, name: b.name });
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
    }),
    route("DELETE", "/api/companies/:slug/secrets/:name", (_r, res, p) => {
      deleteSecret(need(p.slug).company.id, p.name);
      json(res, 200, { ok: true });
    }),

    // config
    route("POST", "/api/companies/:slug/yaml/validate", async (req, res) => {
      const b = await body<{ yaml: string }>(req);
      try {
        json(res, 200, { problems: validateConfig(YAML.parse(b.yaml)) });
      } catch (err) {
        json(res, 200, { problems: [(err as Error).message] });
      }
    }),
    route("PUT", "/api/companies/:slug/yaml", async (req, res, p) => {
      const e = need(p.slug);
      const b = await body<{ yaml: string }>(req);
      const file = path.join(e.loaded.dir, "company.yaml");
      const backup = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, b.yaml);
      try {
        const lc = readCompany(e.loaded.dir);
        if (lc.config.company.slug !== p.slug) throw new LoadError(["slug cannot change"]);
        const company = syncCompany(lc);
        e.loaded = lc;
        e.company = company;
        e.deps.config = lc.config;
        e.deps.company = company;
        opts.onReload?.(p.slug);
        json(res, 200, { ok: true, yaml_hash: lc.yamlHash });
      } catch (err) {
        fs.writeFileSync(file, backup);
        json(res, 400, { error: (err as Error).message, problems: (err as LoadError).problems });
      }
    }),

    // board assistant + voice
    route("POST", "/api/companies/:slug/ask", async (req, res, p) => {
      const e = need(p.slug);
      const b = await body<{ question: string; by?: string; history?: unknown[] }>(req);
      try {
        json(res, 200, await askBoard(e.deps, b.question, b.by ?? "board", (b.history ?? []) as never));
      } catch (err) {
        json(res, 500, { error: (err as Error).message });
      }
    }),
    route("POST", "/api/companies/:slug/voice/stt", async (req, res, p) => {
      const e = need(p.slug);
      const cfg = ((e.loaded.config as unknown as { voice?: VoiceConfig }).voice ?? {}) as VoiceConfig;
      try {
        json(res, 200, await transcribe(cfg, resolver(e.company.id), await rawBody(req), req.headers["content-type"] ?? "audio/webm"));
      } catch (err) {
        json(res, 501, { error: (err as Error).message });
      }
    }),
    route("POST", "/api/companies/:slug/voice/tts", async (req, res, p) => {
      const e = need(p.slug);
      const cfg = ((e.loaded.config as unknown as { voice?: VoiceConfig }).voice ?? {}) as VoiceConfig;
      const b = await body<{ text: string }>(req);
      try {
        const out = await synthesize(cfg, resolver(e.company.id), b.text);
        res.writeHead(200, { "Content-Type": out.mime, "Access-Control-Allow-Origin": "*" });
        res.end(out.audio);
      } catch (err) {
        json(res, 501, { error: (err as Error).message });
      }
    }),

    // ERP
    route("GET", "/api/companies/:slug/erp/people", (_r, res, p) => json(res, 200, erp.people(need(p.slug).company.id))),
    route("POST", "/api/companies/:slug/erp/people", async (req, res, p) => {
      const e = need(p.slug);
      const b = await body<Parameters<typeof erp.addPerson>[1]>(req);
      json(res, 200, erp.addPerson(e.company.id, { ...b, currency: b.currency ?? e.company.currency }));
    }),
    route("PATCH", "/api/companies/:slug/erp/people/:id", async (req, res, p) => {
      erp.updatePerson(need(p.slug).company.id, p.id, await body(req));
      json(res, 200, { ok: true });
    }),
    route("GET", "/api/companies/:slug/erp/payroll", (_r, res, p) => {
      const runs = erp.payrollRuns(need(p.slug).company.id);
      json(res, 200, runs.map((r) => ({ ...r, items: erp.payrollItems(r.id) })));
    }),
    route("POST", "/api/companies/:slug/erp/payroll", async (req, res, p) => {
      const b = await body<{ period: string }>(req);
      json(res, 200, erp.draftPayroll(need(p.slug).company.id, b.period));
    }),
    route("POST", "/api/companies/:slug/erp/payroll/:id/approve", async (req, res, p) => {
      const b = await body<{ by?: string }>(req);
      erp.approvePayroll(need(p.slug).company.id, p.id, b.by ?? "board");
      json(res, 200, { ok: true });
    }),
    route("POST", "/api/companies/:slug/erp/payroll/:id/pay", async (req, res, p) => {
      const b = await body<{ account_id: string; by?: string }>(req);
      try {
        erp.payPayroll(need(p.slug).company.id, p.id, b.account_id, b.by ?? "board");
        json(res, 200, { ok: true });
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
    }),
    route("GET", "/api/companies/:slug/erp/expenses", (_r, res, p, url) => json(res, 200, erp.expenses(need(p.slug).company.id, url.searchParams.get("status") ?? undefined))),
    route("POST", "/api/companies/:slug/erp/expenses", async (req, res, p) => {
      const e = need(p.slug);
      const b = await body<Parameters<typeof erp.submitExpense>[1]>(req);
      json(res, 200, erp.submitExpense(e.company.id, { ...b, currency: b.currency ?? e.company.currency }));
    }),
    route("POST", "/api/companies/:slug/erp/expenses/:id/decide", async (req, res, p) => {
      const b = await body<{ decision: "approved" | "rejected"; by?: string }>(req);
      erp.decideExpense(need(p.slug).company.id, p.id, b.decision, b.by ?? "board");
      json(res, 200, { ok: true });
    }),
    route("POST", "/api/companies/:slug/erp/expenses/:id/pay", async (req, res, p) => {
      const b = await body<{ account_id: string; by?: string }>(req);
      try {
        erp.payExpense(need(p.slug).company.id, p.id, b.account_id, b.by ?? "board");
        json(res, 200, { ok: true });
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
    }),
    route("GET", "/api/companies/:slug/erp/time", (_r, res, p, url) => json(res, 200, erp.timeEntries(need(p.slug).company.id, url.searchParams.get("period") ?? undefined))),
    route("POST", "/api/companies/:slug/erp/time", async (req, res, p) => json(res, 200, erp.logTime(need(p.slug).company.id, await body(req) as never))),
    route("GET", "/api/companies/:slug/erp/cash", (_r, res, p, url) => {
      const e = need(p.slug);
      json(res, 200, { accounts: erp.cashAccounts(e.company.id), txns: erp.cashTxns(e.company.id, url.searchParams.get("period") ?? undefined) });
    }),
    route("POST", "/api/companies/:slug/erp/cash/accounts", async (req, res, p) => {
      const e = need(p.slug);
      const b = await body<Parameters<typeof erp.addCashAccount>[1]>(req);
      json(res, 200, erp.addCashAccount(e.company.id, { ...b, currency: b.currency ?? e.company.currency }));
    }),
    route("POST", "/api/companies/:slug/erp/cash/txns", async (req, res, p) => json(res, 200, erp.addCashTxn(need(p.slug).company.id, await body(req) as never))),
    route("GET", "/api/companies/:slug/erp/statement/:period", (_r, res, p, url) => {
      const e = need(p.slug);
      if (url.searchParams.get("format") === "csv") {
        res.writeHead(200, { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${e.company.slug}-${p.period}.csv"`, "Access-Control-Allow-Origin": "*" });
        return void res.end(erp.statementCsv(e.company.id, p.period));
      }
      json(res, 200, erp.statement(e.company.id, p.period));
    }),

    // creator programme
    route("GET", "/api/companies/:slug/creators", (_r, res, p, url) => {
      const e = need(p.slug);
      json(res, 200, { totals: cr.summary(e.company.id), creators: cr.stats(e.company.id, url.searchParams.get("period") ?? undefined) });
    }),
    route("POST", "/api/companies/:slug/creators", async (req, res, p) => {
      const e = need(p.slug);
      try {
        json(res, 200, cr.addCreator(e.company.id, await body(req) as never));
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
    }),
    route("PATCH", "/api/companies/:slug/creators/:id", async (req, res, p) => {
      cr.updateCreator(need(p.slug).company.id, p.id, await body(req) as never);
      json(res, 200, { ok: true });
    }),
    route("POST", "/api/companies/:slug/creators/:id/events", async (req, res, p) => {
      try {
        json(res, 200, cr.recordEvent(need(p.slug).company.id, { creator_id: p.id }, await body(req) as never));
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
    }),
    route("POST", "/api/companies/:slug/creators/:id/payout", async (req, res, p) => {
      const b = await body<{ by?: string }>(req);
      try {
        json(res, 200, cr.requestPayout(need(p.slug).company.id, p.id, b.by ?? "board"));
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
    }),

    // migration
    route("GET", "/api/export", (_r, res) => json(res, 200, exportBundle(registry.all().map((e) => ({ slug: e.company.slug, dir: e.loaded.dir }))))),
  ];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE" });
      return res.end();
    }
    if (token && req.headers.authorization !== `Bearer ${token}` && url.searchParams.get("token") !== token) return json(res, 401, { error: "unauthorized" });
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      try {
        await r.handler(req, res, params, url);
      } catch (err) {
        const status = (err as { status?: number }).status ?? 500;
        json(res, status, { error: (err as Error).message });
      }
      return;
    }
    json(res, 404, { error: "not found" });
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[worker] port ${port} is already in use — another worker is running. Stop it, or start this one with --port <other> (and point HIVE_API_URL at it).`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(port);
  return server;
}
