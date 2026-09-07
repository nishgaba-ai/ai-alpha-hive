// Notion — the company wiki and its databases. An internal-integration
// token sees only the pages and databases the board has shared with it
// (Notion scopes access itself), so `read` is the board's chosen pages
// rendered to Markdown and `write` creates or appends inside them from
// simple Markdown. Nothing here is public: both modes run without
// approvals.

import { defineIntegration, strictSchema, fail } from "../../src/integrations/registry.js";
import type { ToolResult } from "../../src/types.js";

const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";
const MAX_MD = 30_000;
/** block levels fetched under a page: its children and their children */
const MAX_DEPTH = 2;
/** Notion's per-rich-text-item limit */
const CHUNK = 2000;
/** blocks per create/append request */
const BATCH = 100;

type Json = Record<string, unknown>;
type RichText = { plain_text?: string; href?: string | null; annotations?: { bold?: boolean; italic?: boolean; code?: boolean; strikethrough?: boolean }; text?: { content?: string; link?: { url: string } | null } };
type Prop = { type: string } & Record<string, unknown>;
export type NotionBlock = { id?: string; type: string; has_children?: boolean; children?: NotionBlock[] } & Record<string, unknown>;

async function notion(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Notion-Version": VERSION, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as Json;
  return { ok: res.ok, status: res.status, body };
}
const err = (r: { status: number; body: Json }): ToolResult => fail("notion_error", String(r.body.message ?? `HTTP ${r.status}`), { status: r.status });
const missing = () => fail("missing_secret", "NOTION_TOKEN is not in the vault (notion.so/my-integrations → Internal Integration Secret)");
/** Accepts a 32-hex id, a dashed uuid or a Notion URL. */
const idOf = (s: unknown) => String(s).replace(/-/g, "").match(/[0-9a-f]{32}/i)?.[0] ?? String(s);
const lim = (v: unknown, d: number) => Math.max(1, Math.min(Number(v ?? d) || d, 100));

// ------------------------------------------------------------ rendering

function inline(rt: RichText[] | undefined): string {
  return (rt ?? [])
    .map((t) => {
      let s = t.plain_text ?? t.text?.content ?? "";
      if (!s) return "";
      const a = t.annotations ?? {};
      if (a.code) s = `\`${s}\``;
      if (a.bold) s = `**${s}**`;
      if (a.italic) s = `_${s}_`;
      if (a.strikethrough) s = `~~${s}~~`;
      const href = t.href ?? t.text?.link?.url;
      return href ? `[${s}](${href})` : s;
    })
    .join("");
}

function titleOf(o: Json): string {
  if (o.object === "database") return inline(o.title as RichText[]);
  for (const p of Object.values((o.properties ?? {}) as Record<string, Prop>)) if (p.type === "title") return inline(p.title as RichText[]);
  return "";
}

const LIST = new Set(["bulleted_list_item", "numbered_list_item", "to_do", "toggle"]);

/** Notion blocks (with nested `children`) → Markdown. Exported for tests. */
export function blocksToMarkdown(blocks: NotionBlock[], depth = 0): string {
  const pad = "  ".repeat(depth);
  const parts: { text: string; list: boolean }[] = [];
  let n = 0;
  for (const b of blocks) {
    const v = (b[b.type] ?? {}) as { rich_text?: RichText[]; checked?: boolean; language?: string; title?: string; external?: { url?: string }; file?: { url?: string } };
    const text = inline(v.rich_text);
    n = b.type === "numbered_list_item" ? n + 1 : 0;
    let line: string;
    switch (b.type) {
      case "paragraph": line = text; break;
      case "heading_1": line = `# ${text}`; break;
      case "heading_2": line = `## ${text}`; break;
      case "heading_3": line = `### ${text}`; break;
      case "bulleted_list_item": case "toggle": line = `- ${text}`; break;
      case "numbered_list_item": line = `${n}. ${text}`; break;
      case "to_do": line = `- [${v.checked ? "x" : " "}] ${text}`; break;
      case "quote": case "callout": line = `> ${text}`; break;
      case "code": {
        const lang = v.language && v.language !== "plain text" ? v.language : "";
        line = `\`\`\`${lang}\n${(v.rich_text ?? []).map((t) => t.plain_text ?? t.text?.content ?? "").join("")}\n\`\`\``;
        break;
      }
      case "divider": line = "---"; break;
      case "child_page": line = `[${v.title ?? "page"}] (child page ${b.id ?? ""})`; break;
      case "child_database": line = `[${v.title ?? "database"}] (child database ${b.id ?? ""})`; break;
      case "image": line = `![image](${v.external?.url ?? v.file?.url ?? ""})`; break;
      default: continue;
    }
    if (!line) continue;
    parts.push({ text: line.split("\n").map((l) => pad + l).join("\n"), list: LIST.has(b.type) });
    if (b.children?.length) parts.push({ text: blocksToMarkdown(b.children, depth + 1), list: true });
  }
  return parts.map((p, i) => (i === 0 ? "" : p.list && parts[i - 1].list ? "\n" : "\n\n") + p.text).join("");
}

const LANGS = new Set("abap arduino bash basic c clojure coffeescript c++ c# css dart diff docker elixir elm erlang flow fortran f# gherkin glsl go graphql groovy haskell html java javascript json julia kotlin latex less lisp livescript lua makefile markdown markup matlab mermaid nix objective-c ocaml pascal perl php powershell prolog protobuf python r reason ruby rust sass scala scheme scss shell sql swift typescript vb.net verilog vhdl webassembly xml yaml".split(" "));
const ALIAS: Record<string, string> = { js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", sh: "shell", zsh: "shell", yml: "yaml", md: "markdown", cpp: "c++", cs: "c#", rb: "ruby", rs: "rust", golang: "go", dockerfile: "docker", ps1: "powershell" };
function lang(s: string): string {
  const l = s.toLowerCase();
  const m = ALIAS[l] ?? l;
  return LANGS.has(m) ? m : "plain text";
}

function plain(content: string, extra: Json = {}, annotations?: Json): Json[] {
  const out: Json[] = [];
  for (let i = 0; i < content.length; i += CHUNK) out.push({ type: "text", text: { content: content.slice(i, i + CHUNK), ...extra }, ...(annotations ? { annotations } : {}) });
  return out;
}

/** Inline **bold**, `code` and [text](url) → rich text; everything else is literal. */
function rich(s: string): Json[] {
  const out: Json[] = [];
  const re = /\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(...plain(s.slice(last, at)));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(...plain(tok.slice(2, -2), {}, { bold: true }));
    else if (tok.startsWith("`")) out.push(...plain(tok.slice(1, -1), {}, { code: true }));
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      out.push(...plain(link[1], { link: { url: link[2] } }));
    }
    last = at + tok.length;
  }
  if (last < s.length) out.push(...plain(s.slice(last)));
  return out;
}

/** Simple Markdown → Notion blocks: # ## ### headings, - bullets, 1. numbered, - [ ] to-dos, > quotes, ``` code, --- dividers, paragraphs. Exported for tests. */
export function markdownToBlocks(md: string): Json[] {
  const blocks: Json[] = [];
  const add = (type: string, body: Json) => blocks.push({ object: "block", type, [type]: body });
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) add("paragraph", { rich_text: rich(para.join("\n")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^```\s*(\S*)\s*$/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i]);
      add("code", { rich_text: plain(code.join("\n")), language: lang(fence[1]) });
      continue;
    }
    let m: RegExpExecArray | null;
    if (!line.trim()) flush();
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); add("divider", {}); }
    else if ((m = /^(#{1,6})\s+(.+)$/.exec(line))) { flush(); add(`heading_${Math.min(m[1].length, 3)}`, { rich_text: rich(m[2]) }); }
    else if ((m = /^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/.exec(line))) { flush(); add("to_do", { rich_text: rich(m[2]), checked: m[1] !== " " }); }
    else if ((m = /^\s*[-*+]\s+(.+)$/.exec(line))) { flush(); add("bulleted_list_item", { rich_text: rich(m[1]) }); }
    else if ((m = /^\s*\d+[.)]\s+(.+)$/.exec(line))) { flush(); add("numbered_list_item", { rich_text: rich(m[1]) }); }
    else if ((m = /^>\s?(.*)$/.exec(line))) { flush(); add("quote", { rich_text: rich(m[1]) }); }
    else para.push(line);
  }
  flush();
  return blocks;
}

/** Notion property values → plain JSON (title/rich_text → text, select → name, people → names …). Exported for tests. */
export function flattenProperties(props: Record<string, Prop>): Json {
  const out: Json = {};
  for (const [name, p] of Object.entries(props ?? {})) {
    const v = p[p.type];
    switch (p.type) {
      case "title": case "rich_text": out[name] = inline(v as RichText[]); break;
      case "select": case "status": out[name] = (v as { name?: string } | null)?.name ?? null; break;
      case "multi_select": out[name] = ((v as { name: string }[]) ?? []).map((x) => x.name); break;
      case "number": case "checkbox": case "url": case "email": case "phone_number": case "created_time": case "last_edited_time": out[name] = v ?? null; break;
      case "date": {
        const d = v as { start?: string; end?: string | null } | null;
        out[name] = d ? (d.end ? `${d.start} → ${d.end}` : d.start ?? null) : null;
        break;
      }
      case "people": out[name] = ((v as { id: string; name?: string }[]) ?? []).map((x) => x.name ?? x.id); break;
      case "relation": out[name] = ((v as { id: string }[]) ?? []).map((x) => x.id); break;
      case "formula": {
        const f = v as ({ type: string } & Record<string, unknown>) | null;
        out[name] = !f ? null : f.type === "date" ? ((f.date as { start?: string } | null)?.start ?? null) : (f[f.type] ?? null);
        break;
      }
      default: break; // files, rollups, unique ids … omitted to keep rows small
    }
  }
  return out;
}

async function blockTree(token: string, id: string, level = 1): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 3; page++) {
    const r = await notion(token, `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!r.ok) break;
    blocks.push(...((r.body.results as NotionBlock[]) ?? []));
    if (!r.body.has_more || !r.body.next_cursor) break;
    cursor = String(r.body.next_cursor);
  }
  if (level < MAX_DEPTH) {
    for (const b of blocks) if (b.has_children && b.id && b.type !== "child_page" && b.type !== "child_database") b.children = await blockTree(token, b.id, level + 1);
  }
  return blocks;
}

async function appendBlocks(token: string, pageId: string, blocks: Json[], from = 0): Promise<ToolResult | undefined> {
  for (let i = from; i < blocks.length; i += BATCH) {
    const r = await notion(token, `/blocks/${pageId}/children`, { method: "PATCH", body: JSON.stringify({ children: blocks.slice(i, i + BATCH) }) });
    if (!r.ok) return fail("notion_error", `appending blocks ${i}–${Math.min(i + BATCH, blocks.length)} failed: ${String(r.body.message ?? r.status)}`, { page_id: pageId, appended: i });
  }
  return undefined;
}

// ---------------------------------------------------------- integration

export default defineIntegration({
  id: "notion",
  auth: { kind: "api_key", guide: "notion.so/my-integrations → New internal integration → copy the Internal Integration Secret. Then share each page or database with the integration (page ⋯ menu → Connections); it sees nothing else." },
  title: "Notion",
  description: "Read and write the pages and databases the board shares with the integration: search, render pages to Markdown, query databases, create and append pages.",
  website: "https://developers.notion.com",
  guidance: `
## What it does
- **read** — \`notion.search\` finds pages and databases shared with the integration; \`notion.get_page\` renders a page (two levels of blocks) to Markdown; \`notion.query_database\` returns rows with flattened property values (title, text, select, dates, people …).
- **write** — \`notion.create_page\` creates a page under a page or as a row of a database from simple Markdown (headings, bullets, numbered lists, to-dos, quotes, code); \`notion.append\` adds Markdown to an existing page; \`notion.update_page\` sets properties (status, dates, selects) using Notion's property-value format.

Notion scopes access itself: the integration only sees what the board has shared with it, and nothing here is public, so both modes are \`read\`/\`write\` class and run without approvals. Pages are returned as Markdown truncated at 30k characters.

## Connecting
1. https://www.notion.so/my-integrations → **New integration** (internal, your workspace; capabilities: read, update, insert content) → copy the **Internal Integration Secret** → \`NOTION_TOKEN\`.
2. In Notion, open each page or database the company may use → **⋯ → Connections → add the integration**. Child pages inherit the share.
3. Run the healthcheck, then \`notion.search\` to find page and database ids.

## Enabling
\`\`\`yaml
integrations:
  - id: notion
    modes: [read, write]
roles:
  - id: ops
    tools: [notion.*]          # or notion:read for a researcher
\`\`\`
`,
  secrets: [
    { name: "NOTION_TOKEN", description: "Internal integration secret (ntn_… / secret_…)", obtain: "https://www.notion.so/my-integrations → your integration → Internal Integration Secret" },
  ],
  modes: [
    { id: "read", title: "Read", description: "Search, read pages, query databases", sideEffect: "read" },
    { id: "write", title: "Write", description: "Create and append pages, set properties", sideEffect: "write" },
  ],
  methods: [
    {
      name: "search", mode: "read",
      description: "Search pages and databases shared with the integration by title/content. kind narrows to page or database.",
      input: strictSchema({ query: { type: "string" }, kind: { type: "string", enum: ["page", "database"] }, limit: { type: "integer", minimum: 1, maximum: 100 } }, ["query"]),
      async handler(ctx, input) {
        const token = ctx.secrets.get("NOTION_TOKEN");
        if (!token) return missing();
        const body: Json = { query: String(input.query), page_size: lim(input.limit, 10), sort: { direction: "descending", timestamp: "last_edited_time" } };
        if (input.kind) body.filter = { property: "object", value: input.kind };
        const r = await notion(token, "/search", { method: "POST", body: JSON.stringify(body) });
        if (!r.ok) return err(r);
        const results = ((r.body.results as Json[]) ?? []).map((o) => ({ id: o.id, kind: o.object, title: titleOf(o), url: o.url, last_edited: o.last_edited_time }));
        return { ok: true, results, has_more: !!r.body.has_more };
      },
    },
    {
      name: "get_page", mode: "read",
      description: "Read a page (id or URL) as Markdown: its blocks and their children, two levels deep, truncated at 30k characters.",
      input: strictSchema({ page_id: { type: "string" } }),
      async handler(ctx, input) {
        const token = ctx.secrets.get("NOTION_TOKEN");
        if (!token) return missing();
        const id = idOf(input.page_id);
        const p = await notion(token, `/pages/${id}`);
        if (!p.ok) return err(p);
        let markdown = blocksToMarkdown(await blockTree(token, id));
        const truncated = markdown.length > MAX_MD;
        if (truncated) markdown = markdown.slice(0, MAX_MD);
        return { ok: true, page_id: p.body.id, title: titleOf(p.body), url: p.body.url, last_edited: p.body.last_edited_time, markdown, truncated };
      },
    },
    {
      name: "query_database", mode: "read",
      description: "Rows of a database with flattened property values. filter and sorts use Notion's API format (e.g. {\"property\":\"Status\",\"select\":{\"equals\":\"Doing\"}}).",
      input: strictSchema(
        {
          database_id: { type: "string" },
          filter: { type: "object", description: "Notion filter object" },
          sorts: { type: "array", items: { type: "object" }, description: "[{property, direction: ascending|descending}]" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        ["database_id"],
      ),
      async handler(ctx, input) {
        const token = ctx.secrets.get("NOTION_TOKEN");
        if (!token) return missing();
        const body: Json = { page_size: lim(input.limit, 25) };
        if (input.filter) body.filter = input.filter;
        if (input.sorts) body.sorts = input.sorts;
        const r = await notion(token, `/databases/${idOf(input.database_id)}/query`, { method: "POST", body: JSON.stringify(body) });
        if (!r.ok) return err(r);
        const rows = ((r.body.results as Json[]) ?? []).map((p) => ({ id: p.id, url: p.url, properties: flattenProperties((p.properties ?? {}) as Record<string, Prop>) }));
        return { ok: true, rows, has_more: !!r.body.has_more };
      },
    },
    {
      name: "create_page", mode: "write",
      description: "Create a page under parent_page_id, or a row in parent_database_id, from a title and simple Markdown. properties are raw Notion property values for database rows.",
      input: strictSchema(
        {
          parent_page_id: { type: "string", description: "create under this page" },
          parent_database_id: { type: "string", description: "or as a row of this database" },
          title: { type: "string", maxLength: 500 },
          markdown: { type: "string", description: "# ## ### headings, - bullets, 1. numbered, - [ ] to-dos, > quotes, ``` code, paragraphs" },
          properties: { type: "object", description: "raw Notion property values, e.g. {\"Status\": {\"select\": {\"name\": \"Doing\"}}}" },
        },
        ["title"],
      ),
      async handler(ctx, input) {
        const token = ctx.secrets.get("NOTION_TOKEN");
        if (!token) return missing();
        const parentPage = input.parent_page_id ? idOf(input.parent_page_id) : undefined;
        const parentDb = input.parent_database_id ? idOf(input.parent_database_id) : undefined;
        if (!parentPage && !parentDb) return fail("bad_input", "give parent_page_id or parent_database_id (shared with the integration); notion.search finds ids");
        let titleProp = "title";
        if (parentDb) {
          const db = await notion(token, `/databases/${parentDb}`);
          if (!db.ok) return err(db);
          titleProp = Object.entries((db.body.properties ?? {}) as Record<string, Prop>).find(([, p]) => p.type === "title")?.[0] ?? "Name";
        }
        const blocks = markdownToBlocks(String(input.markdown ?? ""));
        const properties: Json = { ...((input.properties as Json) ?? {}), [titleProp]: { title: plain(String(input.title)) } };
        const r = await notion(token, "/pages", { method: "POST", body: JSON.stringify({ parent: parentDb ? { database_id: parentDb } : { page_id: parentPage }, properties, children: blocks.slice(0, BATCH) }) });
        if (!r.ok) return err(r);
        const id = String(r.body.id);
        const url = String(r.body.url ?? "");
        const rest = await appendBlocks(token, id, blocks, BATCH);
        if (rest) return { ...rest, page_id: id, url, hint: "the page exists; call notion.append with the remaining Markdown" };
        ctx.emit("artifact.created", { kind: "page", ref: url, title: input.title, channel: "notion" });
        return { ok: true, page_id: id, url, blocks: blocks.length };
      },
    },
    {
      name: "append", mode: "write",
      description: "Append Markdown (converted to blocks) to the end of a page.",
      input: strictSchema({ page_id: { type: "string" }, markdown: { type: "string" } }),
      async handler(ctx, input) {
        const token = ctx.secrets.get("NOTION_TOKEN");
        if (!token) return missing();
        const blocks = markdownToBlocks(String(input.markdown ?? ""));
        if (!blocks.length) return fail("bad_input", "markdown is empty");
        const id = idOf(input.page_id);
        const r = await appendBlocks(token, id, blocks);
        return r ?? { ok: true, page_id: id, appended: blocks.length };
      },
    },
    {
      name: "update_page", mode: "write",
      description: "Set page properties using Notion's property-value format, e.g. {\"Status\": {\"select\": {\"name\": \"Done\"}}, \"Due\": {\"date\": {\"start\": \"2026-10-01\"}}}.",
      input: strictSchema({ page_id: { type: "string" }, properties: { type: "object" } }),
      async handler(ctx, input) {
        const token = ctx.secrets.get("NOTION_TOKEN");
        if (!token) return missing();
        const r = await notion(token, `/pages/${idOf(input.page_id)}`, { method: "PATCH", body: JSON.stringify({ properties: input.properties ?? {} }) });
        if (!r.ok) return err(r);
        return { ok: true, page_id: r.body.id, url: r.body.url, properties: flattenProperties((r.body.properties ?? {}) as Record<string, Prop>) };
      },
    },
  ],
  async healthcheck(ctx) {
    const token = ctx.secrets.get("NOTION_TOKEN");
    if (!token) return { ok: false, detail: "NOTION_TOKEN missing" };
    const r = await notion(token, "/users/me");
    return r.ok ? { ok: true, detail: `connected as ${String(r.body.name ?? "bot")} (${String(r.body.type ?? "bot")}); share pages with it to make them visible` } : { ok: false, detail: String(r.body.message ?? `rejected (HTTP ${r.status})`) };
  },
});
