// youtube, tiktok, discord: declaration shapes, naming, auth wiring, and
// that every handler and healthcheck refuses before touching the network
// when nothing is connected (fetch is stubbed to throw).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, openMemoryDb } from "../src/db.js";
import type { Integration } from "../src/integrations/registry.js";
import type { ToolContext } from "../src/types.js";
import youtube, { AUTH as YOUTUBE_AUTH } from "../integrations/youtube/index.js";
import tiktok, { AUTH as TIKTOK_AUTH } from "../integrations/tiktok/index.js";
import discord from "../integrations/discord/index.js";

const ALL: Integration[] = [youtube, tiktok, discord];
const REFUSALS = ["not_connected", "missing_secret"];

const ctx = {
  company: { id: "c1", name: "T", slug: "t", currency: "INR" } as any,
  config: {} as any,
  companyDir: "",
  agent: {} as any,
  role: {} as any,
  run: {} as any,
  secrets: { get: () => undefined, names: () => [] },
  emit: () => {},
} as unknown as ToolContext;

type Prop = { type?: string; enum?: string[]; items?: { type?: string }; minimum?: number };

/** An input that satisfies a method's schema: every required property filled with a plausible value. */
function sample(i: Integration, name: string): Record<string, unknown> {
  const schema = i.methods.find((m) => m.name === name)!.input as { properties?: Record<string, Prop>; required?: string[] | null };
  const out: Record<string, unknown> = {};
  for (const k of schema.required ?? []) {
    const p = schema.properties?.[k] ?? {};
    if (p.enum?.length) out[k] = p.enum[0];
    else if (p.type === "integer" || p.type === "number") out[k] = p.minimum ?? 1;
    else if (p.type === "array") out[k] = ["x"];
    else if (p.type === "boolean") out[k] = true;
    else if (/url/.test(k)) out[k] = "https://cdn.example.com/clips/launch.mp4";
    else if (k === "from" || k === "to") out[k] = "2026-01-01";
    else out[k] = "x";
  }
  return out;
}

const fetchSpy = vi.fn(() => {
  throw new Error("network call attempted");
});

describe("video and community integrations", () => {
  beforeAll(() => {
    openMemoryDb();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    closeDb();
  });

  it("declare complete metadata with snake_case methods in known modes", () => {
    for (const i of ALL) {
      expect(i.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(i.title.length).toBeGreaterThan(0);
      expect(i.description.length).toBeGreaterThan(20);
      expect(i.website).toMatch(/^https:\/\//);
      expect(i.guidance).toContain("## What it does");
      expect(i.guidance).toContain("## Connecting");
      expect(i.guidance).toContain("integrations:");
      expect(i.guidance).toContain(`- id: ${i.id}`);
      expect(i.secrets.length).toBeGreaterThan(0);
      expect(typeof i.healthcheck).toBe("function");
      expect(i.modes.length).toBeGreaterThan(0);
      const modes = new Set(i.modes.map((m) => m.id));
      for (const m of i.methods) {
        expect(m.name).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(modes.has(m.mode)).toBe(true);
        expect(m.description.length).toBeGreaterThan(10);
        expect((m.input as { additionalProperties?: boolean }).additionalProperties).toBe(false);
      }
      for (const mode of i.modes) expect(i.methods.some((m) => m.mode === mode.id)).toBe(true);
      for (const mode of i.modes) expect(i.guidance).toContain(`**${mode.id}**`);
    }
  });

  it("youtube: three modes, GOOGLE OAuth with only YouTube scopes, gated methods carry a reason", () => {
    expect(youtube.modes.map((m) => [m.id, m.sideEffect])).toEqual([["read", "read"], ["engage", "send"], ["publish", "publish"]]);
    expect(youtube.methods.map((m) => m.name)).toEqual(["channel", "videos", "analytics", "comments", "reply", "upload", "update"]);
    expect(YOUTUBE_AUTH.prefix).toBe("GOOGLE");
    expect(YOUTUBE_AUTH.tokenAuth).toBe("body");
    expect(YOUTUBE_AUTH.extraAuthorizeParams).toEqual({ access_type: "offline", prompt: "consent" });
    expect(YOUTUBE_AUTH.scopes.every((s) => /\/auth\/(youtube|yt-analytics)/.test(s))).toBe(true);
    expect(YOUTUBE_AUTH.scopes).toContain("https://www.googleapis.com/auth/youtube.upload");
    for (const name of ["reply", "upload", "update"]) {
      const m = youtube.methods.find((x) => x.name === name)!;
      expect((m.input as { required?: string[] }).required).toContain("reason");
    }
    expect(youtube.secrets.map((s) => s.name)).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ACCESS_TOKEN"]);
    const upload = youtube.methods.find((x) => x.name === "upload")!.input as { properties: Record<string, Prop> };
    expect(upload.properties.privacy.enum).toEqual(["private", "unlisted", "public"]);
  });

  it("tiktok: PKCE Login Kit sending client_key, read + publish", () => {
    expect(tiktok.modes.map((m) => [m.id, m.sideEffect])).toEqual([["read", "read"], ["publish", "publish"]]);
    expect(tiktok.methods.map((m) => m.name)).toEqual(["profile", "videos", "publish", "status"]);
    expect(TIKTOK_AUTH.prefix).toBe("TIKTOK");
    expect(TIKTOK_AUTH.pkce).toBe(true);
    expect(TIKTOK_AUTH.tokenAuth).toBe("body");
    expect(TIKTOK_AUTH.clientIdParam).toBe("client_key");
    expect(TIKTOK_AUTH.authorizeUrl).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(TIKTOK_AUTH.tokenUrl).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    expect(TIKTOK_AUTH.scopes).toEqual(["user.info.basic", "user.info.stats", "video.list", "video.publish"]);
    const publish = tiktok.methods.find((x) => x.name === "publish")!.input as { properties: Record<string, Prop>; required: string[] };
    expect(publish.required).toEqual(["video_url", "title", "reason"]);
    expect(publish.properties.privacy.enum).toEqual(["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "PUBLIC_TO_EVERYONE"]);
    expect(tiktok.guidance).toContain("client_key");
    expect(tiktok.guidance).toContain("SELF_ONLY");
  });

  it("discord: bot token api_key, optional guild id and webhook, community is publish-class", () => {
    expect(discord.auth?.kind).toBe("api_key");
    expect(discord.modes.map((m) => [m.id, m.sideEffect])).toEqual([["read", "read"], ["community", "publish"]]);
    expect(discord.methods.map((m) => m.name)).toEqual(["channels", "read", "post", "reply"]);
    const byName = Object.fromEntries(discord.secrets.map((s) => [s.name, s]));
    expect(byName.DISCORD_BOT_TOKEN.required).not.toBe(false);
    expect(byName.DISCORD_GUILD_ID.required).toBe(false);
    expect(byName.DISCORD_WEBHOOK_URL.required).toBe(false);
    const post = discord.methods.find((x) => x.name === "post")!.input as { properties: Record<string, Prop & { maxLength?: number }>; required: string[] };
    expect(post.required).toEqual(["content", "reason"]);
    expect(post.properties.content.maxLength).toBe(2000);
  });

  it("every handler refuses without credentials and never reaches the network", async () => {
    for (const i of ALL) {
      for (const m of i.methods) {
        fetchSpy.mockClear();
        const r = await m.handler(ctx, sample(i, m.name));
        expect(r.ok, `${i.id}.${m.name}`).toBe(false);
        expect(REFUSALS, `${i.id}.${m.name} → ${JSON.stringify(r.error)}`).toContain((r.error as { code: string }).code);
        expect(typeof (r.error as { hint: string }).hint).toBe("string");
        expect(fetchSpy, `${i.id}.${m.name} fetched`).not.toHaveBeenCalled();
      }
    }
  });

  it("discord.post with and without channel_id both need a credential first", async () => {
    const post = discord.methods.find((x) => x.name === "post")!;
    const a = await post.handler(ctx, { content: "hi", reason: "test" });
    const b = await post.handler(ctx, { channel_id: "123", content: "hi", reason: "test" });
    expect((a.error as { code: string }).code).toBe("missing_secret");
    expect((b.error as { code: string }).code).toBe("missing_secret");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("healthchecks report the missing credential without a request", async () => {
    for (const i of ALL) {
      fetchSpy.mockClear();
      const h = await i.healthcheck!(ctx);
      expect(h.ok, i.id).toBe(false);
      expect(h.detail, i.id).toMatch(/missing/i);
      expect(fetchSpy, `${i.id} healthcheck fetched`).not.toHaveBeenCalled();
    }
  });
});
