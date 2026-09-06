// LinkedIn integration — reference plugin.
// Modes: read (profile, analytics), publish (posts), outreach (messages,
// which the public API does not grant by default; the method exists so the
// gate and the UI show it, and it fails honestly until partner access).

import { defineIntegration, strictSchema, fail, type OAuthConfig } from "../../src/integrations/registry.js";
import { ensureToken } from "../../src/oauth.js";
export const AUTH: OAuthConfig = {
  kind: "oauth2",
  prefix: "LINKEDIN",
  authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
  tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
  scopes: ["openid", "profile", "w_member_social"],
  tokenAuth: "body",
  guide: "linkedin.com/developers/apps → Create app → Products: Share on LinkedIn + Sign In with LinkedIn (OpenID Connect) → Auth tab: add the redirect URI shown here; copy Client ID and Client Secret.",
};

const API = "https://api.linkedin.com";

async function li(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": "202409",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body, id: res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id") };
}

export default defineIntegration({
  id: "linkedin",
  auth: AUTH,
  title: "LinkedIn",
  description: "Publish posts as a member or organisation, read profile and post analytics.",
  website: "https://www.linkedin.com/developers/",
  guidance: `
## What it does
- **read** — who the token belongs to, post and page statistics.
- **publish** — create posts (text, optional article link) as the member or the organisation the token is authorised for. Every post is a \`publish\` side effect: parked for the board unless the company relaxes \`policies.publish\`.
- **outreach** — direct messages. LinkedIn grants the messaging API only to approved partners; the method is present so policy and the UI cover it, and returns a clear error until you have that access.

## Connecting (OAuth, recommended)
1. Create an app at https://www.linkedin.com/developers/apps; add the products **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**.
2. In the app's Auth tab add the redirect URI shown on this screen; paste **Client ID** and **Client Secret** into the vault fields below.
3. Click **Connect** and approve. The runtime stores the token and refreshes it.
4. Run the healthcheck to learn the person id, then store \`LINKEDIN_AUTHOR_URN\` (\`urn:li:person:<id>\`; organisations use \`urn:li:organization:<id>\`).

## Or paste a token
Generate one in the developer portal's Token Generator and store it as \`LINKEDIN_ACCESS_TOKEN\`. It expires in 60 days and will not refresh.

## Enabling
\`\`\`yaml
integrations:
  - id: linkedin
    modes: [read, publish]
roles:
  - id: cmo
    tools: [linkedin.*]        # or by mode: linkedin:read, linkedin:publish
\`\`\`
Tokens expire (60 days); the healthcheck on the Integrations screen tells you when.
`,
  secrets: [
    { name: "LINKEDIN_CLIENT_ID", description: "App client id (for Connect)", obtain: "developers → your app → Auth", required: false },
    { name: "LINKEDIN_CLIENT_SECRET", description: "App client secret (for Connect)", obtain: "developers → your app → Auth", required: false },
    { name: "LINKEDIN_ACCESS_TOKEN", description: "Access token (set by Connect, or paste one)", obtain: "Connect button, or the Token Generator" },
    { name: "LINKEDIN_AUTHOR_URN", description: "urn:li:person:… or urn:li:organization:…", obtain: "linkedin.me returns the person id; organisation ids are in the page admin URL", modes: ["publish"] },
  ],
  modes: [
    { id: "read", title: "Read", description: "Profile and analytics", sideEffect: "read" },
    { id: "publish", title: "Publish", description: "Create public posts", sideEffect: "publish" },
    { id: "outreach", title: "Outreach", description: "Direct messages to people (partner access required)", sideEffect: "send" },
  ],
  methods: [
    {
      name: "me",
      mode: "read",
      description: "Who the LinkedIn token belongs to (name, id). Use to build the author URN.",
      input: strictSchema({}),
      async handler(ctx) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("missing_secret", "LINKEDIN_ACCESS_TOKEN is not in the vault");
        const r = await li(token, "/v2/userinfo");
        if (r.status !== 200) return fail("linkedin_error", `HTTP ${r.status}`, { body: r.body });
        return { ok: true, profile: r.body };
      },
    },
    {
      name: "post",
      mode: "publish",
      description: "Publish a text post (optionally with an article link) as the configured author.",
      input: strictSchema(
        {
          text: { type: "string", maxLength: 3000 },
          article_url: { type: "string" },
          reason: { type: "string", description: "Why this goes out now — shown to the board" },
        },
        ["text", "reason"],
      ),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        const author = ctx.secrets.get("LINKEDIN_AUTHOR_URN");
        if (!token || !author) return fail("missing_secret", "LINKEDIN_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN must be in the vault");
        const body: Record<string, unknown> = {
          author,
          commentary: input.text,
          visibility: "PUBLIC",
          distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        };
        if (input.article_url) body.content = { article: { source: input.article_url, title: String(input.text).slice(0, 80) } };
        const r = await li(token, "/rest/posts", { method: "POST", body: JSON.stringify(body) });
        if (r.status !== 201) return fail("linkedin_error", `HTTP ${r.status}`, { body: r.body });
        ctx.emit("artifact.created", { kind: "post", ref: r.id ?? "linkedin", channel: "linkedin" });
        return { ok: true, post_id: r.id, url: r.id ? `https://www.linkedin.com/feed/update/${r.id}` : undefined };
      },
    },
    {
      name: "analytics",
      mode: "read",
      description: "Statistics for one post (organisation posts) — impressions, clicks, likes, shares.",
      input: strictSchema({ post_id: { type: "string", description: "urn:li:share:… or urn:li:ugcPost:…" } }),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        const author = ctx.secrets.get("LINKEDIN_AUTHOR_URN");
        if (!token || !author) return fail("missing_secret", "LINKEDIN_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN must be in the vault");
        if (!author.includes(":organization:")) return fail("unsupported", "post analytics are only available for organisation authors");
        const q = `q=organizationalEntity&organizationalEntity=${encodeURIComponent(author)}&shares=List(${encodeURIComponent(String(input.post_id))})`;
        const r = await li(token, `/rest/organizationalEntityShareStatistics?${q}`);
        if (r.status !== 200) return fail("linkedin_error", `HTTP ${r.status}`, { body: r.body });
        return { ok: true, stats: r.body };
      },
    },
    {
      name: "message",
      mode: "outreach",
      description: "Send a direct message. Requires LinkedIn partner messaging access.",
      input: strictSchema({ to_urn: { type: "string" }, text: { type: "string" }, reason: { type: "string" } }),
      async handler() {
        return fail("partner_access_required", "LinkedIn messaging is not available to standard apps. Use email.send or a board-approved manual step.");
      },
    },
  ],
  async healthcheck(ctx) {
    const token = ctx.secrets.get("LINKEDIN_ACCESS_TOKEN");
    if (!token) return { ok: false, detail: "LINKEDIN_ACCESS_TOKEN missing" };
    const r = await li(token, "/v2/userinfo");
    return r.status === 200 ? { ok: true, detail: "token valid" } : { ok: false, detail: `token rejected (HTTP ${r.status})` };
  },
});
