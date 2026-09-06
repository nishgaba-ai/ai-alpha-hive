// Slack — post to channels. Company-internal by default (write); flip the
// mode to `external` if the workspace has guests or shared channels.

import { defineIntegration, strictSchema, fail, type OAuthConfig } from "../../src/integrations/registry.js";
export const AUTH: OAuthConfig = {
  kind: "oauth2",
  prefix: "SLACK",
  authorizeUrl: "https://slack.com/oauth/v2/authorize",
  tokenUrl: "https://slack.com/api/oauth.v2.access",
  scopes: ["chat:write", "chat:write.public"],
  tokenAuth: "body",
  guide: "api.slack.com/apps → Create app → OAuth & Permissions: add the redirect URI shown here and bot scopes chat:write, chat:write.public → Basic Information: copy Client ID and Client Secret.",
};

export default defineIntegration({
  id: "slack",
  auth: AUTH,
  title: "Slack",
  description: "Post updates to the company's Slack channels.",
  website: "https://api.slack.com/apps",
  guidance: `
## What it does
- **internal** — \`slack.post\` to channels in your own workspace (a \`write\` side effect: allowed).
- **external** — same method, but treated as \`send\` for workspaces with guests or Slack Connect channels: first messages park for the board.

## Connecting
1. https://api.slack.com/apps → Create app → OAuth & Permissions: add the redirect URI shown here; bot scopes \`chat:write\`, \`chat:write.public\`.
2. Paste **Client ID** and **Client Secret** (Basic Information) into the vault, then **Connect** and pick the workspace. The bot token is stored as \`SLACK_ACCESS_TOKEN\`.

## Or paste the bot token
Install the app to the workspace by hand and store the **Bot User OAuth Token** (\`xoxb-…\`) as \`SLACK_ACCESS_TOKEN\`. Invite the bot to the channels it posts in.
`,
  secrets: [
    { name: "SLACK_CLIENT_ID", description: "App client id", obtain: "Slack app → Basic Information", required: false },
    { name: "SLACK_CLIENT_SECRET", description: "App client secret", obtain: "Slack app → Basic Information", required: false },
    { name: "SLACK_ACCESS_TOKEN", description: "Bot token xoxb-… (set by Connect, or paste)", obtain: "Connect button, or Slack app → OAuth & Permissions" },
  ],
  modes: [
    { id: "internal", title: "Internal", description: "Own workspace channels", sideEffect: "write" },
    { id: "external", title: "External", description: "Shared channels / guests", sideEffect: "send" },
  ],
  methods: [
    ...(["internal", "external"] as const).map((mode) => ({
      name: mode === "internal" ? "post" : "post_external",
      mode,
      description: mode === "internal" ? "Post a message to a channel in the company workspace." : "Post to a shared or guest-visible channel.",
      input: strictSchema({ channel: { type: "string" }, text: { type: "string" } }),
      async handler(ctx: { secrets: { get(n: string): string | undefined } }, input: Record<string, unknown>) {
        const token = ctx.secrets.get("SLACK_ACCESS_TOKEN");
        if (!token) return fail("missing_secret", "SLACK_ACCESS_TOKEN is not in the vault");
        const res = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ channel: input.channel, text: input.text }),
        });
        const body = (await res.json()) as { ok: boolean; ts?: string; error?: string };
        if (!body.ok) return fail("slack_error", body.error ?? "request failed");
        return { ok: true, ts: body.ts };
      },
    })),
  ],
  async healthcheck(ctx) {
    const token = ctx.secrets.get("SLACK_ACCESS_TOKEN");
    if (!token) return { ok: false, detail: "SLACK_ACCESS_TOKEN missing" };
    const res = await fetch("https://slack.com/api/auth.test", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json()) as { ok: boolean; team?: string; error?: string };
    return body.ok ? { ok: true, detail: `workspace: ${body.team}` } : { ok: false, detail: body.error ?? "rejected" };
  },
});
