// SQLite control plane. One file under DATA_DIR shared by the worker and
// the API server (same process today). Schema mirrors docs/company/schema.md.
// Postgres/libSQL migration stays mechanical: no SQLite-only features
// beyond WAL and json text columns.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

export type DB = Database.Database;

let db: DB | null = null;

export function newId(): string {
  return ulid();
}

export function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), "data");
}

export function openDb(file?: string): DB {
  if (db) return db;
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(file ?? path.join(dir, "company.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function getDb(): DB {
  if (!db) throw new Error("db not opened — call openDb() first");
  return db;
}

/** Test helper: fresh in-memory database. */
export function openMemoryDb(): DB {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

export const TABLES = [
  "companies", "roles", "agents", "teams", "team_members", "tasks", "task_deps",
  "runs", "events", "approvals", "wallets", "ledger_entries", "cards",
  "artifacts", "messages", "secrets", "memory", "integrations_enabled", "contacts",
  "people", "payroll_runs", "payroll_items", "expenses", "time_entries", "cash_accounts", "cash_txns", "creators", "creator_events",
  "invoices", "invoice_items", "webhook_events", "kv",
] as const;

function migrate(d: DB) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      mission TEXT NOT NULL,
      currency TEXT NOT NULL,
      yaml_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      role_key TEXT NOT NULL,
      title TEXT NOT NULL,
      harness TEXT NOT NULL,
      model TEXT NOT NULL,
      effort TEXT NOT NULL,
      reports_to TEXT NOT NULL,
      tools_json TEXT NOT NULL,
      budget_json TEXT NOT NULL,
      prompt TEXT NOT NULL,
      UNIQUE (company_id, role_key)
    );
    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      card_id TEXT,
      UNIQUE (company_id, owner_type, owner_id)
    );
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      role_id TEXT NOT NULL REFERENCES roles(id),
      role_key TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      wallet_id TEXT NOT NULL REFERENCES wallets(id),
      created_at INTEGER NOT NULL,
      UNIQUE (company_id, name)
    );
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      team_key TEXT NOT NULL,
      lead_role TEXT NOT NULL,
      UNIQUE (company_id, team_key)
    );
    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL REFERENCES teams(id),
      role_key TEXT NOT NULL,
      PRIMARY KEY (team_id, role_key)
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      parent_id TEXT,
      mission_id TEXT,
      key TEXT,
      title TEXT NOT NULL,
      intent TEXT NOT NULL,
      acceptance TEXT NOT NULL,
      owner_role TEXT NOT NULL,
      owner_agent_id TEXT,
      status TEXT NOT NULL DEFAULT 'planned',
      budget_cap INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 3,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_company_status ON tasks(company_id, status);
    CREATE TABLE IF NOT EXISTS task_deps (
      task_id TEXT NOT NULL REFERENCES tasks(id),
      depends_on TEXT NOT NULL REFERENCES tasks(id),
      PRIMARY KEY (task_id, depends_on)
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      task_id TEXT NOT NULL REFERENCES tasks(id),
      agent_id TEXT NOT NULL REFERENCES agents(id),
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cost_minor INTEGER NOT NULL DEFAULT 0,
      turns INTEGER NOT NULL DEFAULT 0,
      state_json TEXT,
      outcome_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_runs_company ON runs(company_id, started_at);
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      seq INTEGER NOT NULL,
      company_id TEXT NOT NULL,
      run_id TEXT,
      agent_id TEXT,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_company_seq ON events(company_id, seq);
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      side_effect TEXT NOT NULL,
      request_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      decided_by TEXT,
      decided_at INTEGER,
      reason TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_approvals_company_status ON approvals(company_id, status);
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      journal_id TEXT NOT NULL,
      account TEXT NOT NULL,
      debit INTEGER NOT NULL DEFAULT 0,
      credit INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'post',
      hold_ref TEXT,
      released INTEGER NOT NULL DEFAULT 0,
      memo TEXT,
      ref TEXT,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries(company_id, account);
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      wallet_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_card_id TEXT,
      last4 TEXT,
      controls_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      run_id TEXT,
      task_id TEXT,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      meta_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      body TEXT NOT NULL,
      read_at INTEGER,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(company_id, to_id, read_at);
    CREATE TABLE IF NOT EXISTS secrets (
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (company_id, name)
    );
    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      body TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS integrations_enabled (
      company_id TEXT NOT NULL,
      integration_id TEXT NOT NULL,
      modes_json TEXT NOT NULL,
      enabled_at INTEGER NOT NULL,
      PRIMARY KEY (company_id, integration_id)
    );
    CREATE TABLE IF NOT EXISTS contacts (
      company_id TEXT NOT NULL,
      address TEXT NOT NULL,
      first_contact_at INTEGER NOT NULL,
      PRIMARY KEY (company_id, address)
    );

    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      title TEXT,
      kind TEXT NOT NULL DEFAULT 'employee',
      monthly_salary_minor INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL,
      telegram_chat_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payroll_runs (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      period TEXT NOT NULL,
      total_minor INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at INTEGER NOT NULL,
      approved_by TEXT,
      approved_at INTEGER,
      paid_at INTEGER,
      UNIQUE (company_id, period)
    );
    CREATE TABLE IF NOT EXISTS payroll_items (
      id TEXT PRIMARY KEY,
      payroll_run_id TEXT NOT NULL REFERENCES payroll_runs(id),
      person_id TEXT NOT NULL REFERENCES people(id),
      gross_minor INTEGER NOT NULL,
      deductions_minor INTEGER NOT NULL DEFAULT 0,
      net_minor INTEGER NOT NULL,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      person_id TEXT,
      agent_id TEXT,
      category TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      description TEXT NOT NULL,
      receipt_ref TEXT,
      status TEXT NOT NULL DEFAULT 'submitted',
      submitted_at INTEGER NOT NULL,
      decided_by TEXT,
      decided_at INTEGER,
      paid_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS time_entries (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      task_id TEXT,
      date TEXT NOT NULL,
      minutes INTEGER NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cash_accounts (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      currency TEXT NOT NULL,
      opening_minor INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cash_txns (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES cash_accounts(id),
      ts INTEGER NOT NULL,
      amount_minor INTEGER NOT NULL,
      counterparty TEXT,
      category TEXT NOT NULL,
      memo TEXT,
      ref TEXT,
      created_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cash_txns_company_ts ON cash_txns(company_id, ts);

    -- creator programme (docs/company/playbooks/ugc-creators.md)
    CREATE TABLE IF NOT EXISTS creators (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      handle TEXT,
      platform TEXT NOT NULL DEFAULT 'tiktok',
      email TEXT,
      code TEXT NOT NULL,
      commission_pct INTEGER NOT NULL DEFAULT 30,
      status TEXT NOT NULL DEFAULT 'active',
      age_confirmed INTEGER NOT NULL DEFAULT 0,
      joined_at INTEGER NOT NULL,
      last_video_at INTEGER,
      notes TEXT,
      UNIQUE (company_id, code)
    );
    CREATE TABLE IF NOT EXISTS creator_events (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      creator_id TEXT NOT NULL REFERENCES creators(id),
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      amount_minor INTEGER NOT NULL DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0,
      ref TEXT,
      memo TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_creator_events ON creator_events(company_id, creator_id, ts);

    -- invoices with Indian GST split (docs/company/erp.md)
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      number TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT,
      customer_gstin TEXT,
      customer_state TEXT,
      place_of_supply TEXT,
      currency TEXT NOT NULL,
      issued_on TEXT NOT NULL,
      due_on TEXT,
      subtotal_minor INTEGER NOT NULL DEFAULT 0,
      cgst_minor INTEGER NOT NULL DEFAULT 0,
      sgst_minor INTEGER NOT NULL DEFAULT 0,
      igst_minor INTEGER NOT NULL DEFAULT 0,
      total_minor INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      notes TEXT,
      payment_link TEXT,
      paid_at INTEGER,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (company_id, number)
    );
    CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      description TEXT NOT NULL,
      hsn_sac TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_minor INTEGER NOT NULL,
      gst_rate INTEGER NOT NULL DEFAULT 18,
      amount_minor INTEGER NOT NULL
    );
    -- inbound webhooks (Stripe, Razorpay): idempotency + audit
    CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      event_id TEXT NOT NULL,
      type TEXT NOT NULL,
      company_id TEXT,
      received_at INTEGER NOT NULL,
      outcome TEXT,
      UNIQUE (provider, event_id)
    );
    -- small per-company key/value store (provider ids such as the Stripe cardholder)
    CREATE TABLE IF NOT EXISTS kv (
      company_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (company_id, key)
    );
  `);
  const expCols = (d.prepare("PRAGMA table_info(expenses)").all() as { name: string }[]).map((c) => c.name);
  if (!expCols.includes("gst_minor")) d.exec("ALTER TABLE expenses ADD COLUMN gst_minor INTEGER NOT NULL DEFAULT 0");
  if (!expCols.includes("vendor_gstin")) d.exec("ALTER TABLE expenses ADD COLUMN vendor_gstin TEXT");
  const cardCols = (d.prepare("PRAGMA table_info(cards)").all() as { name: string }[]).map((c) => c.name);
  if (!cardCols.includes("agent_id")) d.exec("ALTER TABLE cards ADD COLUMN agent_id TEXT");
  const cols = (d.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("assignee_person_id")) d.exec("ALTER TABLE tasks ADD COLUMN assignee_person_id TEXT");
  if (!cols.includes("due_at")) d.exec("ALTER TABLE tasks ADD COLUMN due_at INTEGER");
}

// Small typed helpers so call sites stay readable.
export function one<T>(sql: string, ...params: unknown[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}
export function all<T>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}
export function run(sql: string, ...params: unknown[]): Database.RunResult {
  return getDb().prepare(sql).run(...params);
}
