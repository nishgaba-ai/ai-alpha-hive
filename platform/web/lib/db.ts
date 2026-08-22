import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { hashSync } from "@node-rs/argon2";
import { newId } from "./ids";

// SQLite-first (decision 2026-08-20): single-writer on one box, file under
// DATA_DIR (a docker volume in production). Schema mirrors
// docs/specs/login-rbac.md §3; Postgres migration stays mechanical.

let db: Database.Database | null = null;

// argon2id parameters per spec §4
export const ARGON2 = { memoryCost: 65536, timeCost: 3, parallelism: 4 } as const;

export function getDb(): Database.Database {
  if (db) return db;
  const dir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, "hive.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seedBootstrapAdmin(db);
  return db;
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email_verified_at INTEGER,
      password_hash TEXT NOT NULL,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memberships (
      user_id TEXT NOT NULL REFERENCES users(id),
      org_id TEXT NOT NULL REFERENCES orgs(id),
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, org_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      org_id TEXT NOT NULL REFERENCES orgs(id),
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      ip TEXT,
      user_agent TEXT
    );
    CREATE TABLE IF NOT EXISTS tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      email TEXT NOT NULL COLLATE NOCASE,
      ip TEXT,
      success INTEGER NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_login_attempts_email_ts ON login_attempts(email, ts);
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      target TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      url TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      UNIQUE (org_id, slug)
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      actor_id TEXT,
      org_id TEXT,
      action TEXT NOT NULL,
      resource TEXT,
      meta TEXT,
      ip TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_org_ts ON audit_events(org_id, ts);
  `);
}

// The bootstrap preset's env credential becomes the first real user, so the
// existing admin login keeps working after the upgrade to the DB store.
function seedBootstrapAdmin(d: Database.Database) {
  const count = (d.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (count > 0 || !email || !password) return;
  const now = Date.now();
  const userId = newId();
  const orgId = newId();
  const tx = d.transaction(() => {
    d.prepare(
      "INSERT INTO users (id, email, email_verified_at, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(userId, email.toLowerCase(), now, hashSync(password, ARGON2), "Admin", now);
    d.prepare("INSERT INTO orgs (id, name, slug, created_at) VALUES (?, ?, ?, ?)").run(
      orgId, "Personal", "personal-" + userId.slice(0, 8), now,
    );
    d.prepare(
      "INSERT INTO memberships (user_id, org_id, role, created_at) VALUES (?, ?, 'owner', ?)",
    ).run(userId, orgId, now);
    d.prepare(
      "INSERT INTO audit_events (id, ts, actor_id, org_id, action, resource) VALUES (?, ?, ?, ?, 'user.bootstrap', ?)",
    ).run(newId(), now, userId, orgId, "user:" + userId);
  });
  tx();
}
