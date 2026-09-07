// GitHub — the engineering surface: repositories, issues, pull requests,
// commits and file contents through the REST API. Shares the GITHUB_*
// vault secrets with the blog integration, so one Connect (or one PAT)
// serves both. Merging is a `deploy`: env: prod parks for the board by
// policy, and the handler refuses to merge into the default branch as
// "preview", so the gate cannot be talked around.

import { defineIntegration, strictSchema, fail, type OAuthConfig } from "../../src/integrations/registry.js";
import { ensureToken } from "../../src/oauth.js";
import type { ToolResult } from "../../src/types.js";

export const AUTH: OAuthConfig = {
  kind: "oauth2",
  prefix: "GITHUB",
  authorizeUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  scopes: ["repo", "read:user"],
  tokenAuth: "body",
  guide: "github.com → Settings → Developer settings → OAuth Apps → New OAuth App → Authorization callback URL = the redirect URI shown here → copy Client ID, generate a Client Secret. Or skip OAuth and paste a personal access token (classic: repo; fine-grained: Contents, Issues, Pull requests read/write on the repos the company works in) as GITHUB_ACCESS_TOKEN.",
};

const GH = "https://api.github.com";
const MAX_FILE = 30_000;

type Json = Record<string, unknown>;
type User = { login?: string };
type Repo = { full_name: string; private: boolean; default_branch: string; description: string | null; open_issues_count: number; updated_at: string; html_url: string };
type Issue = { number: number; title: string; state: string; labels?: { name: string }[]; user?: User; comments: number; created_at: string; updated_at: string; html_url: string; pull_request?: unknown };
type Pull = { number: number; title: string; state: string; draft?: boolean; head: { ref: string }; base: { ref: string }; user?: User; html_url: string; updated_at: string; merged?: boolean; mergeable?: boolean | null; mergeable_state?: string };
type Commit = { sha: string; commit: { message: string; author?: { name?: string; date?: string } }; html_url: string };
type Entry = { name: string; path: string; type: string; size: number };

async function gh(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${GH}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as Json;
  return { ok: res.ok, status: res.status, body };
}
const err = (r: { status: number; body: Json }): ToolResult => {
  const detail = (r.body.errors as { message?: string }[] | undefined)?.find((e) => e.message)?.message;
  return fail("github_error", `${String(r.body.message ?? `HTTP ${r.status}`)}${detail ? `: ${detail}` : ""}`, { status: r.status });
};
const notConnected = () => fail("not_connected", "Connect GitHub on the Integrations screen, or store a personal access token as GITHUB_ACCESS_TOKEN");
const repoOf = (v: unknown) => (/^[\w.-]+\/[\w.-]+$/.test(String(v)) ? String(v) : undefined);
const badRepo = () => fail("bad_input", "repo must be owner/name");
const lim = (v: unknown, d: number) => Math.max(1, Math.min(Number(v ?? d) || d, 100));
const firstLine = (s: string) => s.split("\n")[0].slice(0, 160);

const repoProp = { type: "string", description: "owner/name" };

export default defineIntegration({
  id: "github",
  auth: AUTH,
  title: "GitHub",
  description: "Repositories, issues, pull requests, commits and files; merging is a deploy the board gates.",
  website: "https://docs.github.com/en/rest",
  guidance: `
## What it does
- **read** — \`github.repos\` lists repositories the token can see (or an org's); \`github.issues\`, \`github.pulls\` and \`github.commits\` list a repo's issues, pull requests and commits; \`github.file\` reads a file (or lists a directory) at a ref.
- **write** — \`github.create_issue\`, \`github.comment\` (issues and PRs) and \`github.create_pr\` open work items; nothing is deployed.
- **ship** — \`github.merge_pr\` merges a pull request. It is a \`deploy\`: \`env: prod\` (a merge into the branch that deploys to production, usually the default branch) parks for the board under \`policies.deploy.prod\`; \`env: preview\` follows \`policies.deploy.preview\`. The handler refuses to merge into the default branch as preview.

Pushing code stays with the workspace (\`hive ship\`); this integration is how agents read repos and file, discuss and merge work. The core \`github.pr.*\` tools shell out to \`gh\`; these use the token in the vault, so a role pattern \`github.*\` matches both while \`github:read\` / \`github:write\` / \`github:ship\` select only this integration.

## Connecting
One GitHub connection serves \`blog\` and \`github\`: both read \`GITHUB_ACCESS_TOKEN\`.
1. **Connect** with GitHub OAuth (scopes \`repo\`, \`read:user\`) using the app you create at github.com → Settings → Developer settings → OAuth Apps, callback = the redirect URI shown here. Or paste a personal access token (classic \`repo\`, or fine-grained with Contents, Issues and Pull requests read/write on the company's repos) as \`GITHUB_ACCESS_TOKEN\`.
2. Run the healthcheck: it shows the login the token belongs to.

## Enabling
\`\`\`yaml
integrations:
  - id: github
    modes: [read, write, ship]   # drop ship to make merging impossible
roles:
  - id: engineer
    tools: [github:read, github:write]
  - id: cto
    tools: [github.*]
policies:
  deploy: { preview: allow, prod: approve }
\`\`\`
`,
  secrets: [
    { name: "GITHUB_CLIENT_ID", description: "OAuth app client id", obtain: "github.com → Developer settings → OAuth Apps", required: false },
    { name: "GITHUB_CLIENT_SECRET", description: "OAuth app client secret", obtain: "github.com → Developer settings → OAuth Apps", required: false },
    { name: "GITHUB_ACCESS_TOKEN", description: "Token (set by Connect, or a personal access token)", obtain: "Connect button, or github.com → Settings → Developer settings → Personal access tokens" },
  ],
  modes: [
    { id: "read", title: "Read", description: "Repos, issues, pull requests, commits, files", sideEffect: "read" },
    { id: "write", title: "Write", description: "Open issues and pull requests, comment", sideEffect: "write" },
    { id: "ship", title: "Ship", description: "Merge pull requests (prod parks by policy)", sideEffect: "deploy" },
  ],
  methods: [
    {
      name: "repos", mode: "read",
      description: "Repositories the token can see, most recently updated first; org narrows to one organisation.",
      input: strictSchema({ org: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, []),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return notConnected();
        const per = lim(input.limit, 30);
        const path = input.org ? `/orgs/${encodeURIComponent(String(input.org))}/repos?sort=updated&per_page=${per}` : `/user/repos?sort=updated&affiliation=owner,collaborator,organization_member&per_page=${per}`;
        const r = await gh(token, path);
        if (!r.ok) return err(r);
        const repos = (r.body as unknown as Repo[]).map((x) => ({ full_name: x.full_name, private: x.private, default_branch: x.default_branch, description: x.description, open_issues: x.open_issues_count, updated_at: x.updated_at, html_url: x.html_url }));
        return { ok: true, repos };
      },
    },
    {
      name: "issues", mode: "read",
      description: "Issues in a repo (pull requests excluded). state: open|closed|all; labels narrow.",
      input: strictSchema({ repo: repoProp, state: { type: "string", enum: ["open", "closed", "all"] }, labels: { type: "array", items: { type: "string" } }, limit: { type: "integer", minimum: 1, maximum: 100 } }, ["repo"]),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return notConnected();
        const repo = repoOf(input.repo);
        if (!repo) return badRepo();
        const q = new URLSearchParams({ state: String(input.state ?? "open"), per_page: String(lim(input.limit, 30)), sort: "updated" });
        if (Array.isArray(input.labels) && input.labels.length) q.set("labels", (input.labels as string[]).join(","));
        const r = await gh(token, `/repos/${repo}/issues?${q}`);
        if (!r.ok) return err(r);
        const issues = (r.body as unknown as Issue[]).filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, state: i.state, labels: (i.labels ?? []).map((l) => l.name), author: i.user?.login, comments: i.comments, created_at: i.created_at, updated_at: i.updated_at, html_url: i.html_url }));
        return { ok: true, issues };
      },
    },
    {
      name: "create_issue", mode: "write",
      description: "Open an issue.",
      input: strictSchema({ repo: repoProp, title: { type: "string", maxLength: 256 }, body: { type: "string" }, labels: { type: "array", items: { type: "string" } } }, ["repo", "title", "body"]),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return notConnected();
        const repo = repoOf(input.repo);
        if (!repo) return badRepo();
        const r = await gh(token, `/repos/${repo}/issues`, { method: "POST", body: JSON.stringify({ title: input.title, body: input.body, labels: input.labels ?? [] }) });
        if (!r.ok) return err(r);
        ctx.emit("artifact.created", { kind: "issue", ref: r.body.html_url, repo, number: r.body.number, title: input.title });
        return { ok: true, number: r.body.number, html_url: r.body.html_url };
      },
    },
    {
      name: "comment", mode: "write",
      description: "Comment on an issue or pull request by number.",
      input: strictSchema({ repo: repoProp, number: { type: "integer", minimum: 1 }, body: { type: "string" } }),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return notConnected();
        const repo = repoOf(input.repo);
        if (!repo) return badRepo();
        const r = await gh(token, `/repos/${repo}/issues/${Number(input.number)}/comments`, { method: "POST", body: JSON.stringify({ body: input.body }) });
        if (!r.ok) return err(r);
        return { ok: true, comment_id: r.body.id, html_url: r.body.html_url };
      },
    },
    {
      name: "pulls", mode: "read",
      description: "Pull requests in a repo. state: open|closed|all.",
      input: strictSchema({ repo: repoProp, state: { type: "string", enum: ["open", "closed", "all"] }, limit: { type: "integer", minimum: 1, maximum: 100 } }, ["repo"]),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return notConnected();
        const repo = repoOf(input.repo);
        if (!repo) return badRepo();
        const q = new URLSearchParams({ state: String(input.state ?? "open"), per_page: String(lim(input.limit, 30)), sort: "updated", direction: "desc" });
        const r = await gh(token, `/repos/${repo}/pulls?${q}`);
        if (!r.ok) return err(r);
        const pulls = (r.body as unknown as Pull[]).map((p) => ({ number: p.number, title: p.title, state: p.state, draft: !!p.draft, head: p.head.ref, base: p.base.ref, author: p.user?.login, updated_at: p.updated_at, html_url: p.html_url }));
        return { ok: true, pulls };
      },
    },
    {
      name: "create_pr", mode: "write",
      description: "Open a pull request from head into base.",
      input: strictSchema({ repo: repoProp, head: { type: "string", description: "branch with the changes (owner:branch for forks)" }, base: { type: "string", description: "branch to merge into" }, title: { type: "string", maxLength: 256 }, body: { type: "string" } }),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return notConnected();
        const repo = repoOf(input.repo);
        if (!repo) return badRepo();
        const r = await gh(token, `/repos/${repo}/pulls`, { method: "POST", body: JSON.stringify({ title: input.title, body: input.body, head: input.head, base: input.base }) });
        if (!r.ok) return err(r);
        ctx.emit("artifact.created", { kind: "pr", ref: r.body.html_url, repo, number: r.body.number, title: input.title });
        return { ok: true, number: r.body.number, html_url: r.body.html_url };
      },
    },
    {
      name: "merge_pr", mode: "ship",
      description: "Merge a pull request. env: prod when the base branch deploys to production (the default branch always counts as prod) — parks for the board by policy; preview for merges into feature or staging branches.",
      input: strictSchema(
        {
          repo: repoProp,
          number: { type: "integer", minimum: 1 },
          env: { type: "string", enum: ["preview", "prod"], description: "prod = lands on the branch that deploys to production" },
          method: { type: "string", enum: ["squash", "merge", "rebase"] },
          reason: { type: "string" },
        },
        ["repo", "number", "env", "reason"],
      ),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return notConnected();
        const repo = repoOf(input.repo);
        if (!repo) return badRepo();
        const n = Number(input.number);
        const pr = await gh(token, `/repos/${repo}/pulls/${n}`);
        if (!pr.ok) return err(pr);
        const p = pr.body as unknown as Pull;
        if (p.merged) return fail("already_merged", `#${n} is already merged`);
        const info = await gh(token, `/repos/${repo}`);
        const def = info.ok ? String(info.body.default_branch) : undefined;
        if (def && p.base.ref === def && input.env !== "prod") return fail("env_mismatch", `#${n} targets ${def}, the default branch: call again with env: prod so the board can approve`);
        if (p.mergeable === false) return fail("not_mergeable", `#${n} cannot be merged (${p.mergeable_state ?? "conflicts or failing required checks"})`);
        const r = await gh(token, `/repos/${repo}/pulls/${n}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: input.method ?? "squash" }) });
        if (!r.ok) return err(r);
        return { ok: true, merged: !!r.body.merged, sha: r.body.sha, base: p.base.ref, html_url: p.html_url, message: r.body.message };
      },
    },
    {
      name: "commits", mode: "read",
      description: "Recent commits on a branch (default branch when omitted).",
      input: strictSchema({ repo: repoProp, branch: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, ["repo"]),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return notConnected();
        const repo = repoOf(input.repo);
        if (!repo) return badRepo();
        const q = new URLSearchParams({ per_page: String(lim(input.limit, 20)) });
        if (input.branch) q.set("sha", String(input.branch));
        const r = await gh(token, `/repos/${repo}/commits?${q}`);
        if (!r.ok) return err(r);
        const commits = (r.body as unknown as Commit[]).map((c) => ({ sha: c.sha, message: firstLine(c.commit.message), author: c.commit.author?.name, date: c.commit.author?.date, html_url: c.html_url }));
        return { ok: true, commits };
      },
    },
    {
      name: "file", mode: "read",
      description: "Read a file at a path (and optional ref: branch, tag or sha), truncated at 30k characters; a directory path lists its entries.",
      input: strictSchema({ repo: repoProp, path: { type: "string" }, ref: { type: "string" } }, ["repo", "path"]),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return notConnected();
        const repo = repoOf(input.repo);
        if (!repo) return badRepo();
        const path = String(input.path).replace(/^\/+/, "");
        const q = input.ref ? `?ref=${encodeURIComponent(String(input.ref))}` : "";
        const r = await gh(token, `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}${q}`);
        if (!r.ok) return err(r);
        if (Array.isArray(r.body)) return { ok: true, path, entries: (r.body as Entry[]).map((e) => ({ name: e.name, type: e.type, size: e.size, path: e.path })) };
        if (r.body.encoding !== "base64" || typeof r.body.content !== "string") return fail("too_large", "GitHub returned no inline content (files over 1 MB); fetch download_url with web.fetch instead", { download_url: r.body.download_url });
        const content = Buffer.from(r.body.content, "base64").toString("utf8");
        return { ok: true, path, sha: r.body.sha, size: r.body.size, html_url: r.body.html_url, content: content.slice(0, MAX_FILE), truncated: content.length > MAX_FILE };
      },
    },
  ],
  async healthcheck(ctx) {
    const token = ctx.secrets.get("GITHUB_ACCESS_TOKEN");
    if (!token) return { ok: false, detail: "GITHUB_ACCESS_TOKEN missing (Connect or paste a PAT)" };
    const r = await gh(token, "/user");
    return r.ok ? { ok: true, detail: `connected as ${String(r.body.login ?? "?")}` } : { ok: false, detail: String(r.body.message ?? `rejected (HTTP ${r.status})`) };
  },
});
