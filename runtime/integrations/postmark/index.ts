// Postmark integration — transactional email out, inbound in.

import { defineIntegration, strictSchema, fail } from "../../src/integrations/registry.js";
import { all, one, run } from "../../src/db.js";

const API = "https://api.postmarkapp.com";

async function pm(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { "X-Postmark-Server-Token": token, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body: body as Record<string, unknown> };
}

export default defineIntegration({
  id: "email",
  auth: { kind: "api_key", guide: "Postmark uses server API tokens; there is no OAuth." },
  title: "Email (Postmark)",
  description: "Send email from the company's domain and read inbound replies.",
  website: "https://postmarkapp.com",
  guidance: `
## What it does
- **send** — outbound email from \`POSTMARK_FROM\`. First contact with a new address is a \`send\` side effect that parks for the board; replies in an existing thread are allowed by default (\`policies.send\`).
- **read** — inbound messages (Postmark inbound stream) so agents can answer.

## Getting credentials
1. Create a Postmark server, verify your sending domain (DKIM + Return-Path).
2. Copy the **Server API token** → \`POSTMARK_SERVER_TOKEN\`.
3. Set \`POSTMARK_FROM\` to a verified address, e.g. \`maya@yourcompany.com\`.
4. For inbound, enable the inbound stream on the server; the runtime reads it by API (no webhook needed).

## Enabling
\`\`\`yaml
integrations:
  - id: email
    modes: [send, read]
\`\`\`
`,
  secrets: [
    { name: "POSTMARK_SERVER_TOKEN", description: "Server API token", obtain: "https://account.postmarkapp.com/servers → API Tokens" },
    { name: "POSTMARK_FROM", description: "Verified sender address", obtain: "Postmark → Sender Signatures / Domains", modes: ["send"] },
  ],
  modes: [
    { id: "send", title: "Send", description: "Outbound email", sideEffect: "send" },
    { id: "read", title: "Read", description: "Inbound email", sideEffect: "read" },
  ],
  methods: [
    {
      name: "send",
      mode: "send",
      description: "Send an email. New recipients park for the board; replies to known threads are allowed.",
      input: strictSchema(
        {
          to: { type: "array", items: { type: "string" }, minItems: 1 },
          subject: { type: "string" },
          body_md: { type: "string" },
          thread_id: { type: "string" },
          reason: { type: "string" },
        },
        ["to", "subject", "body_md", "reason"],
      ),
      async handler(ctx, input) {
        const token = ctx.secrets.get("POSTMARK_SERVER_TOKEN");
        const from = ctx.secrets.get("POSTMARK_FROM");
        if (!token || !from) return fail("missing_secret", "POSTMARK_SERVER_TOKEN and POSTMARK_FROM must be in the vault");
        const to = (input.to as string[]).join(",");
        const r = await pm(token, "/email", {
          method: "POST",
          body: JSON.stringify({ From: from, To: to, Subject: input.subject, TextBody: input.body_md, MessageStream: "outbound" }),
        });
        if (r.status !== 200) return fail("postmark_error", String(r.body.Message ?? `HTTP ${r.status}`));
        const now = Date.now();
        for (const addr of input.to as string[]) {
          run(
            "INSERT OR IGNORE INTO contacts (company_id, address, first_contact_at) VALUES (?, ?, ?)",
            ctx.company.id, addr.toLowerCase(), now,
          );
        }
        ctx.emit("artifact.created", { kind: "email", ref: String(r.body.MessageID ?? ""), to });
        return { ok: true, message_id: r.body.MessageID };
      },
    },
    {
      name: "inbox",
      mode: "read",
      description: "Inbound email received since a timestamp (ms).",
      input: strictSchema({ since: { type: "integer" }, limit: { type: "integer", maximum: 50 } }, []),
      async handler(ctx, input) {
        const token = ctx.secrets.get("POSTMARK_SERVER_TOKEN");
        if (!token) return fail("missing_secret", "POSTMARK_SERVER_TOKEN is not in the vault");
        const limit = Number(input.limit ?? 20);
        const r = await pm(token, `/messages/inbound?count=${limit}&offset=0`);
        if (r.status !== 200) return fail("postmark_error", String(r.body.Message ?? `HTTP ${r.status}`));
        const since = Number(input.since ?? 0);
        const msgs = ((r.body.InboundMessages as Record<string, unknown>[]) ?? []).filter(
          (m) => new Date(String(m.ReceivedAt)).getTime() >= since,
        );
        return { ok: true, messages: msgs.map((m) => ({ id: m.MessageID, from: m.From, subject: m.Subject, received_at: m.ReceivedAt, text: m.TextBody })) };
      },
    },
  ],
  async healthcheck(ctx) {
    const token = ctx.secrets.get("POSTMARK_SERVER_TOKEN");
    if (!token) return { ok: false, detail: "POSTMARK_SERVER_TOKEN missing" };
    const r = await pm(token, "/server");
    return r.status === 200 ? { ok: true, detail: `server: ${r.body.Name}` } : { ok: false, detail: `rejected (HTTP ${r.status})` };
  },
});

/** Used by the gate: has this address been contacted before? */
export { knownContact, knownContacts } from "../../src/contacts.js";
