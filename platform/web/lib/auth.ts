import { createHash, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { ARGON2, getDb } from "./db";
import { newId, newSecret } from "./ids";
import { audit } from "./audit";
import { sendEmail, emailConfigured } from "./email";
import type { Role } from "./rbac";

// Standard preset of the Login/RBAC library (docs/specs/login-rbac.md):
// argon2id passwords, DB-backed revocable sessions, single-use hashed
// tokens, lockout, uniform errors.

const COOKIE = "hive_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // absolute 14d (spec §6)
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_FAILS = 10;
const MIN_PASSWORD = 10;

export type Session = {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  orgId: string;
  orgName: string;
  role: Role;
  emailVerified: boolean;
};

type UserRow = {
  id: string;
  email: string;
  email_verified_at: number | null;
  password_hash: string;
  name: string | null;
  status: string;
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function siteUrl(): string {
  return process.env.SITE_URL ?? "http://localhost:3000";
}

async function requestMeta(): Promise<{ ip: string | null; ua: string | null }> {
  const h = await headers();
  return {
    ip: h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    ua: h.get("user-agent"),
  };
}

export function validatePassword(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  return null;
}

// ---------- registration ----------

export async function registerUser(
  email: string,
  password: string,
  name: string,
): Promise<{ ok: true; needsVerification: boolean } | { ok: false; error: string }> {
  email = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Enter a valid email." };
  const pwErr = validatePassword(password);
  if (pwErr) return { ok: false, error: pwErr };

  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  // uniform response on duplicates (spec §11: no enumeration) — we still
  // stop here, the UI says "check your email" either way
  if (existing) return { ok: true, needsVerification: true };

  const now = Date.now();
  const userId = newId();
  const orgId = newId();
  const verifyNow = !emailConfigured();
  const passwordHash = await argonHash(password, ARGON2);
  const { ip } = await requestMeta();

  db.transaction(() => {
    db.prepare(
      "INSERT INTO users (id, email, email_verified_at, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(userId, email, verifyNow ? now : null, passwordHash, name.trim() || null, now);
    db.prepare("INSERT INTO orgs (id, name, slug, created_at) VALUES (?, ?, ?, ?)").run(
      orgId, "Personal", "personal-" + userId.slice(0, 8), now,
    );
    db.prepare(
      "INSERT INTO memberships (user_id, org_id, role, created_at) VALUES (?, ?, 'owner', ?)",
    ).run(userId, orgId, now);
  })();
  audit("user.register", { actorId: userId, orgId, resource: "user:" + userId, ip });

  if (!verifyNow) {
    const token = issueToken(userId, "verify", 24 * 60 * 60 * 1000);
    await sendEmail({
      to: email,
      subject: "Verify your email — Nish Alpha Hive",
      text: `Confirm your account: ${siteUrl()}/verify?token=${token}\n\nThis link expires in 24 hours.`,
    });
  }
  return { ok: true, needsVerification: !verifyNow };
}

// ---------- login / lockout ----------

function lockedOut(email: string): boolean {
  const since = Date.now() - LOCKOUT_WINDOW_MS;
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND success = 0 AND ts > ?")
    .get(email, since) as { n: number };
  return row.n >= LOCKOUT_FAILS;
}

export async function loginUser(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  email = email.trim().toLowerCase();
  const db = getDb();
  const { ip, ua } = await requestMeta();
  const fail = (reason: string) => {
    db.prepare("INSERT INTO login_attempts (email, ip, success, ts) VALUES (?, ?, 0, ?)").run(email, ip, Date.now());
    audit("login.failed", { resource: "email:" + sha256(email).slice(0, 12), meta: { reason }, ip });
    return { ok: false as const, error: "Invalid credentials." };
  };

  if (lockedOut(email)) return fail("locked");

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
  // always run a verify so timing doesn't reveal whether the email exists
  const verified = await argonVerify(
    user?.password_hash ?? "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    password,
  ).catch(() => false);
  if (!user || !verified || user.status !== "active") return fail("bad-credentials");
  if (!user.email_verified_at) return { ok: false, error: "Verify your email first — check your inbox." };

  const membership = db
    .prepare("SELECT org_id, role FROM memberships WHERE user_id = ? AND status = 'active' ORDER BY created_at LIMIT 1")
    .get(user.id) as { org_id: string; role: Role } | undefined;
  if (!membership) return fail("no-org");

  db.prepare("INSERT INTO login_attempts (email, ip, success, ts) VALUES (?, ?, 1, ?)").run(email, ip, Date.now());
  await createSession(user.id, membership.org_id, ip, ua);
  audit("login.success", { actorId: user.id, orgId: membership.org_id, ip });
  return { ok: true };
}

// ---------- sessions ----------

async function createSession(userId: string, orgId: string, ip: string | null, ua: string | null) {
  const id = newSecret();
  const now = Date.now();
  getDb()
    .prepare(
      "INSERT INTO sessions (id, user_id, org_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(sha256(id), userId, orgId, now, now, now + SESSION_TTL_MS, ip, ua);
  (await cookies()).set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: siteUrl().startsWith("https"),
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const row = getDb()
    .prepare(
      `SELECT s.id, s.user_id, s.org_id, s.expires_at, s.revoked_at, s.last_seen_at,
              u.email, u.name, u.email_verified_at, u.status,
              o.name AS org_name, m.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN orgs o ON o.id = s.org_id
         JOIN memberships m ON m.user_id = s.user_id AND m.org_id = s.org_id
        WHERE s.id = ?`,
    )
    .get(sha256(raw)) as
    | {
        id: string; user_id: string; org_id: string; expires_at: number; revoked_at: number | null;
        last_seen_at: number; email: string; name: string | null; email_verified_at: number | null;
        status: string; org_name: string; role: Role;
      }
    | undefined;
  if (!row || row.revoked_at || row.expires_at < Date.now() || row.status !== "active") return null;
  if (Date.now() - row.last_seen_at > 60_000) {
    getDb().prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(Date.now(), row.id);
  }
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    orgId: row.org_id,
    orgName: row.org_name,
    role: row.role,
    emailVerified: Boolean(row.email_verified_at),
  };
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (raw) {
    const hashed = sha256(raw);
    const row = getDb().prepare("SELECT user_id, org_id FROM sessions WHERE id = ?").get(hashed) as
      | { user_id: string; org_id: string }
      | undefined;
    getDb().prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(Date.now(), hashed);
    if (row) audit("session.revoke", { actorId: row.user_id, orgId: row.org_id, resource: "session:self" });
  }
  jar.delete(COOKIE);
}

export function revokeAllSessions(userId: string): void {
  getDb().prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(Date.now(), userId);
}

export function listSessions(userId: string) {
  return getDb()
    .prepare(
      "SELECT id, created_at, last_seen_at, ip, user_agent FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC",
    )
    .all(userId, Date.now()) as { id: string; created_at: number; last_seen_at: number; ip: string | null; user_agent: string | null }[];
}

// ---------- one-time tokens (verify / reset) ----------

function issueToken(userId: string, kind: "verify" | "reset", ttlMs: number): string {
  const raw = newSecret();
  getDb()
    .prepare("INSERT INTO tokens (id, user_id, kind, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(newId(), userId, kind, sha256(raw), Date.now() + ttlMs);
  return raw;
}

function consumeToken(kind: "verify" | "reset", raw: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT id, user_id, expires_at, used_at FROM tokens WHERE kind = ? AND token_hash = ?")
    .get(kind, sha256(raw)) as { id: string; user_id: string; expires_at: number; used_at: number | null } | undefined;
  if (!row || row.used_at || row.expires_at < Date.now()) return null;
  const res = db.prepare("UPDATE tokens SET used_at = ? WHERE id = ? AND used_at IS NULL").run(Date.now(), row.id);
  return res.changes === 1 ? row.user_id : null; // single-use, race-safe
}

export function verifyEmailToken(raw: string): boolean {
  const userId = consumeToken("verify", raw);
  if (!userId) return false;
  getDb().prepare("UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL").run(Date.now(), userId);
  audit("email.verified", { actorId: userId, resource: "user:" + userId });
  return true;
}

export async function requestPasswordReset(email: string): Promise<void> {
  email = email.trim().toLowerCase();
  const user = getDb().prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
  if (!user) return; // uniform: caller always says "if an account exists, we emailed it"
  const token = issueToken(user.id, "reset", 30 * 60 * 1000);
  audit("password.reset.requested", { actorId: user.id, resource: "user:" + user.id });
  await sendEmail({
    to: email,
    subject: "Reset your password — Nish Alpha Hive",
    text: `Reset your password: ${siteUrl()}/reset?token=${token}\n\nThis link expires in 30 minutes and works once.`,
  });
}

export async function resetPassword(raw: string, password: string): Promise<string | null> {
  const pwErr = validatePassword(password);
  if (pwErr) return pwErr;
  const userId = consumeToken("reset", raw);
  if (!userId) return "This reset link is invalid or has expired.";
  const passwordHash = await argonHash(password, ARGON2);
  getDb().prepare("UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?").run(passwordHash, Date.now(), userId);
  revokeAllSessions(userId); // spec §5: reset revokes every session
  audit("password.reset", { actorId: userId, resource: "user:" + userId });
  return null;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
