// Google Sheets — read ranges, append or update rows, create spreadsheets.
// Values are read as displayed and written USER_ENTERED (numbers, dates
// and =formulas parse as if typed into the cell). Uses the shared Google
// connection (prefix GOOGLE) or a service account the sheet is shared with.

import { defineIntegration, strictSchema, fail, type OAuthConfig } from "../../src/integrations/registry.js";
import { ensureToken } from "../../src/oauth.js";
import { googleAccessToken } from "../../src/integrations/google.js";
import type { ToolContext, ToolResult } from "../../src/types.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.file"];
export const AUTH: OAuthConfig = {
  kind: "oauth2",
  prefix: "GOOGLE",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: SCOPES,
  tokenAuth: "body",
  extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  guide: "console.cloud.google.com → APIs & Services → enable Google Sheets API and Google Drive API → Credentials → OAuth client (Web application) → Authorized redirect URIs = the one shown here; copy Client ID and Client Secret. One Google connection serves GA4, Search Console, Drive, Sheets, Calendar, Gmail and YouTube.",
};

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const MAX_CHARS = 30_000;
const MAX_ROWS = 500;
const enc = encodeURIComponent;

type Json = Record<string, unknown>;
type Ctx = Pick<ToolContext, "company" | "secrets">;

function notConnected(): ToolResult {
  return fail("not_connected", "Connect Google on the Integrations screen, or store GOOGLE_SERVICE_ACCOUNT_JSON and share the spreadsheet with the service account's email");
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

async function gapi(token: string, url: string, method: "GET" | "POST" | "PUT" = "GET", json?: unknown): Promise<{ ok: boolean; status: number; body: Json }> {
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
  if (r.status === 403) return `${message} — is the spreadsheet shared with the connected account, and is the Sheets API enabled?`;
  if (r.status === 404) return `${message} — check spreadsheet_id (the long id in the sheet's URL)`;
  return message;
}
function sheetsError(r: { status: number; body: Json }): ToolResult {
  return fail("sheets_error", errorMessage(r));
}

/** Keep responses small: at most MAX_ROWS rows and about MAX_CHARS characters. */
function capRows(rows: unknown[][]): { rows: unknown[][]; truncated: boolean } {
  const out: unknown[][] = [];
  let size = 2;
  for (const r of rows.slice(0, MAX_ROWS)) {
    const s = JSON.stringify(r).length + 1;
    if (size + s > MAX_CHARS) break;
    out.push(r);
    size += s;
  }
  return { rows: out, truncated: out.length < rows.length };
}

function rowsInput(v: unknown): string[][] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  return v.map((r) => (Array.isArray(r) ? r.map((c) => (c === null || c === undefined ? "" : String(c))) : [String(r)]));
}

const ROWS = { type: "array", items: { type: "array", items: { type: "string" } }, minItems: 1, description: "rows of cell values; numbers, dates and =formulas are parsed as typed" };

export default defineIntegration({
  id: "google-sheets",
  auth: AUTH,
  title: "Google Sheets",
  description: "Read ranges, append and update rows, and create spreadsheets in Google Sheets.",
  website: "https://developers.google.com/sheets/api",
  guidance: `
## What it does
- **read** — \`google-sheets.list_sheets\` lists the tabs of a spreadsheet with their sizes; \`google-sheets.read_range\` returns the values of an A1 range (\`Sheet1!A1:D50\`) as rows.
- **write** — \`google-sheets.append_rows\` adds rows after the last row of a range's table; \`google-sheets.update_range\` overwrites a range; \`google-sheets.create_spreadsheet\` makes a new spreadsheet (returns id and url). Values are USER_ENTERED, so \`=SUM(A1:A9)\` becomes a formula and \`2026-09-07\` a date.

## Connecting (OAuth, recommended)
1. Google Cloud → APIs & Services → enable **Google Sheets API** (and **Google Drive API**, used to create spreadsheets) → Credentials → OAuth client, type Web application, redirect URI = the one shown here.
2. Paste Client ID and Client Secret into the vault as \`GOOGLE_CLIENT_ID\` / \`GOOGLE_CLIENT_SECRET\`, then **Connect** with the Google account that owns or can edit the spreadsheets.
3. One Google connection serves GA4, Search Console, Drive, Sheets, Calendar, Gmail and YouTube: enabling more Google integrations only adds scopes to the same Connect button (reconnect once after enabling a new one).

## Or a service account
Create a service account, store its key JSON as \`GOOGLE_SERVICE_ACCOUNT_JSON\`, and share each spreadsheet with the service account's email (Editor to write). Spreadsheets it creates live in its own Drive: share them back or create them in a shared folder with google-drive.

## Enabling
\`\`\`yaml
integrations:
  - id: google-sheets
    modes: [read, write]
\`\`\`
The spreadsheet id is the long token in the sheet's URL (\`/spreadsheets/d/<id>/edit\`).
`,
  secrets: [
    { name: "GOOGLE_CLIENT_ID", description: "OAuth client id (shared with GA4, Search Console and the other Google integrations)", obtain: "Google Cloud → Credentials", required: false },
    { name: "GOOGLE_CLIENT_SECRET", description: "OAuth client secret", obtain: "Google Cloud → Credentials", required: false },
    { name: "GOOGLE_ACCESS_TOKEN", description: "Access token (set by Connect)", obtain: "Connect button", required: false },
    { name: "GOOGLE_SERVICE_ACCOUNT_JSON", description: "Alternative to Connect: service account key JSON (share spreadsheets with its email)", obtain: "Google Cloud → IAM → Service Accounts → Keys", required: false },
  ],
  modes: [
    { id: "read", title: "Read", description: "Tabs and cell ranges", sideEffect: "read" },
    { id: "write", title: "Write", description: "Append and update rows, create spreadsheets", sideEffect: "write" },
  ],
  methods: [
    {
      name: "list_sheets",
      mode: "read",
      description: "Title, url and the tabs (name, index, rows × columns) of a spreadsheet.",
      input: strictSchema({ spreadsheet_id: { type: "string" } }),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const r = await gapi(token, `${SHEETS}/${enc(String(input.spreadsheet_id))}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))`);
        if (!r.ok) return sheetsError(r);
        const sheets = ((r.body.sheets as { properties?: { sheetId?: number; title?: string; index?: number; gridProperties?: { rowCount?: number; columnCount?: number } } }[]) ?? [])
          .slice(0, 100)
          .map((s) => ({ id: s.properties?.sheetId, title: s.properties?.title, index: s.properties?.index, rows: s.properties?.gridProperties?.rowCount, columns: s.properties?.gridProperties?.columnCount }));
        return { ok: true, id: r.body.spreadsheetId, title: (r.body.properties as { title?: string } | undefined)?.title, url: r.body.spreadsheetUrl, sheets };
      },
    },
    {
      name: "read_range",
      mode: "read",
      description: "Values of an A1 range as rows of strings, e.g. Sheet1!A1:D50 or a bare tab name for the whole tab. At most 500 rows.",
      input: strictSchema({ spreadsheet_id: { type: "string" }, range: { type: "string" } }),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const r = await gapi(token, `${SHEETS}/${enc(String(input.spreadsheet_id))}/values/${enc(String(input.range))}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`);
        if (!r.ok) return sheetsError(r);
        const all = (r.body.values as unknown[][]) ?? [];
        const { rows, truncated } = capRows(all);
        return { ok: true, range: r.body.range, rows, row_count: all.length, truncated };
      },
    },
    {
      name: "append_rows",
      mode: "write",
      description: "Append rows after the last row of the table found in `range` (e.g. Sheet1!A:D). Returns the range written.",
      input: strictSchema({ spreadsheet_id: { type: "string" }, range: { type: "string" }, rows: ROWS }),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const rows = rowsInput(input.rows);
        if (!rows) return fail("bad_input", "rows must be a non-empty array of arrays of cell values");
        const r = await gapi(
          token,
          `${SHEETS}/${enc(String(input.spreadsheet_id))}/values/${enc(String(input.range))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS&includeValuesInResponse=false`,
          "POST",
          { majorDimension: "ROWS", values: rows },
        );
        if (!r.ok) return sheetsError(r);
        const u = (r.body.updates as { updatedRange?: string; updatedRows?: number; updatedCells?: number } | undefined) ?? {};
        return { ok: true, updated_range: u.updatedRange, updated_rows: u.updatedRows ?? rows.length, updated_cells: u.updatedCells };
      },
    },
    {
      name: "update_range",
      mode: "write",
      description: "Overwrite a range with rows, starting at its top-left cell (e.g. Sheet1!B2). Cells outside the given rows are left alone.",
      input: strictSchema({ spreadsheet_id: { type: "string" }, range: { type: "string" }, rows: ROWS }),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const rows = rowsInput(input.rows);
        if (!rows) return fail("bad_input", "rows must be a non-empty array of arrays of cell values");
        const range = String(input.range);
        const r = await gapi(token, `${SHEETS}/${enc(String(input.spreadsheet_id))}/values/${enc(range)}?valueInputOption=USER_ENTERED&includeValuesInResponse=false`, "PUT", { range, majorDimension: "ROWS", values: rows });
        if (!r.ok) return sheetsError(r);
        return { ok: true, updated_range: r.body.updatedRange, updated_rows: r.body.updatedRows, updated_cells: r.body.updatedCells };
      },
    },
    {
      name: "create_spreadsheet",
      mode: "write",
      description: "Create a spreadsheet with the given title and tab names (default one tab, Sheet1). Returns id and url.",
      input: strictSchema({ title: { type: "string" }, sheets: { type: "array", items: { type: "string" }, description: "tab names" } }, ["title"]),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const title = String(input.title ?? "").trim();
        if (!title) return fail("bad_input", "title is required");
        const tabs = (Array.isArray(input.sheets) ? (input.sheets as unknown[]).map(String).filter((s) => s.trim()) : []).slice(0, 50);
        const body: Json = { properties: { title } };
        if (tabs.length) body.sheets = tabs.map((t) => ({ properties: { title: t } }));
        const r = await gapi(token, `${SHEETS}?fields=spreadsheetId,spreadsheetUrl,sheets(properties(sheetId,title))`, "POST", body);
        if (!r.ok) return sheetsError(r);
        const id = String(r.body.spreadsheetId);
        const url = String(r.body.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${id}/edit`);
        const sheets = ((r.body.sheets as { properties?: { sheetId?: number; title?: string } }[]) ?? []).map((s) => ({ id: s.properties?.sheetId, title: s.properties?.title }));
        ctx.emit("artifact.created", { kind: "spreadsheet", ref: id, title, url });
        return { ok: true, id, url, title, sheets };
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
    // about.get accepts the drive.file scope, so this verifies the token without needing a spreadsheet id.
    const r = await gapi(token, "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)");
    const user = r.body.user as { emailAddress?: string } | undefined;
    return r.ok ? { ok: true, detail: `Sheets as ${user?.emailAddress ?? "the connected account"}` } : { ok: false, detail: errorMessage(r) };
  },
});
