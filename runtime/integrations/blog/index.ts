// Blog — git-based publishing, the Okara way: a post is a Markdown file
// committed to the website's repository; the host (Vercel, or `hive ship`)
// deploys it. No CMS, no database: the repo is the source of truth and
// every post is a commit the board can read. Publishing parks for the
// board; the approval shows the full text.

import { defineIntegration, strictSchema, fail, type OAuthConfig } from "../../src/integrations/registry.js";
import { ensureToken } from "../../src/oauth.js";

export const AUTH: OAuthConfig = {
  kind: "oauth2",
  prefix: "GITHUB",
  authorizeUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  scopes: ["repo"],
  tokenAuth: "body",
  guide: "github.com → Settings → Developer settings → OAuth Apps → New OAuth App → Authorization callback URL = the redirect URI shown here → copy Client ID, generate a Client Secret. Or skip OAuth and paste a fine-grained personal access token with Contents: read/write on the site repo as GITHUB_ACCESS_TOKEN.",
};

const GH = "https://api.github.com";

async function gh(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${GH}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function cfg(secrets: { get(n: string): string | undefined }) {
  const repo = secrets.get("BLOG_REPO");
  const dir = (secrets.get("BLOG_PATH") ?? "content/blog").replace(/^\/|\/$/g, "");
  const branch = secrets.get("BLOG_BRANCH") ?? "main";
  const site = (secrets.get("BLOG_SITE_URL") ?? "").replace(/\/$/, "");
  return { repo, dir, branch, site };
}

export default defineIntegration({
  id: "blog",
  auth: AUTH,
  title: "Website blog (GitHub)",
  description: "Publish posts as Markdown commits to the website repository; the host deploys them.",
  website: "https://docs.github.com/en/rest/repos/contents",
  guidance: `
## What it does
- **read** — \`blog.list\` shows the posts in the repo folder; \`blog.get\` reads one.
- **publish** — \`blog.publish\` commits \`<slug>.md\` with front matter (title, description, date, tags, author) to the site repo and returns the URL the post will have once the host deploys. \`blog.unpublish\` deletes the file. Both park for the board, who sees the full post in the approval.

This is how the Prodigal AI site publishes: the writer drafts, the CMO requests publish, you approve, the commit lands, Vercel deploys. The site renders \`content/blog/*.md\` (platform/web has the route; the hive marketing template gets it next).

## Connecting
1. **Connect** with GitHub OAuth (scope \\\`repo\\\`) using the app you create at github.com → Settings → Developer settings → OAuth Apps, callback = the redirect URI shown here. Or paste a fine-grained personal access token (Contents: read/write on the site repo) as \\\`GITHUB_ACCESS_TOKEN\\\`.
2. Store \\\`BLOG_REPO\\\` (\\\`owner/name\\\`), \\\`BLOG_PATH\\\` (default \\\`content/blog\\\`), \\\`BLOG_BRANCH\\\` (default \\\`main\\\`) and \\\`BLOG_SITE_URL\\\` (for the returned links).
3. Make sure the host deploys on push (Vercel: import the repo once), or run \\\`hive ship\\\` from the workspace.
`,
  secrets: [
    { name: "GITHUB_CLIENT_ID", description: "OAuth app client id", obtain: "github.com → Developer settings → OAuth Apps", required: false },
    { name: "GITHUB_CLIENT_SECRET", description: "OAuth app client secret", obtain: "github.com → Developer settings → OAuth Apps", required: false },
    { name: "GITHUB_ACCESS_TOKEN", description: "Token (set by Connect, or a fine-grained PAT with Contents: write)", obtain: "Connect button, or github.com → Settings → Developer settings → Personal access tokens" },
    { name: "BLOG_REPO", description: "owner/name of the website repository", obtain: "the repo URL" },
    { name: "BLOG_PATH", description: "folder for posts (default content/blog)", obtain: "your site's content folder", required: false },
    { name: "BLOG_BRANCH", description: "branch the host deploys (default main)", obtain: "repo settings", required: false },
    { name: "BLOG_SITE_URL", description: "public site URL, for post links", obtain: "e.g. https://prodigalai.com", required: false },
  ],
  modes: [
    { id: "read", title: "Read", description: "List and read posts", sideEffect: "read" },
    { id: "publish", title: "Publish", description: "Commit and delete posts", sideEffect: "publish" },
  ],
  methods: [
    {
      name: "list", mode: "read",
      description: "Posts currently in the site repo (file names and sizes).",
      input: strictSchema({}),
      async handler(ctx) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        const { repo, dir, branch } = cfg(ctx.secrets);
        if (!token || !repo) return fail("not_connected", "Connect GitHub (or store GITHUB_ACCESS_TOKEN) and set BLOG_REPO");
        const r = await gh(token, `/repos/${repo}/contents/${dir}?ref=${branch}`);
        if (r.status === 404) return { ok: true, posts: [], note: `${dir} does not exist yet; the first publish creates it` };
        if (!r.ok) return fail("github_error", String(r.body.message ?? r.status));
        const files = (r.body as unknown as { name: string; size: number; path: string }[]).filter((f) => /\.mdx?$/.test(f.name));
        return { ok: true, posts: files.map((f) => ({ slug: f.name.replace(/\.mdx?$/, ""), path: f.path, size: f.size })) };
      },
    },
    {
      name: "get", mode: "read",
      description: "Read one post by slug (front matter + body).",
      input: strictSchema({ slug: { type: "string" } }),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        const { repo, dir, branch } = cfg(ctx.secrets);
        if (!token || !repo) return fail("not_connected", "Connect GitHub and set BLOG_REPO");
        const r = await gh(token, `/repos/${repo}/contents/${dir}/${slugify(String(input.slug))}.md?ref=${branch}`);
        if (!r.ok) return fail("not_found", String(r.body.message ?? r.status));
        return { ok: true, content: Buffer.from(String(r.body.content), "base64").toString("utf8") };
      },
    },
    {
      name: "publish", mode: "publish",
      description: "Commit a Markdown post to the site repo (creates or updates <slug>.md with front matter). Parks for the board.",
      input: strictSchema(
        {
          title: { type: "string", maxLength: 120 },
          description: { type: "string", maxLength: 300 },
          body_md: { type: "string" },
          slug: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          author: { type: "string" },
          reason: { type: "string" },
        },
        ["title", "description", "body_md", "reason"],
      ),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        const { repo, dir, branch, site } = cfg(ctx.secrets);
        if (!token || !repo) return fail("not_connected", "Connect GitHub (or store GITHUB_ACCESS_TOKEN) and set BLOG_REPO");
        const slug = slugify(String(input.slug ?? input.title));
        const path = `${dir}/${slug}.md`;
        const date = new Date().toISOString().slice(0, 10);
        const fm = [
          "---",
          `title: ${JSON.stringify(input.title)}`,
          `description: ${JSON.stringify(input.description)}`,
          `date: ${date}`,
          `author: ${JSON.stringify(input.author ?? ctx.agent.name)}`,
          `tags: [${((input.tags as string[]) ?? []).map((t) => JSON.stringify(t)).join(", ")}]`,
          "---",
          "",
        ].join("\n");
        const content = Buffer.from(fm + String(input.body_md).trim() + "\n", "utf8").toString("base64");
        const existing = await gh(token, `/repos/${repo}/contents/${path}?ref=${branch}`);
        const sha = existing.ok ? String(existing.body.sha) : undefined;
        const r = await gh(token, `/repos/${repo}/contents/${path}`, { method: "PUT", body: JSON.stringify({ message: `${sha ? "Update" : "Publish"}: ${input.title}\n\nby ${ctx.agent.name} · approved by the board`, content, branch, ...(sha ? { sha } : {}) }) });
        if (!r.ok) return fail("github_error", String(r.body.message ?? r.status));
        const commit = (r.body.commit as { html_url?: string })?.html_url;
        const url = site ? `${site}/blog/${slug}` : undefined;
        ctx.emit("artifact.created", { kind: "post", ref: url ?? path, channel: "blog", commit });
        return { ok: true, slug, path, url, commit, note: "deploys when the host picks up the commit" };
      },
    },
    {
      name: "unpublish", mode: "publish",
      description: "Delete a post from the site repo. Parks for the board.",
      input: strictSchema({ slug: { type: "string" }, reason: { type: "string" } }),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        const { repo, dir, branch } = cfg(ctx.secrets);
        if (!token || !repo) return fail("not_connected", "Connect GitHub and set BLOG_REPO");
        const path = `${dir}/${slugify(String(input.slug))}.md`;
        const existing = await gh(token, `/repos/${repo}/contents/${path}?ref=${branch}`);
        if (!existing.ok) return fail("not_found", "no such post");
        const r = await gh(token, `/repos/${repo}/contents/${path}`, { method: "DELETE", body: JSON.stringify({ message: `Unpublish: ${input.slug}`, sha: existing.body.sha, branch }) });
        if (!r.ok) return fail("github_error", String(r.body.message ?? r.status));
        return { ok: true };
      },
    },
  ],
  async healthcheck(ctx) {
    const token = ctx.secrets.get("GITHUB_ACCESS_TOKEN");
    const { repo, branch } = cfg(ctx.secrets);
    if (!token) return { ok: false, detail: "GITHUB_ACCESS_TOKEN missing (Connect or paste a PAT)" };
    if (!repo) return { ok: false, detail: "BLOG_REPO missing" };
    const r = await gh(token, `/repos/${repo}/branches/${branch}`);
    return r.ok ? { ok: true, detail: `${repo}@${branch} reachable` } : { ok: false, detail: String(r.body.message ?? r.status) };
  },
});
