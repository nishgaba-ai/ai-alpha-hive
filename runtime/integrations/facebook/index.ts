// Facebook Pages — publish to a Page, read its posts, comments and
// insights, reply to comments. Shares the Meta Business app (prefix META)
// with ads-meta, so one Connect serves both and the server unions the
// scopes; a Page access token in the vault works without Connect.
// Publishing parks for the board. Replying to a comment is a public send
// with no `to`, so the gate treats it as first contact (parks by default).

import { defineIntegration, strictSchema, fail, type OAuthConfig } from "../../src/integrations/registry.js";
import { ensureToken } from "../../src/oauth.js";
import type { SecretResolver, ToolResult } from "../../src/types.js";

export const AUTH: OAuthConfig = {
  kind: "oauth2",
  prefix: "META",
  authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
  tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
  scopes: ["pages_show_list", "pages_read_engagement", "pages_read_user_content", "pages_manage_posts", "pages_manage_engagement", "read_insights", "business_management"],
  tokenAuth: "body",
  guide: "developers.facebook.com → the Business app used for Meta Ads (or a new one) → add Facebook Login for Business → Valid OAuth Redirect URIs = the one shown here → Settings → Basic: App ID (client id), App Secret. Connect with a user who admins the Page.",
};

const G = "https://graph.facebook.com/v21.0";
const NOT_CONNECTED = "Connect Facebook (Meta login) first, or store FACEBOOK_PAGE_ACCESS_TOKEN and FACEBOOK_PAGE_ID in the vault";
const PAGE_FIELDS = "id,name,category,fan_count";

type Page = { id: string; name: string; token: string };

async function graph(token: string, path: string, method: "GET" | "POST" = "GET", params: Record<string, unknown> = {}) {
  const url = new URL(`${G}${path}`);
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) form.set(k, typeof v === "string" ? v : JSON.stringify(v));
  form.set("access_token", token);
  const res =
    method === "GET"
      ? await fetch(`${url}?${form}`)
      : await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, body };
}

function errMsg(body: Record<string, unknown>): string {
  return String((body.error as { message?: string })?.message ?? "request failed");
}

function pick(p: Record<string, unknown>) {
  return { id: String(p.id ?? ""), name: p.name, category: p.category, fan_count: p.fan_count };
}

/** Pages visible to a token: a Page token sees itself (/me), a user token lists /me/accounts. Never returns tokens. */
async function pagesWith(token: string, pageToken: boolean): Promise<{ pages: ReturnType<typeof pick>[] } | { error: string }> {
  const r = pageToken ? await graph(token, "/me", "GET", { fields: PAGE_FIELDS }) : await graph(token, "/me/accounts", "GET", { fields: PAGE_FIELDS });
  if (!r.ok) return { error: errMsg(r.body) };
  const list = pageToken ? [r.body] : ((r.body.data as Record<string, unknown>[]) ?? []);
  return { pages: list.map(pick) };
}

/**
 * The Page (id + Page token) handlers act on. FACEBOOK_PAGE_ACCESS_TOKEN
 * wins when stored (with FACEBOOK_PAGE_ID, or /me tells us the id);
 * otherwise the user token from Connect resolves the Page token through
 * /me/accounts, picking `wanted` (the call's page_id, else FACEBOOK_PAGE_ID)
 * or the first Page the login manages.
 */
async function pageFor(companyId: string, secrets: SecretResolver, override?: string): Promise<{ page: Page } | { error: ToolResult }> {
  const wanted = override || secrets.get("FACEBOOK_PAGE_ID");
  const direct = secrets.get("FACEBOOK_PAGE_ACCESS_TOKEN");
  if (direct) {
    if (wanted) return { page: { id: wanted, name: "", token: direct } };
    const me = await graph(direct, "/me", "GET", { fields: "id,name" });
    if (!me.ok || !me.body.id) return { error: fail("facebook_error", `FACEBOOK_PAGE_ACCESS_TOKEN rejected: ${errMsg(me.body)}`) };
    return { page: { id: String(me.body.id), name: String(me.body.name ?? ""), token: direct } };
  }
  const user = await ensureToken(companyId, secrets, AUTH);
  if (!user) return { error: fail("not_connected", NOT_CONNECTED) };
  const r = await graph(user, "/me/accounts", "GET", { fields: "id,name,access_token" });
  if (!r.ok) return { error: fail("facebook_error", errMsg(r.body)) };
  const pages = (r.body.data as { id: string; name: string; access_token: string }[]) ?? [];
  const p = wanted ? pages.find((x) => x.id === wanted) : pages[0];
  if (!p) return { error: fail("no_page", wanted ? `this login does not manage Page ${wanted}` : "this login manages no Facebook Page; run facebook.pages") };
  return { page: { id: p.id, name: p.name, token: p.access_token } };
}

export default defineIntegration({
  id: "facebook",
  auth: AUTH,
  title: "Facebook Pages",
  description: "Publish posts to a Facebook Page, read posts, comments and insights, reply to comments.",
  website: "https://developers.facebook.com/docs/pages-api",
  guidance: `
## What it does
- **read** — \`facebook.pages\` lists the Pages the login manages; \`facebook.posts\` recent posts with likes, comments and shares; \`facebook.comments\` the comments on one post; \`facebook.insights\` page metrics (impressions, post engagements, fans) by day, week or 28 days.
- **publish** — \`facebook.post\` publishes a text post with an optional link, or a photo post from a public image URL. Parks for the board, who sees the text and the media link.
- **engage** — \`facebook.reply_comment\` answers a comment publicly. It is a send with no known recipient, so it parks as **first contact** under the default policy.

## Connecting
1. Meta app of type Business (the Meta Ads one works) with **Facebook Login for Business**; add the redirect URI shown here under Valid OAuth Redirect URIs. Pages need the \`pages_*\` and \`read_insights\` permissions; apps in development mode can use them for Pages their admins manage, live apps need App Review.
2. Paste App ID and App Secret (\`META_CLIENT_ID\` / \`META_CLIENT_SECRET\`, shared with Meta Ads), **Connect** with a user who admins the Page, and approve the Page in the dialog. One Connect covers every Meta integration the company enabled.
3. Run \`facebook.pages\`. If the login manages several Pages, store the one to use as \`FACEBOOK_PAGE_ID\`; otherwise the first Page is used.

## Or use a Page token
Business Settings → System Users → assign the Page → Generate token with \`pages_show_list, pages_read_engagement, pages_read_user_content, pages_manage_posts, pages_manage_engagement, read_insights\` → \`FACEBOOK_PAGE_ACCESS_TOKEN\` (+ \`FACEBOOK_PAGE_ID\`). No Connect needed.

## Enabling
\`\`\`yaml
integrations:
  - id: facebook
    modes: [read, publish, engage]
\`\`\`
Media must be a public URL. Postiz is the alternative when you want scheduling and every network in one place.
`,
  secrets: [
    { name: "META_CLIENT_ID", description: "App ID (for Connect; shared with Meta Ads)", obtain: "developers.facebook.com → app → Settings → Basic", required: false },
    { name: "META_CLIENT_SECRET", description: "App Secret (for Connect; shared with Meta Ads)", obtain: "developers.facebook.com → app → Settings → Basic", required: false },
    { name: "META_ACCESS_TOKEN", description: "User token (set by Connect; shared with Meta Ads) — or store FACEBOOK_PAGE_ACCESS_TOKEN instead", obtain: "Connect button" },
    { name: "FACEBOOK_PAGE_ACCESS_TOKEN", description: "Page access token (alternative to Connect)", obtain: "Business Settings → System Users → Generate token, or Graph API Explorer", required: false },
    { name: "FACEBOOK_PAGE_ID", description: "Page id to act on (optional; first managed Page otherwise)", obtain: "facebook.pages, or the Page's About → Page transparency", required: false },
  ],
  modes: [
    { id: "read", title: "Read", description: "Pages, posts, comments, insights", sideEffect: "read" },
    { id: "publish", title: "Publish", description: "Publish posts to the Page", sideEffect: "publish" },
    { id: "engage", title: "Engage", description: "Reply to comments", sideEffect: "send" },
  ],
  methods: [
    {
      name: "pages", mode: "read",
      description: "The Facebook Pages this login manages (id, name, category, fans). With a Page token: that Page.",
      input: strictSchema({}),
      async handler(ctx) {
        const direct = ctx.secrets.get("FACEBOOK_PAGE_ACCESS_TOKEN");
        const token = direct ?? (await ensureToken(ctx.company.id, ctx.secrets, AUTH));
        if (!token) return fail("not_connected", NOT_CONNECTED);
        const r = await pagesWith(token, !!direct);
        if ("error" in r) return fail("facebook_error", r.error);
        return { ok: true, pages: r.pages };
      },
    },
    {
      name: "post", mode: "publish",
      description: "Publish a post to the Page: text with an optional link, or a photo post when media_url is given. Parks for the board.",
      input: strictSchema(
        {
          message: { type: "string", maxLength: 63206 },
          link: { type: "string", description: "URL to attach as a link preview" },
          media_url: { type: "string", description: "Public image URL; makes it a photo post with message as caption" },
          page_id: { type: "string", description: "Override the Page (default FACEBOOK_PAGE_ID or the first managed Page)" },
          reason: { type: "string" },
        },
        ["message", "reason"],
      ),
      async handler(ctx, input) {
        const p = await pageFor(ctx.company.id, ctx.secrets, input.page_id ? String(input.page_id) : undefined);
        if ("error" in p) return p.error;
        const message = String(input.message);
        const r = input.media_url
          ? await graph(p.page.token, `/${p.page.id}/photos`, "POST", { url: String(input.media_url), message: input.link ? `${message}\n${String(input.link)}` : message })
          : await graph(p.page.token, `/${p.page.id}/feed`, "POST", { message, ...(input.link ? { link: String(input.link) } : {}) });
        if (!r.ok) return fail("facebook_error", errMsg(r.body));
        const postId = String(r.body.post_id ?? r.body.id ?? "");
        ctx.emit("artifact.created", { kind: "post", ref: postId, channel: "facebook" });
        return { ok: true, post_id: postId, page_id: p.page.id };
      },
    },
    {
      name: "insights", mode: "read",
      description: "Page metrics over a period: default page_impressions, page_post_engagements, page_fans (fans is a lifetime count, period day). Returns the latest value and the last 7 data points per metric.",
      input: strictSchema(
        {
          metrics: { type: "array", items: { type: "string" }, description: "Page insight metric names" },
          period: { type: "string", enum: ["day", "week", "days_28"] },
        },
        [],
      ),
      async handler(ctx, input) {
        const p = await pageFor(ctx.company.id, ctx.secrets);
        if ("error" in p) return p.error;
        const metrics = ((input.metrics as unknown[] | undefined) ?? []).map(String).filter(Boolean);
        const period = String(input.period ?? "day");
        const r = await graph(p.page.token, `/${p.page.id}/insights`, "GET", { metric: (metrics.length ? metrics : ["page_impressions", "page_post_engagements", "page_fans"]).join(","), period });
        if (!r.ok) return fail("facebook_error", errMsg(r.body));
        type Metric = { name: string; period: string; values?: { value: unknown; end_time?: string }[] };
        const data = (r.body.data as Metric[]) ?? [];
        return {
          ok: true,
          page_id: p.page.id,
          period,
          insights: data.map((m) => ({ metric: m.name, period: m.period, latest: m.values?.at(-1)?.value, values: (m.values ?? []).slice(-7) })),
        };
      },
    },
    {
      name: "posts", mode: "read",
      description: "Recent posts on the Page with message, permalink, likes, comments and shares.",
      input: strictSchema({ limit: { type: "integer", maximum: 100 } }, []),
      async handler(ctx, input) {
        const p = await pageFor(ctx.company.id, ctx.secrets);
        if ("error" in p) return p.error;
        const r = await graph(p.page.token, `/${p.page.id}/posts`, "GET", {
          fields: "message,created_time,permalink_url,shares,likes.summary(true),comments.summary(true)",
          limit: String(Math.min(Math.max(Number(input.limit ?? 20), 1), 100)),
        });
        if (!r.ok) return fail("facebook_error", errMsg(r.body));
        type Post = { id: string; message?: string; created_time?: string; permalink_url?: string; shares?: { count?: number }; likes?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } };
        const data = (r.body.data as Post[]) ?? [];
        return {
          ok: true,
          page_id: p.page.id,
          posts: data.map((x) => ({
            id: x.id, message: (x.message ?? "").slice(0, 500), created_time: x.created_time, permalink_url: x.permalink_url,
            likes: x.likes?.summary?.total_count ?? 0, comments: x.comments?.summary?.total_count ?? 0, shares: x.shares?.count ?? 0,
          })),
        };
      },
    },
    {
      name: "comments", mode: "read",
      description: "Comments on one post (id, author, text, likes, reply count), oldest first. Use the comment id with facebook.reply_comment.",
      input: strictSchema({ post_id: { type: "string" }, limit: { type: "integer", maximum: 100 } }, ["post_id"]),
      async handler(ctx, input) {
        const p = await pageFor(ctx.company.id, ctx.secrets);
        if ("error" in p) return p.error;
        const r = await graph(p.page.token, `/${String(input.post_id)}/comments`, "GET", {
          fields: "id,message,from,created_time,like_count,comment_count",
          limit: String(Math.min(Math.max(Number(input.limit ?? 25), 1), 100)),
        });
        if (!r.ok) return fail("facebook_error", errMsg(r.body));
        type Comment = { id: string; message?: string; from?: { id?: string; name?: string }; created_time?: string; like_count?: number; comment_count?: number };
        const data = (r.body.data as Comment[]) ?? [];
        return {
          ok: true,
          post_id: input.post_id,
          comments: data.map((c) => ({ id: c.id, from: c.from?.name, from_id: c.from?.id, message: (c.message ?? "").slice(0, 1000), created_time: c.created_time, likes: c.like_count ?? 0, replies: c.comment_count ?? 0 })),
        };
      },
    },
    {
      name: "reply_comment", mode: "engage",
      description: "Reply publicly to a comment on a Page post, as the Page. A public reply has no known recipient, so it parks as first contact under the default policy.",
      alwaysApprove: false,
      input: strictSchema({ comment_id: { type: "string", description: "Comment id from facebook.comments" }, message: { type: "string", maxLength: 8000 } }),
      async handler(ctx, input) {
        const p = await pageFor(ctx.company.id, ctx.secrets);
        if ("error" in p) return p.error;
        const r = await graph(p.page.token, `/${String(input.comment_id)}/comments`, "POST", { message: String(input.message) });
        if (!r.ok) return fail("facebook_error", errMsg(r.body));
        const id = String(r.body.id ?? "");
        ctx.emit("artifact.created", { kind: "comment", ref: id, channel: "facebook", in_reply_to: input.comment_id });
        return { ok: true, comment_id: id, in_reply_to: input.comment_id };
      },
    },
  ],
  async healthcheck(ctx) {
    const direct = ctx.secrets.get("FACEBOOK_PAGE_ACCESS_TOKEN");
    const token = direct ?? ctx.secrets.get("META_ACCESS_TOKEN");
    if (!token) return { ok: false, detail: "not connected: META_ACCESS_TOKEN (Connect) or FACEBOOK_PAGE_ACCESS_TOKEN missing" };
    const r = await pagesWith(token, !!direct);
    if ("error" in r) return { ok: false, detail: `token rejected: ${r.error}` };
    if (!r.pages.length) return { ok: false, detail: "token valid but this login manages no Page" };
    return { ok: true, detail: r.pages.map((p) => `${String(p.name ?? "?")} (${p.id})`).join(", ") };
  },
});
