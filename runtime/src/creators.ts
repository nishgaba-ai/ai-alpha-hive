// Creator programme: roster, referral codes, attributed events (videos,
// signups, revenue), commission owed, payouts as board-paid expenses.
// The offer (commission %, daily video, no ads) lives in company.yaml and
// the kit; this module only records and computes.

import { all, getDb, newId, one, run } from "./db.js";
import { emit } from "./bus.js";
import { submitExpense } from "./erp.js";

export type Creator = {
  id: string; company_id: string; name: string; handle: string | null; platform: string; email: string | null; code: string;
  commission_pct: number; status: "active" | "inactive" | "churned"; age_confirmed: number; joined_at: number; last_video_at: number | null; notes: string | null;
};
export type CreatorEvent = { id: string; company_id: string; creator_id: string; ts: number; kind: "video" | "signup" | "revenue" | "payout"; amount_minor: number; views: number; ref: string | null; memo: string | null };

function makeCode(name: string, companyId: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "creator";
  for (let i = 0; i < 50; i++) {
    const code = i === 0 ? base : `${base}${i + 1}`;
    if (!one("SELECT 1 FROM creators WHERE company_id = ? AND code = ?", companyId, code)) return code;
  }
  return `${base}${Date.now().toString(36)}`;
}

export function creators(companyId: string, status?: string): Creator[] {
  return status
    ? all<Creator>("SELECT * FROM creators WHERE company_id = ? AND status = ? ORDER BY joined_at DESC", companyId, status)
    : all<Creator>("SELECT * FROM creators WHERE company_id = ? ORDER BY joined_at DESC", companyId);
}

export function addCreator(companyId: string, c: { name: string; handle?: string; platform?: string; email?: string; commission_pct?: number; age_confirmed: boolean; notes?: string }): Creator {
  if (!c.age_confirmed) throw new Error("age must be confirmed (18+) before a creator joins");
  const id = newId();
  const code = makeCode(c.name, companyId);
  run(
    "INSERT INTO creators (id, company_id, name, handle, platform, email, code, commission_pct, status, age_confirmed, joined_at, notes) VALUES (?,?,?,?,?,?,?,?,'active',1,?,?)",
    id, companyId, c.name, c.handle ?? null, c.platform ?? "tiktok", c.email ?? null, code, c.commission_pct ?? 30, Date.now(), c.notes ?? null,
  );
  emit(companyId, "creator.joined", { creator_id: id, name: c.name, code });
  return one<Creator>("SELECT * FROM creators WHERE id = ?", id)!;
}

export function updateCreator(companyId: string, id: string, patch: Partial<Pick<Creator, "status" | "notes" | "handle" | "email" | "platform">>): void {
  const sets: string[] = []; const vals: unknown[] = [];
  for (const k of ["status", "notes", "handle", "email", "platform"] as const) if (patch[k] !== undefined) { sets.push(`${k} = ?`); vals.push(patch[k]); }
  if (!sets.length) return;
  run(`UPDATE creators SET ${sets.join(", ")} WHERE company_id = ? AND id = ?`, ...vals, companyId, id);
}

/** Record a video, signup or revenue against a creator (by id or code). */
export function recordEvent(companyId: string, ref: { creator_id?: string; code?: string }, e: { kind: CreatorEvent["kind"]; amount_minor?: number; views?: number; ref?: string; memo?: string; ts?: number }): CreatorEvent {
  const c = ref.creator_id
    ? one<Creator>("SELECT * FROM creators WHERE company_id = ? AND id = ?", companyId, ref.creator_id)
    : one<Creator>("SELECT * FROM creators WHERE company_id = ? AND code = ?", companyId, String(ref.code).toLowerCase());
  if (!c) throw new Error("no such creator");
  const id = newId();
  const ts = e.ts ?? Date.now();
  run("INSERT INTO creator_events (id, company_id, creator_id, ts, kind, amount_minor, views, ref, memo) VALUES (?,?,?,?,?,?,?,?,?)",
    id, companyId, c.id, ts, e.kind, e.amount_minor ?? 0, e.views ?? 0, e.ref ?? null, e.memo ?? null);
  if (e.kind === "video") run("UPDATE creators SET last_video_at = ? WHERE id = ?", ts, c.id);
  emit(companyId, `creator.${e.kind}`, { creator_id: c.id, code: c.code, amount_minor: e.amount_minor ?? 0, views: e.views ?? 0 });
  return one<CreatorEvent>("SELECT * FROM creator_events WHERE id = ?", id)!;
}

export type CreatorStats = Creator & { videos: number; views: number; signups: number; revenue_minor: number; commission_minor: number; paid_minor: number; owed_minor: number; active: boolean };

export function stats(companyId: string, period?: string): CreatorStats[] {
  const [from, to] = period ? periodRange(period) : [0, Number.MAX_SAFE_INTEGER];
  const threeDays = Date.now() - 3 * 86400000;
  return creators(companyId).map((c) => {
    const agg = one<{ videos: number; views: number; signups: number; revenue: number; paid: number }>(
      `SELECT SUM(kind='video') AS videos, COALESCE(SUM(views),0) AS views, SUM(kind='signup') AS signups,
              COALESCE(SUM(CASE WHEN kind='revenue' THEN amount_minor END),0) AS revenue,
              COALESCE(SUM(CASE WHEN kind='payout' THEN amount_minor END),0) AS paid
       FROM creator_events WHERE company_id = ? AND creator_id = ? AND ts >= ? AND ts < ?`, companyId, c.id, from, to)!;
    const commission = Math.round((agg.revenue ?? 0) * c.commission_pct / 100);
    return { ...c, videos: agg.videos ?? 0, views: agg.views ?? 0, signups: agg.signups ?? 0, revenue_minor: agg.revenue ?? 0, commission_minor: commission, paid_minor: agg.paid ?? 0, owed_minor: Math.max(0, commission - (agg.paid ?? 0)), active: (c.last_video_at ?? 0) >= threeDays };
  });
}

export function summary(companyId: string) {
  const s = stats(companyId);
  const total = (k: keyof CreatorStats) => s.reduce((a, c) => a + Number(c[k] ?? 0), 0);
  return { creators: s.length, active: s.filter((c) => c.active).length, videos: total("videos"), views: total("views"), signups: total("signups"), revenue_minor: total("revenue_minor"), commission_minor: total("commission_minor"), owed_minor: total("owed_minor") };
}

/** File the commission owed as an expense for the board to approve and pay from cash; records the payout once paid via ERP hooks. */
export function requestPayout(companyId: string, creatorId: string, by: string): { expense_id: string; amount_minor: number } {
  const c = stats(companyId).find((x) => x.id === creatorId);
  if (!c) throw new Error("no such creator");
  if (c.owed_minor <= 0) throw new Error("nothing owed");
  const currency = one<{ currency: string }>("SELECT currency FROM companies WHERE id = ?", companyId)!.currency;
  const e = submitExpense(companyId, { category: "creator-commission", amount_minor: c.owed_minor, currency, description: `Commission · ${c.name} (${c.code})`, receipt_ref: `creator:${c.id}` });
  recordEvent(companyId, { creator_id: c.id }, { kind: "payout", amount_minor: c.owed_minor, ref: e.id, memo: `requested by ${by}` });
  return { expense_id: e.id, amount_minor: c.owed_minor };
}

function periodRange(period: string): [number, number] {
  const [y, m] = period.split("-").map(Number);
  return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)];
}

export { getDb };
