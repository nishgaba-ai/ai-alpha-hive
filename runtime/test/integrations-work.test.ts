// Shape and offline-safety tests for the work integrations: notion,
// github, hubspot, webhook, stripe, razorpay. Every handler must refuse
// before any network call when the vault is empty; the webhook must
// refuse hosts outside its allowlist and never forward Authorization.

import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { openMemoryDb } from "../src/db.js";
import type { Integration } from "../src/integrations/registry.js";
import type { ToolContext, ToolResult } from "../src/types.js";
import { AUTH as BLOG_AUTH } from "../integrations/blog/index.js";
import notion, { blocksToMarkdown, flattenProperties, markdownToBlocks } from "../integrations/notion/index.js";
import github, { AUTH as GITHUB_AUTH } from "../integrations/github/index.js";
import hubspot from "../integrations/hubspot/index.js";
import webhook, { hostAllowed } from "../integrations/webhook/index.js";
import stripe from "../integrations/stripe/index.js";
import razorpay from "../integrations/razorpay/index.js";

const ALL: Integration[] = [notion, github, hubspot, webhook, stripe, razorpay];

type Failed = ToolResult & { error?: { code: string; hint: string } };
type Schema = { type: string; properties?: Record<string, { type?: string; enum?: unknown[] }>; required?: string[] | null; additionalProperties?: boolean };
const schemaOf = (m: Integration["methods"][number]) => m.input as unknown as Schema;

function ctxWith(secrets: Record<string, string> = {}): ToolContext {
  return {
    company: { id: "c1", name: "T", slug: "t", currency: "INR" } as any,
    config: {} as any,
    companyDir: "",
    agent: {} as any,
    role: {} as any,
    run: {} as any,
    secrets: { get: (n: string) => secrets[n], names: () => Object.keys(secrets) },
    emit: () => {},
  };
}

/** A plausible input for a method from its schema: every required field, typed. */
function sampleFor(schema: Schema): Record<string, unknown> {
  const props = schema.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const name of schema.required ?? []) {
    const p = props[name] ?? {};
    if (p.enum?.length) out[name] = p.enum[0];
    else if (name === "url") out[name] = "https://hooks.zapier.com/hooks/catch/1/2";
    else if (name === "repo") out[name] = "owner/name";
    else if (p.type === "integer" || p.type === "number") out[name] = 1;
    else if (p.type === "array") out[name] = [];
    else if (p.type === "object") out[name] = {};
    else if (p.type === "boolean") out[name] = true;
    else out[name] = "x";
  }
  return out;
}

// Any fetch during these tests is a bug: handlers must refuse before the network.
const offline = vi.fn(async () => {
  throw new Error("network call during an offline test");
});

beforeAll(() => {
  openMemoryDb();
  vi.stubGlobal("fetch", offline);
});

describe("work integrations: shape", () => {
  it.each(ALL.map((i) => [i.id, i] as const))("%s declares title, guidance, secrets, modes, methods, healthcheck", (_id, i) => {
    expect(i.id).toMatch(/^[a-z][a-z0-9-]*$/);
    for (const k of ["title", "description", "website"] as const) expect(i[k]).toBeTruthy();
    expect(i.guidance).toContain("## What it does");
    expect(i.guidance).toContain("## Connecting");
    expect(i.guidance).toContain("integrations:");
    expect(i.auth?.kind).toBeTruthy();
    expect(i.secrets.length).toBeGreaterThan(0);
    for (const s of i.secrets) expect(s.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
    expect(i.modes.length).toBeGreaterThan(0);
    const modes = new Set(i.modes.map((m) => m.id));
    for (const m of i.methods) {
      expect(m.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(modes.has(m.mode)).toBe(true);
      expect(m.description).toBeTruthy();
      const schema = schemaOf(m);
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
      for (const r of schema.required ?? []) expect(Object.keys(schema.properties ?? {})).toContain(r);
    }
    expect(typeof i.healthcheck).toBe("function");
  });

  it("has the promised modes and methods", () => {
    const names = (i: Integration) => i.methods.map((m) => m.name).sort();
    const modes = (i: Integration) => Object.fromEntries(i.modes.map((m) => [m.id, m.sideEffect]));
    expect(modes(notion)).toEqual({ read: "read", write: "write" });
    expect(names(notion)).toEqual(["append", "create_page", "get_page", "query_database", "search", "update_page"]);
    expect(modes(github)).toEqual({ read: "read", write: "write", ship: "deploy" });
    expect(names(github)).toEqual(["comment", "commits", "create_issue", "create_pr", "file", "issues", "merge_pr", "pulls", "repos"]);
    expect(github.methods.find((m) => m.name === "merge_pr")?.mode).toBe("ship");
    expect(modes(hubspot)).toEqual({ read: "read", write: "write" });
    expect(names(hubspot)).toEqual(["add_note", "create_contact", "create_deal", "deals", "search_contacts", "update_contact"]);
    expect(modes(webhook)).toEqual({ call: "send" });
    expect(names(webhook)).toEqual(["call"]);
    expect(modes(stripe)).toEqual({ read: "read" });
    expect(names(stripe)).toEqual(["balance", "customers", "payments", "payouts"]);
    expect(modes(razorpay)).toEqual({ read: "read" });
    expect(names(razorpay)).toEqual(["orders", "payment_links", "payments", "settlements"]);
  });

  it("github shares the blog's GitHub connection", () => {
    expect(GITHUB_AUTH.kind).toBe("oauth2");
    expect(GITHUB_AUTH.prefix).toBe(BLOG_AUTH.prefix);
    expect(GITHUB_AUTH.scopes).toEqual(expect.arrayContaining(BLOG_AUTH.scopes));
    expect(github.auth).toEqual(GITHUB_AUTH);
    expect(github.secrets.map((s) => s.name)).toEqual(expect.arrayContaining(["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_ACCESS_TOKEN"]));
    expect(github.secrets.find((s) => s.name === "GITHUB_ACCESS_TOKEN")?.required).not.toBe(false);
  });

  it("finance views are read-only; merge_pr carries env for the deploy gate; webhook needs a reason", () => {
    for (const i of [stripe, razorpay]) for (const m of i.modes) expect(m.sideEffect).toBe("read");
    expect(stripe.secrets.map((s) => s.name)).toEqual(["STRIPE_SECRET_KEY"]);
    expect(razorpay.secrets.map((s) => s.name).sort()).toEqual(["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]);
    const merge = schemaOf(github.methods.find((m) => m.name === "merge_pr")!);
    expect(merge.required).toEqual(expect.arrayContaining(["repo", "number", "env", "reason"]));
    expect(merge.properties?.env?.enum).toEqual(["preview", "prod"]);
    const call = schemaOf(webhook.methods[0]);
    expect(call.required).toEqual(expect.arrayContaining(["url", "reason"]));
    expect(webhook.secrets.find((s) => s.name === "WEBHOOK_SIGNING_SECRET")?.required).toBe(false);
  });
});

describe("work integrations: offline safety", () => {
  const cases = ALL.flatMap((i) => i.methods.map((m) => [`${i.id}.${m.name}`, m] as const));
  it.each(cases)("%s refuses without credentials and without touching the network", async (_name, m) => {
    const r = (await m.handler(ctxWith(), sampleFor(schemaOf(m)))) as Failed;
    expect(r.ok).toBe(false);
    expect(["not_connected", "missing_secret"]).toContain(r.error?.code);
    expect(r.error?.hint).toBeTruthy();
    expect(offline).not.toHaveBeenCalled();
  });

  it.each(ALL.map((i) => [i.id, i] as const))("%s healthcheck fails cleanly without credentials", async (_id, i) => {
    const h = await i.healthcheck!(ctxWith());
    expect(h.ok).toBe(false);
    expect(h.detail).toBeTruthy();
    expect(offline).not.toHaveBeenCalled();
  });

  it("razorpay needs both halves of the key pair", async () => {
    const r = (await razorpay.methods[0].handler(ctxWith({ RAZORPAY_KEY_ID: "rzp_test_x" }), {})) as Failed;
    expect(r.error?.code).toBe("missing_secret");
    expect(offline).not.toHaveBeenCalled();
  });
});

describe("webhook", () => {
  const call = webhook.methods.find((m) => m.name === "call")!;

  it("blocks hosts outside the allowlist before any network", async () => {
    const r = (await call.handler(ctxWith({ WEBHOOK_ALLOWED_HOSTS: "hooks.zapier.com" }), { url: "https://evil.example/x", body: { a: 1 }, reason: "test" })) as Failed;
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("blocked");
    expect(offline).not.toHaveBeenCalled();
  });

  it("refuses non-http schemes and relative urls", async () => {
    const ctx = ctxWith({ WEBHOOK_ALLOWED_HOSTS: "hooks.zapier.com" });
    expect(((await call.handler(ctx, { url: "ftp://hooks.zapier.com/x", reason: "t" })) as Failed).error?.code).toBe("bad_input");
    expect(((await call.handler(ctx, { url: "/relative", reason: "t" })) as Failed).error?.code).toBe("bad_input");
    expect(offline).not.toHaveBeenCalled();
  });

  it("matches exact hosts and *. wildcards only", () => {
    expect(hostAllowed("hooks.zapier.com", ["hooks.zapier.com"])).toBe(true);
    expect(hostAllowed("HOOKS.zapier.com", ["hooks.zapier.com"])).toBe(true);
    expect(hostAllowed("evil.example", ["hooks.zapier.com"])).toBe(false);
    expect(hostAllowed("hooks.zapier.com.evil.example", ["hooks.zapier.com"])).toBe(false);
    expect(hostAllowed("a.n8n.example", ["*.n8n.example"])).toBe(true);
    expect(hostAllowed("n8n.example", ["*.n8n.example"])).toBe(true);
    expect(hostAllowed("xn8n.example", ["*.n8n.example"])).toBe(false);
  });

  it("strips Authorization, keeps other headers, signs the body, returns the first 4k", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init: RequestInit) => {
        seen.push({ url: String(url), init });
        return new Response(JSON.stringify({ received: true, pad: "y".repeat(5000) }), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    try {
      const ctx = ctxWith({ WEBHOOK_ALLOWED_HOSTS: "hooks.zapier.com", WEBHOOK_SIGNING_SECRET: "s3cret" });
      const r = await call.handler(ctx, { url: "https://hooks.zapier.com/hooks/catch/1/2", body: { lead: "x" }, headers: { Authorization: "Bearer leak", Cookie: "a=b", "X-Custom": "1" }, reason: "test" });
      expect(r.ok).toBe(true);
      expect(r.status).toBe(200);
      expect(String(r.body)).toContain("received");
      expect(String(r.body).length).toBe(4096);
      expect(seen[0].url).toBe("https://hooks.zapier.com/hooks/catch/1/2");
      expect(seen[0].init.method).toBe("POST");
      const h = seen[0].init.headers as Record<string, string>;
      expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain("authorization");
      expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain("cookie");
      expect(h["X-Custom"]).toBe("1");
      expect(h["X-Hive-Company"]).toBe("t");
      expect(h["X-Hive-Signature"]).toBe(`sha256=${createHmac("sha256", "s3cret").update(JSON.stringify({ lead: "x" })).digest("hex")}`);
    } finally {
      vi.stubGlobal("fetch", offline);
    }
  });
});

describe("notion markdown", () => {
  it("converts simple markdown to blocks", () => {
    const md = "# Title\n\nSome **bold** and `code` with a [link](https://x.y).\n\n- one\n- [x] done\n1. first\n2. second\n> quoted\n```ts\nconst a = 1;\n```\n---\n";
    const blocks = markdownToBlocks(md);
    expect(blocks.map((b) => b.type)).toEqual(["heading_1", "paragraph", "bulleted_list_item", "to_do", "numbered_list_item", "numbered_list_item", "quote", "code", "divider"]);
    type RT = { text: { content: string; link?: { url: string } }; annotations?: Record<string, boolean> };
    const para = (blocks[1] as { paragraph: { rich_text: RT[] } }).paragraph.rich_text;
    expect(para.map((t) => t.text.content).join("")).toBe("Some bold and code with a link.");
    expect(para.find((t) => t.annotations?.bold)?.text.content).toBe("bold");
    expect(para.find((t) => t.annotations?.code)?.text.content).toBe("code");
    expect(para.find((t) => t.text.link)?.text.link?.url).toBe("https://x.y");
    expect((blocks[3] as { to_do: { checked: boolean } }).to_do.checked).toBe(true);
    const code = (blocks[7] as { code: { language: string; rich_text: RT[] } }).code;
    expect(code.language).toBe("typescript");
    expect(code.rich_text[0].text.content).toBe("const a = 1;");
    expect((blocks[0] as { heading_1: { rich_text: RT[] } }).heading_1.rich_text[0].text.content).toBe("Title");
  });

  it("maps unknown code languages to plain text and chunks long text to 2000 chars", () => {
    const [code] = markdownToBlocks("```brainfuck\n+++\n```") as { code: { language: string } }[];
    expect(code.code.language).toBe("plain text");
    const [p] = markdownToBlocks("x".repeat(4500)) as { paragraph: { rich_text: { text: { content: string } }[] } }[];
    expect(p.paragraph.rich_text.map((t) => t.text.content.length)).toEqual([2000, 2000, 500]);
    expect(markdownToBlocks("")).toEqual([]);
  });

  it("renders blocks (with children) back to markdown", () => {
    const rt = (s: string) => [{ plain_text: s }];
    const md = blocksToMarkdown([
      { type: "heading_2", heading_2: { rich_text: rt("Plan") } },
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "see " }, { plain_text: "docs", href: "https://d.example" }, { plain_text: " now", annotations: { bold: true } }] } },
      { type: "bulleted_list_item", bulleted_list_item: { rich_text: rt("a") }, children: [{ type: "bulleted_list_item", bulleted_list_item: { rich_text: rt("nested") } }] },
      { type: "numbered_list_item", numbered_list_item: { rich_text: rt("one") } },
      { type: "numbered_list_item", numbered_list_item: { rich_text: rt("two") } },
      { type: "to_do", to_do: { rich_text: rt("ship"), checked: false } },
      { type: "code", code: { rich_text: rt("x = 1"), language: "python" } },
      { type: "quote", quote: { rich_text: rt("q") } },
      { type: "unsupported_thing", unsupported_thing: {} },
    ]);
    expect(md).toBe("## Plan\n\nsee [docs](https://d.example)** now**\n\n- a\n  - nested\n1. one\n2. two\n- [ ] ship\n\n```python\nx = 1\n```\n\n> q");
  });

  it("round-trips its own output", () => {
    const md = "# T\n\nhello **world**\n\n- a\n- b\n\n> q";
    type Created = { type: string; [k: string]: unknown };
    type RT = { text: { content: string; link?: { url: string } }; annotations?: Record<string, boolean> };
    // markdown → blocks → (as the API would return them) → markdown
    const api = (markdownToBlocks(md) as Created[]).map((b) => {
      const body = b[b.type] as { rich_text?: RT[] };
      return { ...b, [b.type]: { ...body, rich_text: (body.rich_text ?? []).map((t) => ({ plain_text: t.text.content, href: t.text.link?.url ?? null, annotations: t.annotations })) } };
    });
    expect(blocksToMarkdown(api)).toBe(md);
  });

  it("flattens database property values", () => {
    expect(
      flattenProperties({
        Name: { type: "title", title: [{ plain_text: "Row" }] },
        Notes: { type: "rich_text", rich_text: [{ plain_text: "hi" }] },
        Status: { type: "select", select: { name: "Doing" } },
        Empty: { type: "select", select: null },
        Tags: { type: "multi_select", multi_select: [{ name: "a" }, { name: "b" }] },
        N: { type: "number", number: 3 },
        When: { type: "date", date: { start: "2026-09-01", end: null } },
        Span: { type: "date", date: { start: "2026-09-01", end: "2026-09-03" } },
        Done: { type: "checkbox", checkbox: true },
        Site: { type: "url", url: "https://x.y" },
        Mail: { type: "email", email: "a@b.co" },
        Owner: { type: "people", people: [{ id: "u1", name: "Nish" }, { id: "u2" }] },
        Files: { type: "files", files: [] },
      }),
    ).toEqual({ Name: "Row", Notes: "hi", Status: "Doing", Empty: null, Tags: ["a", "b"], N: 3, When: "2026-09-01", Span: "2026-09-01 → 2026-09-03", Done: true, Site: "https://x.y", Mail: "a@b.co", Owner: ["Nish", "u2"] });
  });
});
