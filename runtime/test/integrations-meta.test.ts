// Offline checks for the Meta messaging/pages integrations: shapes, gate
// classes, and that every handler refuses cleanly (no network) when the
// vault is empty. The WhatsApp inbox/threads read the shared inbound store
// (src/inbound.ts) and work end-to-end against the in-memory database.

import { beforeAll, describe, expect, it } from "vitest";
import { openMemoryDb } from "../src/db.js";
import { recordInbound } from "../src/inbound.js";
import { toolsFor } from "../src/integrations/registry.js";
import type { Integration } from "../src/integrations/registry.js";
import type { ToolContext, ToolResult } from "../src/types.js";
import whatsapp, { normalisePhone } from "../integrations/whatsapp/index.js";
import facebook, { AUTH as FACEBOOK_AUTH } from "../integrations/facebook/index.js";

const ctx: ToolContext = {
  company: { id: "c1", name: "T", slug: "t", currency: "INR" } as any,
  config: {} as any,
  companyDir: "",
  agent: {} as any,
  role: {} as any,
  run: {} as any,
  secrets: { get: () => undefined, names: () => [] },
  emit: () => {},
};

const OFFLINE_CODES = ["not_connected", "missing_secret"];
const method = (i: Integration, name: string) => {
  const m = i.methods.find((x) => x.name === name);
  if (!m) throw new Error(`${i.id}.${name} is not defined`);
  return m;
};
const errorCode = (r: ToolResult) => (r.error as { code: string } | undefined)?.code;

beforeAll(() => {
  openMemoryDb();
});

describe.each([whatsapp, facebook])("$id definition", (i) => {
  it("is well-formed: kebab id, snake_case methods in declared modes, strict inputs, healthcheck", () => {
    expect(i.id).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(i.title).toBeTruthy();
    expect(i.description).toBeTruthy();
    expect(i.guidance).toContain("## Enabling");
    expect(i.guidance).toContain(`id: ${i.id}`);
    const modeIds = new Set(i.modes.map((m) => m.id));
    expect(modeIds.size).toBe(i.modes.length);
    for (const m of i.methods) {
      expect(m.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(modeIds.has(m.mode)).toBe(true);
      expect(m.description.length).toBeGreaterThan(20);
      expect(m.input.type).toBe("object");
      expect((m.input as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    }
    // every mode contributes at least one tool
    for (const mode of i.modes) expect(i.methods.some((m) => m.mode === mode.id)).toBe(true);
    for (const s of i.secrets) {
      expect(s.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(s.description).toBeTruthy();
      expect(s.obtain).toBeTruthy();
    }
    expect(typeof i.healthcheck).toBe("function");
  });

  it("healthcheck reports the missing credential without touching the network", async () => {
    const h = await i.healthcheck!({ secrets: ctx.secrets });
    expect(h.ok).toBe(false);
    expect(h.detail).toMatch(/missing/i);
  });
});

describe("whatsapp", () => {
  it("declares api_key auth, read + send modes, the expected methods and secrets", () => {
    expect(whatsapp.auth?.kind).toBe("api_key");
    expect(whatsapp.modes.map((m) => m.id)).toEqual(["read", "send"]);
    expect(whatsapp.modes.map((m) => m.sideEffect)).toEqual(["read", "send"]);
    expect(whatsapp.methods.map((m) => m.name).sort()).toEqual(["inbox", "mark_read", "send_media", "send_template", "send_text", "templates", "threads"]);
    const required = whatsapp.secrets.filter((s) => s.required !== false).map((s) => s.name);
    expect(required).toEqual(["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]);
    expect(whatsapp.secrets.map((s) => s.name)).toEqual(expect.arrayContaining(["WHATSAPP_BUSINESS_ACCOUNT_ID", "META_WEBHOOK_VERIFY_TOKEN", "WHATSAPP_APP_SECRET"]));
  });

  it("send tools are class send with a `to` recipient; mark_read is a write inside read", () => {
    for (const name of ["send_template", "send_text", "send_media"]) {
      const m = method(whatsapp, name);
      expect(m.mode).toBe("send");
      expect(m.input.required).toContain("to");
    }
    expect(method(whatsapp, "mark_read").mode).toBe("read");
    expect(method(whatsapp, "mark_read").sideEffect).toBe("write");
    const classes = Object.fromEntries(toolsFor(whatsapp, ["read", "send"]).map((t) => [t.spec.name, t.spec.sideEffect]));
    expect(classes).toEqual({
      "whatsapp.templates": "read", "whatsapp.inbox": "read", "whatsapp.threads": "read", "whatsapp.mark_read": "write",
      "whatsapp.send_template": "send", "whatsapp.send_text": "send", "whatsapp.send_media": "send",
    });
    expect(toolsFor(whatsapp, ["read"]).map((t) => t.spec.name)).not.toContain("whatsapp.send_text");
  });

  it("guidance names the webhook URL, the verify token, the System User token scopes and the 24-hour window", () => {
    expect(whatsapp.guidance).toContain("<HIVE_PUBLIC_URL>/api/webhooks/meta/<company-slug>");
    expect(whatsapp.guidance).toContain("META_WEBHOOK_VERIFY_TOKEN");
    expect(whatsapp.guidance).toContain("whatsapp_business_messaging");
    expect(whatsapp.guidance).toContain("whatsapp_business_management");
    expect(whatsapp.guidance).toMatch(/24-hour/);
    expect(whatsapp.guidance).toContain("modes: [read, send]");
  });

  it("normalises recipients to E.164 digits", () => {
    expect(normalisePhone("+91 99999-99999")).toBe("919999999999");
    expect(normalisePhone("919999999999")).toBe("919999999999");
    expect(normalisePhone(undefined)).toBe("");
  });

  it("inbox and threads read the shared inbound store offline", async () => {
    const row = recordInbound("c1", { channel: "whatsapp", external_id: "wamid.1", thread_id: "919999999999", from_id: "919999999999", from_name: "Test", body: "hi" });
    expect(row).toBeTruthy();
    // a different company sees nothing
    recordInbound("c2", { channel: "whatsapp", external_id: "wamid.other", thread_id: "1", from_id: "1", body: "elsewhere" });

    const inbox = await method(whatsapp, "inbox").handler(ctx, {});
    expect(inbox.ok).toBe(true);
    const messages = inbox.messages as Record<string, unknown>[];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: row!.id, message_id: "wamid.1", thread_id: "919999999999", from: "Test", from_id: "919999999999", body: "hi", read: false, replied: false });

    const byThread = await method(whatsapp, "inbox").handler(ctx, { thread_id: "+91 99999 99999", unread: true });
    expect((byThread.messages as unknown[]).length).toBe(1);
    const none = await method(whatsapp, "inbox").handler(ctx, { thread_id: "1" });
    expect((none.messages as unknown[]).length).toBe(0);

    const t = await method(whatsapp, "threads").handler(ctx, {});
    expect(t.ok).toBe(true);
    expect(t.threads).toEqual([{ thread_id: "919999999999", from: "Test", last_message: "hi", last_ts: row!.ts, count: 1, unread: 1, replied: false }]);
  });

  it("every network method fails fast with missing_secret when the vault is empty", async () => {
    const network = whatsapp.methods.filter((m) => !["inbox", "threads"].includes(m.name));
    expect(network.map((m) => m.name).sort()).toEqual(["mark_read", "send_media", "send_template", "send_text", "templates"]);
    for (const m of network) {
      const r = await m.handler(ctx, { to: "+919999999999", template: "hello", text: "hi", media_url: "https://x/y.png", kind: "image", message_id: "wamid.1" });
      expect(r.ok, m.name).toBe(false);
      expect(OFFLINE_CODES, m.name).toContain(errorCode(r));
    }
  });
});

describe("facebook", () => {
  it("shares the META Business app and asks for the Pages scopes", () => {
    expect(facebook.auth).toBe(FACEBOOK_AUTH);
    expect(FACEBOOK_AUTH.kind).toBe("oauth2");
    expect(FACEBOOK_AUTH.prefix).toBe("META");
    expect(FACEBOOK_AUTH.tokenAuth).toBe("body");
    expect(FACEBOOK_AUTH.authorizeUrl).toBe("https://www.facebook.com/v21.0/dialog/oauth");
    expect(FACEBOOK_AUTH.tokenUrl).toBe("https://graph.facebook.com/v21.0/oauth/access_token");
    expect(FACEBOOK_AUTH.scopes).toEqual(expect.arrayContaining(["pages_show_list", "pages_read_engagement", "pages_manage_posts", "pages_manage_engagement", "read_insights", "business_management"]));
    const names = facebook.secrets.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["META_CLIENT_ID", "META_CLIENT_SECRET", "META_ACCESS_TOKEN", "FACEBOOK_PAGE_ACCESS_TOKEN", "FACEBOOK_PAGE_ID"]));
    for (const opt of ["FACEBOOK_PAGE_ACCESS_TOKEN", "FACEBOOK_PAGE_ID"]) expect(facebook.secrets.find((s) => s.name === opt)?.required).toBe(false);
  });

  it("declares read / publish / engage with the expected methods and gate classes", () => {
    expect(facebook.modes.map((m) => [m.id, m.sideEffect])).toEqual([["read", "read"], ["publish", "publish"], ["engage", "send"]]);
    expect(facebook.methods.map((m) => m.name).sort()).toEqual(["comments", "insights", "pages", "post", "posts", "reply_comment"]);
    const classes = Object.fromEntries(toolsFor(facebook, ["read", "publish", "engage"]).map((t) => [t.spec.name, t.spec.sideEffect]));
    expect(classes).toEqual({
      "facebook.pages": "read", "facebook.posts": "read", "facebook.comments": "read", "facebook.insights": "read",
      "facebook.post": "publish", "facebook.reply_comment": "send",
    });
    expect(method(facebook, "post").input.required).toEqual(expect.arrayContaining(["message", "reason"]));
  });

  it("reply_comment keeps comment_id (no `to`), so the gate treats it as first contact", () => {
    const m = method(facebook, "reply_comment");
    expect(m.mode).toBe("engage");
    expect(m.alwaysApprove).toBe(false);
    expect(m.input.required).toEqual(["comment_id", "message"]);
    expect(Object.keys(m.input.properties ?? {})).not.toContain("to");
  });

  it("every handler fails fast with not_connected when nothing is in the vault", async () => {
    for (const m of facebook.methods) {
      const r = await m.handler(ctx, { message: "hello", reason: "test", post_id: "1_2", comment_id: "1_2_3" });
      expect(r.ok, m.name).toBe(false);
      expect(OFFLINE_CODES, m.name).toContain(errorCode(r));
    }
  });
});
