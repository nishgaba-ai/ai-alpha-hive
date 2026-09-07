// WhatsApp Business Cloud API — message customers from the company's
// WhatsApp number and read what they write back. Inbound messages are
// recorded by the Meta webhook endpoint (/api/webhooks/meta/<slug>) into
// the shared inbound store (src/inbound.ts); `inbox` and `threads` read
// from there without touching the network. Free-form text and media only
// deliver inside the 24-hour customer service window a customer's message
// opens; outside it only approved templates go through. Sends are gated:
// a number the company has never written to parks as first contact, a
// reply in a known thread is allowed by default.

import { defineIntegration, strictSchema, fail } from "../../src/integrations/registry.js";
import { listInbound, markRead, markReplied, threads, type InboundMessage } from "../../src/inbound.js";
import { rememberContact } from "../../src/contacts.js";
import { one } from "../../src/db.js";
import type { ToolContext, ToolResult } from "../../src/types.js";

const G = "https://graph.facebook.com/v21.0";
const CHANNEL = "whatsapp";
const MISSING = "WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be in the vault";
const BAD_TO = "`to` must be a phone number in E.164, e.g. +919999999999";

type Secrets = { get(n: string): string | undefined };
type Creds = { token: string; phoneId: string };

function creds(secrets: Secrets): Creds | undefined {
  const token = secrets.get("WHATSAPP_ACCESS_TOKEN");
  const phoneId = secrets.get("WHATSAPP_PHONE_NUMBER_ID");
  return token && phoneId ? { token, phoneId } : undefined;
}

async function wa(token: string, path: string, method: "GET" | "POST" = "GET", body?: Record<string, unknown>) {
  const res = await fetch(`${G}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, body: json };
}

function errorOf(body: Record<string, unknown>): { message: string; code?: number } {
  const e = body.error as { message?: string; code?: number; error_data?: { details?: string } } | undefined;
  return { message: e?.error_data?.details ?? e?.message ?? "request failed", code: e?.code };
}

/** E.164 digits without the plus, which is what the API wants: "+91 99999-99999" → "919999999999". */
export function normalisePhone(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "");
}

function compact(m: InboundMessage) {
  return {
    id: m.id,
    message_id: m.external_id,
    thread_id: m.thread_id,
    from: m.from_name ?? m.from_id,
    from_id: m.from_id,
    body: m.body,
    media: m.media_json ? (JSON.parse(m.media_json) as unknown) : undefined,
    ts: m.ts,
    read: !!m.read_at,
    replied: !!m.replied_at,
  };
}

/** POST /{phone}/messages; on success remembers the recipient so the next message in the thread is a reply. */
async function send(ctx: ToolContext, c: Creds, to: string, payload: Record<string, unknown>): Promise<ToolResult> {
  const r = await wa(c.token, `/${c.phoneId}/messages`, "POST", { messaging_product: "whatsapp", recipient_type: "individual", to, ...payload });
  if (!r.ok) {
    const e = errorOf(r.body);
    if (e.code === 131047) return fail("outside_window", "more than 24 hours since this customer last wrote; only an approved template delivers now (whatsapp.send_template)");
    return fail("whatsapp_error", e.message);
  }
  const id = String((r.body.messages as { id?: string }[] | undefined)?.[0]?.id ?? "");
  rememberContact(ctx.company.id, to);
  markReplied(ctx.company.id, CHANNEL, to);
  ctx.emit("artifact.created", { kind: "message", ref: id, channel: CHANNEL, to });
  return { ok: true, message_id: id, to };
}

export default defineIntegration({
  id: "whatsapp",
  auth: { kind: "api_key", guide: "The Cloud API uses a permanent System User token from Meta Business Settings; Embedded Signup (OAuth) is not wired, so paste the token." },
  title: "WhatsApp",
  description: "Message customers on WhatsApp (templates, text, media) from the company number; read the replies the webhook records.",
  website: "https://developers.facebook.com/docs/whatsapp/cloud-api",
  guidance: `
## What it does
- **read** — \`whatsapp.inbox\` and \`whatsapp.threads\` show what customers wrote to the company number (recorded by the Meta webhook; no network call); \`whatsapp.templates\` lists message templates and their approval status; \`whatsapp.mark_read\` sends the read receipt (\`write\`).
- **send** — \`whatsapp.send_template\` (approved template, delivers any time), \`whatsapp.send_text\` and \`whatsapp.send_media\` (only inside the 24-hour window). The recipient is \`to\` in E.164; a number the company has never written to parks as **first contact**, later messages in that thread are replies and go out under the reply policy.

## The 24-hour window
A customer's message opens a 24-hour customer service window. Inside it you may send free-form text and media. Outside it WhatsApp only delivers **approved message templates** (\`send_template\`); free-form sends fail with \`outside_window\`. Templates are created in WhatsApp Manager and need Meta's approval (minutes to a day); \`whatsapp.templates\` shows which are \`APPROVED\`.

## Connecting
1. developers.facebook.com → your Business app (the Meta Ads one works) → **Add product → WhatsApp**. Under WhatsApp → API Setup add (or claim) the business phone number; copy the **Phone number ID** → \`WHATSAPP_PHONE_NUMBER_ID\` and the **WhatsApp Business Account ID** → \`WHATSAPP_BUSINESS_ACCOUNT_ID\`.
2. business.facebook.com → Business Settings → Users → **System Users** → add one (admin) → assign the WhatsApp account and the app → **Generate token** with \`whatsapp_business_messaging\` and \`whatsapp_business_management\`, expiry *never* → \`WHATSAPP_ACCESS_TOKEN\`. (The temporary token on the API Setup page dies in 24 hours; do not store that one.)
3. Invent a verify token (any 32 random characters) → \`META_WEBHOOK_VERIFY_TOKEN\`. Store the app's **App Secret** (Settings → Basic) as \`WHATSAPP_APP_SECRET\`: the endpoint verifies every delivery's signature with it and drops unsigned posts. (If Meta Ads or Facebook are connected from the same app, \`META_CLIENT_SECRET\` is already there and works too.)
4. Webhook: in the Meta app → WhatsApp → **Configuration → Webhooks**, set the callback URL to \`<HIVE_PUBLIC_URL>/api/webhooks/meta/<company-slug>\` and the verify token to the \`META_WEBHOOK_VERIFY_TOKEN\` you stored, click Verify and save, then subscribe to the \`messages\` field. Inbound messages then appear in \`whatsapp.inbox\` and under Inbox → Conversations.
5. Press the healthcheck: it shows the display number, verified name and quality rating.

## Enabling
\`\`\`yaml
integrations:
  - id: whatsapp
    modes: [read, send]
\`\`\`
Give \`send\` to the role that answers customers (sales, support); \`read\` alone is enough for a role that only triages.
`,
  secrets: [
    { name: "WHATSAPP_ACCESS_TOKEN", description: "Permanent System User token (whatsapp_business_messaging, whatsapp_business_management)", obtain: "business.facebook.com → Business Settings → Users → System Users → Generate token" },
    { name: "WHATSAPP_PHONE_NUMBER_ID", description: "Phone number ID of the business number (not the number itself)", obtain: "developers.facebook.com → app → WhatsApp → API Setup" },
    { name: "WHATSAPP_BUSINESS_ACCOUNT_ID", description: "WhatsApp Business Account id (needed for whatsapp.templates)", obtain: "developers.facebook.com → app → WhatsApp → API Setup", required: false },
    { name: "META_WEBHOOK_VERIFY_TOKEN", description: "A string you invent; paste the same one in the Meta webhook form", obtain: "make one up (32 random characters)", required: false },
    { name: "WHATSAPP_APP_SECRET", description: "App Secret; the webhook endpoint verifies X-Hub-Signature-256 with it (META_CLIENT_SECRET from the same app also works)", obtain: "developers.facebook.com → app → Settings → Basic", required: false },
  ],
  modes: [
    { id: "read", title: "Read", description: "Inbox, threads, templates, read receipts", sideEffect: "read" },
    { id: "send", title: "Send", description: "Message customers", sideEffect: "send" },
  ],
  methods: [
    {
      name: "templates", mode: "read",
      description: "Message templates on the WhatsApp Business Account with status (only APPROVED ones deliver), category, language and body text.",
      input: strictSchema({ limit: { type: "integer", maximum: 100 } }, []),
      async handler(ctx, input) {
        const token = ctx.secrets.get("WHATSAPP_ACCESS_TOKEN");
        const waba = ctx.secrets.get("WHATSAPP_BUSINESS_ACCOUNT_ID");
        if (!token) return fail("missing_secret", "WHATSAPP_ACCESS_TOKEN is not in the vault");
        if (!waba) return fail("missing_secret", "WHATSAPP_BUSINESS_ACCOUNT_ID is not in the vault (app → WhatsApp → API Setup)");
        const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 100);
        const r = await wa(token, `/${waba}/message_templates?fields=name,status,category,language,components&limit=${limit}`);
        if (!r.ok) return fail("whatsapp_error", errorOf(r.body).message);
        type Component = { type: string; format?: string; text?: string };
        const data = (r.body.data as { name: string; status: string; category: string; language: string; components?: Component[] }[]) ?? [];
        return {
          ok: true,
          templates: data.map((t) => ({
            name: t.name, status: t.status, category: t.category, language: t.language,
            header: t.components?.find((c) => c.type === "HEADER")?.format,
            body: t.components?.find((c) => c.type === "BODY")?.text,
          })),
        };
      },
    },
    {
      name: "inbox", mode: "read",
      description: "Customer messages received on the company number (recorded by the Meta webhook), newest first. Filter by thread_id (the customer's number), unread, or since (unix ms).",
      input: strictSchema(
        {
          thread_id: { type: "string", description: "Customer phone (wa_id) to read one conversation" },
          unread: { type: "boolean" },
          since: { type: "integer", description: "Unix ms; only messages newer than this" },
          limit: { type: "integer", maximum: 200 },
        },
        [],
      ),
      async handler(ctx, input) {
        const rows = listInbound(ctx.company.id, {
          channel: CHANNEL,
          thread_id: input.thread_id ? normalisePhone(input.thread_id) : undefined,
          unread: input.unread === true,
          since: input.since ? Number(input.since) : undefined,
          limit: Number(input.limit ?? 50),
        });
        return { ok: true, messages: rows.map(compact) };
      },
    },
    {
      name: "threads", mode: "read",
      description: "Conversations on the company number: one row per customer with the latest message, message count and unread count.",
      input: strictSchema({ limit: { type: "integer", maximum: 200 } }, []),
      async handler(ctx, input) {
        const rows = threads(ctx.company.id, CHANNEL, Number(input.limit ?? 50));
        return {
          ok: true,
          threads: rows.map((t) => ({ thread_id: t.thread_id, from: t.from_name ?? t.from_id, last_message: t.body.slice(0, 200), last_ts: t.ts, count: t.count, unread: t.unread, replied: !!t.replied_at })),
        };
      },
    },
    {
      name: "send_template", mode: "send",
      description: "Send an approved message template to a number. Delivers any time, also outside the 24-hour window. A number the company never wrote to parks as first contact.",
      input: strictSchema(
        {
          to: { type: "string", description: "Recipient phone in E.164 (+ optional), e.g. +919999999999" },
          template: { type: "string", description: "Template name exactly as approved in WhatsApp Manager" },
          language: { type: "string", description: "Template language code (default en_US)" },
          params: { type: "array", items: { type: "string" }, description: "Body placeholders {{1}}, {{2}}… in order" },
          header_image_url: { type: "string", description: "Public image URL, for templates with an image header" },
        },
        ["to", "template"],
      ),
      async handler(ctx, input) {
        const c = creds(ctx.secrets);
        if (!c) return fail("missing_secret", MISSING);
        const to = normalisePhone(input.to);
        if (to.length < 7 || to.length > 15) return fail("bad_recipient", BAD_TO);
        const components: Record<string, unknown>[] = [];
        if (input.header_image_url) components.push({ type: "header", parameters: [{ type: "image", image: { link: String(input.header_image_url) } }] });
        const params = ((input.params as unknown[] | undefined) ?? []).map(String);
        if (params.length) components.push({ type: "body", parameters: params.map((text) => ({ type: "text", text })) });
        return send(ctx, c, to, {
          type: "template",
          template: { name: String(input.template), language: { code: String(input.language ?? "en_US") }, ...(components.length ? { components } : {}) },
        });
      },
    },
    {
      name: "send_text", mode: "send",
      description: "Send a free-form text message. Only delivers inside the 24-hour window after the customer's last message; otherwise use send_template.",
      input: strictSchema({ to: { type: "string", description: "Recipient phone in E.164" }, text: { type: "string", maxLength: 4096 } }),
      async handler(ctx, input) {
        const c = creds(ctx.secrets);
        if (!c) return fail("missing_secret", MISSING);
        const to = normalisePhone(input.to);
        if (to.length < 7 || to.length > 15) return fail("bad_recipient", BAD_TO);
        const text = String(input.text ?? "");
        return send(ctx, c, to, { type: "text", text: { preview_url: /https?:\/\//.test(text), body: text } });
      },
    },
    {
      name: "send_media", mode: "send",
      description: "Send an image, video, document or audio file from a public URL, with an optional caption (not for audio) and filename (documents). 24-hour window applies.",
      input: strictSchema(
        {
          to: { type: "string", description: "Recipient phone in E.164" },
          media_url: { type: "string", description: "Public https URL of the file" },
          kind: { type: "string", enum: ["image", "video", "document", "audio"] },
          caption: { type: "string", maxLength: 1024 },
          filename: { type: "string", description: "Shown to the customer for documents" },
        },
        ["to", "media_url", "kind"],
      ),
      async handler(ctx, input) {
        const c = creds(ctx.secrets);
        if (!c) return fail("missing_secret", MISSING);
        const to = normalisePhone(input.to);
        if (to.length < 7 || to.length > 15) return fail("bad_recipient", BAD_TO);
        const kind = String(input.kind);
        const media: Record<string, unknown> = { link: String(input.media_url) };
        if (input.caption && kind !== "audio") media.caption = String(input.caption);
        if (input.filename && kind === "document") media.filename = String(input.filename);
        return send(ctx, c, to, { type: kind, [kind]: media });
      },
    },
    {
      name: "mark_read", mode: "read", sideEffect: "write",
      description: "Send the read receipt (blue ticks) for a customer message and mark it read in the inbox. message_id is the WhatsApp id (wamid.…) shown by whatsapp.inbox.",
      input: strictSchema({ message_id: { type: "string", description: "wamid.… from whatsapp.inbox (the inbox row id also works)" } }),
      async handler(ctx, input) {
        const c = creds(ctx.secrets);
        if (!c) return fail("missing_secret", MISSING);
        const key = String(input.message_id ?? "");
        const row = one<Pick<InboundMessage, "id" | "external_id">>(
          "SELECT id, external_id FROM inbound_messages WHERE company_id = ? AND channel = ? AND (external_id = ? OR id = ?)",
          ctx.company.id, CHANNEL, key, key,
        );
        if (row) markRead(ctx.company.id, [row.id]);
        const wamid = row?.external_id ?? key;
        const r = await wa(c.token, `/${c.phoneId}/messages`, "POST", { messaging_product: "whatsapp", status: "read", message_id: wamid });
        if (!r.ok) return fail("whatsapp_error", errorOf(r.body).message, { message_id: wamid, inbox: row ? "marked" : "not_found" });
        return { ok: true, message_id: wamid, inbox: row ? "marked" : "not_found" };
      },
    },
  ],
  async healthcheck(ctx) {
    const c = creds(ctx.secrets);
    if (!c) return { ok: false, detail: "WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID missing" };
    const r = await wa(c.token, `/${c.phoneId}?fields=display_phone_number,verified_name,quality_rating`);
    if (!r.ok) return { ok: false, detail: `token rejected: ${errorOf(r.body).message}` };
    return { ok: true, detail: `${r.body.verified_name ?? "?"} ${r.body.display_phone_number ?? ""} (quality ${r.body.quality_rating ?? "unknown"})` };
  },
});
