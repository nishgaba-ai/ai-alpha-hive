#!/usr/bin/env node
// hive-company — the CLI the Go binary delegates to (`hive company …`).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { openDb, all, one } from "./db.js";
import { readCompany, syncCompany, LoadError } from "./loader.js";
import { startWorker, discoverCompanies } from "./worker.js";
import { decideApproval } from "./harness/loop.js";
import { startMission, tick } from "./scheduler.js";
import { setSecret, secretNames, generateVaultKey, vaultConfigured } from "./vault.js";
import { exportBundle, importBundle, type Bundle } from "./migrate.js";
import { INTEGRATIONS } from "../integrations/index.js";
import { scaffoldCompany, slugify, listTemplates } from "./init.js";
import { describe } from "./integrations/registry.js";
import * as ledger from "./ledger.js";
import type { ApprovalRow } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, fs.existsSync(path.join(here, "..", "..", "..", "templates")) ? "../../.." : "../..");
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name: string, dflt?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const has = (name: string) => argv.includes(`--${name}`);
const companyDir = path.resolve(flag("company", process.cwd())!);

function loadEnv() {
  for (const f of [path.join(process.cwd(), ".env"), path.join(repoRoot, ".env")]) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/.exec(line);
      if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  }
}
loadEnv();

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function tree(dir: string) {
  const lc = readCompany(dir);
  const byParent = new Map<string, string[]>();
  for (const r of lc.config.roles) byParent.set(r.reports_to, [...(byParent.get(r.reports_to) ?? []), r.id]);
  const draw = (id: string, depth: number) => {
    for (const child of byParent.get(id) ?? []) {
      const r = lc.config.roles.find((x) => x.id === child)!;
      console.log(`${"  ".repeat(depth)}└ ${r.id} — ${r.title} · ${r.model ?? (r.harness === "agent-sdk" ? "claude-code" : "anthropic/claude-opus-5")} · budget ${r.budget.monthly} ${lc.config.company.currency}${r.count && r.count > 1 ? ` ×${r.count}` : ""}`);
      draw(child, depth + 1);
    }
  };
  console.log(`${lc.config.company.name} (${lc.config.company.slug}) — ${lc.config.company.mission}`);
  console.log("board");
  draw("board", 1);
  return lc;
}

async function main() {
  switch (cmd) {
    case "init": {
      const template = argv[1];
      const name = argv[2];
      if (!template || !name) die("usage: hive company init <template> \"<Name>\" [--dir <path>] [--model mock]\n  templates: " + listTemplates().map((t) => t.id).join(", "));
      const dir = path.resolve(flag("dir", slugify(name))!);
      try {
        scaffoldCompany(template, name, dir, { model: flag("model") });
      } catch (e) {
        die((e as Error).message);
      }
      console.log(`created ${dir}\n  edit company.yaml (mission, board email, budgets), then: hive company validate --company ${dir}`);
      return;
    }
    case "validate": {
      try {
        tree(companyDir);
        console.log("ok");
      } catch (e) {
        die(e instanceof LoadError ? e.message : (e as Error).message);
      }
      return;
    }
    case "run": {
      const dirs = has("group") ? discoverCompanies(path.resolve(flag("group")!)) : [companyDir];
      if (!dirs.length) die("no company.yaml found");
      const w = await startWorker({ companyDirs: dirs, port: flag("port") ? Number(flag("port")) : undefined, once: has("once"), companiesRoot: has("group") ? path.resolve(flag("group")!) : path.dirname(companyDir) });
      if (has("once")) {
        for (const e of w.registry.all()) console.log(`${e.company.slug}: started ${await tick(e.deps)} runs`);
        await new Promise((r) => setTimeout(r, 500));
        w.stop();
        process.exit(0);
      }
      const shutdown = () => {
        w.stop();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      return;
    }
    case "mission": {
      const text = argv.slice(1).filter((a) => !a.startsWith("--") && a !== flag("company")).join(" ");
      if (!text) die("usage: hive company mission \"<what to achieve>\"");
      openDb();
      const lc = readCompany(companyDir);
      const company = syncCompany(lc);
      const t = startMission({ company, config: lc.config, companyDir }, text, "cli");
      console.log(`mission ${t.id} queued; run the worker to execute`);
      return;
    }
    case "status": {
      openDb();
      const lc = readCompany(companyDir);
      const company = syncCompany(lc);
      const agents = all<{ name: string; role_key: string; status: string; id: string }>("SELECT id, name, role_key, status FROM agents WHERE company_id = ?", company.id);
      console.log(`${company.name} — ${company.status}`);
      for (const a of agents) console.log(`  ${a.name.padEnd(16)} ${a.role_key.padEnd(12)} ${a.status.padEnd(9)} available ${(ledger.available(company.id, ledger.walletAccount(a.id)) / 100).toFixed(2)}`);
      const tasks = all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM tasks WHERE company_id = ? GROUP BY status", company.id);
      console.log("tasks: " + (tasks.map((t) => `${t.status} ${t.n}`).join(", ") || "none"));
      const pending = all<ApprovalRow>("SELECT * FROM approvals WHERE company_id = ? AND status='pending' ORDER BY created_at", company.id);
      if (pending.length) {
        console.log("pending approvals:");
        for (const p of pending) console.log(`  ${p.id}  ${p.tool} (${p.side_effect})  ${(JSON.parse(p.request_json) as { reason?: string }).reason ?? ""}`);
      }
      return;
    }
    case "approve":
    case "deny": {
      const id = argv[1];
      if (!id) die(`usage: hive company ${cmd} <approval id>`);
      openDb();
      const lc = readCompany(companyDir);
      const company = syncCompany(lc);
      await decideApproval({ company, config: lc.config, companyDir }, id, cmd === "approve" ? "approved" : "denied", "cli", flag("note"));
      console.log(`${cmd}d ${id}`);
      return;
    }
    case "secret": {
      const sub = argv[1];
      if (sub === "keygen") {
        console.log(generateVaultKey());
        return;
      }
      openDb();
      const lc = readCompany(companyDir);
      const company = syncCompany(lc);
      if (sub === "set") {
        const name = argv[2];
        if (!name) die("usage: hive company secret set NAME   (value is read from stdin, never from an argument)");
        if (!vaultConfigured()) die(`VAULT_KEY is not set. Generate one:\n  VAULT_KEY=${generateVaultKey()}\nand put it in .env (keep it with your backups; it never leaves this machine).`);
        const rl = readline.createInterface({ input: process.stdin, terminal: false });
        const value = await new Promise<string>((resolve) => rl.once("line", (l) => resolve(l.trim())));
        rl.close();
        setSecret(company.id, name, value);
        console.log(`stored ${name}`);
      } else if (sub === "list") console.log(secretNames(company.id).join("\n") || "(none)");
      else if (sub === "keygen") console.log(generateVaultKey());
      else die("usage: hive company secret set NAME | list | keygen");
      return;
    }
    case "integrations": {
      for (const i of INTEGRATIONS) {
        const d = describe(i);
        console.log(`${i.id.padEnd(16)} ${i.title} — ${i.description}`);
        console.log(`  modes: ${d.modes.map((m) => `${m.id} (${m.sideEffect})`).join(", ")}`);
        console.log(`  secrets: ${d.secrets.map((s) => s.name).join(", ") || "none"}`);
      }
      return;
    }
    case "export": {
      const out = argv[1] ?? `hive-export-${new Date().toISOString().slice(0, 10)}.json`;
      openDb();
      const dirs = has("group") ? discoverCompanies(path.resolve(flag("group")!)) : [companyDir];
      const list = dirs.map((d) => ({ slug: readCompany(d).config.company.slug, dir: d }));
      fs.writeFileSync(out, JSON.stringify(exportBundle(list)));
      console.log(`wrote ${out} (${list.length} companies). Carry VAULT_KEY separately.`);
      return;
    }
    case "import": {
      const file = argv[1];
      if (!file) die("usage: hive company import <bundle.json> [--into <dir>]");
      openDb();
      const bundle = JSON.parse(fs.readFileSync(file, "utf8")) as Bundle;
      const r = importBundle(bundle, path.resolve(flag("into", ".")!));
      console.log(`imported ${r.rows} rows; company dirs: ${r.dirs.join(", ")}`);
      return;
    }
    case "doctor": {
      console.log(`node ${process.version}`);
      console.log(`VAULT_KEY ${vaultConfigured() ? "ok" : "MISSING (hive company secret keygen)"}`);
      console.log(`ANTHROPIC_API_KEY ${process.env.ANTHROPIC_API_KEY ? "set" : "not set (needed for anthropic/* roles; claude-code roles use your Claude Code login)"}`);
      console.log(`OPENROUTER_API_KEY ${process.env.OPENROUTER_API_KEY ? "set" : "not set"}`);
      try {
        const r = await fetch("http://localhost:11434/api/tags");
        const b = (await r.json()) as { models?: { name: string }[] };
        console.log(`ollama: ${(b.models ?? []).map((m) => m.name).join(", ") || "running, no models"}`);
      } catch {
        console.log("ollama: not running");
      }
      openDb();
      console.log(`db: ${one<{ n: number }>("SELECT COUNT(*) AS n FROM companies")?.n ?? 0} companies`);
      return;
    }
    default:
      console.log(`hive company <command>
  init <template> "<Name>" [--dir d]   scaffold from templates/companies
  validate [--company d]               schema + rules, prints the org tree
  run [--company d | --group d] [--port 4700] [--once]
  mission "<text>" [--company d]       queue a mission for the executive
  status | approve <id> | deny <id> [--note "..."]
  secret set NAME | list | keygen      vault (value from stdin)
  integrations                         the library and its modes
  export [file] [--group d] | import <file> [--into d]
  doctor`);
  }
}

main().catch((e) => die(e instanceof LoadError ? e.message : (e as Error).stack ?? String(e)));
