// Instagram — publishing through the Instagram Graph API (a professional
// account linked to a Facebook Page). Posts need a public image or video
// URL. Publishing parks for the board. Prefer Postiz when you want one
// place for every network; use this for direct control.

import { defineIntegration, strictSchema, fail, type OAuthConfig } from "../../src/integrations/registry.js";
import { ensureToken } from "../../src/oauth.js";

export const AUTH: OAuthConfig = {
  kind: "oauth2",
  prefix: "INSTAGRAM",
  authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
  tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
  scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement", "business_management"],
  tokenAuth: "body",
  guide: "developers.facebook.com → the same Business app as Meta Ads (or a new one) → add Instagram Graph API and Facebook Login for Business → Valid OAuth Redirect URIs = the one shown here → Settings → Basic: App ID (client id), App Secret. The Instagram account must be Professional and linked to a Facebook Page you manage.",
};

const G = "https://graph.facebook.com/v21.0";

async function graph(token: string, path: string, method: "GET" | "POST" = "GET", params: Record<string, string> = {}) {
  const form = new URLSearchParams({ ...params, access_token: token });
  const res = method === "GET" ? await fetch(`${G}${path}?${form}`) : await fetch(`${G}${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, body };
}

async function igUserId(ctx: { secrets: { get(n: string): string | undefined } }, token: string): Promise<string | undefined> {
  const stored = ctx.secrets.get("INSTAGRAM_USER_ID");
  if (stored) return stored;
  const r = await graph(token, "/me/accounts", "GET", { fields: "name,instagram_business_account" });
  const pages = (r.body.data as { name: string; instagram_business_account?: { id: string } }[]) ?? [];
  return pages.find((p) => p.instagram_business_account)?.instagram_business_account?.id;
}

export default defineIntegration({
  id: "instagram",
  auth: AUTH,
  title: "Instagram",
  description: "Publish image and video posts to a professional Instagram account; read recent media.",
  website: "https://developers.facebook.com/docs/instagram-platform",
  guidance: `
## What it does
- **read** — \`instagram.account\` finds the professional account behind your Facebook Page; \`instagram.media\` lists recent posts with likes and comments.
- **publish** — \`instagram.post\` publishes an image or video from a public URL with a caption. Parks for the board, who sees the caption and the media link.

## Connecting
1. Instagram account set to **Professional** and linked to a Facebook Page you admin.
2. Meta app (the Meta Ads one works) with **Instagram Graph API** and **Facebook Login for Business**; add the redirect URI shown here.
3. Paste App ID and App Secret, **Connect**, approve for the Page. Run \`instagram.account\` (or the healthcheck) once; it stores nothing but tells you the account id, which you can store as \`INSTAGRAM_USER_ID\` to skip the lookup.

Media must be a public URL (an image on your site, or an asset the content role uploaded). Postiz is the alternative when you want scheduling and every network in one place.
`,
  secrets: [
    { name: "INSTAGRAM_CLIENT_ID", description: "Meta App ID", obtain: "developers.facebook.com → app → Settings → Basic", required: false },
    { name: "INSTAGRAM_CLIENT_SECRET", description: "Meta App Secret", obtain: "developers.facebook.com → app → Settings → Basic", required: false },
    { name: "INSTAGRAM_ACCESS_TOKEN", description: "User token (set by Connect)", obtain: "Connect button" },
    { name: "INSTAGRAM_USER_ID", description: "Instagram professional account id (optional; auto-discovered)", obtain: "instagram.account", required: false },
  ],
  modes: [
    { id: "read", title: "Read", description: "Account and media", sideEffect: "read" },
    { id: "publish", title: "Publish", description: "Publish posts", sideEffect: "publish" },
  ],
  methods: [
    {
      name: "account", mode: "read",
      description: "The Instagram professional account linked to your Facebook Pages.",
      input: strictSchema({}),
      async handler(ctx) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("not_connected", "Connect Instagram first");
        const id = await igUserId(ctx, token);
        if (!id) return fail("no_account", "no Page with a linked professional Instagram account was found for this login");
        const r = await graph(token, `/${id}`, "GET", { fields: "username,name,followers_count,media_count" });
        return { ok: r.ok, account: { id, ...r.body } };
      },
    },
    {
      name: "media", mode: "read",
      description: "Recent posts with caption, permalink, likes and comments.",
      input: strictSchema({ limit: { type: "integer", maximum: 50 } }, []),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("not_connected", "Connect Instagram first");
        const id = await igUserId(ctx, token);
        if (!id) return fail("no_account", "no linked professional account");
        const r = await graph(token, `/${id}/media`, "GET", { fields: "caption,permalink,media_type,timestamp,like_count,comments_count", limit: String(input.limit ?? 20) });
        if (!r.ok) return fail("instagram_error", String((r.body.error as { message?: string })?.message ?? "request failed"));
        return { ok: true, media: r.body.data ?? [] };
      },
    },
    {
      name: "post", mode: "publish",
      description: "Publish an image (or video) from a public URL with a caption. Parks for the board.",
      input: strictSchema(
        { media_url: { type: "string" }, caption: { type: "string", maxLength: 2200 }, kind: { type: "string", enum: ["image", "video"] }, reason: { type: "string" } },
        ["media_url", "caption", "reason"],
      ),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("not_connected", "Connect Instagram first; the board can post by hand meanwhile");
        const id = await igUserId(ctx, token);
        if (!id) return fail("no_account", "no linked professional account");
        const isVideo = input.kind === "video";
        const container = await graph(token, `/${id}/media`, "POST", isVideo ? { media_type: "REELS", video_url: String(input.media_url), caption: String(input.caption) } : { image_url: String(input.media_url), caption: String(input.caption) });
        if (!container.ok) return fail("instagram_error", String((container.body.error as { message?: string })?.message ?? "container failed"));
        if (isVideo) await new Promise((r) => setTimeout(r, 15000)); // video containers need processing time
        const pub = await graph(token, `/${id}/media_publish`, "POST", { creation_id: String(container.body.id) });
        if (!pub.ok) return fail("instagram_error", String((pub.body.error as { message?: string })?.message ?? "publish failed"));
        ctx.emit("artifact.created", { kind: "post", ref: String(pub.body.id), channel: "instagram" });
        return { ok: true, media_id: pub.body.id };
      },
    },
  ],
});
