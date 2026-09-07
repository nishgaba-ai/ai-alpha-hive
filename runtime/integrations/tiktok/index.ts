// TikTok — profile and video stats through the Display API (read);
// publishing through the Content Posting API, pull-from-URL (publish:
// parked for the board). Login Kit OAuth with PKCE; TikTok names the
// client id `client_key`, which the OAuth layer honours via clientIdParam.
// Unaudited apps can only post SELF_ONLY.

import { defineIntegration, strictSchema, fail, type OAuthConfig } from "../../src/integrations/registry.js";
import { ensureToken } from "../../src/oauth.js";

export const AUTH: OAuthConfig = {
  kind: "oauth2",
  prefix: "TIKTOK",
  authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
  tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
  scopes: ["user.info.basic", "user.info.stats", "video.list", "video.publish"],
  pkce: true,
  tokenAuth: "body",
  clientIdParam: "client_key",
  guide: "developers.tiktok.com → Manage apps → create an app → add Login Kit and Content Posting API → Login Kit: Redirect URI = the one shown here → copy the Client key (paste as TIKTOK_CLIENT_ID) and Client secret. Enable the scopes user.info.basic, user.info.stats, video.list, video.publish on the app.",
};

const API = "https://open.tiktokapis.com/v2";
const NOT_CONNECTED = "Connect TikTok first (Integrations → TikTok → Connect)";
const PRIVACY = ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "PUBLIC_TO_EVERYONE"];

type Json = Record<string, unknown>;
type TkError = { code?: string; message?: string; log_id?: string };
type Reply = { ok: boolean; status: number; data: Json; error: TkError };

async function tk(token: string, path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<Reply> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as { data?: Json; error?: TkError };
  const error = body.error ?? {};
  return { ok: res.ok && (!error.code || error.code === "ok"), status: res.status, data: body.data ?? {}, error };
}

function errText(r: { status: number; error: TkError }): string {
  const code = r.error.code ?? `HTTP ${r.status}`;
  const base = `${code}${r.error.message ? `: ${r.error.message}` : ""}`;
  switch (r.error.code) {
    case "access_token_invalid":
      return `${base} — token expired or revoked; Connect TikTok again`;
    case "scope_not_authorized":
      return `${base} — enable the scope on the app at developers.tiktok.com and Connect again`;
    case "url_ownership_unverified":
      return `${base} — verify the video's domain under Content Posting API → URL properties in the TikTok app, or host it on a verified domain`;
    case "unaudited_client_can_only_post_to_private_accounts":
      return `${base} — the app has not passed TikTok's audit: post with privacy SELF_ONLY, or submit the app for review`;
    case "spam_risk_too_many_posts":
    case "spam_risk_user_banned_from_posting":
    case "rate_limit_exceeded":
      return `${base} — TikTok is throttling this account; wait before posting again`;
    default:
      return base;
  }
}

export default defineIntegration({
  id: "tiktok",
  auth: AUTH,
  title: "TikTok",
  description: "Profile and video stats for the connected creator; publish videos from a public URL after approval.",
  website: "https://developers.tiktok.com/",
  guidance: `
## What it does
- **read** — \`tiktok.profile\` (display name, followers, likes, video count), \`tiktok.videos\` (recent videos with views, likes, comments, shares), \`tiktok.status\` (progress of a publish by \`publish_id\`).
- **publish** — \`tiktok.publish\` posts a video from a public URL through the Content Posting API (pull-from-URL). Parks for the board. It returns a \`publish_id\`; poll \`tiktok.status\` until \`PUBLISH_COMPLETE\`.

## Connecting
1. https://developers.tiktok.com → Manage apps → create an app; add the products **Login Kit** and **Content Posting API**. Enable the scopes \`user.info.basic\`, \`user.info.stats\`, \`video.list\`, \`video.publish\`.
2. Login Kit → **Redirect URI** = the one shown here (TikTok wants https; the sandbox accepts localhost).
3. Paste the app's **Client key** as \`TIKTOK_CLIENT_ID\` and the **Client secret** as \`TIKTOK_CLIENT_SECRET\`, then **Connect** with the creator account. TikTok names the id parameter \`client_key\`: this integration sets \`clientIdParam\`, so the runtime's OAuth layer sends \`client_key\` instead of \`client_id\` on both the authorize and the token call. Access tokens last 24 hours and refresh automatically (the refresh token lasts a year).
4. Content Posting API → **URL properties**: verify the domain (or URL prefix) the videos will be pulled from. Unverified sources are rejected with \`url_ownership_unverified\`.

## Sandbox vs audited app
An app that has not passed TikTok's audit can post only as **SELF_ONLY** (visible to the creator alone), and in the sandbox only for accounts added as testers; the creator can change visibility in the TikTok app afterwards. Submit the app for review to unlock \`PUBLIC_TO_EVERYONE\` and the other privacy levels. \`tiktok.publish\` queries the creator's allowed levels first and fails early when the requested one is not available.

## Enabling
\`\`\`yaml
integrations:
  - id: tiktok
    modes: [read, publish]
roles:
  - id: content
    tools: [tiktok.*]          # or by mode: tiktok:read, tiktok:publish
\`\`\`
`,
  secrets: [
    { name: "TIKTOK_CLIENT_ID", description: "App Client key (TikTok calls it client_key)", obtain: "developers.tiktok.com → Manage apps → your app", required: false },
    { name: "TIKTOK_CLIENT_SECRET", description: "App Client secret", obtain: "developers.tiktok.com → Manage apps → your app", required: false },
    { name: "TIKTOK_ACCESS_TOKEN", description: "User token (set by Connect; 24 h, refreshed automatically)", obtain: "Connect button" },
  ],
  modes: [
    { id: "read", title: "Read", description: "Profile, videos, publish status", sideEffect: "read" },
    { id: "publish", title: "Publish", description: "Post videos", sideEffect: "publish" },
  ],
  methods: [
    {
      name: "profile", mode: "read",
      description: "The connected creator: display name, followers, following, likes, video count.",
      input: strictSchema({}),
      async handler(ctx) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("not_connected", NOT_CONNECTED);
        const r = await tk(token, "/user/info/?fields=open_id,display_name,avatar_url,follower_count,following_count,likes_count,video_count");
        if (!r.ok) return fail("tiktok_error", errText(r));
        const u = (r.data.user as Json) ?? {};
        return { ok: true, profile: { open_id: u.open_id, display_name: u.display_name, followers: u.follower_count, following: u.following_count, likes: u.likes_count, videos: u.video_count } };
      },
    },
    {
      name: "videos", mode: "read",
      description: "Recent videos (newest first) with views, likes, comments and shares. At most 20 per call.",
      input: strictSchema({ limit: { type: "integer", minimum: 1, maximum: 20 } }, []),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("not_connected", NOT_CONNECTED);
        const r = await tk(token, "/video/list/?fields=id,title,create_time,share_url,duration,view_count,like_count,comment_count,share_count", { method: "POST", body: { max_count: Math.min(Number(input.limit ?? 20), 20) } });
        if (!r.ok) return fail("tiktok_error", errText(r));
        const videos = ((r.data.videos as Json[]) ?? []).map((v) => ({
          id: v.id,
          title: String(v.title ?? "").slice(0, 200),
          created_at: typeof v.create_time === "number" ? v.create_time * 1000 : v.create_time,
          url: v.share_url,
          duration_sec: v.duration,
          views: v.view_count,
          likes: v.like_count,
          comments: v.comment_count,
          shares: v.share_count,
        }));
        return { ok: true, videos, has_more: r.data.has_more ?? false };
      },
    },
    {
      name: "publish", mode: "publish",
      description: "Post a video from a public https URL on a domain verified in the TikTok app. privacy defaults to SELF_ONLY (the only level unaudited apps may use). Parks for the board; returns publish_id for tiktok.status.",
      input: strictSchema(
        {
          video_url: { type: "string", description: "https link to the file on a verified domain" },
          title: { type: "string", minLength: 1, maxLength: 2200, description: "caption; #hashtags and @mentions are parsed" },
          privacy: { type: "string", enum: PRIVACY },
          reason: { type: "string" },
        },
        ["video_url", "title", "reason"],
      ),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("not_connected", `${NOT_CONNECTED}; the board can post by hand meanwhile`);
        const videoUrl = String(input.video_url);
        if (!/^https:\/\/[^/\s]+\/\S*$/.test(videoUrl)) return fail("bad_url", "video_url must be an https link to the file on a domain verified under the TikTok app's URL properties");
        const privacy = String(input.privacy ?? "SELF_ONLY");
        const info = await tk(token, "/post/publish/creator_info/query/", { method: "POST", body: {} });
        if (!info.ok) return fail("tiktok_error", errText(info));
        const options = (info.data.privacy_level_options as string[]) ?? [];
        if (options.length && !options.includes(privacy)) return fail("privacy_not_allowed", `this account may post as ${options.join(", ")}; unaudited apps are limited to SELF_ONLY`);
        const r = await tk(token, "/post/publish/video/init/", {
          method: "POST",
          body: {
            post_info: {
              title: String(input.title),
              privacy_level: privacy,
              disable_duet: !!info.data.duet_disabled,
              disable_comment: !!info.data.comment_disabled,
              disable_stitch: !!info.data.stitch_disabled,
            },
            source_info: { source: "PULL_FROM_URL", video_url: videoUrl },
          },
        });
        if (!r.ok) return fail("tiktok_error", errText(r));
        const publishId = String(r.data.publish_id ?? "");
        ctx.emit("artifact.created", { kind: "video", ref: publishId, channel: "tiktok", privacy });
        return { ok: true, publish_id: publishId, privacy, creator: info.data.creator_nickname, max_duration_sec: info.data.max_video_post_duration_sec, next: "poll tiktok.status with publish_id until PUBLISH_COMPLETE" };
      },
    },
    {
      name: "status", mode: "read",
      description: "Progress of a publish: PROCESSING_UPLOAD, PROCESSING_DOWNLOAD, SEND_TO_USER_INBOX, PUBLISH_COMPLETE or FAILED (with fail_reason).",
      input: strictSchema({ publish_id: { type: "string" } }),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("not_connected", NOT_CONNECTED);
        const r = await tk(token, "/post/publish/status/fetch/", { method: "POST", body: { publish_id: String(input.publish_id) } });
        if (!r.ok) return fail("tiktok_error", errText(r));
        return { ok: true, status: r.data.status, fail_reason: r.data.fail_reason, post_ids: r.data.publicaly_available_post_id ?? [], uploaded_bytes: r.data.uploaded_bytes };
      },
    },
  ],
  async healthcheck(ctx) {
    const token = ctx.secrets.get("TIKTOK_ACCESS_TOKEN");
    if (!token) return { ok: false, detail: "TIKTOK_ACCESS_TOKEN missing — Connect TikTok" };
    const r = await tk(token, "/user/info/?fields=open_id,display_name,follower_count");
    if (!r.ok) return { ok: false, detail: r.error.code === "access_token_invalid" ? "token expired or revoked (a tool call refreshes it; otherwise Connect again)" : errText(r) };
    const u = (r.data.user as Json) ?? {};
    return { ok: true, detail: `${u.display_name ?? "creator"} — ${u.follower_count ?? "?"} followers` };
  },
});
