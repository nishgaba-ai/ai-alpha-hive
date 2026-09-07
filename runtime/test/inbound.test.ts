// Inbound conversations: the Meta webhook (verification, signature,
// WhatsApp / Instagram / Messenger parsing, dedupe) and the contacts rule
// the gate uses for first contact vs reply.

import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { openMemoryDb } from "../src/db.js";
import { extractInbound, handleMetaWebhook, verifyMetaSignature, verifySubscription } from "../src/webhooks-meta.js";
import { listInbound, markRead, recordInbound, threads } from "../src/inbound.js";
import { knownContact, rememberContact } from "../src/contacts.js";
import type { SecretResolver } from "../src/types.js";

const secretsWith = (m: Record<string, string>): SecretResolver => ({ get: (n) => m[n], names: () => Object.keys(m) });
const CID = "01TESTCOMPANY";

describe("inbound conversations", () => {
  beforeAll(() => {
    openMemoryDb();
  });

  it("verifies the subscription handshake only with the stored token", () => {
    const s = secretsWith({ META_WEBHOOK_VERIFY_TOKEN: "hive-verify-123" });
    expect(verifySubscription(new URLSearchParams("hub.mode=subscribe&hub.verify_token=hive-verify-123&hub.challenge=42"), s)).toBe("42");
    expect(verifySubscription(new URLSearchParams("hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42"), s)).toBeNull();
    expect(verifySubscription(new URLSearchParams("hub.mode=subscribe&hub.verify_token=hive-verify-123"), secretsWith({}))).toBeNull();
  });

  it("checks X-Hub-Signature-256 against any Meta app secret in the vault", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const sig = "sha256=" + createHmac("sha256", "app-secret").update(body).digest("hex");
    expect(verifyMetaSignature(body, sig, secretsWith({ WHATSAPP_APP_SECRET: "app-secret" }))).toBe(true);
    expect(verifyMetaSignature(body, sig, secretsWith({ META_CLIENT_SECRET: "app-secret" }))).toBe(true);
    expect(verifyMetaSignature(body, sig, secretsWith({ META_CLIENT_SECRET: "other" }))).toBe(false);
    expect(verifyMetaSignature(body, "sha256=00", secretsWith({ WHATSAPP_APP_SECRET: "app-secret" }))).toBe(false);
    expect(verifyMetaSignature(body, undefined, secretsWith({ WHATSAPP_APP_SECRET: "app-secret" }))).toBe(false);
  });

  it("parses WhatsApp, Instagram and Messenger payloads and drops statuses and echoes", () => {
    const wa = extractInbound({
      object: "whatsapp_business_account",
      entry: [{ id: "waba", changes: [{ field: "messages", value: { contacts: [{ wa_id: "919999999999", profile: { name: "Asha" } }], messages: [
        { id: "wamid.1", from: "919999999999", timestamp: "1700000000", type: "text", text: { body: "Hi, is the 2BHK still available?" } },
        { id: "wamid.2", from: "919999999999", timestamp: "1700000001", type: "image", image: { id: "m1", caption: "site photo" } },
      ], statuses: [{ id: "wamid.out", status: "delivered", recipient_id: "919999999999" }] } }] }],
    });
    expect(wa.length).toBe(2);
    expect(wa[0]).toMatchObject({ channel: "whatsapp", external_id: "wamid.1", thread_id: "919999999999", from_name: "Asha", ts: 1700000000000 });
    expect(wa[1].body).toBe("[image: site photo]");
    const ig = extractInbound({ object: "instagram", entry: [{ id: "page", messaging: [
      { sender: { id: "u1" }, recipient: { id: "page" }, timestamp: 1700000002000, message: { mid: "m.1", text: "love the reel" } },
      { sender: { id: "page" }, recipient: { id: "u1" }, timestamp: 1700000003000, message: { mid: "m.2", text: "thanks", is_echo: true } },
    ] }] });
    expect(ig.length).toBe(1);
    expect(ig[0]).toMatchObject({ channel: "instagram", thread_id: "u1", body: "love the reel" });
    const fb = extractInbound({ object: "page", entry: [{ id: "page", messaging: [{ sender: { id: "u2" }, recipient: { id: "page" }, timestamp: 1, message: { mid: "m.3", attachments: [{ type: "image", payload: { url: "https://x/y.jpg" } }] } }] }] });
    expect(fb[0].channel).toBe("messenger");
    expect(fb[0].body).toContain("[image");
  });

  it("records once, lists by thread, marks read, and the webhook end to end is idempotent", () => {
    const secrets = secretsWith({ WHATSAPP_APP_SECRET: "app-secret" });
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "waba", changes: [{ field: "messages", value: { contacts: [{ wa_id: "918888888888", profile: { name: "Ravi" } }], messages: [{ id: "wamid.9", from: "918888888888", timestamp: "1700000010", type: "text", text: { body: "Send me the brochure" } }] } }] }] });
    const sig = "sha256=" + createHmac("sha256", "app-secret").update(body).digest("hex");
    expect(handleMetaWebhook(CID, secrets, body, "sha256=bad").status).toBe(401);
    expect(handleMetaWebhook(CID, secretsWith({}), body, sig).status).toBe(400);
    const first = handleMetaWebhook(CID, secrets, body, sig);
    expect(first.status).toBe(200);
    expect(first.body.messages).toBe(1);
    const again = handleMetaWebhook(CID, secrets, body, sig);
    expect(again.body.messages).toBe(0);
    const rows = listInbound(CID, { channel: "whatsapp", thread_id: "918888888888" });
    expect(rows.length).toBe(1);
    expect(rows[0].from_name).toBe("Ravi");
    expect(listInbound(CID, { unread: true }).length).toBe(1);
    expect(recordInbound(CID, { channel: "whatsapp", external_id: "wamid.9", thread_id: "918888888888", from_id: "918888888888", body: "dup" })).toBeUndefined();
    const t = threads(CID, "whatsapp");
    expect(t.length).toBe(1);
    expect(t[0].unread).toBe(1);
    expect(markRead(CID, { channel: "whatsapp", thread_id: "918888888888" })).toBe(1);
    expect(listInbound(CID, { unread: true }).length).toBe(0);
  });

  it("contacts: first contact until remembered, case-insensitive", () => {
    expect(knownContact(CID, "Lead@Example.com")).toBe(false);
    rememberContact(CID, ["lead@example.com", "+919999999999"]);
    expect(knownContact(CID, "Lead@Example.com")).toBe(true);
    expect(knownContact(CID, "+919999999999")).toBe(true);
    rememberContact(CID, "lead@example.com"); // idempotent
    expect(knownContact(CID, "nobody@example.com")).toBe(false);
  });
});
