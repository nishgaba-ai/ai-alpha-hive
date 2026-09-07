// Inbound conversations from messaging channels (WhatsApp, Instagram DMs,
// Messenger, Discord…). Webhooks record here; agents read with the
// channel's `inbox` tool; the board sees them under Inbox → Conversations.
// One table, one shape, so a sales role can answer WhatsApp and Instagram
// the same way. Replies always go out through the channel's own send tool
// (gated), never from here.

import { all, newId, one, run } from "./db.js";
import { emit } from "./bus.js";

export type InboundMessage = {
  id: string;
  company_id: string;
  channel: string;
  /** provider's message id (dedupe key together with channel) */
  external_id: string;
  /** provider's conversation/thread key: WhatsApp wa_id, Instagram thread, Discord channel */
  thread_id: string;
  from_id: string;
  from_name: string | null;
  body: string;
  media_json: string | null;
  ts: number;
  read_at: number | null;
  replied_at: number | null;
};

export type NewInbound = {
  channel: string;
  external_id: string;
  thread_id: string;
  from_id: string;
  from_name?: string;
  body: string;
  media?: unknown;
  ts?: number;
};

/** Record once; a webhook retry with the same provider id is ignored. Returns the row or undefined when it was a duplicate. */
export function recordInbound(companyId: string, m: NewInbound): InboundMessage | undefined {
  const dup = one("SELECT 1 FROM inbound_messages WHERE company_id = ? AND channel = ? AND external_id = ?", companyId, m.channel, m.external_id);
  if (dup) return undefined;
  const id = newId();
  run(
    "INSERT INTO inbound_messages (id, company_id, channel, external_id, thread_id, from_id, from_name, body, media_json, ts) VALUES (?,?,?,?,?,?,?,?,?,?)",
    id, companyId, m.channel, m.external_id, m.thread_id, m.from_id, m.from_name ?? null, m.body.slice(0, 8000), m.media ? JSON.stringify(m.media) : null, m.ts ?? Date.now(),
  );
  emit(companyId, "inbound.message", { channel: m.channel, thread_id: m.thread_id, from: m.from_name ?? m.from_id, preview: m.body.slice(0, 200), message_id: id });
  return one<InboundMessage>("SELECT * FROM inbound_messages WHERE id = ?", id);
}

export function listInbound(companyId: string, opts: { channel?: string; thread_id?: string; unread?: boolean; since?: number; limit?: number } = {}): InboundMessage[] {
  const where = ["company_id = ?"];
  const vals: unknown[] = [companyId];
  if (opts.channel) { where.push("channel = ?"); vals.push(opts.channel); }
  if (opts.thread_id) { where.push("thread_id = ?"); vals.push(opts.thread_id); }
  if (opts.unread) where.push("read_at IS NULL");
  if (opts.since) { where.push("ts > ?"); vals.push(opts.since); }
  vals.push(Math.min(Math.max(opts.limit ?? 50, 1), 500));
  return all<InboundMessage>(`SELECT * FROM inbound_messages WHERE ${where.join(" AND ")} ORDER BY ts DESC LIMIT ?`, ...vals);
}

/** Threads with their latest message, for the board's Conversations view. */
export function threads(companyId: string, channel?: string, limit = 50) {
  const rows = channel
    ? all<InboundMessage>("SELECT * FROM inbound_messages WHERE company_id = ? AND channel = ? ORDER BY ts DESC LIMIT 1000", companyId, channel)
    : all<InboundMessage>("SELECT * FROM inbound_messages WHERE company_id = ? ORDER BY ts DESC LIMIT 1000", companyId);
  const seen = new Map<string, InboundMessage & { count: number; unread: number }>();
  for (const r of rows) {
    const k = `${r.channel}:${r.thread_id}`;
    const t = seen.get(k);
    if (t) { t.count++; if (!r.read_at) t.unread++; }
    else seen.set(k, { ...r, count: 1, unread: r.read_at ? 0 : 1 });
  }
  return [...seen.values()].slice(0, limit);
}

export function markRead(companyId: string, ids: string[] | { channel: string; thread_id: string }): number {
  if (Array.isArray(ids)) {
    if (!ids.length) return 0;
    return run(`UPDATE inbound_messages SET read_at = ? WHERE company_id = ? AND read_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`, Date.now(), companyId, ...ids).changes;
  }
  return run("UPDATE inbound_messages SET read_at = ? WHERE company_id = ? AND channel = ? AND thread_id = ? AND read_at IS NULL", Date.now(), companyId, ids.channel, ids.thread_id).changes;
}

export function markReplied(companyId: string, channel: string, threadId: string): void {
  run("UPDATE inbound_messages SET replied_at = ? WHERE company_id = ? AND channel = ? AND thread_id = ? AND replied_at IS NULL", Date.now(), companyId, channel, threadId);
}
