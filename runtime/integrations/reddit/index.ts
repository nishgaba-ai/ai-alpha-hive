// Reddit — find conversations where the product is the honest answer.
// Reading uses the public JSON endpoints; replying needs an OAuth token
// and is a `send` side effect (first contact parks for the board).

import { defineIntegration, strictSchema, fail, type OAuthConfig } from "../../src/integrations/registry.js";
import { ensureToken } from "../../src/oauth.js";
export const AUTH: OAuthConfig = {
  kind: "oauth2",
  prefix: "REDDIT",
  authorizeUrl: "https://www.reddit.com/api/v1/authorize",
  tokenUrl: "https://www.reddit.com/api/v1/access_token",
  scopes: ["identity", "read", "submit"],
  tokenAuth: "basic",
  extraAuthorizeParams: { duration: "permanent" },
  guide: "reddit.com/prefs/apps → create app (type: web app) → redirect uri = the one shown here → the id under the app name is the client id; copy the secret.",
};
import { newId, run } from "../../src/db.js";

const UA = "alpha-hive-company/0.1 (by /u/prodigal-ai)";

async function pub(path: string) {
  const res = await fetch(`https://www.reddit.com${path}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`reddit HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

type Post = { data: { id: string; title: string; subreddit: string; selftext?: string; score: number; num_comments: number; permalink: string; created_utc: number; author: string } };

export default defineIntegration({
  id: "reddit",
  auth: AUTH,
  title: "Reddit",
  description: "Search threads and comments where a helpful reply would drive signups; draft replies for approval; post with an OAuth token.",
  website: "https://www.reddit.com/prefs/apps",
  guidance: `
## What it does
- **read** — \`reddit.search\` finds recent threads by query and subreddit; \`reddit.thread\` reads a thread with its top comments.
- **engage** — \`reddit.draft_reply\` saves a reply as a content draft (the board sees the exact text); \`reddit.reply\` posts it. Replying is a \`send\` side effect: parked for the board.

## Connecting (only for replying)
1. https://www.reddit.com/prefs/apps → create an app of type **web app**; redirect URI = the one shown here.
2. Paste the client id (the string under the app name) and the secret into the vault fields, then **Connect** and approve with the account that will reply. The runtime keeps a permanent refresh token and refreshes the hourly access token itself.

## Rules the social role follows
Only reply where the product is the genuinely useful answer; disclose the affiliation; never post the same reply twice; never touch subreddits that ban promotion.
`,
  secrets: [
    { name: "REDDIT_CLIENT_ID", description: "App client id", obtain: "https://www.reddit.com/prefs/apps", required: false },
    { name: "REDDIT_CLIENT_SECRET", description: "App secret", obtain: "https://www.reddit.com/prefs/apps", required: false },
    { name: "REDDIT_ACCESS_TOKEN", description: "User token (set by Connect)", obtain: "Connect button", modes: ["engage"] },
  ],
  modes: [
    { id: "read", title: "Read", description: "Search and read threads", sideEffect: "read" },
    { id: "engage", title: "Engage", description: "Draft and post replies", sideEffect: "send" },
  ],
  methods: [
    {
      name: "search", mode: "read",
      description: "Search recent Reddit threads. Optional subreddit and time window (day|week|month).",
      input: strictSchema({ query: { type: "string" }, subreddit: { type: "string" }, time: { type: "string", enum: ["day", "week", "month", "year"] }, limit: { type: "integer", maximum: 25 } }, ["query"]),
      async handler(_ctx, input) {
        const q = encodeURIComponent(String(input.query));
        const path = input.subreddit ? `/r/${input.subreddit}/search.json?q=${q}&restrict_sr=1&sort=new&t=${input.time ?? "week"}&limit=${input.limit ?? 15}` : `/search.json?q=${q}&sort=new&t=${input.time ?? "week"}&limit=${input.limit ?? 15}`;
        try {
          const body = await pub(path);
          const posts = (((body.data as { children?: Post[] })?.children) ?? []).map((p) => ({ id: p.data.id, title: p.data.title, subreddit: p.data.subreddit, score: p.data.score, comments: p.data.num_comments, url: `https://www.reddit.com${p.data.permalink}`, created_at: p.data.created_utc * 1000, excerpt: (p.data.selftext ?? "").slice(0, 300) }));
          return { ok: true, posts };
        } catch (e) {
          return fail("reddit_error", (e as Error).message);
        }
      },
    },
    {
      name: "thread", mode: "read",
      description: "Read a thread and its top comments by post id.",
      input: strictSchema({ post_id: { type: "string" } }),
      async handler(_ctx, input) {
        try {
          const body = (await pub(`/comments/${input.post_id}.json?limit=20`)) as unknown as [{ data: { children: Post[] } }, { data: { children: { data: { author: string; body?: string; score: number } }[] } }];
          const post = body[0]?.data.children[0]?.data;
          const comments = (body[1]?.data.children ?? []).map((c) => ({ author: c.data.author, score: c.data.score, body: (c.data.body ?? "").slice(0, 600) })).filter((c) => c.body);
          return { ok: true, post: post ? { title: post.title, text: (post.selftext ?? "").slice(0, 3000), subreddit: post.subreddit, score: post.score } : null, comments };
        } catch (e) {
          return fail("reddit_error", (e as Error).message);
        }
      },
    },
    {
      name: "draft_reply", mode: "engage", sideEffect: "write",
      description: "Save a reply draft for a thread so the board can read the exact text before it goes out.",
      input: strictSchema({ post_id: { type: "string" }, text: { type: "string", maxLength: 3000 }, why: { type: "string" } }),
      async handler(ctx, input) {
        const id = newId();
        run("INSERT INTO artifacts (id, company_id, run_id, task_id, kind, ref, meta_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
          id, ctx.company.id, ctx.run.id, ctx.run.task_id, "draft:reddit", String(input.post_id), JSON.stringify({ body_md: input.text, why: input.why, status: "draft" }), Date.now());
        ctx.emit("artifact.created", { kind: "draft:reddit", ref: input.post_id, artifact_id: id });
        return { ok: true, draft_id: id };
      },
    },
    {
      name: "reply", mode: "engage",
      description: "Post a reply to a thread. Parks for the board (send).",
      input: strictSchema({ post_id: { type: "string" }, text: { type: "string", maxLength: 3000 }, reason: { type: "string" } }),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("missing_secret", "REDDIT_ACCESS_TOKEN is not in the vault; the board can post the approved text by hand meanwhile");
        const res = await fetch("https://oauth.reddit.com/api/comment", { method: "POST", headers: { Authorization: `Bearer ${token}`, "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ api_type: "json", thing_id: `t3_${input.post_id}`, text: String(input.text) }) });
        const body = (await res.json().catch(() => ({}))) as { json?: { errors?: unknown[] } };
        if (!res.ok || body.json?.errors?.length) return fail("reddit_error", JSON.stringify(body.json?.errors ?? res.status));
        ctx.emit("artifact.created", { kind: "post", ref: `reddit:${input.post_id}`, channel: "reddit" });
        return { ok: true };
      },
    },
  ],
});
