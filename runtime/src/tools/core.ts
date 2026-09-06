// Handlers for the core manifest (tools/manifest.ts). Integration tools
// bring their own handlers. Everything here is org-scoped through ctx.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { all, getDb, newId, one, run } from "../db.js";
import * as ledger from "../ledger.js";
import { setSecret, secretNames } from "../vault.js";
import { fail } from "../integrations/registry.js";
import type { AgentRow, TaskRow, ToolContext, ToolHandler, ToolResult } from "../types.js";

const exec = promisify(execFile);

function now() {
  return Date.now();
}

function workspaceDir(ctx: ToolContext): string {
  return ctx.config.company.workspace?.path ?? path.join(ctx.companyDir, "workspace");
}

async function hive(ctx: ToolContext, args: string[]): Promise<ToolResult> {
  const bin = process.env.HIVE_BIN ?? "hive";
  const cwd = ctx.config.company.workspace?.hive_project
    ? path.join(workspaceDir(ctx), ctx.config.company.workspace.hive_project)
    : workspaceDir(ctx);
  try {
    const { stdout, stderr } = await exec(bin, args, { cwd, maxBuffer: 8 * 1024 * 1024, timeout: 15 * 60_000 });
    let parsed: unknown = undefined;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      /* text */
    }
    return { ok: true, output: parsed ?? stdout.slice(-8000), stderr: stderr.slice(-2000) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string; code?: number | string };
    if (err.code === "ENOENT") return fail("hive_missing", "hive binary not found; set HIVE_BIN or install hive");
    return { ok: false, error: { code: "hive_failed", hint: err.message }, output: (err.stdout ?? "").slice(-8000), stderr: (err.stderr ?? "").slice(-2000) };
  }
}

function taskRow(ctx: ToolContext, id: string): TaskRow | undefined {
  return one<TaskRow>("SELECT * FROM tasks WHERE company_id = ? AND id = ?", ctx.company.id, id);
}

export const coreHandlers: Record<string, ToolHandler> = {
  // ------------------------------------------------------------- hive.*
  async "hive.new"(ctx, input) {
    return hive(ctx, ["new", String(input.template), String(input.name), "--intent", String(input.intent)]);
  },
  async "hive.check"(ctx, input) {
    return hive(ctx, input.gate ? ["check", "--gate", String(input.gate), "--json"] : ["check", "--json"]);
  },
  async "hive.ship"(ctx, input) {
    const r = await hive(ctx, input.env === "prod" ? ["ship", "--env", "prod"] : ["ship"]);
    if (r.ok) ctx.emit("artifact.created", { kind: "url", ref: String(r.output).match(/https?:\/\/\S+/)?.[0] ?? "deployed", env: input.env });
    return r;
  },
  async "hive.graph_impact"(ctx, input) {
    return hive(ctx, ["graph", "impact", String(input.node)]);
  },
  async "hive.intent_get"(ctx) {
    const { readFileSync, existsSync } = await import("node:fs");
    const p = path.join(workspaceDir(ctx), ctx.config.company.workspace?.hive_project ?? ".", "hive.yaml");
    if (!existsSync(p)) return fail("not_found", `no hive.yaml at ${p}`);
    return { ok: true, yaml: readFileSync(p, "utf8") };
  },
  async "hive.intent_set"(ctx, input) {
    const fs = await import("node:fs");
    const YAML = (await import("yaml")).default;
    const p = path.join(workspaceDir(ctx), ctx.config.company.workspace?.hive_project ?? ".", "hive.yaml");
    if (!fs.existsSync(p)) return fail("not_found", `no hive.yaml at ${p}`);
    const doc = YAML.parse(fs.readFileSync(p, "utf8")) ?? {};
    const merged = deepMerge(doc, input.patch as Record<string, unknown>);
    fs.writeFileSync(p, YAML.stringify(merged));
    return { ok: true };
  },

  // -------------------------------------------------------- organisation
  async "task.plan"(ctx, input) {
    const root = ctx.config.roles.find((r) => r.reports_to === "board");
    if (root?.id !== ctx.role.role_key) return fail("forbidden", "only the role reporting to the board may plan a mission");
    const items = input.tasks as Record<string, unknown>[];
    const roleIds = new Set(ctx.config.roles.map((r) => r.id));
    for (const t of items) if (!roleIds.has(String(t.owner_role))) return fail("bad_owner", `owner_role ${t.owner_role} is not a role`);
    const missionId = ctx.run.task_id;
    const ids = new Map<string, string>();
    const tx = getDb().transaction(() => {
      for (const t of items) {
        const id = newId();
        ids.set(String(t.key), id);
        run(
          `INSERT INTO tasks (id, company_id, parent_id, mission_id, key, title, intent, acceptance, owner_role, status, budget_cap, priority, created_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,'planned',?,?,?,?,?)`,
          id, ctx.company.id, missionId, missionId, t.key, t.title, t.intent, t.acceptance, t.owner_role,
          Number(t.budget_cap ?? 0), Number(t.priority ?? 3), ctx.agent.id, now(), now(),
        );
      }
      for (const t of items) {
        for (const dep of (t.depends_on as string[]) ?? []) {
          const to = ids.get(dep);
          if (!to) throw new Error(`depends_on ${dep} is not a task key in this plan`);
          run("INSERT INTO task_deps (task_id, depends_on) VALUES (?, ?)", ids.get(String(t.key)), to);
        }
      }
      for (const [, id] of ids) {
        const deps = all<{ n: number }>("SELECT COUNT(*) AS n FROM task_deps WHERE task_id = ?", id)[0].n;
        if (deps === 0) run("UPDATE tasks SET status = 'ready' WHERE id = ?", id);
      }
    });
    try {
      tx();
    } catch (e) {
      return fail("bad_plan", (e as Error).message);
    }
    for (const [key, id] of ids) ctx.emit("task.planned", { task_id: id, key, mission_id: missionId });
    return { ok: true, tasks: Object.fromEntries(ids) };
  },
  async "task.create"(ctx, input) {
    const id = newId();
    run(
      `INSERT INTO tasks (id, company_id, parent_id, mission_id, title, intent, acceptance, owner_role, status, budget_cap, priority, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,'ready',?,3,?,?,?)`,
      id, ctx.company.id, ctx.run.task_id, taskRow(ctx, ctx.run.task_id)?.mission_id ?? ctx.run.task_id, input.title, input.intent, input.acceptance, input.owner_role,
      Number(input.budget_cap ?? 0), ctx.agent.id, now(), now(),
    );
    for (const dep of (input.depends_on as string[]) ?? []) {
      if (taskRow(ctx, dep)) {
        run("INSERT INTO task_deps (task_id, depends_on) VALUES (?, ?)", id, dep);
        run("UPDATE tasks SET status = 'planned' WHERE id = ?", id);
      }
    }
    ctx.emit("task.planned", { task_id: id, title: input.title });
    return { ok: true, task_id: id };
  },
  async "task.update"(ctx, input) {
    const t = taskRow(ctx, String(input.task_id));
    if (!t) return fail("not_found", "no such task");
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (input.status) {
      sets.push("status = ?");
      vals.push(input.status);
    }
    if (input.notes) {
      sets.push("notes = ?");
      vals.push(String(input.notes).slice(0, 4000));
    }
    if (input.acceptance) {
      sets.push("acceptance = ?");
      vals.push(input.acceptance);
    }
    if (!sets.length) return fail("no_change", "nothing to update");
    sets.push("updated_at = ?");
    vals.push(now(), t.id);
    run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, ...vals);
    if (input.status === "done") ctx.emit("task.done", { task_id: t.id });
    if (input.status === "failed") ctx.emit("task.failed", { task_id: t.id, notes: input.notes });
    return { ok: true };
  },
  async "task.list"(ctx, input) {
    const rows = all<TaskRow>(
      `SELECT * FROM tasks WHERE company_id = ? ${input.status ? "AND status = ?" : ""} ${input.owner ? "AND owner_role = ?" : ""} ORDER BY priority, created_at LIMIT 100`,
      ...[ctx.company.id, input.status, input.owner].filter((v) => v !== undefined),
    );
    return { ok: true, tasks: rows.map((t) => ({ id: t.id, key: t.key, title: t.title, status: t.status, owner_role: t.owner_role, intent: t.intent, acceptance: t.acceptance, notes: t.notes })) };
  },
  async "task.handoff"(ctx, input) {
    const t = taskRow(ctx, String(input.task_id));
    if (!t) return fail("not_found", "no such task");
    run("UPDATE tasks SET owner_role = ?, owner_agent_id = NULL, status = 'ready', notes = ?, updated_at = ? WHERE id = ?",
      input.to_role, `handoff from ${ctx.role.role_key}: ${input.note}`, now(), t.id);
    ctx.emit("task.handoff", { task_id: t.id, to_role: input.to_role, note: input.note });
    return { ok: true };
  },
  async "agent.list"(ctx) {
    const rows = all<AgentRow>("SELECT * FROM agents WHERE company_id = ?", ctx.company.id);
    return { ok: true, agents: rows.map((a) => ({ id: a.id, name: a.name, role: a.role_key, status: a.status })) };
  },
  async "agent.hire"(ctx, input) {
    const role = one<{ id: string }>("SELECT id FROM roles WHERE company_id = ? AND role_key = ?", ctx.company.id, String(input.role_key));
    if (!role) return fail("bad_role", "no such role");
    const agentId = newId();
    const walletId = newId();
    run("INSERT INTO wallets (id, company_id, owner_type, owner_id, currency) VALUES (?, ?, 'agent', ?, ?)", walletId, ctx.company.id, agentId, ctx.company.currency);
    run("INSERT INTO agents (id, company_id, role_id, role_key, name, status, wallet_id, created_at) VALUES (?,?,?,?,?,'idle',?,?)",
      agentId, ctx.company.id, role.id, input.role_key, input.name, walletId, now());
    ctx.emit("agent.hired", { agent_id: agentId, role: input.role_key, name: input.name });
    return { ok: true, agent_id: agentId };
  },
  async "agent.suspend"(ctx, input) {
    run("UPDATE agents SET status = 'suspended' WHERE company_id = ? AND id = ?", ctx.company.id, String(input.agent_id));
    ctx.emit("agent.suspended", { agent_id: input.agent_id, reason: input.reason });
    return { ok: true };
  },
  async "message.send"(ctx, input) {
    const to = String(input.to);
    if (to !== "board" && !one("SELECT 1 FROM agents WHERE company_id = ? AND id = ?", ctx.company.id, to)) return fail("bad_recipient", "unknown agent id; use agent.list or 'board'");
    const thread = String(input.thread_id ?? newId());
    const id = newId();
    run("INSERT INTO messages (id, company_id, from_id, to_id, thread_id, body, ts) VALUES (?,?,?,?,?,?,?)", id, ctx.company.id, ctx.agent.id, to, thread, String(input.body).slice(0, 8000), now());
    ctx.emit("message.sent", { message_id: id, to, thread_id: thread, preview: String(input.body).slice(0, 200) });
    return { ok: true, message_id: id, thread_id: thread };
  },
  async "message.read"(ctx, input) {
    const rows = input.thread_id
      ? all<{ id: string; from_id: string; to_id: string; body: string; ts: number }>("SELECT * FROM messages WHERE company_id = ? AND thread_id = ? ORDER BY ts", ctx.company.id, String(input.thread_id))
      : all<{ id: string; from_id: string; to_id: string; body: string; ts: number }>("SELECT * FROM messages WHERE company_id = ? AND to_id = ? AND read_at IS NULL ORDER BY ts LIMIT 50", ctx.company.id, ctx.agent.id);
    run("UPDATE messages SET read_at = ? WHERE company_id = ? AND to_id = ? AND read_at IS NULL", now(), ctx.company.id, ctx.agent.id);
    return { ok: true, messages: rows };
  },
  async "report.weekly"(ctx, input) {
    const agents = all<AgentRow>("SELECT * FROM agents WHERE company_id = ?", ctx.company.id);
    const spend = agents.map((a) => ({ agent: a.name, role: a.role_key, mtd_minor: ledger.monthToDateSpend(ctx.company.id, ledger.walletAccount(a.id)), available_minor: ledger.available(ctx.company.id, ledger.walletAccount(a.id)) }));
    const tasks = one<{ done: number; failed: number; open: number }>(
      "SELECT SUM(status='done') AS done, SUM(status='failed') AS failed, SUM(status IN ('ready','running','parked','planned')) AS open FROM tasks WHERE company_id = ?",
      ctx.company.id,
    );
    const revenue = ledger.balance(ctx.company.id, "revenue") * -1;
    const report = { period: input.period, spend, tasks, revenue_minor: revenue, company_available_minor: ledger.available(ctx.company.id, "wallet:company") };
    const id = newId();
    run("INSERT INTO artifacts (id, company_id, run_id, task_id, kind, ref, meta_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
      id, ctx.company.id, ctx.run.id, ctx.run.task_id, "report", `weekly:${input.period}`, JSON.stringify(report), now());
    ctx.emit("artifact.created", { kind: "report", ref: `weekly:${input.period}`, artifact_id: id });
    return { ok: true, artifact_id: id, report };
  },
  async "artifact.save"(ctx, input) {
    const id = newId();
    run("INSERT INTO artifacts (id, company_id, run_id, task_id, kind, ref, meta_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
      id, ctx.company.id, ctx.run.id, ctx.run.task_id, String(input.kind), String(input.ref), JSON.stringify(input.meta ?? {}), now());
    ctx.emit("artifact.created", { kind: input.kind, ref: input.ref, artifact_id: id });
    return { ok: true, artifact_id: id };
  },

  // ---------------------------------------------------------------- web
  async "web.fetch"(ctx, input) {
    const url = String(input.url);
    const host = new URL(url).hostname;
    const allowed = (ctx.config.policies as { web?: { allowed?: string[] } }).web?.allowed;
    if (allowed?.length && !allowed.some((a) => host.endsWith(a))) return fail("blocked", `${host} is not in the company's allowed domains`);
    const res = await fetch(url, { headers: { "User-Agent": "alpha-hive-company/0.1" }, redirect: "follow" });
    const text = (await res.text()).replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    return { ok: res.ok, status: res.status, text: text.slice(0, 20000) };
  },
  async "web.search"() {
    return fail("unavailable", "web.search runs as an Anthropic server tool; this provider has none. Use web.fetch on a known URL.");
  },

  // ----------------------------------------------------------- treasury
  async "wallet.read"(ctx, input) {
    const walletId = input.wallet_id ? String(input.wallet_id) : ctx.agent.wallet_id;
    const w = one<{ id: string; owner_type: string; owner_id: string; currency: string }>("SELECT * FROM wallets WHERE company_id = ? AND id = ?", ctx.company.id, walletId);
    if (!w) return fail("not_found", "no such wallet");
    const account = w.owner_type === "company" ? "wallet:company" : ledger.walletAccount(w.owner_id);
    return { ok: true, wallet_id: w.id, currency: w.currency, balance_minor: ledger.balance(ctx.company.id, account), holds_minor: ledger.openHolds(ctx.company.id, account), available_minor: ledger.available(ctx.company.id, account), mtd_spend_minor: ledger.monthToDateSpend(ctx.company.id, account) };
  },
  async "wallet.transfer"(ctx, input) {
    const to = one<{ owner_type: string; owner_id: string }>("SELECT owner_type, owner_id FROM wallets WHERE company_id = ? AND id = ?", ctx.company.id, String(input.to_wallet));
    if (!to) return fail("not_found", "no such wallet");
    const from = ledger.walletAccount(ctx.agent.id);
    const dest = to.owner_type === "company" ? "wallet:company" : ledger.walletAccount(to.owner_id);
    if (ledger.available(ctx.company.id, from) < Number(input.amount)) return fail("insufficient", "not enough available");
    ledger.post(ctx.company.id, [{ account: dest, debit: Number(input.amount) }, { account: from, credit: Number(input.amount) }], `transfer: ${input.reason}`, ctx.run.id);
    ctx.emit("ledger.posted", { kind: "transfer", amount: input.amount, to: input.to_wallet });
    return { ok: true };
  },
  async "card.request"(ctx, input) {
    if ((ctx.config.treasury.card_provider ?? "none") === "none") return fail("ledger_only", "this company runs ledger-only (no card provider); budgets and approvals still apply, the board pays approved items by hand");
    const id = newId();
    run("INSERT INTO cards (id, company_id, wallet_id, provider, controls_json, status, created_at) VALUES (?,?,?,?,?,'requested',?)",
      id, ctx.company.id, ctx.agent.wallet_id, ctx.config.treasury.card_provider, JSON.stringify({ per_tx: input.per_tx, monthly: input.monthly, categories: input.categories, purpose: input.purpose }), now());
    ctx.emit("card.issued", { card_id: id, status: "requested" });
    return { ok: true, card_id: id, status: "requested — the worker issues it with spending controls once the board approves" };
  },
  async "card.freeze"(ctx, input) {
    const c = one<{ wallet_id: string }>("SELECT wallet_id FROM cards WHERE company_id = ? AND id = ?", ctx.company.id, String(input.card_id));
    if (!c || c.wallet_id !== ctx.agent.wallet_id) return fail("not_yours", "you can only freeze your own card");
    run("UPDATE cards SET status = 'frozen' WHERE id = ?", String(input.card_id));
    return { ok: true };
  },
  async "card.purchase"(ctx, input) {
    // In ledger-only mode the gate already placed a hold; capture it as spend.
    const account = ledger.walletAccount(ctx.agent.id);
    const amount = Number(input.amount);
    const holdRef = (input as { _hold_ref?: string })._hold_ref;
    const journal = holdRef
      ? ledger.capture(ctx.company.id, holdRef, amount, `purchase: ${input.vendor} — ${input.reason}`)
      : ledger.post(ctx.company.id, [{ account: "external", debit: amount }, { account, credit: amount }], `purchase: ${input.vendor} — ${input.reason}`, ctx.run.id);
    ctx.emit("spend.authorized", { vendor: input.vendor, amount, journal });
    const mode = (ctx.config.treasury.card_provider ?? "none") === "none" ? "ledger-only: recorded; the board pays the vendor by hand" : "card";
    return { ok: true, journal_id: journal, mode };
  },
  async "card.transactions"(ctx) {
    return { ok: true, entries: ledger.entries(ctx.company.id, 100, ledger.walletAccount(ctx.agent.id)) };
  },
  async "payment-link.create"(ctx, input) {
    const rz = ctx.secrets.get("RAZORPAY_KEY_ID");
    const rzs = ctx.secrets.get("RAZORPAY_KEY_SECRET");
    const currency = String(input.currency);
    if (currency === "INR" && rz && rzs) {
      const res = await fetch("https://api.razorpay.com/v1/payment_links", {
        method: "POST",
        headers: { Authorization: "Basic " + Buffer.from(`${rz}:${rzs}`).toString("base64"), "Content-Type": "application/json" },
        body: JSON.stringify({ amount: input.amount, currency, description: input.description, customer: input.customer_email ? { email: input.customer_email } : undefined }),
      });
      const body = (await res.json()) as { id?: string; short_url?: string; error?: { description?: string } };
      if (!res.ok) return fail("razorpay_error", body.error?.description ?? String(res.status));
      return { ok: true, link_id: body.id, url: body.short_url };
    }
    const sk = ctx.secrets.get("STRIPE_SECRET_KEY");
    if (sk) {
      const params = new URLSearchParams({ "line_items[0][price_data][currency]": currency.toLowerCase(), "line_items[0][price_data][product_data][name]": String(input.description), "line_items[0][price_data][unit_amount]": String(input.amount), "line_items[0][quantity]": "1" });
      const res = await fetch("https://api.stripe.com/v1/payment_links", { method: "POST", headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/x-www-form-urlencoded" }, body: params });
      const body = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
      if (!res.ok) return fail("stripe_error", body.error?.message ?? String(res.status));
      return { ok: true, link_id: body.id, url: body.url };
    }
    return fail("not_configured", "store RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET (INR) or STRIPE_SECRET_KEY in the vault");
  },
  async "payment-link.send"(ctx, input) {
    return fail("use_email", `send the link with email.send to ${input.to}; payment-link.send is a thin alias kept for policy naming`);
  },
  async "treasury.fund"() {
    return fail("board_only", "humans fund the company in the treasury screen");
  },
  async "treasury.raise_cap"() {
    return fail("board_only", "humans change caps in company.yaml");
  },

  // ------------------------------------------------------ infrastructure
  async "infra.targets"(ctx) {
    const targets = [];
    if (process.env.VERCEL_TOKEN) targets.push({ driver: "vercel" });
    if (process.env.DROPLET_HOST) targets.push({ driver: "droplet", host: "configured" });
    targets.push({ driver: "local" });
    return { ok: true, targets, workspace: workspaceDir(ctx) };
  },
  async "infra.secret.set"(ctx, input) {
    try {
      setSecret(ctx.company.id, String(input.name), String(input.value));
    } catch (e) {
      return fail("vault_error", (e as Error).message);
    }
    return { ok: true, stored: input.name };
  },
  async "infra.secret.list"(ctx) {
    return { ok: true, names: secretNames(ctx.company.id) };
  },
  async "infra.domain.search"(_ctx, input) {
    const name = String(input.name);
    try {
      const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(name)}`);
      return { ok: true, name, registered: res.status === 200, hint: res.status === 200 ? "taken" : "appears available; price via the registrar module (not yet wired)" };
    } catch (e) {
      return fail("lookup_failed", (e as Error).message);
    }
  },
  async "infra.domain.buy"() {
    return fail("not_configured", "registrar module not wired yet; the board buys the domain and stores DNS credentials");
  },
  async "infra.dns.set"() {
    return fail("not_configured", "DNS provider module not wired yet");
  },
  async "github.pr.open"(ctx, input) {
    return gh(ctx, ["pr", "create", "--repo", String(input.repo), "--head", String(input.branch), "--title", String(input.title), "--body", String(input.body)]);
  },
  async "github.pr.merge"(ctx, input) {
    return gh(ctx, ["pr", "merge", String(input.pr), "--squash"]);
  },
  async "github.issue.create"(ctx, input) {
    return gh(ctx, ["issue", "create", "--repo", String(input.repo), "--title", String(input.title), "--body", String(input.body)]);
  },
  async "github.repo.create"(ctx, input) {
    return gh(ctx, ["repo", "create", String(input.name), input.private ? "--private" : "--public"]);
  },
};

async function gh(ctx: ToolContext, args: string[]): Promise<ToolResult> {
  try {
    const { stdout } = await exec("gh", args, { cwd: workspaceDir(ctx), timeout: 120_000 });
    return { ok: true, output: stdout.trim() };
  } catch (e) {
    const err = e as { message: string; code?: string; stderr?: string };
    if (err.code === "ENOENT") return fail("gh_missing", "GitHub CLI (gh) not installed on the worker");
    return fail("gh_failed", (err.stderr ?? err.message).slice(0, 1000));
  }
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" && out[k] !== null
      ? deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>)
      : v;
  }
  return out;
}
