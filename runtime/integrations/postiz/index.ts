// Postiz — open-source social scheduling. One connection covers every
// channel the board has linked inside Postiz (LinkedIn, X, Instagram,
// TikTok, YouTube, Threads, Bluesky …). Scheduling a post is `publish`:
// parked for the board, who sees the exact text and the channel.

import { defineIntegration, strictSchema, fail } from "../../src/integrations/registry.js";

async function pz(base: string, key: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${base.replace(/\/$/, "")}/public/v1${path}`, { ...init, headers: { Authorization: key, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as unknown;
  return { ok: res.ok, status: res.status, body };
}

export default defineIntegration({
  id: "postiz",
  auth: { kind: "api_key", guide: "Postiz issues a public API key per workspace; the channels themselves are connected inside Postiz with its own OAuth, so one key here covers all of them." },
  title: "Postiz",
  description: "Schedule and publish to every social channel connected in Postiz (LinkedIn, X, Instagram, TikTok, YouTube, Threads, Bluesky…).",
  website: "https://postiz.com",
  guidance: `
## What it does
- **read** — \`postiz.channels\` lists the channels connected in your Postiz workspace; \`postiz.posts\` lists scheduled posts for a week.
- **publish** — \`postiz.schedule\` creates a post (now or at a time) on one or more channels. Parked for the board.

Postiz is where the social accounts are connected (it handles each network's OAuth). This company only needs the API key. Self-hosted Postiz works the same; set \`POSTIZ_URL\` to your instance.

## Getting credentials
1. Postiz → Settings → **Public API** → copy the key → \`POSTIZ_API_KEY\`.
2. Cloud: leave \`POSTIZ_URL\` empty (defaults to https://api.postiz.com). Self-hosted: your backend URL.
3. Connect your channels inside Postiz, then run \`postiz.channels\` (or the healthcheck) to see their ids.
`,
  secrets: [
    { name: "POSTIZ_API_KEY", description: "Public API key", obtain: "Postiz → Settings → Public API" },
    { name: "POSTIZ_URL", description: "API base (self-hosted only)", obtain: "your instance, e.g. https://postiz.example.com", required: false },
  ],
  modes: [
    { id: "read", title: "Read", description: "Channels and scheduled posts", sideEffect: "read" },
    { id: "publish", title: "Publish", description: "Schedule posts", sideEffect: "publish" },
  ],
  methods: [
    {
      name: "channels", mode: "read",
      description: "Channels connected in Postiz with their ids and platforms.",
      input: strictSchema({}),
      async handler(ctx) {
        const key = ctx.secrets.get("POSTIZ_API_KEY");
        if (!key) return fail("missing_secret", "POSTIZ_API_KEY is not in the vault");
        const r = await pz(ctx.secrets.get("POSTIZ_URL") ?? "https://api.postiz.com", key, "/integrations");
        if (!r.ok) return fail("postiz_error", `HTTP ${r.status}`);
        const list = (r.body as { id: string; name: string; identifier: string; disabled?: boolean }[]) ?? [];
        return { ok: true, channels: list.map((c) => ({ id: c.id, name: c.name, platform: c.identifier, disabled: !!c.disabled })) };
      },
    },
    {
      name: "posts", mode: "read",
      description: "Scheduled posts in a date range (ISO dates).",
      input: strictSchema({ start: { type: "string" }, end: { type: "string" } }),
      async handler(ctx, input) {
        const key = ctx.secrets.get("POSTIZ_API_KEY");
        if (!key) return fail("missing_secret", "POSTIZ_API_KEY is not in the vault");
        const r = await pz(ctx.secrets.get("POSTIZ_URL") ?? "https://api.postiz.com", key, `/posts?startDate=${encodeURIComponent(String(input.start))}&endDate=${encodeURIComponent(String(input.end))}`);
        if (!r.ok) return fail("postiz_error", `HTTP ${r.status}`);
        return { ok: true, posts: r.body };
      },
    },
    {
      name: "schedule", mode: "publish",
      description: "Create a post on one or more channel ids, now or at an ISO time. Parks for the board.",
      input: strictSchema(
        {
          channel_ids: { type: "array", items: { type: "string" }, minItems: 1 },
          text: { type: "string", maxLength: 5000 },
          at: { type: "string", description: "ISO datetime; omit to post now" },
          reason: { type: "string" },
        },
        ["channel_ids", "text", "reason"],
      ),
      async handler(ctx, input) {
        const key = ctx.secrets.get("POSTIZ_API_KEY");
        if (!key) return fail("missing_secret", "POSTIZ_API_KEY is not in the vault");
        const body = {
          type: input.at ? "schedule" : "now",
          date: input.at ?? new Date().toISOString(),
          shortLink: false,
          posts: (input.channel_ids as string[]).map((id) => ({ integration: { id }, value: [{ content: input.text, image: [] }] })),
        };
        const r = await pz(ctx.secrets.get("POSTIZ_URL") ?? "https://api.postiz.com", key, "/posts", { method: "POST", body: JSON.stringify(body) });
        if (!r.ok) return fail("postiz_error", `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
        ctx.emit("artifact.created", { kind: "post", ref: "postiz", channels: input.channel_ids, at: input.at ?? "now" });
        return { ok: true, result: r.body };
      },
    },
  ],
  async healthcheck(ctx) {
    const key = ctx.secrets.get("POSTIZ_API_KEY");
    if (!key) return { ok: false, detail: "POSTIZ_API_KEY missing" };
    const r = await pz(ctx.secrets.get("POSTIZ_URL") ?? "https://api.postiz.com", key, "/integrations");
    return r.ok ? { ok: true, detail: `${((r.body as unknown[]) ?? []).length} channels connected in Postiz` } : { ok: false, detail: `rejected (HTTP ${r.status})` };
  },
});
