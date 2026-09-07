// Google Drive — search, read and create files in the connected account's
// Drive: Docs export as Markdown, Sheets as CSV, Slides as text; text files
// upload as-is; Markdown becomes a real Google Doc. Sharing is send-class:
// the first share to a new address parks for the board like a first email.
// Uses the shared Google connection (prefix GOOGLE) or a service account.

import { randomUUID } from "node:crypto";
import { defineIntegration, strictSchema, fail, type OAuthConfig } from "../../src/integrations/registry.js";
import { ensureToken } from "../../src/oauth.js";
import { googleAccessToken } from "../../src/integrations/google.js";
import { rememberContact } from "../../src/contacts.js";
import type { ToolContext, ToolResult } from "../../src/types.js";

const SCOPES = ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/documents"];
export const AUTH: OAuthConfig = {
  kind: "oauth2",
  prefix: "GOOGLE",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: SCOPES,
  tokenAuth: "body",
  extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  guide: "console.cloud.google.com → APIs & Services → enable Google Drive API and Google Docs API → Credentials → OAuth client (Web application) → Authorized redirect URIs = the one shown here; copy Client ID and Client Secret. One Google connection serves GA4, Search Console, Drive, Sheets, Calendar, Gmail and YouTube.",
};

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const DOCS = "https://docs.googleapis.com/v1";
const FOLDER = "application/vnd.google-apps.folder";
const FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink,parents";
const MAX_TEXT = 30_000;
const MAX_DOWNLOAD = 200 * 1024;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const enc = encodeURIComponent;

type Json = Record<string, unknown>;
type Ctx = Pick<ToolContext, "company" | "secrets">;

function notConnected(): ToolResult {
  return fail("not_connected", "Connect Google on the Integrations screen, or store GOOGLE_SERVICE_ACCOUNT_JSON and share the files with the service account's email");
}

/** Token from the shared Google connection or a service account. Fails before any network call when neither is configured. */
async function accessToken(ctx: Ctx): Promise<string | ToolResult> {
  const sa = ctx.secrets.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!sa && !ctx.secrets.get("GOOGLE_ACCESS_TOKEN") && !ctx.secrets.get("GOOGLE_REFRESH_TOKEN")) return notConnected();
  try {
    const token = sa ? await googleAccessToken(sa, SCOPES.join(" ")) : await ensureToken(ctx.company.id, ctx.secrets, AUTH);
    return token ?? notConnected();
  } catch (e) {
    return fail("auth_error", (e as Error).message);
  }
}

async function gapi(token: string, url: string, method: "GET" | "POST" | "PUT" | "PATCH" = "GET", json?: unknown): Promise<{ ok: boolean; status: number; body: Json }> {
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
  if (r.status === 403) return `${message} — is the file shared with the connected account, and are the Drive and Docs APIs enabled?`;
  return message;
}
function driveError(r: { status: number; body: Json }, code = "drive_error", extra: Record<string, unknown> = {}): ToolResult {
  return fail(code, errorMessage(r), extra);
}

function fileOut(f: Json) {
  return {
    id: f.id,
    name: f.name,
    mime_type: f.mimeType,
    size: f.size === undefined ? undefined : Number(f.size),
    modified: f.modifiedTime,
    url: f.webViewLink,
    parents: f.parents,
  };
}

/** Plain words become a full-text search; anything that already reads like Drive query syntax passes through. */
const Q_FIELDS = /\b(name|fullText|mimeType|modifiedTime|createdTime|viewedByMeTime|trashed|starred|sharedWithMe|parents|owners|writers|readers|visibility|properties|appProperties)\b/;
function driveQ(query: string): string {
  const q = query.trim();
  if (Q_FIELDS.test(q) && /(\bcontains\b|\bin\b|\bhas\b|[=<>!])/.test(q)) return q;
  return `fullText contains '${q.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and trashed = false`;
}

const EXPORT: Record<string, string> = {
  "application/vnd.google-apps.document": "text/markdown",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};
const TEXTISH = /^text\/|^application\/(json|xml|x-yaml|yaml|javascript|x-javascript|x-sh|sql|x-ndjson|ld\+json|rtf)$|\+(json|xml)$/;
const EXT: Record<string, string> = {
  md: "text/markdown", markdown: "text/markdown", txt: "text/plain", csv: "text/csv", tsv: "text/tab-separated-values",
  json: "application/json", html: "text/html", htm: "text/html", xml: "application/xml", yaml: "text/yaml", yml: "text/yaml",
  js: "text/javascript", ts: "text/plain", css: "text/css", sql: "application/sql",
};
function mimeFor(name: string, explicit: unknown): string {
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  return EXT[name.toLowerCase().split(".").pop() ?? ""] ?? "text/plain";
}

/**
 * Markdown → the text a Docs insertText takes, with `#` heading markers
 * stripped and remembered as offsets (UTF-16 units, the same unit Docs
 * indexes use) so the paragraphs can be styled HEADING_n afterwards.
 */
export function docBody(markdown: string): { text: string; headings: { start: number; end: number; level: number }[] } {
  const headings: { start: number; end: number; level: number }[] = [];
  const parts: string[] = [];
  let offset = 0;
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw);
    const line = m ? m[2] : raw;
    if (m && line) headings.push({ start: offset, end: offset + line.length, level: m[1].length });
    parts.push(line);
    offset += line.length + 1;
  }
  return { text: parts.join("\n"), headings };
}

export default defineIntegration({
  id: "google-drive",
  auth: AUTH,
  title: "Google Drive",
  description: "Search, read and create files in Google Drive: Docs as Markdown, Sheets as CSV, uploads, folders, sharing.",
  website: "https://developers.google.com/drive/api",
  guidance: `
## What it does
- **read** — \`google-drive.search\` finds files by words or Drive query syntax; \`google-drive.get\` returns metadata and the link; \`google-drive.read\` returns the text of a file (Google Docs as Markdown, Sheets as CSV of the first sheet, Slides as plain text, text files up to 200 KB).
- **write** — \`google-drive.upload\` stores text content as a file, \`google-drive.create_folder\` makes a folder, \`google-drive.create_doc\` turns Markdown into a Google Doc (headings become Docs headings).
- **share** — \`google-drive.share\` grants a person (by email) or anyone-with-the-link reader / commenter / writer access. Send-class: the first share to a new address parks for the board; sharing with a known contact follows the reply policy.

## Connecting (OAuth, recommended)
1. Google Cloud → APIs & Services → enable **Google Drive API** and **Google Docs API** → Credentials → OAuth client, type Web application, redirect URI = the one shown here.
2. Paste Client ID and Client Secret into the vault as \`GOOGLE_CLIENT_ID\` / \`GOOGLE_CLIENT_SECRET\`, then **Connect** with the Google account whose Drive the company should use.
3. One Google connection serves GA4, Search Console, Drive, Sheets, Calendar, Gmail and YouTube: enabling more Google integrations only adds scopes to the same Connect button (reconnect once after enabling a new one).

## Or a service account
Create a service account, store its key JSON as \`GOOGLE_SERVICE_ACCOUNT_JSON\`, and share the folders the company may use with the service account's email. It sees only what is shared with it.

## Enabling
\`\`\`yaml
integrations:
  - id: google-drive
    modes: [read, write, share]
\`\`\`
`,
  secrets: [
    { name: "GOOGLE_CLIENT_ID", description: "OAuth client id (shared with GA4, Search Console and the other Google integrations)", obtain: "Google Cloud → Credentials", required: false },
    { name: "GOOGLE_CLIENT_SECRET", description: "OAuth client secret", obtain: "Google Cloud → Credentials", required: false },
    { name: "GOOGLE_ACCESS_TOKEN", description: "Access token (set by Connect)", obtain: "Connect button", required: false },
    { name: "GOOGLE_SERVICE_ACCOUNT_JSON", description: "Alternative to Connect: service account key JSON (share files with its email)", obtain: "Google Cloud → IAM → Service Accounts → Keys", required: false },
  ],
  modes: [
    { id: "read", title: "Read", description: "Search and read files", sideEffect: "read" },
    { id: "write", title: "Write", description: "Upload files, create folders and Docs", sideEffect: "write" },
    { id: "share", title: "Share", description: "Grant access to people or by link", sideEffect: "send" },
  ],
  methods: [
    {
      name: "search",
      mode: "read",
      description: "Find files. Plain words search full text and names; Drive query syntax (name contains 'x', mimeType = '…', '<folder id>' in parents) passes through.",
      input: strictSchema({ query: { type: "string" }, limit: { type: "integer", maximum: 50 } }, ["query"]),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const query = String(input.query ?? "").trim();
        if (!query) return fail("bad_input", "query is empty");
        const limit = Math.min(Number(input.limit ?? 20), 50);
        const u = new URL(`${DRIVE}/files`);
        u.searchParams.set("q", driveQ(query));
        u.searchParams.set("pageSize", String(limit));
        u.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,webViewLink)");
        u.searchParams.set("supportsAllDrives", "true");
        u.searchParams.set("includeItemsFromAllDrives", "true");
        const r = await gapi(token, u.toString());
        if (!r.ok) return driveError(r);
        const files = ((r.body.files as Json[]) ?? []).slice(0, limit).map((f) => ({ id: f.id, name: f.name, mime_type: f.mimeType, modified: f.modifiedTime, url: f.webViewLink }));
        return { ok: true, files, count: files.length };
      },
    },
    {
      name: "get",
      mode: "read",
      description: "Metadata for one file: name, type, size, modified time, link, parent folder.",
      input: strictSchema({ file_id: { type: "string" } }),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const r = await gapi(token, `${DRIVE}/files/${enc(String(input.file_id))}?fields=${FIELDS}&supportsAllDrives=true`);
        if (!r.ok) return driveError(r);
        return { ok: true, file: fileOut(r.body) };
      },
    },
    {
      name: "read",
      mode: "read",
      description: "Text of a file: Google Docs as Markdown, Sheets as CSV (first sheet; use google-sheets for ranges), Slides as plain text, text files up to 200 KB. Truncated to 30k characters.",
      input: strictSchema({ file_id: { type: "string" } }),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const id = enc(String(input.file_id));
        const meta = await gapi(token, `${DRIVE}/files/${id}?fields=${FIELDS}&supportsAllDrives=true`);
        if (!meta.ok) return driveError(meta);
        const mime = String(meta.body.mimeType ?? "");
        const headers = { Authorization: `Bearer ${token}` };
        let res: Response;
        let format = EXPORT[mime];
        if (format) {
          res = await fetch(`${DRIVE}/files/${id}/export?mimeType=${enc(format)}`, { headers });
          if (!res.ok && format === "text/markdown") {
            format = "text/plain";
            res = await fetch(`${DRIVE}/files/${id}/export?mimeType=${enc(format)}`, { headers });
          }
        } else if (TEXTISH.test(mime)) {
          const size = Number(meta.body.size ?? 0);
          if (size > MAX_DOWNLOAD) return fail("too_large", `${Math.round(size / 1024)} KB exceeds the 200 KB limit for text files; use google-drive.get for the link`);
          format = mime;
          res = await fetch(`${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`, { headers });
        } else {
          return fail("unsupported", `${mime || "unknown type"} is not text; use google-drive.get for metadata and the link`);
        }
        if (!res.ok) return driveError({ status: res.status, body: (await res.json().catch(() => ({}))) as Json });
        const text = await res.text();
        return { ok: true, file: fileOut(meta.body), format, text: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT };
      },
    },
    {
      name: "upload",
      mode: "write",
      description: "Create a file from text content (Markdown, CSV, JSON, HTML, plain text). mime_type is inferred from the name when omitted.",
      input: strictSchema(
        {
          name: { type: "string" },
          content: { type: "string" },
          mime_type: { type: "string", description: "e.g. text/markdown, text/csv, application/json" },
          folder_id: { type: "string" },
        },
        ["name", "content"],
      ),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const name = String(input.name ?? "").trim();
        if (!name) return fail("bad_input", "name is required");
        const mime = mimeFor(name, input.mime_type);
        const meta: Json = { name, mimeType: mime };
        if (input.folder_id) meta.parents = [String(input.folder_id)];
        const boundary = `hive-${randomUUID()}`;
        const body = [
          `--${boundary}`,
          "Content-Type: application/json; charset=UTF-8",
          "",
          JSON.stringify(meta),
          `--${boundary}`,
          `Content-Type: ${mime}; charset=UTF-8`,
          "",
          String(input.content ?? ""),
          `--${boundary}--`,
          "",
        ].join("\r\n");
        const res = await fetch(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=${FIELDS}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
          body,
        });
        const json = (await res.json().catch(() => ({}))) as Json;
        if (!res.ok) return driveError({ status: res.status, body: json });
        const file = fileOut(json);
        ctx.emit("artifact.created", { kind: "file", ref: String(file.id), name, url: file.url });
        return { ok: true, file };
      },
    },
    {
      name: "create_folder",
      mode: "write",
      description: "Create a folder, optionally inside another folder.",
      input: strictSchema({ name: { type: "string" }, parent_id: { type: "string" } }, ["name"]),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const name = String(input.name ?? "").trim();
        if (!name) return fail("bad_input", "name is required");
        const meta: Json = { name, mimeType: FOLDER };
        if (input.parent_id) meta.parents = [String(input.parent_id)];
        const r = await gapi(token, `${DRIVE}/files?supportsAllDrives=true&fields=id,name,webViewLink,parents`, "POST", meta);
        if (!r.ok) return driveError(r);
        ctx.emit("artifact.created", { kind: "folder", ref: String(r.body.id), name, url: r.body.webViewLink });
        return { ok: true, folder: { id: r.body.id, name: r.body.name, url: r.body.webViewLink, parents: r.body.parents } };
      },
    },
    {
      name: "create_doc",
      mode: "write",
      description: "Create a Google Doc from Markdown. # headings become Docs headings; other lines are inserted as paragraphs.",
      input: strictSchema({ title: { type: "string" }, markdown: { type: "string" }, folder_id: { type: "string" } }, ["title", "markdown"]),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const title = String(input.title ?? "").trim();
        if (!title) return fail("bad_input", "title is required");
        const meta: Json = { name: title, mimeType: "application/vnd.google-apps.document" };
        if (input.folder_id) meta.parents = [String(input.folder_id)];
        const created = await gapi(token, `${DRIVE}/files?supportsAllDrives=true&fields=id,name,webViewLink`, "POST", meta);
        if (!created.ok) return driveError(created);
        const id = String(created.body.id);
        const url = String(created.body.webViewLink ?? `https://docs.google.com/document/d/${id}/edit`);
        const { text, headings } = docBody(String(input.markdown ?? ""));
        if (text.trim()) {
          const requests: Json[] = [{ insertText: { location: { index: 1 }, text } }];
          for (const h of headings) {
            requests.push({
              updateParagraphStyle: {
                range: { startIndex: 1 + h.start, endIndex: 1 + h.end },
                paragraphStyle: { namedStyleType: `HEADING_${h.level}` },
                fields: "namedStyleType",
              },
            });
          }
          const upd = await gapi(token, `${DOCS}/documents/${enc(id)}:batchUpdate`, "POST", { requests });
          if (!upd.ok) return driveError(upd, "docs_error", { doc_id: id, url, note: "the document was created but is empty; is the Google Docs API enabled?" });
        }
        ctx.emit("artifact.created", { kind: "doc", ref: id, title, url });
        return { ok: true, doc_id: id, url, title, headings: headings.length };
      },
    },
    {
      name: "share",
      mode: "share",
      description: "Share a file or folder with a person (to = their email) or with anyone who has the link. First contact parks for the board.",
      input: strictSchema(
        {
          file_id: { type: "string" },
          to: { type: "string", description: "email address of the person; omit when sharing by link" },
          anyone: { type: "boolean", description: "true = anyone with the link" },
          role: { type: "string", enum: ["reader", "commenter", "writer"] },
          reason: { type: "string" },
        },
        ["file_id", "role"],
      ),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const fileId = String(input.file_id ?? "");
        const to = typeof input.to === "string" ? input.to.trim().toLowerCase() : "";
        const anyone = input.anyone === true;
        if (!to && !anyone) return fail("bad_input", "give `to` (an email address) or anyone: true");
        if (to && !EMAIL.test(to)) return fail("bad_input", "`to` must be one email address");
        const role = String(input.role);
        const perm = to ? { type: "user", role, emailAddress: to } : { type: "anyone", role };
        const r = await gapi(token, `${DRIVE}/files/${enc(fileId)}/permissions?supportsAllDrives=true&fields=id,type,role${to ? "&sendNotificationEmail=true" : ""}`, "POST", perm);
        if (!r.ok) return driveError(r);
        if (to) rememberContact(ctx.company.id, to);
        return { ok: true, permission_id: r.body.id, role, shared_with: to || "anyone with the link", url: `https://drive.google.com/open?id=${enc(fileId)}` };
      },
    },
  ],
  async healthcheck(ctx) {
    const sa = ctx.secrets.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    const access = ctx.secrets.get("GOOGLE_ACCESS_TOKEN");
    if (!sa && !access) return { ok: false, detail: "not connected: Connect Google, or store GOOGLE_SERVICE_ACCOUNT_JSON" };
    let token: string;
    try {
      token = sa ? await googleAccessToken(sa, SCOPES.join(" ")) : access!;
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
    const r = await gapi(token, `${DRIVE}/about?fields=user(emailAddress)`);
    const user = r.body.user as { emailAddress?: string } | undefined;
    return r.ok ? { ok: true, detail: `Drive of ${user?.emailAddress ?? "the connected account"}` } : { ok: false, detail: errorMessage(r) };
  },
});
