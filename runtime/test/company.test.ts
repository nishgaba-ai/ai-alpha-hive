// End-to-end on the mock provider: template → company → mission → plan →
// runs → an approval parks → board approves → run completes.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { openMemoryDb, all, one } from "../src/db.js";
import { readCompany, syncCompany } from "../src/loader.js";
import { startMission, tick } from "../src/scheduler.js";
import { decideApproval, type LoopDeps } from "../src/harness/loop.js";
import { exportBundle } from "../src/migrate.js";
import { setSecret, redact, resolver } from "../src/vault.js";
import * as erp from "../src/erp.js";
import type { ApprovalRow, TaskRow } from "../src/types.js";

const repo = path.resolve(__dirname, "..", "..");

function scaffold(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hive-company-"));
  let yaml = fs.readFileSync(path.join(repo, "templates", "companies", "startup.yaml"), "utf8");
  yaml = yaml.replace(/model: [^\n]+/g, "model: mock").replace("harness: agent-sdk", "harness: api").replace("workspace: true", "workspace: false");
  fs.writeFileSync(path.join(dir, "company.yaml"), yaml);
  fs.mkdirSync(path.join(dir, "roles"));
  for (const f of fs.readdirSync(path.join(repo, "templates", "companies", "roles"))) fs.copyFileSync(path.join(repo, "templates", "companies", "roles", f), path.join(dir, "roles", f));
  return dir;
}

async function settle(deps: LoopDeps, rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await tick(deps);
    await new Promise((r) => setTimeout(r, 30));
  }
}

describe("company on the mock provider", () => {
  let deps: LoopDeps;
  let dir: string;
  beforeAll(() => {
    process.env.VAULT_KEY = Buffer.alloc(32, 7).toString("base64");
    openMemoryDb();
    dir = scaffold();
    const lc = readCompany(dir);
    const company = syncCompany(lc);
    deps = { company, config: lc.config, companyDir: dir };
  });

  it("loads, syncs and allocates budgets", () => {
    expect(all("SELECT * FROM agents WHERE company_id = ?", deps.company.id).length).toBe(4);
    const alloc = one<{ n: number }>("SELECT COUNT(*) AS n FROM ledger_entries WHERE company_id = ? AND memo LIKE 'alloc:%'", deps.company.id)!.n;
    expect(alloc).toBeGreaterThan(0);
  });

  it("plans a mission, runs the team, parks a publish for the board, resumes on approval", async () => {
    startMission(deps, "Launch the product to founders this month", "test");
    await settle(deps);
    const tasks = all<TaskRow>("SELECT * FROM tasks WHERE company_id = ?", deps.company.id);
    expect(tasks.length).toBeGreaterThan(2);
    const pending = all<ApprovalRow>("SELECT * FROM approvals WHERE company_id = ? AND status = 'pending'", deps.company.id);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0].side_effect).toBe("publish");
    await decideApproval(deps, pending[0].id, "approved", "test");
    await settle(deps, 6);
    const after = one<ApprovalRow>("SELECT * FROM approvals WHERE id = ?", pending[0].id)!;
    expect(after.status).toBe("approved");
    const done = all<TaskRow>("SELECT * FROM tasks WHERE company_id = ? AND status = 'done'", deps.company.id);
    expect(done.length).toBeGreaterThan(0);
    const events = all("SELECT type FROM events WHERE company_id = ?", deps.company.id);
    expect(events.some((e: { type: string }) => e.type === "approval.decided")).toBe(true);
  });

  it("vault stores, resolves and redacts", () => {
    setSecret(deps.company.id, "LINKEDIN_ACCESS_TOKEN", "tok_super_secret_value");
    const r = resolver(deps.company.id);
    expect(r.get("LINKEDIN_ACCESS_TOKEN")).toBe("tok_super_secret_value");
    expect(redact("token is tok_super_secret_value ok", r)).toBe("token is [redacted:LINKEDIN_ACCESS_TOKEN] ok");
  });

  it("erp: payroll, expenses, statement csv", () => {
    const cid = deps.company.id;
    const p = erp.addPerson(cid, { name: "Surabhi", kind: "board", monthly_salary_minor: 5000000, currency: "INR" });
    const acct = erp.addCashAccount(cid, { name: "HDFC current", kind: "bank", currency: "INR", opening_minor: 100000000 });
    const period = new Date().toISOString().slice(0, 7);
    const pr = erp.draftPayroll(cid, period);
    expect(pr.total_minor).toBe(5000000);
    erp.approvePayroll(cid, pr.id, "test");
    erp.payPayroll(cid, pr.id, acct.id, "test");
    const e = erp.submitExpense(cid, { person_id: p.id, category: "travel", amount_minor: 120000, currency: "INR", description: "site visit" });
    erp.decideExpense(cid, e.id, "approved", "test");
    erp.payExpense(cid, e.id, acct.id, "test");
    const s = erp.statement(cid, period);
    expect(s.totals.outflow_minor).toBe(-5120000);
    expect(erp.statementCsv(cid, period)).toContain("salary");
    expect(erp.cashAccounts(cid)[0].balance_minor).toBe(100000000 - 5120000);
  });

  it("exports a migratable bundle", () => {
    const b = exportBundle([{ slug: deps.company.slug, dir }]);
    expect(b.tables.companies.length).toBe(1);
    expect(Object.keys(b.companies[0].dir_files)).toContain("company.yaml");
    expect(b.tables.secrets[0]).toBeDefined();
    expect(JSON.stringify(b)).not.toContain("tok_super_secret_value");
  });
});
