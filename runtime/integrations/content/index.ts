// Content — a git-free draft store inside the control plane. Drafts are
// artifacts; publishing marks them published and (later) hands them to the
// hive CMS module. Publishing is a `publish` side effect: parked by default.

import { defineIntegration, strictSchema, fail } from "../../src/integrations/registry.js";
import { all, newId, one, run } from "../../src/db.js";

type Draft = { id: string; ref: string; meta_json: string; created_at: number };

export default defineIntegration({
  id: "content",
  title: "Content drafts",
  description: "Draft posts, articles, emails and ads inside the company; publish through the board.",
  guidance: `
## What it does
- **draft** — \`content.draft\` stores a draft as an artifact with its brief, reader and sources. \`content.list\` and \`content.get\` read drafts back.
- **publish** — \`content.publish\` marks a draft published. This is a \`publish\` side effect (parked for the board by default). Distribution to LinkedIn or email is a separate call to that integration, so the board sees the exact text once and the channel once.

No credentials needed. Drafts live in the control-plane database and travel with \`hive company export\`.
`,
  secrets: [],
  modes: [
    { id: "draft", title: "Draft", description: "Write and read drafts", sideEffect: "write" },
    { id: "publish", title: "Publish", description: "Mark drafts as published", sideEffect: "publish" },
  ],
  methods: [
    {
      name: "draft",
      mode: "draft",
      description: "Save a draft. Include the reader, the one thing they should do, and sources in meta.",
      input: strictSchema(
        {
          kind: { type: "string", enum: ["post", "article", "email", "ad"] },
          title: { type: "string" },
          body_md: { type: "string" },
          meta: { type: "object", additionalProperties: true },
        },
        ["kind", "title", "body_md"],
      ),
      async handler(ctx, input) {
        const id = newId();
        run(
          "INSERT INTO artifacts (id, company_id, run_id, task_id, kind, ref, meta_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
          id, ctx.company.id, ctx.run.id, ctx.run.task_id, `draft:${input.kind}`, String(input.title),
          JSON.stringify({ body_md: input.body_md, status: "draft", ...(input.meta as object ?? {}) }), Date.now(),
        );
        ctx.emit("artifact.created", { kind: `draft:${input.kind}`, ref: input.title, artifact_id: id });
        return { ok: true, draft_id: id };
      },
    },
    {
      name: "list",
      mode: "draft",
      description: "List drafts (optionally by status: draft | published).",
      input: strictSchema({ status: { type: "string", enum: ["draft", "published"] } }, []),
      async handler(ctx, input) {
        const rows = all<Draft>("SELECT id, ref, meta_json, created_at FROM artifacts WHERE company_id = ? AND kind LIKE 'draft:%' ORDER BY created_at DESC LIMIT 100", ctx.company.id);
        const out = rows
          .map((r) => ({ id: r.id, title: r.ref, ...(JSON.parse(r.meta_json) as { status: string; body_md: string }), created_at: r.created_at }))
          .filter((d) => !input.status || d.status === input.status)
          .map(({ body_md, ...rest }) => ({ ...rest, chars: body_md?.length ?? 0 }));
        return { ok: true, drafts: out };
      },
    },
    {
      name: "get",
      mode: "draft",
      description: "Read one draft in full.",
      input: strictSchema({ draft_id: { type: "string" } }),
      async handler(ctx, input) {
        const r = one<Draft>("SELECT id, ref, meta_json, created_at FROM artifacts WHERE company_id = ? AND id = ?", ctx.company.id, String(input.draft_id));
        if (!r) return fail("not_found", "no such draft");
        return { ok: true, draft: { id: r.id, title: r.ref, ...JSON.parse(r.meta_json) } };
      },
    },
    {
      name: "publish",
      mode: "publish",
      description: "Mark a draft as published. The board sees the full text in the approval.",
      input: strictSchema({ draft_id: { type: "string" }, reason: { type: "string" } }),
      async handler(ctx, input) {
        const r = one<Draft>("SELECT id, ref, meta_json FROM artifacts WHERE company_id = ? AND id = ?", ctx.company.id, String(input.draft_id));
        if (!r) return fail("not_found", "no such draft");
        const meta = JSON.parse(r.meta_json) as Record<string, unknown>;
        run("UPDATE artifacts SET meta_json = ? WHERE id = ?", JSON.stringify({ ...meta, status: "published", published_at: Date.now() }), r.id);
        ctx.emit("artifact.created", { kind: "published", ref: r.ref, artifact_id: r.id });
        return { ok: true, draft_id: r.id, status: "published" };
      },
    },
  ],
});
