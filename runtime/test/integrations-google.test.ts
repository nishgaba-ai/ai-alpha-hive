// Google integrations (Drive, Sheets, Calendar, Gmail): declarations are
// well-formed, and every handler refuses offline — not_connected /
// missing_secret — before touching the network, so agents get a clear
// hint and nothing leaks when Google is not connected.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, openMemoryDb } from "../src/db.js";
import drive, { docBody } from "../integrations/google-drive/index.js";
import sheets from "../integrations/google-sheets/index.js";
import calendar from "../integrations/google-calendar/index.js";
import gmail, { buildRaw, cleanText } from "../integrations/gmail/index.js";
import type { Integration, IntegrationMethod } from "../src/integrations/registry.js";
import type { ToolContext } from "../src/types.js";

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

const fetchSpy = vi.fn(async () => {
  throw new Error("network call attempted while not connected");
});

beforeAll(() => {
  openMemoryDb();
  vi.stubGlobal("fetch", fetchSpy);
});
afterAll(() => {
  vi.unstubAllGlobals();
  closeDb();
});

/** Minimal input satisfying a method's required fields, built from its schema. */
function sampleInput(m: IntegrationMethod): Record<string, unknown> {
  const props = (m.input.properties ?? {}) as Record<string, { type?: string; enum?: unknown[]; items?: { type?: string } }>;
  const out: Record<string, unknown> = {};
  for (const k of (m.input.required as string[] | undefined) ?? []) {
    const p = props[k] ?? {};
    if (p.enum) out[k] = p.enum[0];
    else if (p.type === "integer" || p.type === "number") out[k] = 1;
    else if (p.type === "boolean") out[k] = true;
    else if (p.type === "array") out[k] = p.items?.type === "array" ? [["x"]] : ["x"];
    else out[k] = "x";
  }
  return out;
}

const cases: [string, Integration, string[]][] = [
  ["google-drive", drive, ["read", "write", "share"]],
  ["google-sheets", sheets, ["read", "write"]],
  ["google-calendar", calendar, ["read", "schedule"]],
  ["gmail", gmail, ["read", "send"]],
];

describe.each(cases)("%s", (id, integration, modes) => {
  it("declares the id, modes, Google OAuth and the shared secrets", () => {
    expect(integration.id).toBe(id);
    expect(integration.modes.map((m) => m.id)).toEqual(modes);
    expect(integration.auth?.kind).toBe("oauth2");
    if (integration.auth?.kind === "oauth2") {
      expect(integration.auth.prefix).toBe("GOOGLE");
      expect(integration.auth.scopes.length).toBeGreaterThan(0);
      for (const s of integration.auth.scopes) expect(s.startsWith("https://www.googleapis.com/auth/")).toBe(true);
      expect(integration.auth.extraAuthorizeParams).toEqual({ access_type: "offline", prompt: "consent" });
      expect(integration.auth.tokenAuth).toBe("body");
    }
    const names = integration.secrets.map((s) => s.name);
    for (const n of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ACCESS_TOKEN"]) expect(names).toContain(n);
    expect(integration.guidance).toContain(`id: ${id}`);
    expect(typeof integration.healthcheck).toBe("function");
  });

  it("every method has a known mode, a snake_case name and a strict schema", () => {
    const modeIds = new Set(integration.modes.map((m) => m.id));
    expect(integration.methods.length).toBeGreaterThan(0);
    for (const m of integration.methods) {
      expect(modeIds.has(m.mode)).toBe(true);
      expect(m.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(m.input.type).toBe("object");
      expect((m.input as { additionalProperties?: boolean }).additionalProperties).toBe(false);
      expect(m.description.length).toBeGreaterThan(10);
    }
  });

  it.each(integration.methods.map((m): [string, IntegrationMethod] => [m.name, m]))("%s refuses offline without a network call", async (_name, m) => {
    fetchSpy.mockClear();
    for (const input of [{}, sampleInput(m)]) {
      const r = await m.handler(ctx, input);
      expect(r.ok).toBe(false);
      expect(["not_connected", "missing_secret"]).toContain((r.error as { code: string }).code);
      expect(typeof (r.error as { hint: string }).hint).toBe("string");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("healthcheck reports not connected without a network call", async () => {
    fetchSpy.mockClear();
    const r = await integration.healthcheck!({ secrets: ctx.secrets });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/not connected/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("send-class methods name the recipient `to` so the gate's first-contact rule applies", () => {
  it.each([
    ["google-drive", drive, "share"],
    ["google-calendar", calendar, "create_event"],
    ["gmail", gmail, "send"],
  ])("%s.%s", (_id, integration, name) => {
    const m = integration.methods.find((x) => x.name === name)!;
    const mode = integration.modes.find((x) => x.id === m.mode)!;
    expect(mode.sideEffect).toBe("send");
    expect(Object.keys(m.input.properties as Record<string, unknown>)).toContain("to");
  });
});

describe("pure helpers", () => {
  it("docBody strips heading markers and keeps offsets in UTF-16 units", () => {
    const { text, headings } = docBody("# Title\n\nBody ✨ line\n## Sub ##\n#not a heading\n");
    expect(text).toBe("Title\n\nBody ✨ line\nSub\n#not a heading\n");
    expect(headings).toEqual([
      { start: 0, end: 5, level: 1 },
      { start: "Title\n\nBody ✨ line\n".length, end: "Title\n\nBody ✨ line\n".length + 3, level: 2 },
    ]);
    for (const h of headings) expect(text.slice(h.start, h.end)).toBe(h.level === 1 ? "Title" : "Sub");
  });

  it("buildRaw produces an RFC 2822 message with reply headers and a base64 UTF-8 body", () => {
    const raw = buildRaw({ from: "me@example.com", to: "you@example.com", subject: "Namaste 🙏", body: "Hello\nWorld ✨", inReplyTo: "<abc@mail>", references: "<root@mail> <abc@mail>" });
    const [head, body] = raw.split("\r\n\r\n");
    expect(head).toContain("From: me@example.com\r\nTo: you@example.com\r\n");
    expect(head).toMatch(/^.*Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/s);
    expect(head).toContain("In-Reply-To: <abc@mail>\r\nReferences: <root@mail> <abc@mail>\r\n");
    expect(head).toContain('Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64');
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("Hello\nWorld ✨");
    expect(buildRaw({ to: "a@b.co", subject: "Plain", body: "x" })).toMatch(/^To: a@b.co\r\nSubject: Plain\r\n/);
  });

  it("cleanText drops quoted replies lightly", () => {
    const text = "Thanks, works for me.\n\nOn Mon, Sep 7, 2026 at 10:00 AM Nishchal <\nn@example.com> wrote:\n> earlier\n> lines";
    expect(cleanText(text)).toBe("Thanks, works for me.");
    expect(cleanText("Top\n> quoted\nBottom\n-----Original Message-----\nFrom: x")).toBe("Top\nBottom");
  });
});
