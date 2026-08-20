import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// Bootstrap preset of the Login/RBAC library (docs/specs/login-rbac.md §14):
// single admin credential from env, HMAC-signed server-verified session
// cookie. Stage B replaces the credential store with argon2id + SQLite users
// — the session and guard surface stay identical.

const COOKIE = "hive_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error("AUTH_SECRET missing or too short (set it in .env.deploy)");
  }
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  // hash both sides first: constant-time compare requires equal lengths,
  // and this leaks neither content nor length
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function verifyCredentials(email: string, password: string): boolean {
  const wantEmail = process.env.ADMIN_EMAIL ?? "";
  const wantPassword = process.env.ADMIN_PASSWORD ?? "";
  if (!wantEmail || !wantPassword) return false;
  // evaluate both to keep timing uniform regardless of which field is wrong
  const emailOk = safeEqual(email.trim().toLowerCase(), wantEmail.toLowerCase());
  const passOk = safeEqual(password, wantPassword);
  return emailOk && passOk;
}

export async function createSession(email: string): Promise<void> {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${email}|${exp}`;
  const token = Buffer.from(payload).toString("base64url") + "." + sign(payload);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.SITE_URL ?? "").startsWith("https"),
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function getSession(): Promise<{ email: string } | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = Buffer.from(raw.slice(0, dot), "base64url").toString();
  const mac = raw.slice(dot + 1);
  if (!safeEqual(mac, sign(payload))) return null;
  const sep = payload.lastIndexOf("|");
  const email = payload.slice(0, sep);
  const exp = Number(payload.slice(sep + 1));
  if (!email || !Number.isFinite(exp) || Date.now() > exp) return null;
  return { email };
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
