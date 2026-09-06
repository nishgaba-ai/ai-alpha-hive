// X (Twitter) — recent search with an app bearer token; posting with a
// user-context token. Posting is `publish`: parked for the board.

import { defineIntegration, strictSchema, fail, type OAuthConfig } from "../../src/integrations/registry.js";
import { ensureToken } from "../../src/oauth.js";
export const AUTH: OAuthConfig = {
  kind: "oauth2",
  prefix: "X",
  authorizeUrl: "https://x.com/i/oauth2/authorize",
  tokenUrl: "https://api.x.com/2/oauth2/token",
  scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
  pkce: true,
  tokenAuth: "basic",
  guide: "developer.x.com → your app → User authentication settings: OAuth 2.0, type Web App, callback = the redirect URI shown here → Keys and tokens: copy OAuth 2.0 Client ID and Client Secret.",
};

export default defineIntegration({
  id: "x",
  auth: AUTH,
  title: "X",
  description: "Search recent posts by keyword; publish posts and replies after approval.",
  website: "https://developer.x.com/en/portal/dashboard",
  guidance: `
## What it does
- **read** — \`x.search\` recent posts matching a query (last 7 days).
- **publish** — \`x.post\` publishes a post or a reply. Parked for the board.

## Connecting
1. Developer portal → your app → **User authentication settings**: OAuth 2.0, app type *Web App*, callback URI = the redirect URI shown here.
2. Paste **Client ID** and **Client Secret** (Keys and tokens) into the vault fields, then **Connect** and approve. Tokens refresh automatically.
3. For search only, the app **Bearer token** stored as \`X_BEARER_TOKEN\` is enough.
`,
  secrets: [
    { name: "X_BEARER_TOKEN", description: "App bearer token", obtain: "developer.x.com → app → Keys and tokens", modes: ["read"] },
    { name: "X_CLIENT_ID", description: "OAuth 2.0 client id", obtain: "developer.x.com → app → Keys and tokens", required: false },
    { name: "X_CLIENT_SECRET", description: "OAuth 2.0 client secret", obtain: "developer.x.com → app → Keys and tokens", required: false },
    { name: "X_ACCESS_TOKEN", description: "User token (set by Connect)", obtain: "Connect button", modes: ["publish"] },
  ],
  modes: [
    { id: "read", title: "Read", description: "Recent search", sideEffect: "read" },
    { id: "publish", title: "Publish", description: "Posts and replies", sideEffect: "publish" },
  ],
  methods: [
    {
      name: "search", mode: "read",
      description: "Recent posts matching a query (X API v2 recent search).",
      input: strictSchema({ query: { type: "string" }, limit: { type: "integer", minimum: 10, maximum: 100 } }, ["query"]),
      async handler(ctx, input) {
        const token = ctx.secrets.get("X_BEARER_TOKEN");
        if (!token) return fail("missing_secret", "X_BEARER_TOKEN is not in the vault");
        const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(String(input.query))}&max_results=${input.limit ?? 20}&tweet.fields=created_at,public_metrics,author_id`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const body = (await res.json().catch(() => ({}))) as { data?: unknown[]; detail?: string; title?: string };
        if (!res.ok) return fail("x_error", body.detail ?? body.title ?? String(res.status));
        return { ok: true, posts: body.data ?? [] };
      },
    },
    {
      name: "post", mode: "publish",
      description: "Publish a post, or a reply when in_reply_to is given. Parks for the board.",
      input: strictSchema({ text: { type: "string", maxLength: 280 }, in_reply_to: { type: "string" }, reason: { type: "string" } }, ["text", "reason"]),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("not_connected", "X is not connected; the board can post the approved text by hand meanwhile");
        const res = await fetch("https://api.x.com/2/tweets", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ text: input.text, ...(input.in_reply_to ? { reply: { in_reply_to_tweet_id: input.in_reply_to } } : {}) }) });
        const body = (await res.json().catch(() => ({}))) as { data?: { id: string }; detail?: string };
        if (!res.ok) return fail("x_error", body.detail ?? String(res.status));
        ctx.emit("artifact.created", { kind: "post", ref: body.data?.id ?? "x", channel: "x" });
        return { ok: true, post_id: body.data?.id };
      },
    },
  ],
});
