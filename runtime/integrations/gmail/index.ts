// Gmail — search and read mail, and send or reply from the connected
// account. Sending is send-class: the first mail to a new address parks
// for the board; replies to known contacts follow the reply policy. Uses
// the shared Google connection (prefix GOOGLE). Bodies are plain text
// (RFC 2822, base64url raw); replies carry In-Reply-To / References so
// they thread correctly on both ends.

import { defineIntegration, strictSchema, fail, type OAuthConfig } from "../../src/integrations/registry.js";
import { ensureToken } from "../../src/oauth.js";
import { rememberContact } from "../../src/contacts.js";
import type { ToolContext, ToolResult } from "../../src/types.js";

export const AUTH: OAuthConfig = {
  kind: "oauth2",
  prefix: "GOOGLE",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
  tokenAuth: "body",
  extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  guide: "console.cloud.google.com → APIs & Services → enable Gmail API → Credentials → OAuth client (Web application) → Authorized redirect URIs = the one shown here; copy Client ID and Client Secret. While the consent screen is in Testing, add the mailbox as a test user. One Google connection serves GA4, Search Console, Drive, Sheets, Calendar, Gmail and YouTube.",
};

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TOTAL = 30_000;
const MAX_MESSAGE = 6_000;
const enc = encodeURIComponent;

type Json = Record<string, unknown>;
type Ctx = Pick<ToolContext, "company" | "secrets">;
type Header = { name: string; value: string };
type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: Header[] };

function notConnected(): ToolResult {
  return fail("not_connected", "Connect Google on the Integrations screen with Gmail enabled (Gmail needs the OAuth connection)");
}

/** Token from the shared Google connection. Fails before any network call when not connected. */
async function accessToken(ctx: Ctx): Promise<string | ToolResult> {
  if (!ctx.secrets.get("GOOGLE_ACCESS_TOKEN") && !ctx.secrets.get("GOOGLE_REFRESH_TOKEN")) return notConnected();
  try {
    const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
    return token ?? notConnected();
  } catch (e) {
    return fail("auth_error", (e as Error).message);
  }
}

async function gapi(token: string, url: string, method: "GET" | "POST" = "GET", json?: unknown): Promise<{ ok: boolean; status: number; body: Json }> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(json === undefined ? {} : { "Content-Type": "application/json" }) },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  return { ok: res.ok, status: res.status, body };
}

function errorMessage(r: { status: number; body: Json }): string {
  const message = (r.body.error as { message?: string } | undefined)?.message ?? `HTTP ${r.status}`;
  if (r.status === 401) return `${message} — token rejected; reconnect Google`;
  if (r.status === 403) return `${message} — is the Gmail API enabled, and was Gmail included when Google was connected?`;
  return message;
}
function gmailError(r: { status: number; body: Json }): ToolResult {
  return fail("gmail_error", errorMessage(r));
}

function header(headers: Header[] | undefined, name: string): string | undefined {
  const n = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === n)?.value;
}

function collect(part: Part | undefined, want: string, acc: string[]): void {
  if (!part) return;
  if (part.mimeType === want && part.body?.data) acc.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
  for (const p of part.parts ?? []) collect(p, want, acc);
}

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** text/plain parts of a message, else text/html stripped to text. */
function bodyText(payload: Part | undefined): string {
  const plain: string[] = [];
  collect(payload, "text/plain", plain);
  if (plain.length) return plain.join("\n");
  const html: string[] = [];
  collect(payload, "text/html", html);
  return htmlToText(html.join("\n"));
}

/** Light quote stripping: drop `>` lines and everything after an "On … wrote:" marker or a forwarded / original-message divider. */
export function cleanText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trim();
    if (/^On .+wrote:$/.test(t) || (/^On .+/.test(t) && /wrote:$/.test((lines[i + 1] ?? "").trim()))) break;
    if (/^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}$/i.test(t) || /^_{5,}$/.test(t)) break;
    if (l.startsWith(">")) continue;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function encodeHeader(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

/** RFC 2822 message: UTF-8 headers (RFC 2047 when needed), plain-text body as base64, CRLF line ends. */
export function buildRaw(msg: { from?: string; to: string; subject: string; body: string; inReplyTo?: string; references?: string }): string {
  const headers = [
    msg.from ? `From: ${msg.from}` : undefined,
    `To: ${msg.to}`,
    `Subject: ${encodeHeader(msg.subject)}`,
    `Date: ${new Date().toUTCString().replace(/GMT$/, "+0000")}`,
    msg.inReplyTo ? `In-Reply-To: ${msg.inReplyTo}` : undefined,
    msg.references ? `References: ${msg.references}` : undefined,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter((h): h is string => !!h);
  const body = Buffer.from(msg.body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

type ReplyTarget = { thread_id: string; message_id_header?: string; references?: string; subject?: string };

/** Message-ID / References / Subject of the message being replied to: an explicit message, else the last message of the thread. */
async function replyTarget(token: string, messageId: string | undefined, threadId: string | undefined): Promise<ReplyTarget | ToolResult> {
  const hdrs = "metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=References";
  if (messageId) {
    const r = await gapi(token, `${GMAIL}/messages/${enc(messageId)}?format=metadata&${hdrs}`);
    if (!r.ok) return gmailError(r);
    const h = (r.body.payload as Part | undefined)?.headers;
    return { thread_id: String(r.body.threadId), message_id_header: header(h, "Message-ID"), references: header(h, "References"), subject: header(h, "Subject") };
  }
  const r = await gapi(token, `${GMAIL}/threads/${enc(String(threadId))}?format=metadata&${hdrs}`);
  if (!r.ok) return gmailError(r);
  const msgs = (r.body.messages as { id: string; payload?: Part }[] | undefined) ?? [];
  const h = msgs[msgs.length - 1]?.payload?.headers;
  return { thread_id: String(r.body.id ?? threadId), message_id_header: header(h, "Message-ID"), references: header(h, "References"), subject: header(h, "Subject") };
}

export default defineIntegration({
  id: "gmail",
  auth: AUTH,
  title: "Gmail",
  description: "Search and read mail in the connected Gmail account; send new mail and threaded replies.",
  website: "https://developers.google.com/gmail/api",
  guidance: `
## What it does
- **read** — \`gmail.search\` runs a Gmail search (\`from:x newer_than:7d\`, \`subject:invoice is:unread\`) and returns from, subject, date and a snippet per message; \`gmail.read_thread\` returns the messages of a thread as plain text with quoted replies stripped.
- **send** — \`gmail.send\` sends plain-text mail from the connected mailbox, or replies in a thread (pass thread_id or in_reply_to_message_id; the subject is reused and the reply threads correctly). Send-class: the first mail to a new address parks for the board; replies to known contacts follow the reply policy.

## Connecting (OAuth)
1. Google Cloud → APIs & Services → enable **Gmail API** → Credentials → OAuth client, type Web application, redirect URI = the one shown here.
2. OAuth consent screen: while it is in **Testing**, add the mailbox as a test user (Google expires test connections every 7 days; publish the app, or keep it Internal on Workspace, for a lasting connection). Gmail scopes are restricted, so a public app needs Google's verification.
3. Paste Client ID and Client Secret into the vault as \`GOOGLE_CLIENT_ID\` / \`GOOGLE_CLIENT_SECRET\`, then **Connect** with the mailbox the company sends from.
4. One Google connection serves GA4, Search Console, Drive, Sheets, Calendar, Gmail and YouTube: enabling more Google integrations only adds scopes to the same Connect button (reconnect once after enabling a new one).

Gmail has no service-account path: a service account cannot read a person's mailbox without Workspace domain-wide delegation. For transactional mail from a system address use \`email\` (Postmark).

## Enabling
\`\`\`yaml
integrations:
  - id: gmail
    modes: [read, send]
\`\`\`
`,
  secrets: [
    { name: "GOOGLE_CLIENT_ID", description: "OAuth client id (shared with GA4, Search Console and the other Google integrations)", obtain: "Google Cloud → Credentials", required: false },
    { name: "GOOGLE_CLIENT_SECRET", description: "OAuth client secret", obtain: "Google Cloud → Credentials", required: false },
    { name: "GOOGLE_ACCESS_TOKEN", description: "Access token (set by Connect)", obtain: "Connect button" },
  ],
  modes: [
    { id: "read", title: "Read", description: "Search and read mail", sideEffect: "read" },
    { id: "send", title: "Send", description: "Send mail and replies", sideEffect: "send" },
  ],
  methods: [
    {
      name: "search",
      mode: "read",
      description: "Search mail with Gmail query syntax (from:, to:, subject:, newer_than:7d, is:unread, has:attachment). Returns from, subject, date and snippet per message.",
      input: strictSchema({ query: { type: "string" }, limit: { type: "integer", maximum: 25 } }, ["query"]),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const query = String(input.query ?? "").trim();
        if (!query) return fail("bad_input", "query is empty");
        const limit = Math.min(Number(input.limit ?? 10), 25);
        const list = await gapi(token, `${GMAIL}/messages?q=${enc(query)}&maxResults=${limit}`);
        if (!list.ok) return gmailError(list);
        const ids = ((list.body.messages as { id: string }[]) ?? []).slice(0, limit);
        const messages = await Promise.all(
          ids.map(async ({ id }) => {
            const m = await gapi(token, `${GMAIL}/messages/${enc(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&fields=id,threadId,snippet,labelIds,payload/headers`);
            const h = (m.body.payload as Part | undefined)?.headers;
            return {
              id,
              thread_id: m.body.threadId,
              from: header(h, "From"),
              to: header(h, "To"),
              subject: header(h, "Subject"),
              date: header(h, "Date"),
              snippet: typeof m.body.snippet === "string" ? m.body.snippet.slice(0, 300) : undefined,
              unread: ((m.body.labelIds as string[]) ?? []).includes("UNREAD"),
            };
          }),
        );
        return { ok: true, messages, count: messages.length, estimated_total: list.body.resultSizeEstimate };
      },
    },
    {
      name: "read_thread",
      mode: "read",
      description: "The messages of a thread, oldest first, as plain text with quoted replies stripped. Truncated to 30k characters.",
      input: strictSchema({ thread_id: { type: "string" } }),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const r = await gapi(token, `${GMAIL}/threads/${enc(String(input.thread_id))}?format=full`);
        if (!r.ok) return gmailError(r);
        const msgs = (r.body.messages as { id: string; labelIds?: string[]; internalDate?: string; payload?: Part }[] | undefined) ?? [];
        let budget = MAX_TOTAL;
        let truncated = false;
        const messages = [];
        for (const m of msgs) {
          const h = m.payload?.headers;
          const full = cleanText(bodyText(m.payload));
          const take = Math.min(full.length, MAX_MESSAGE, Math.max(budget, 0));
          if (take < full.length) truncated = true;
          budget -= take;
          messages.push({
            id: m.id,
            from: header(h, "From"),
            to: header(h, "To"),
            cc: header(h, "Cc"),
            date: header(h, "Date"),
            subject: header(h, "Subject"),
            message_id_header: header(h, "Message-ID"),
            unread: (m.labelIds ?? []).includes("UNREAD"),
            text: full.slice(0, take),
          });
          if (budget <= 0 && messages.length < msgs.length) {
            truncated = true;
            break;
          }
        }
        return { ok: true, thread_id: r.body.id, subject: messages[0]?.subject, messages, message_count: msgs.length, truncated };
      },
    },
    {
      name: "send",
      mode: "send",
      description: "Send plain-text mail to one address, or reply in a thread (thread_id or in_reply_to_message_id; subject may be omitted for replies). First contact parks for the board.",
      input: strictSchema(
        {
          to: { type: "string", description: "one email address" },
          subject: { type: "string", description: "required for new mail; replies reuse the thread's subject when omitted" },
          body: { type: "string", description: "plain text" },
          thread_id: { type: "string", description: "reply to the last message of this thread" },
          in_reply_to_message_id: { type: "string", description: "reply to this specific message" },
          reason: { type: "string" },
        },
        ["to", "body"],
      ),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const to = String(input.to ?? "").trim().toLowerCase();
        if (!EMAIL.test(to)) return fail("bad_input", "`to` must be one email address (send separately per recipient)");
        const body = String(input.body ?? "");
        if (!body.trim()) return fail("bad_input", "body is empty");
        const replyId = input.in_reply_to_message_id ? String(input.in_reply_to_message_id) : undefined;
        const threadIn = input.thread_id ? String(input.thread_id) : undefined;
        let subject = String(input.subject ?? "").trim();
        let threadId: string | undefined;
        let inReplyTo: string | undefined;
        let references: string | undefined;
        if (replyId || threadIn) {
          const target = await replyTarget(token, replyId, threadIn);
          if ("ok" in target) return target;
          threadId = target.thread_id;
          inReplyTo = target.message_id_header;
          references = [target.references, target.message_id_header].filter(Boolean).join(" ") || undefined;
          if (!subject && target.subject) subject = /^re:/i.test(target.subject) ? target.subject : `Re: ${target.subject}`;
        }
        if (!subject) return fail("bad_input", "subject is required for new mail");
        const profile = await gapi(token, `${GMAIL}/profile?fields=emailAddress`);
        const from = profile.ok && typeof profile.body.emailAddress === "string" ? profile.body.emailAddress : undefined;
        const raw = Buffer.from(buildRaw({ from, to, subject, body, inReplyTo, references })).toString("base64url");
        const r = await gapi(token, `${GMAIL}/messages/send`, "POST", threadId ? { raw, threadId } : { raw });
        if (!r.ok) return gmailError(r);
        rememberContact(ctx.company.id, to);
        ctx.emit("artifact.created", { kind: "email", ref: String(r.body.id ?? ""), to, subject, thread_id: r.body.threadId, channel: "gmail" });
        return { ok: true, message_id: r.body.id, thread_id: r.body.threadId, from, to, subject, reply: !!threadId };
      },
    },
  ],
  async healthcheck(ctx) {
    const access = ctx.secrets.get("GOOGLE_ACCESS_TOKEN");
    if (!access) return { ok: false, detail: "not connected: Connect Google with Gmail enabled" };
    const r = await gapi(access, `${GMAIL}/profile?fields=emailAddress,messagesTotal`);
    return r.ok ? { ok: true, detail: `${r.body.emailAddress ?? "mailbox"}, ${r.body.messagesTotal ?? "?"} messages` } : { ok: false, detail: errorMessage(r) };
  },
});
