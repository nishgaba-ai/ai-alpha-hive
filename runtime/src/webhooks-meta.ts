// Meta webhook (WhatsApp Cloud API, Instagram messaging, Messenger).
//   GET  /api/webhooks/meta/<slug>   verification handshake: hub.mode=subscribe,
//                                    hub.verify_token must equal the vault's
//                                    META_WEBHOOK_VERIFY_TOKEN; answer hub.challenge
//   POST /api/webhooks/meta/<slug>   X-Hub-Signature-256 = sha256 HMAC of the raw
//                                    body with the app secret; inbound messages
//                                    are recorded once in inbound_messages
// The same endpoint serves every Meta product the company enabled; the app
// secret is whichever of WHATSAPP_APP_SECRET / META_CLIENT_SECRET /
// INSTAGRAM_CLIENT_SECRET verifies the signature.

import { createHmac, timingSafeEqual } from "node:crypto";
import { recordInbound, type NewInbound } from "./inbound.js";
import { emit } from "./bus.js";
import type { SecretResolver } from "./types.js";

const SECRET_NAMES = ["WHATSAPP_APP_SECRET", "META_CLIENT_SECRET", "INSTAGRAM_CLIENT_SECRET"] as const;

export function verifyMetaSignature(rawBody: string, header: string | undefined, secrets: SecretResolver): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice(7), "hex");
  for (const name of SECRET_NAMES) {
    const secret = secrets.get(name);
    if (!secret) continue;
    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

/** GET handshake. Returns the challenge to echo, or null when the token does not match. */
export function verifySubscription(query: URLSearchParams, secrets: SecretResolver): string | null {
  const token = secrets.get("META_WEBHOOK_VERIFY_TOKEN");
  if (!token) return null;
  if (query.get("hub.mode") !== "subscribe") return null;
  if (query.get("hub.verify_token") !== token) return null;
  return query.get("hub.challenge") ?? "";
}

type WaMessage = {
  id: string; from: string; timestamp?: string; type: string;
  text?: { body: string }; image?: { id: string; caption?: string; mime_type?: string }; video?: { id: string; caption?: string }; audio?: { id: string; mime_type?: string };
  document?: { id: string; filename?: string; caption?: string }; location?: { latitude: number; longitude: number; name?: string }; button?: { text: string }; interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
};
type WaValue = { messaging_product?: string; metadata?: { phone_number_id?: string }; contacts?: { wa_id: string; profile?: { name?: string } }[]; messages?: WaMessage[]; statuses?: { id: string; status: string; recipient_id: string }[] };
type Entry = { id: string; changes?: { field: string; value: WaValue }[]; messaging?: MessagingEvent[] };
type MessagingEvent = { sender: { id: string }; recipient: { id: string }; timestamp: number; message?: { mid: string; text?: string; attachments?: { type: string; payload?: { url?: string } }[]; is_echo?: boolean } };
export type MetaPayload = { object: string; entry: Entry[] };

function waBody(m: WaMessage): string {
  switch (m.type) {
    case "text": return m.text?.body ?? "";
    case "image": return `[image${m.image?.caption ? `: ${m.image.caption}` : ""}]`;
    case "video": return `[video${m.video?.caption ? `: ${m.video.caption}` : ""}]`;
    case "audio": return "[voice note]";
    case "document": return `[document ${m.document?.filename ?? ""}${m.document?.caption ? `: ${m.document.caption}` : ""}]`;
    case "location": return `[location ${m.location?.latitude},${m.location?.longitude}${m.location?.name ? ` ${m.location.name}` : ""}]`;
    case "button": return m.button?.text ?? "[button]";
    case "interactive": return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "[interactive]";
    default: return `[${m.type}]`;
  }
}

/** Pure: turn a Meta payload into inbound rows (statuses and echoes are dropped). */
export function extractInbound(payload: MetaPayload): NewInbound[] {
  const out: NewInbound[] = [];
  for (const entry of payload.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field !== "messages" || !ch.value?.messages) continue;
      const names = new Map((ch.value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of ch.value.messages) {
        const media = m.image ?? m.video ?? m.audio ?? m.document ?? m.location;
        out.push({ channel: "whatsapp", external_id: m.id, thread_id: m.from, from_id: m.from, from_name: names.get(m.from) ?? undefined, body: waBody(m), media: media ? { type: m.type, ...media } : undefined, ts: m.timestamp ? Number(m.timestamp) * 1000 : Date.now() });
      }
    }
    for (const ev of entry.messaging ?? []) {
      if (!ev.message || ev.message.is_echo) continue;
      const channel = payload.object === "instagram" ? "instagram" : "messenger";
      const attachments = ev.message.attachments ?? [];
      const body = ev.message.text ?? (attachments.length ? attachments.map((a) => `[${a.type}${a.payload?.url ? ` ${a.payload.url}` : ""}]`).join(" ") : "[message]");
      out.push({ channel, external_id: ev.message.mid, thread_id: ev.sender.id, from_id: ev.sender.id, body, media: attachments.length ? attachments : undefined, ts: ev.timestamp || Date.now() });
    }
  }
  return out;
}

export function handleMetaWebhook(companyId: string, secrets: SecretResolver, rawBody: string, signature: string | undefined): { status: number; body: Record<string, unknown> } {
  if (!SECRET_NAMES.some((n) => secrets.get(n))) return { status: 400, body: { error: "no Meta app secret in the vault (WHATSAPP_APP_SECRET, META_CLIENT_SECRET or INSTAGRAM_CLIENT_SECRET)" } };
  if (!verifyMetaSignature(rawBody, signature, secrets)) return { status: 401, body: { error: "bad signature" } };
  let payload: MetaPayload;
  try {
    payload = JSON.parse(rawBody) as MetaPayload;
  } catch {
    return { status: 400, body: { error: "bad json" } };
  }
  const rows = extractInbound(payload);
  let recorded = 0;
  for (const r of rows) if (recordInbound(companyId, r)) recorded++;
  const statuses = (payload.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => c.value?.statuses ?? []));
  for (const s of statuses) emit(companyId, "outbound.status", { channel: "whatsapp", message_id: s.id, status: s.status, to: s.recipient_id });
  return { status: 200, body: { received: true, messages: recorded, statuses: statuses.length } };
}
