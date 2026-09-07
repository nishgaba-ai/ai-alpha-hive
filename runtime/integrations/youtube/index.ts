// YouTube — channel, videos, analytics and comments through the Data API
// v3 and the YouTube Analytics API (read); replies to comments (engage: a
// `send` side effect with no known recipient, so it parks as first
// contact); uploads and metadata edits (publish: parked for the board).
// Shares the GOOGLE OAuth connection with GA4 and Search Console; the
// server asks for the union of their scopes on Connect.

import { defineIntegration, strictSchema, fail, type OAuthConfig } from "../../src/integrations/registry.js";
import { ensureToken } from "../../src/oauth.js";

export const AUTH: OAuthConfig = {
  kind: "oauth2",
  prefix: "GOOGLE",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.force-ssl",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
  ],
  tokenAuth: "body",
  extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  guide: "console.cloud.google.com → APIs & Services → enable YouTube Data API v3 and YouTube Analytics API → Credentials → OAuth client (Web application) → Authorized redirect URIs = the one shown here; copy Client ID and Client Secret. The same Google app and connection serve GA4 and Search Console.",
};

const DATA = "https://www.googleapis.com/youtube/v3";
const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
const DEFAULT_METRICS = ["views", "estimatedMinutesWatched", "averageViewDuration", "likes", "comments", "subscribersGained"];
const NOT_CONNECTED = "Connect Google with the YouTube scopes first (Integrations → YouTube → Connect)";

type Json = Record<string, unknown>;
type Reply = { ok: boolean; status: number; body: Json };

async function yt(token: string, url: string, init: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {}): Promise<Reply> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  return { ok: res.ok, status: res.status, body };
}

function apiError(r: { status: number; body: Json }): string {
  const e = r.body.error as { message?: string; errors?: { reason?: string }[] } | undefined;
  const reason = e?.errors?.[0]?.reason;
  const base = `${e?.message ?? `HTTP ${r.status}`}${reason ? ` (${reason})` : ""}`;
  if (r.status === 401) return `${base} — token expired or revoked; Connect Google again`;
  if (reason === "quotaExceeded") return `${base} — the daily YouTube API quota is used up; it resets at midnight Pacific time`;
  return base;
}

function prune<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

type VideoItem = {
  id: string;
  snippet?: { title?: string; description?: string; publishedAt?: string; tags?: string[]; categoryId?: string; defaultLanguage?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  status?: { privacyStatus?: string; uploadStatus?: string; embeddable?: boolean; license?: string; publicStatsViewable?: boolean; selfDeclaredMadeForKids?: boolean; publishAt?: string };
};

function compact(v: VideoItem) {
  return {
    id: v.id,
    title: v.snippet?.title,
    published_at: v.snippet?.publishedAt,
    privacy: v.status?.privacyStatus,
    views: Number(v.statistics?.viewCount ?? 0),
    likes: Number(v.statistics?.likeCount ?? 0),
    comments: Number(v.statistics?.commentCount ?? 0),
    url: `https://youtu.be/${v.id}`,
    description: (v.snippet?.description ?? "").slice(0, 200),
  };
}

async function hydrate(token: string, ids: string[]) {
  if (!ids.length) return { ok: true as const, videos: [] as ReturnType<typeof compact>[] };
  const r = await yt(token, `${DATA}/videos?part=snippet,statistics,status&maxResults=50&id=${ids.slice(0, 50).join(",")}`);
  if (!r.ok) return { ok: false as const, error: apiError(r) };
  return { ok: true as const, videos: ((r.body.items as VideoItem[]) ?? []).map(compact) };
}

type Channel = {
  id: string;
  snippet?: { title?: string; customUrl?: string; publishedAt?: string };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean; viewCount?: string; videoCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
};

async function myChannel(token: string) {
  const r = await yt(token, `${DATA}/channels?part=snippet,statistics,contentDetails&mine=true`);
  if (!r.ok) return { ok: false as const, status: r.status, error: apiError(r) };
  const c = ((r.body.items as Channel[]) ?? [])[0];
  if (!c) return { ok: false as const, status: 404, error: "this Google account has no YouTube channel (Connect with the account that owns the channel)" };
  return {
    ok: true as const,
    channel: {
      id: c.id,
      title: c.snippet?.title,
      handle: c.snippet?.customUrl,
      created_at: c.snippet?.publishedAt,
      subscribers: c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount ?? 0),
      views: Number(c.statistics?.viewCount ?? 0),
      videos: Number(c.statistics?.videoCount ?? 0),
      uploads_playlist: c.contentDetails?.relatedPlaylists?.uploads,
      url: `https://www.youtube.com/channel/${c.id}`,
    },
  };
}

/** Only public http(s) hosts: the worker fetches this URL itself, so loopback, link-local and private ranges are refused. */
function publicHttpUrl(raw: string): URL | undefined {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
  const h = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return undefined;
  if (h.includes(":")) {
    if (h === "::" || h === "::1" || h.startsWith("::ffff:") || /^fe[89ab]/.test(h) || /^f[cd]/.test(h)) return undefined;
    return u;
  }
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return undefined;
  }
  return u;
}

type Source = { ok: true; res: Response; size: number; type: string } | { ok: false; code: string; hint: string };

/** Opens the video as a stream; follows redirects by hand so every hop passes the host check. */
async function openSource(raw: string): Promise<Source> {
  let url = publicHttpUrl(raw);
  if (!url) return { ok: false, code: "bad_url", hint: "video_url must be a public http(s) URL (no private or local hosts)" };
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, { redirect: "manual", headers: { Accept: "video/*, application/octet-stream;q=0.9, */*;q=0.1" } });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      url = publicHttpUrl(new URL(location, url).toString());
      if (!url) return { ok: false, code: "bad_url", hint: "video_url redirects to a private or local host" };
      continue;
    }
    if (res.type === "opaqueredirect" || res.status === 0) {
      await res.body?.cancel();
      return { ok: false, code: "redirect_blocked", hint: "video_url redirects and the hop could not be inspected; give the final direct link" };
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      return { ok: false, code: "source_unreachable", hint: `fetching video_url returned HTTP ${res.status}` };
    }
    const size = Number(res.headers.get("content-length") ?? NaN);
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type.startsWith("text/html")) {
      await res.body.cancel();
      return { ok: false, code: "not_a_video", hint: "video_url returned an HTML page, not a video file; use a direct file link" };
    }
    if (!Number.isFinite(size) || size <= 0) {
      await res.body.cancel();
      return { ok: false, code: "unknown_size", hint: "the source did not send Content-Length; host the file where the size is known (object storage, a CDN, the company site)" };
    }
    if (size > MAX_UPLOAD_BYTES) {
      await res.body.cancel();
      return { ok: false, code: "too_large", hint: `the file is ${(size / 1048576).toFixed(0)} MB; this tool uploads at most 512 MB` };
    }
    return { ok: true, res, size, type: type.startsWith("video/") ? type : "application/octet-stream" };
  }
  return { ok: false, code: "bad_url", hint: "video_url redirects too many times" };
}

export default defineIntegration({
  id: "youtube",
  auth: AUTH,
  title: "YouTube",
  description: "Channel stats, videos, analytics and comments; reply to comments; upload and update videos after approval.",
  website: "https://developers.google.com/youtube/v3",
  guidance: `
## What it does
- **read** — \`youtube.channel\` (title, subscribers, views, uploads), \`youtube.videos\` (recent uploads with views, likes and comments, or a search of your own videos), \`youtube.analytics\` (YouTube Analytics reports: views, watch time, subscribers by day, video, country…), \`youtube.comments\` (top-level comments on a video).
- **engage** — \`youtube.reply\` answers a comment. A \`send\` side effect with no known recipient, so it parks for the board as first contact.
- **publish** — \`youtube.upload\` streams a video from a public URL into a resumable upload (private by default, 512 MB cap); \`youtube.update\` edits title, description, tags or privacy. Both park for the board.

## Connecting
1. Google Cloud → APIs & Services → enable **YouTube Data API v3** and **YouTube Analytics API** (the GA4 / Search Console project is fine).
2. OAuth consent screen: add the Google account that owns the channel as a test user while the app is in *Testing*; tokens issued in Testing expire after 7 days, so publish the app for permanent refresh tokens.
3. Credentials → OAuth client, type Web application, redirect URI = the one shown here. Paste Client ID and Client Secret into the vault (\`GOOGLE_CLIENT_ID\` / \`GOOGLE_CLIENT_SECRET\`, shared with GA4 and Search Console), then **Connect** with the channel's account and pick the channel if the account has several.
4. Run the healthcheck: it prints the channel title and subscriber count.

One Google token serves every Google integration the company enabled; Connect asks for all their scopes at once, so run Connect again after enabling another Google integration.

## Uploading
\`video_url\` must be a direct, public link to the file (object storage, a CDN, the company site) that sends \`Content-Length\`; the worker streams it to YouTube without storing it. Uploads land **private** unless \`privacy\` says otherwise, so the board can review and flip to public with \`youtube.update\`. The Data API quota is 10,000 units a day and an upload costs 1,600, so plan on at most six uploads a day; unverified Google projects may also keep uploads private.

## Enabling
\`\`\`yaml
integrations:
  - id: youtube
    modes: [read, engage, publish]
roles:
  - id: content
    tools: [youtube.*]        # or by mode: youtube:read, youtube:engage, youtube:publish
\`\`\`
`,
  secrets: [
    { name: "GOOGLE_CLIENT_ID", description: "OAuth client id (shared with GA4 and Search Console)", obtain: "Google Cloud → Credentials", required: false },
    { name: "GOOGLE_CLIENT_SECRET", description: "OAuth client secret", obtain: "Google Cloud → Credentials", required: false },
    { name: "GOOGLE_ACCESS_TOKEN", description: "User token with the YouTube scopes (set by Connect)", obtain: "Connect button" },
  ],
  modes: [
    { id: "read", title: "Read", description: "Channel, videos, analytics, comments", sideEffect: "read" },
    { id: "engage", title: "Engage", description: "Reply to comments", sideEffect: "send" },
    { id: "publish", title: "Publish", description: "Upload and update videos", sideEffect: "publish" },
  ],
  methods: [
    {
      name: "channel", mode: "read",
      description: "The connected channel: title, handle, subscribers, total views, video count.",
      input: strictSchema({}),
      async handler(ctx) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("not_connected", NOT_CONNECTED);
        const r = await myChannel(token);
        if (!r.ok) return fail("youtube_error", r.error);
        return { ok: true, channel: r.channel };
      },
    },
    {
      name: "videos", mode: "read",
      description: "Recent uploads with views, likes and comments; with query, searches the channel's own videos.",
      input: strictSchema({ limit: { type: "integer", minimum: 1, maximum: 50 }, query: { type: "string" } }, []),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("not_connected", NOT_CONNECTED);
        const limit = Math.min(Number(input.limit ?? 20), 50);
        let ids: string[];
        if (input.query) {
          const r = await yt(token, `${DATA}/search?part=id&forMine=true&type=video&maxResults=${limit}&q=${encodeURIComponent(String(input.query))}`);
          if (!r.ok) return fail("youtube_error", apiError(r));
          ids = ((r.body.items as { id?: { videoId?: string } }[]) ?? []).map((i) => i.id?.videoId).filter((x): x is string => !!x);
        } else {
          const ch = await myChannel(token);
          if (!ch.ok) return fail("youtube_error", ch.error);
          if (!ch.channel.uploads_playlist) return { ok: true, videos: [] };
          const r = await yt(token, `${DATA}/playlistItems?part=contentDetails&playlistId=${ch.channel.uploads_playlist}&maxResults=${limit}`);
          if (!r.ok) return fail("youtube_error", apiError(r));
          ids = ((r.body.items as { contentDetails?: { videoId?: string } }[]) ?? []).map((i) => i.contentDetails?.videoId).filter((x): x is string => !!x);
        }
        const v = await hydrate(token, ids);
        if (!v.ok) return fail("youtube_error", v.error);
        return { ok: true, videos: v.videos };
      },
    },
    {
      name: "analytics", mode: "read",
      description: "YouTube Analytics report for the channel between two dates (YYYY-MM-DD). metrics default to views, estimatedMinutesWatched, averageViewDuration, likes, comments, subscribersGained; dimensions default to [day] (others: video, country, trafficSourceType, deviceType). Reports by video need sort, e.g. -views.",
      input: strictSchema(
        {
          from: { type: "string", description: "YYYY-MM-DD" },
          to: { type: "string", description: "YYYY-MM-DD" },
          metrics: { type: "array", items: { type: "string" } },
          dimensions: { type: "array", items: { type: "string" } },
          sort: { type: "string", description: "column to sort by; prefix - for descending" },
          limit: { type: "integer", minimum: 1, maximum: 200 },
        },
        ["from", "to"],
      ),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("not_connected", NOT_CONNECTED);
        const metrics = (input.metrics as string[] | undefined)?.length ? (input.metrics as string[]) : DEFAULT_METRICS;
        const dims = (input.dimensions as string[] | undefined) ?? ["day"];
        const q = new URLSearchParams({ ids: "channel==MINE", startDate: String(input.from), endDate: String(input.to), metrics: metrics.join(","), maxResults: String(Math.min(Number(input.limit ?? 200), 200)) });
        if (dims.length) q.set("dimensions", dims.join(","));
        const sort = input.sort ? String(input.sort) : dims.includes("day") ? "day" : dims.includes("month") ? "month" : dims.length ? `-${metrics[0]}` : undefined;
        if (sort) q.set("sort", sort);
        const r = await yt(token, `${ANALYTICS}?${q}`);
        if (!r.ok) return fail("youtube_error", apiError(r));
        const headers = ((r.body.columnHeaders as { name: string }[]) ?? []).map((h) => h.name);
        const rows = ((r.body.rows as unknown[][]) ?? []).slice(0, 200).map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
        return { ok: true, rows, row_count: rows.length, metrics, dimensions: dims };
      },
    },
    {
      name: "comments", mode: "read",
      description: "Top-level comments on a video (comment_id is what youtube.reply needs). order: relevance (default) or time.",
      input: strictSchema({ video_id: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 }, order: { type: "string", enum: ["relevance", "time"] } }, ["video_id"]),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("not_connected", NOT_CONNECTED);
        const r = await yt(token, `${DATA}/commentThreads?part=snippet&videoId=${encodeURIComponent(String(input.video_id))}&maxResults=${Math.min(Number(input.limit ?? 20), 100)}&order=${input.order ?? "relevance"}&textFormat=plainText`);
        if (!r.ok) return fail("youtube_error", apiError(r));
        type Thread = { id: string; snippet?: { totalReplyCount?: number; topLevelComment?: { id: string; snippet?: { authorDisplayName?: string; textOriginal?: string; textDisplay?: string; likeCount?: number; publishedAt?: string } } } };
        const comments = ((r.body.items as Thread[]) ?? []).map((t) => {
          const c = t.snippet?.topLevelComment;
          return {
            comment_id: c?.id ?? t.id,
            author: c?.snippet?.authorDisplayName,
            text: (c?.snippet?.textOriginal ?? c?.snippet?.textDisplay ?? "").slice(0, 500),
            likes: c?.snippet?.likeCount ?? 0,
            replies: t.snippet?.totalReplyCount ?? 0,
            published_at: c?.snippet?.publishedAt,
          };
        });
        return { ok: true, comments };
      },
    },
    {
      name: "reply", mode: "engage",
      description: "Reply to a comment as the channel. Parks for the board (send, first contact).",
      input: strictSchema({ comment_id: { type: "string" }, text: { type: "string", minLength: 1, maxLength: 10000 }, reason: { type: "string" } }),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("not_connected", `${NOT_CONNECTED}; the board can reply by hand meanwhile`);
        const r = await yt(token, `${DATA}/comments?part=snippet`, { method: "POST", body: { snippet: { parentId: String(input.comment_id), textOriginal: String(input.text) } } });
        if (!r.ok) return fail("youtube_error", apiError(r));
        const id = String(r.body.id ?? "");
        ctx.emit("artifact.created", { kind: "comment", ref: id, channel: "youtube", parent: String(input.comment_id) });
        return { ok: true, reply_id: id };
      },
    },
    {
      name: "upload", mode: "publish",
      description: "Upload a video from a public URL (≤ 512 MB, streamed) with title, description, tags; private unless privacy says otherwise. Parks for the board.",
      input: strictSchema(
        {
          video_url: { type: "string", description: "direct public link to the file" },
          title: { type: "string", minLength: 1, maxLength: 100 },
          description: { type: "string", maxLength: 5000 },
          tags: { type: "array", items: { type: "string" } },
          privacy: { type: "string", enum: ["private", "unlisted", "public"] },
          category_id: { type: "string", description: "YouTube category id, e.g. 22 People & Blogs, 27 Education, 28 Science & Technology" },
          reason: { type: "string" },
        },
        ["video_url", "title", "reason"],
      ),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("not_connected", `${NOT_CONNECTED}; the board can upload by hand meanwhile`);
        const privacy = String(input.privacy ?? "private");
        const src = await openSource(String(input.video_url));
        if (!src.ok) return fail(src.code, src.hint);
        const meta = {
          snippet: prune({ title: String(input.title), description: String(input.description ?? ""), tags: input.tags as string[] | undefined, categoryId: input.category_id ? String(input.category_id) : undefined }),
          status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
        };
        try {
          const init = await fetch(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": src.type, "X-Upload-Content-Length": String(src.size) },
            body: JSON.stringify(meta),
          });
          const location = init.headers.get("location");
          if (!init.ok || !location) {
            const body = (await init.json().catch(() => ({}))) as Json;
            await src.res.body!.cancel();
            return fail("youtube_error", apiError({ status: init.status, body }));
          }
          await init.text().catch(() => "");
          const put = await fetch(location, {
            method: "PUT",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": src.type, "Content-Length": String(src.size) },
            body: src.res.body,
            duplex: "half",
          } as RequestInit);
          const body = (await put.json().catch(() => ({}))) as Json;
          if (!put.ok) return fail("youtube_error", apiError({ status: put.status, body }));
          const id = String(body.id ?? "");
          const status = (body.status as VideoItem["status"]) ?? {};
          ctx.emit("artifact.created", { kind: "video", ref: id, channel: "youtube", privacy: status.privacyStatus ?? privacy });
          return { ok: true, video_id: id, url: `https://youtu.be/${id}`, privacy: status.privacyStatus ?? privacy, upload_status: status.uploadStatus, bytes: src.size };
        } catch (e) {
          return fail("upload_failed", (e as Error).message);
        }
      },
    },
    {
      name: "update", mode: "publish",
      description: "Change a video's title, description, tags or privacy (other fields are kept). Parks for the board.",
      input: strictSchema(
        {
          video_id: { type: "string" },
          title: { type: "string", minLength: 1, maxLength: 100 },
          description: { type: "string", maxLength: 5000 },
          tags: { type: "array", items: { type: "string" } },
          privacy: { type: "string", enum: ["private", "unlisted", "public"] },
          reason: { type: "string" },
        },
        ["video_id", "reason"],
      ),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("not_connected", NOT_CONNECTED);
        const id = String(input.video_id);
        const cur = await yt(token, `${DATA}/videos?part=snippet,status&id=${encodeURIComponent(id)}`);
        if (!cur.ok) return fail("youtube_error", apiError(cur));
        const v = ((cur.body.items as VideoItem[]) ?? [])[0];
        if (!v) return fail("not_found", `video ${id} is not visible to this channel`);
        const s = v.snippet ?? {};
        const st = v.status ?? {};
        const privacy = input.privacy !== undefined ? String(input.privacy) : st.privacyStatus;
        const snippet = prune({
          title: input.title !== undefined ? String(input.title) : s.title,
          description: input.description !== undefined ? String(input.description) : s.description ?? "",
          tags: input.tags !== undefined ? (input.tags as string[]) : s.tags,
          categoryId: s.categoryId ?? "22",
          defaultLanguage: s.defaultLanguage,
        });
        const status = prune({
          privacyStatus: privacy,
          embeddable: st.embeddable,
          license: st.license,
          publicStatsViewable: st.publicStatsViewable,
          selfDeclaredMadeForKids: st.selfDeclaredMadeForKids,
          publishAt: privacy === "private" ? st.publishAt : undefined,
        });
        const r = await yt(token, `${DATA}/videos?part=snippet,status`, { method: "PUT", body: { id, snippet, status } });
        if (!r.ok) return fail("youtube_error", apiError(r));
        const out = r.body as VideoItem;
        return { ok: true, video_id: id, title: out.snippet?.title ?? snippet.title, privacy: out.status?.privacyStatus ?? privacy, url: `https://youtu.be/${id}` };
      },
    },
  ],
  async healthcheck(ctx) {
    const token = ctx.secrets.get("GOOGLE_ACCESS_TOKEN");
    if (!token) return { ok: false, detail: "GOOGLE_ACCESS_TOKEN missing — Connect Google with the YouTube scopes" };
    const r = await myChannel(token);
    if (!r.ok) return { ok: false, detail: r.status === 401 ? "token expired or revoked (a tool call refreshes it when a refresh token exists; otherwise Connect again)" : r.error };
    return { ok: true, detail: `${r.channel.title} — ${r.channel.subscribers ?? "hidden"} subscribers, ${r.channel.videos} videos` };
  },
});
