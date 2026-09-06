// Server-side client for the company runtime API (runtime/src/server.ts).
// The browser never talks to the worker directly: client components go
// through /api/hive/* which adds the token and checks the session.

export const HIVE_URL = (process.env.HIVE_API_URL ?? "http://localhost:4700").replace(/\/$/, "");

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", ...extra };
  if (process.env.HIVE_API_TOKEN) h.Authorization = `Bearer ${process.env.HIVE_API_TOKEN}`;
  return h;
}

export class HiveError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function hive<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${HIVE_URL}${path}`, { ...init, headers: headers(init.headers as Record<string, string>), cache: "no-store" });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* text */
  }
  if (!res.ok) throw new HiveError(res.status, (body as { error?: string })?.error ?? `HTTP ${res.status}`);
  return body as T;
}

/** Null instead of throwing, for pages that must render when the worker is down. */
export async function hiveOr<T>(path: string, fallback: T): Promise<T> {
  try {
    return await hive<T>(path);
  } catch {
    return fallback;
  }
}

export async function workerUp(): Promise<boolean> {
  try {
    await hive("/api/health");
    return true;
  } catch {
    return false;
  }
}

export function money(minor: number | null | undefined, currency = "INR"): string {
  const n = (minor ?? 0) / 100;
  const sym = currency === "INR" ? "₹" : currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : currency + " ";
  return sym + n.toLocaleString("en-IN", { maximumFractionDigits: n % 1 ? 2 : 0 });
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// Shapes returned by the runtime API (subset the UI reads).
export type CompanySummary = {
  id: string; slug: string; name: string; mission: string; currency: string; status: string;
  agents: number; running: number; inflight: number; tasks: Record<string, number>; pending_approvals: number;
  cost_minor: number; available_minor: number; monthly_cap: number;
  roles: { id: string; title: string; model?: string; harness: string }[]; integrations: string[]; yaml_hash: string;
};
export type GraphNode = { id: string; type: "board" | "agent"; data: Record<string, unknown> };
export type Graph = { nodes: GraphNode[]; edges: { id: string; source: string; target: string; kind?: string }[]; teams: { id: string; lead: string; members: string[] }[] };
export type Approval = {
  id: string; run_id: string; agent_id: string; agent_name: string; role_key: string; tool: string; side_effect: string; status: string; created_at: number;
  request: { input?: Record<string, unknown>; reason?: string; amount?: number; task?: string }; wallet_available_minor: number; decided_by?: string; decided_at?: number; reason?: string;
};
export type HiveEvent = { id: string; seq: number; run_id: string | null; agent_id: string | null; ts: number; type: string; payload: Record<string, unknown> };
export type Task = { id: string; key: string | null; title: string; intent: string; acceptance: string; owner_role: string; status: string; budget_cap: number; priority: number; notes: string | null; mission_id: string | null; created_at: number; updated_at: number; assignee_person_id?: string | null; due_at?: number | null };
export type Template = { id: string; name: string; mission: string; roles: { id: string; title: string }[]; integrations: string[]; blurb: string; currency: string; monthly_cap: number };

/** Sentence case for names the runtime keys by role ("ceo" → "Ceo", "writer-2" → "Writer 2"); a role title wins when the name is just the role key. */
export function displayName(name: string, title?: string | null, roleKey?: string | null): string {
  if (title && (name === roleKey || name === title.toLowerCase())) return title;
  const m = /^([a-z][a-z-]*?)-(\d+)$/.exec(name);
  if (m && title && m[1] === roleKey) return `${title} ${m[2]}`;
  const words = name.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function sentence(s: string): string {
  const t = s.replace(/[-_]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
