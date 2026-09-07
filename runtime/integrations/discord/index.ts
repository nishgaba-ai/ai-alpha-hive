// Discord — list a server's text channels and read messages with a bot
// token (read); post and reply in community channels (community: a
// `publish` side effect, parked for the board). A channel webhook URL
// alone is enough for discord.post when there is no bot.

import { defineIntegration, strictSchema, fail } from "../../src/integrations/registry.js";

const API = "https://discord.com/api/v10";
const UA = "DiscordBot (https://github.com/nishgaba-ai/ai-alpha-hive, 0.1)";
const MAX_CONTENT = 2000;

type Json = Record<string, unknown>;
type Reply = { ok: boolean; status: number; body: Json };

async function dc(token: string, path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}, retry = true): Promise<Reply> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bot ${token}`, "User-Agent": UA, Accept: "application/json", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  if (res.status === 429 && retry) {
    const wait = Math.min(Number(body.retry_after ?? res.headers.get("retry-after") ?? 1), 5);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return dc(token, path, init, false);
  }
  return { ok: res.ok, status: res.status, body };
}

function errText(r: { status: number; body: Json }): string {
  const base = `${String(r.body.message ?? `HTTP ${r.status}`)}${r.body.code ? ` (code ${r.body.code})` : ""}`;
  if (r.status === 401) return `${base} — bot token rejected; reset it on the Bot page and store it again`;
  if (r.status === 403) return `${base} — the bot lacks access: invite it to the server with View Channels, Send Messages and Read Message History`;
  return base;
}

type Msg = {
  id: string;
  content?: string;
  timestamp?: string;
  author?: { id?: string; username?: string; global_name?: string; bot?: boolean };
  message_reference?: { message_id?: string };
  attachments?: unknown[];
};

function compact(m: Msg) {
  return {
    id: m.id,
    author: m.author?.global_name ?? m.author?.username,
    author_id: m.author?.id,
    bot: !!m.author?.bot,
    content: (m.content ?? "").slice(0, 1000),
    at: m.timestamp,
    reply_to: m.message_reference?.message_id,
    attachments: m.attachments?.length ?? 0,
  };
}

/** Never ping @everyone, @here or roles from an agent; user mentions still resolve. */
const MENTIONS = { parse: ["users"] };

export default defineIntegration({
  id: "discord",
  auth: { kind: "api_key", guide: "discord.com/developers/applications → New Application → Bot → Reset Token (paste as DISCORD_BOT_TOKEN) → OAuth2 → URL Generator: scope bot, permissions View Channels, Send Messages, Read Message History → open the URL to add the bot to your server." },
  title: "Discord",
  description: "Read a community server's channels and messages; post and reply in channels after approval.",
  website: "https://discord.com/developers/applications",
  guidance: `
## What it does
- **read** — \`discord.channels\` lists the server's text channels; \`discord.read\` reads recent messages in one channel (newest first).
- **community** — \`discord.post\` sends a message to a channel; \`discord.reply\` answers a specific message. Community posts are \`publish\` side effects: parked for the board unless \`policies.publish\` relaxes it.

## Connecting
1. https://discord.com/developers/applications → New Application → **Bot** → Reset Token; paste it as \`DISCORD_BOT_TOKEN\`. On the same page enable **Message Content Intent**, or \`discord.read\` returns empty \`content\` for other people's messages.
2. OAuth2 → URL Generator: scope \`bot\`, permissions **View Channels**, **Send Messages**, **Read Message History** → open the generated URL and add the bot to your server.
3. Store the server id as \`DISCORD_GUILD_ID\` (Server Settings → Widget → Server ID, or right-click the server with Developer Mode on) so \`discord.channels\` can list channels; channel ids come from that list.
4. Run the healthcheck: it prints the bot's username and the server it can see.

## Or a webhook
Without a bot, create a webhook on one channel (Channel → Edit → Integrations → Webhooks → New Webhook → Copy URL) and store it as \`DISCORD_WEBHOOK_URL\`. \`discord.post\` without \`channel_id\` then posts through it; reading and replying still need the bot.

Messages are at most 2000 characters. Posts never ping @everyone, @here or roles; only user mentions go through.

## Enabling
\`\`\`yaml
integrations:
  - id: discord
    modes: [read, community]
roles:
  - id: community
    tools: [discord.*]         # or by mode: discord:read, discord:community
\`\`\`
`,
  secrets: [
    { name: "DISCORD_BOT_TOKEN", description: "Bot token", obtain: "discord.com/developers/applications → your app → Bot → Reset Token" },
    { name: "DISCORD_GUILD_ID", description: "Server id (for discord.channels)", obtain: "Discord → Server Settings → Widget → Server ID, or right-click the server with Developer Mode on", required: false },
    { name: "DISCORD_WEBHOOK_URL", description: "Channel webhook URL: lets discord.post work without a bot", obtain: "Channel → Edit → Integrations → Webhooks → New Webhook → Copy URL", required: false },
  ],
  modes: [
    { id: "read", title: "Read", description: "Channels and messages", sideEffect: "read" },
    { id: "community", title: "Community", description: "Post and reply in channels", sideEffect: "publish" },
  ],
  methods: [
    {
      name: "channels", mode: "read",
      description: "Text and announcement channels of the server in DISCORD_GUILD_ID, with ids for discord.read and discord.post.",
      input: strictSchema({}),
      async handler(ctx) {
        const token = ctx.secrets.get("DISCORD_BOT_TOKEN");
        if (!token) return fail("missing_secret", "DISCORD_BOT_TOKEN is not in the vault");
        const guild = ctx.secrets.get("DISCORD_GUILD_ID");
        if (!guild) return fail("missing_secret", "DISCORD_GUILD_ID is not in the vault (Server Settings → Widget → Server ID)");
        const r = await dc(token, `/guilds/${encodeURIComponent(guild)}/channels`);
        if (!r.ok) return fail("discord_error", errText(r));
        type Ch = { id: string; name: string; type: number; topic?: string | null; position?: number };
        const channels = (Array.isArray(r.body) ? (r.body as unknown as Ch[]) : [])
          .filter((c) => c.type === 0 || c.type === 5)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .slice(0, 100)
          .map((c) => ({ id: c.id, name: c.name, kind: c.type === 5 ? "announcement" : "text", topic: (c.topic ?? "").slice(0, 200) }));
        return { ok: true, channels };
      },
    },
    {
      name: "read", mode: "read",
      description: "Recent messages in a channel, newest first (up to 100).",
      input: strictSchema({ channel_id: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, ["channel_id"]),
      async handler(ctx, input) {
        const token = ctx.secrets.get("DISCORD_BOT_TOKEN");
        if (!token) return fail("missing_secret", "DISCORD_BOT_TOKEN is not in the vault");
        const r = await dc(token, `/channels/${encodeURIComponent(String(input.channel_id))}/messages?limit=${Math.min(Number(input.limit ?? 50), 100)}`);
        if (!r.ok) return fail("discord_error", errText(r));
        const messages = (Array.isArray(r.body) ? (r.body as unknown as Msg[]) : []).map(compact);
        return { ok: true, messages };
      },
    },
    {
      name: "post", mode: "community",
      description: "Post a message (≤ 2000 chars) to a channel with the bot; without channel_id it goes through DISCORD_WEBHOOK_URL. Parks for the board.",
      input: strictSchema({ channel_id: { type: "string" }, content: { type: "string", minLength: 1, maxLength: MAX_CONTENT }, reason: { type: "string" } }, ["content", "reason"]),
      async handler(ctx, input) {
        const content = String(input.content);
        if (content.length > MAX_CONTENT) return fail("too_long", `Discord messages are at most ${MAX_CONTENT} characters; split it`);
        const token = ctx.secrets.get("DISCORD_BOT_TOKEN");
        const webhook = ctx.secrets.get("DISCORD_WEBHOOK_URL");
        const channel = input.channel_id ? String(input.channel_id) : undefined;
        if (!channel && webhook) {
          if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(webhook)) return fail("bad_webhook", "DISCORD_WEBHOOK_URL must be a discord.com/api/webhooks/… URL");
          const res = await fetch(`${webhook}${webhook.includes("?") ? "&" : "?"}wait=true`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify({ content, allowed_mentions: MENTIONS }) });
          const body = (await res.json().catch(() => ({}))) as Json;
          if (!res.ok) return fail("discord_error", errText({ status: res.status, body }));
          ctx.emit("artifact.created", { kind: "post", ref: String(body.id ?? "webhook"), channel: "discord", channel_id: body.channel_id });
          return { ok: true, message_id: body.id, channel_id: body.channel_id, via: "webhook" };
        }
        if (!token) return fail("missing_secret", channel ? "DISCORD_BOT_TOKEN is not in the vault" : "store DISCORD_BOT_TOKEN and pass channel_id, or store DISCORD_WEBHOOK_URL to post without a bot");
        if (!channel) return fail("missing_channel", "channel_id is required when posting with the bot (discord.channels lists them)");
        const r = await dc(token, `/channels/${encodeURIComponent(channel)}/messages`, { method: "POST", body: { content, allowed_mentions: MENTIONS } });
        if (!r.ok) return fail("discord_error", errText(r));
        ctx.emit("artifact.created", { kind: "post", ref: String(r.body.id ?? ""), channel: "discord", channel_id: channel });
        return { ok: true, message_id: r.body.id, channel_id: channel, via: "bot" };
      },
    },
    {
      name: "reply", mode: "community",
      description: "Reply to a message in a channel (quoted reply, ≤ 2000 chars). Needs the bot token. Parks for the board.",
      input: strictSchema({ channel_id: { type: "string" }, message_id: { type: "string" }, content: { type: "string", minLength: 1, maxLength: MAX_CONTENT }, reason: { type: "string" } }),
      async handler(ctx, input) {
        const content = String(input.content);
        if (content.length > MAX_CONTENT) return fail("too_long", `Discord messages are at most ${MAX_CONTENT} characters; split it`);
        const token = ctx.secrets.get("DISCORD_BOT_TOKEN");
        if (!token) return fail("missing_secret", "DISCORD_BOT_TOKEN is not in the vault (replies need the bot; a webhook cannot reply)");
        const channel = String(input.channel_id);
        const r = await dc(token, `/channels/${encodeURIComponent(channel)}/messages`, {
          method: "POST",
          body: { content, message_reference: { message_id: String(input.message_id), channel_id: channel, fail_if_not_exists: false }, allowed_mentions: { ...MENTIONS, replied_user: true } },
        });
        if (!r.ok) return fail("discord_error", errText(r));
        ctx.emit("artifact.created", { kind: "post", ref: String(r.body.id ?? ""), channel: "discord", channel_id: channel, reply_to: String(input.message_id) });
        return { ok: true, message_id: r.body.id, channel_id: channel };
      },
    },
  ],
  async healthcheck(ctx) {
    const token = ctx.secrets.get("DISCORD_BOT_TOKEN");
    if (!token) return { ok: false, detail: ctx.secrets.get("DISCORD_WEBHOOK_URL") ? "DISCORD_BOT_TOKEN missing (webhook posting still works)" : "DISCORD_BOT_TOKEN missing" };
    const me = await dc(token, "/users/@me");
    if (!me.ok) return { ok: false, detail: errText(me) };
    const name = `@${String(me.body.username ?? "bot")}`;
    const guild = ctx.secrets.get("DISCORD_GUILD_ID");
    if (!guild) return { ok: true, detail: `${name} — set DISCORD_GUILD_ID to list channels` };
    const g = await dc(token, `/guilds/${encodeURIComponent(guild)}`);
    return g.ok ? { ok: true, detail: `${name} in ${String(g.body.name ?? guild)}` } : { ok: false, detail: `${name} is not in server ${guild}: ${errText(g)}` };
  },
});
