// company.yaml → validated config → rows. Fail closed on anything the
// schema or the rules reject; the org tree the board described is what runs.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import AjvModule from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
// ESM/CJS interop under NodeNext: both packages export the callable on .default at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv: any = (AjvModule as any).default ?? AjvModule;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addFormats: any = (addFormatsModule as any).default ?? addFormatsModule;
import { getDb, newId, one, all, run } from "./db.js";
import { TOOLS, unknownPatterns } from "../tools/manifest.js";
import { INTEGRATIONS, integrationById } from "../integrations/index.js";
import * as ledger from "./ledger.js";
import type { CompanyConfig, CompanyRow, LoadedCompany, RoleConfig, IntegrationEnable, McpEnable } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(here, "..", "..", "company.schema.json");
const schemaPathSrc = path.resolve(here, "..", "company.schema.json");

function loadSchema(): object {
  const p = fs.existsSync(schemaPath) ? schemaPath : schemaPathSrc;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export class LoadError extends Error {
  constructor(public problems: string[]) {
    super("company.yaml is invalid:\n  - " + problems.join("\n  - "));
  }
}

export function isIntegrationEnable(x: unknown): x is IntegrationEnable {
  return typeof x === "object" && x !== null && "id" in x;
}
export function isMcpEnable(x: unknown): x is McpEnable {
  return typeof x === "object" && x !== null && "mcp" in x;
}

/** Expand role tool patterns, including integration mode patterns (`linkedin:publish`). */
export function expandPatterns(patterns: string[], config: CompanyConfig): { names: string[]; unknown: string[] } {
  const names = new Set<string>();
  const unknown: string[] = [];
  const enabled = (config.integrations ?? []).filter(isIntegrationEnable);
  for (const p of patterns) {
    if (p.includes(":")) {
      const [id, mode] = p.split(":");
      const i = integrationById(id);
      const en = enabled.find((e) => e.id === id);
      if (!i || !en || !(en.modes ?? i.modes.map((m) => m.id)).includes(mode)) {
        unknown.push(p);
        continue;
      }
      for (const m of i.methods.filter((m) => m.mode === mode)) names.add(`${id}.${m.name}`);
      continue;
    }
    let matched = false;
    // core manifest
    if (unknownPatterns([p]).length === 0) {
      matched = true;
      for (const t of TOOLS) if (p.endsWith(".*") ? t.name.startsWith(p.slice(0, -1)) : t.name === p) names.add(t.name);
    }
    // enabled integrations
    for (const en of enabled) {
      const i = integrationById(en.id);
      if (!i) continue;
      const modes = en.modes ?? i.modes.map((m) => m.id);
      for (const m of i.methods.filter((m) => modes.includes(m.mode))) {
        const full = `${i.id}.${m.name}`;
        if (p.endsWith(".*") ? full.startsWith(p.slice(0, -1)) : full === p) {
          names.add(full);
          matched = true;
        }
      }
    }
    if (!matched) unknown.push(p);
  }
  return { names: [...names], unknown };
}

export function validateConfig(config: CompanyConfig): string[] {
  const problems: string[] = [];
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(loadSchema());
  if (!validate(config)) {
    for (const e of validate.errors ?? []) problems.push(`${e.instancePath || "/"} ${e.message ?? ""}`.trim());
  }
  if (problems.length) return problems;

  const roles = config.roles;
  const ids = new Set(roles.map((r) => r.id));
  const roots = roles.filter((r) => r.reports_to === "board");
  if (roots.length !== 1) problems.push(`exactly one role must report to the board (found ${roots.length})`);
  for (const r of roles) {
    if (r.reports_to !== "board" && !ids.has(r.reports_to)) problems.push(`role ${r.id} reports_to unknown role ${r.reports_to}`);
    if (r.harness === "agent-sdk" && !r.workspace) problems.push(`role ${r.id}: harness agent-sdk requires workspace: true`);
    const { unknown } = expandPatterns(r.tools, config);
    for (const u of unknown) problems.push(`role ${r.id}: tool pattern "${u}" matches nothing (core manifest or enabled integrations)`);
    for (const t of expandPatterns(r.tools, config).names) {
      const spec = TOOLS.find((x) => x.name === t);
      if (spec?.sideEffect === "board") problems.push(`role ${r.id}: "${t}" is board-only and cannot be granted to an agent`);
    }
  }
  // cycles
  const seen = new Set<string>();
  for (const r of roles) {
    const path: string[] = [];
    let cur: RoleConfig | undefined = r;
    while (cur && cur.reports_to !== "board") {
      if (path.includes(cur.id)) {
        if (!seen.has(cur.id)) problems.push(`reporting cycle through ${cur.id}`);
        seen.add(cur.id);
        break;
      }
      path.push(cur.id);
      cur = roles.find((x) => x.id === cur!.reports_to);
    }
  }
  // budgets
  const allocated = roles.reduce((s, r) => s + r.budget.monthly * (r.count ?? 1), 0) + (config.treasury.reserve ?? 0);
  if (allocated > config.treasury.monthly_cap) {
    problems.push(`role budgets + reserve (${allocated}) exceed treasury.monthly_cap (${config.treasury.monthly_cap})`);
  }
  // teams
  for (const t of config.teams ?? []) {
    if (!ids.has(t.lead)) problems.push(`team ${t.id}: lead ${t.lead} is not a role`);
    for (const m of t.members) if (!ids.has(m)) problems.push(`team ${t.id}: member ${m} is not a role`);
  }
  // integrations
  for (const en of config.integrations ?? []) {
    if (isIntegrationEnable(en)) {
      const i = integrationById(en.id);
      if (!i) problems.push(`integration "${en.id}" is not in the library (${INTEGRATIONS.map((x) => x.id).join(", ")})`);
      else for (const m of en.modes ?? []) if (!i.modes.some((x) => x.id === m)) problems.push(`integration ${en.id}: unknown mode ${m}`);
    }
  }
  // providers referenced by roles
  for (const r of roles) {
    const ref = r.model ?? "";
    const prov = ref.includes("/") ? ref.split("/")[0] : ref === "claude-code" || ref === "mock" ? ref : "anthropic";
    const known = ["anthropic", "claude-code", "mock", ...Object.keys(config.providers ?? {}).filter((k) => k !== "default")];
    if (!known.includes(prov)) problems.push(`role ${r.id}: model "${ref}" names provider "${prov}" which is not configured under providers:`);
  }
  return problems;
}

export function readCompany(dir: string): LoadedCompany {
  const file = path.join(dir, "company.yaml");
  if (!fs.existsSync(file)) throw new LoadError([`no company.yaml in ${dir}`]);
  const yamlText = fs.readFileSync(file, "utf8");
  const config = YAML.parse(yamlText) as CompanyConfig;
  const problems = validateConfig(config);
  const prompts: Record<string, string> = {};
  for (const r of config.roles) {
    const rel = r.prompt ?? `roles/${r.id}.md`;
    const p = path.join(dir, rel);
    if (!fs.existsSync(p)) problems.push(`role ${r.id}: prompt file ${rel} not found`);
    else prompts[r.id] = fs.readFileSync(p, "utf8");
  }
  if (problems.length) throw new LoadError(problems);
  return { dir, config, yamlText, yamlHash: createHash("sha256").update(yamlText).digest("hex").slice(0, 16), prompts };
}

/** Upsert the company into the control plane. Idempotent. */
export function syncCompany(lc: LoadedCompany, orgId: string | null = null): CompanyRow {
  const { config } = lc;
  const now = Date.now();
  const db = getDb();
  const tx = db.transaction(() => {
    let company = one<CompanyRow>("SELECT * FROM companies WHERE slug = ?", config.company.slug);
    if (!company) {
      run(
        "INSERT INTO companies (id, org_id, slug, name, mission, currency, yaml_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)",
        newId(), orgId, config.company.slug, config.company.name, config.company.mission, config.company.currency, lc.yamlHash, now,
      );
      company = one<CompanyRow>("SELECT * FROM companies WHERE slug = ?", config.company.slug)!;
    } else {
      run("UPDATE companies SET name = ?, mission = ?, currency = ?, yaml_hash = ? WHERE id = ?",
        config.company.name, config.company.mission, config.company.currency, lc.yamlHash, company.id);
    }
    const cid = company.id;
    // company wallet
    if (!one("SELECT 1 FROM wallets WHERE company_id = ? AND owner_type = 'company'", cid)) {
      run("INSERT INTO wallets (id, company_id, owner_type, owner_id, currency) VALUES (?, ?, 'company', 'company', ?)", newId(), cid, config.company.currency);
    }
    // roles + agents
    for (const r of config.roles) {
      const model = r.model ?? (r.harness === "agent-sdk" ? "claude-code" : "anthropic/claude-opus-5");
      const existing = one<{ id: string }>("SELECT id FROM roles WHERE company_id = ? AND role_key = ?", cid, r.id);
      const roleId = existing?.id ?? newId();
      if (existing) {
        run("UPDATE roles SET title=?, harness=?, model=?, effort=?, reports_to=?, tools_json=?, budget_json=?, prompt=? WHERE id=?",
          r.title, r.harness, model, r.effort ?? "high", r.reports_to, JSON.stringify(r.tools), JSON.stringify(r.budget), lc.prompts[r.id], roleId);
      } else {
        run("INSERT INTO roles (id, company_id, role_key, title, harness, model, effort, reports_to, tools_json, budget_json, prompt) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          roleId, cid, r.id, r.title, r.harness, model, r.effort ?? "high", r.reports_to, JSON.stringify(r.tools), JSON.stringify(r.budget), lc.prompts[r.id]);
      }
      const count = r.count ?? 1;
      const agents = all<{ id: string; name: string }>("SELECT id, name FROM agents WHERE company_id = ? AND role_id = ? ORDER BY created_at", cid, roleId);
      for (let n = agents.length; n < count; n++) {
        const name = count === 1 ? r.id : `${r.id}-${n + 1}`;
        const agentId = newId();
        const walletId = newId();
        run("INSERT INTO wallets (id, company_id, owner_type, owner_id, currency) VALUES (?, ?, 'agent', ?, ?)", walletId, cid, agentId, config.company.currency);
        run("INSERT INTO agents (id, company_id, role_id, role_key, name, status, wallet_id, created_at) VALUES (?,?,?,?,?,'idle',?,?)",
          agentId, cid, roleId, r.id, name, walletId, now);
      }
    }
    // agents whose role left the config retire (kept for history, hidden from the org)
    const keep = config.roles.map((r) => r.id);
    run(`UPDATE agents SET status = 'suspended' WHERE company_id = ? AND role_key NOT IN (${keep.map(() => "?").join(",")})`, cid, ...keep);
    run(`UPDATE agents SET status = 'idle' WHERE company_id = ? AND status = 'suspended' AND role_key IN (${keep.map(() => "?").join(",")})`, cid, ...keep);
    // teams
    for (const t of config.teams ?? []) {
      const ex = one<{ id: string }>("SELECT id FROM teams WHERE company_id = ? AND team_key = ?", cid, t.id);
      const teamId = ex?.id ?? newId();
      if (!ex) run("INSERT INTO teams (id, company_id, team_key, lead_role) VALUES (?,?,?,?)", teamId, cid, t.id, t.lead);
      else run("UPDATE teams SET lead_role = ? WHERE id = ?", t.lead, teamId);
      run("DELETE FROM team_members WHERE team_id = ?", teamId);
      for (const m of t.members) run("INSERT INTO team_members (team_id, role_key) VALUES (?, ?)", teamId, m);
    }
    // integrations
    run("DELETE FROM integrations_enabled WHERE company_id = ?", cid);
    for (const en of config.integrations ?? []) {
      if (isIntegrationEnable(en)) {
        const i = integrationById(en.id)!;
        run("INSERT INTO integrations_enabled (company_id, integration_id, modes_json, enabled_at) VALUES (?,?,?,?)",
          cid, en.id, JSON.stringify(en.modes ?? i.modes.map((m) => m.id)), now);
      }
    }
    return one<CompanyRow>("SELECT * FROM companies WHERE id = ?", company.id)!;
  });
  const company = tx();
  allocateMonth(company, config);
  return company;
}

/**
 * Monthly budget cycle. Posts the board's monthly cap from `funding` to the
 * company wallet, then each role's budget to its agents. Idempotent per month.
 */
export function allocateMonth(company: CompanyRow, config: CompanyConfig, when = new Date()): void {
  const ym = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`;
  const memo = `alloc:${ym}`;
  if (one("SELECT 1 FROM ledger_entries WHERE company_id = ? AND memo = ? LIMIT 1", company.id, memo)) return;
  const cap = config.treasury.monthly_cap * 100; // whole units in YAML → minor units in ledger
  ledger.post(company.id, [{ account: "wallet:company", debit: cap }, { account: "funding", credit: cap }], memo, "monthly-cap");
  const reserve = (config.treasury.reserve ?? 0) * 100;
  if (reserve > 0) ledger.post(company.id, [{ account: "reserve", debit: reserve }, { account: "wallet:company", credit: reserve }], memo, "reserve");
  for (const r of config.roles) {
    const agents = all<{ id: string }>("SELECT id FROM agents WHERE company_id = ? AND role_key = ?", company.id, r.id);
    for (const a of agents) {
      const amt = r.budget.monthly * 100;
      if (amt > 0) ledger.post(company.id, [{ account: `wallet:${a.id}`, debit: amt }, { account: "wallet:company", credit: amt }], memo, `budget:${r.id}`);
    }
  }
}
