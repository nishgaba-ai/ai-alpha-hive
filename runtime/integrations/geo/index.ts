// GEO (generative engine optimisation): how do AI assistants describe the
// brand today? The probe asks the company's configured model providers the
// questions a prospect would ask, records the answers as an artifact, and
// lets the GEO role track drift and gaps over time. No credentials of its
// own; it uses the providers already declared in company.yaml.

import { defineIntegration, strictSchema, fail } from "../../src/integrations/registry.js";
import { providerFor } from "../../src/providers/index.js";
import { newId, run } from "../../src/db.js";

export default defineIntegration({
  id: "geo",
  title: "GEO probe",
  description: "Ask AI assistants how they describe the brand and its category; track what they get wrong or miss.",
  guidance: `
## What it does
- **read** — \`geo.probe\` sends a set of prospect questions ("best tools for X", "what is <brand>", "alternatives to <brand>") to the model providers the company already has (Anthropic, OpenRouter, Ollama) and saves the answers as an artifact. The GEO role compares runs week to week and turns gaps into content tasks (FAQ schema, comparison pages, standalone citable sections, llms.txt).

No credentials needed beyond the providers in \`company.yaml\`. Add an OpenRouter provider to probe models from several vendors in one run.
`,
  secrets: [],
  modes: [{ id: "read", title: "Read", description: "Probe assistants", sideEffect: "read" }],
  methods: [
    {
      name: "probe",
      mode: "read",
      description: "Ask configured model providers a set of questions about the brand/category and record the answers as an artifact.",
      input: strictSchema(
        {
          brand: { type: "string" },
          questions: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 },
          providers: { type: "array", items: { type: "string" }, description: "model refs to ask, e.g. anthropic/claude-sonnet-5, openrouter/openai/gpt-5; default: the executive's model" },
        },
        ["brand", "questions"],
      ),
      async handler(ctx, input) {
        const root = ctx.config.roles.find((r) => r.reports_to === "board");
        const refs = (input.providers as string[] | undefined)?.length ? (input.providers as string[]) : [root?.model ?? "anthropic/claude-sonnet-5"];
        const results: { model: string; question: string; answer: string }[] = [];
        for (const ref of refs) {
          let p;
          try {
            p = providerFor(ref, ctx.config, ctx.secrets);
          } catch (e) {
            results.push({ model: ref, question: "*", answer: `unavailable: ${(e as Error).message}` });
            continue;
          }
          for (const q of input.questions as string[]) {
            try {
              const r = await p.provider.chat({ model: p.model, system: "You are a general assistant answering a member of the public. Answer plainly in under 120 words. If you do not know a brand, say so.", messages: [{ role: "user", content: q }], tools: [], effort: "low", maxTokens: 400 });
              results.push({ model: ref, question: q, answer: r.text.slice(0, 1200) });
            } catch (e) {
              results.push({ model: ref, question: q, answer: `error: ${(e as Error).message}` });
            }
          }
        }
        const brand = String(input.brand);
        const mentions = results.filter((r) => r.answer.toLowerCase().includes(brand.toLowerCase())).length;
        const id = newId();
        run("INSERT INTO artifacts (id, company_id, run_id, task_id, kind, ref, meta_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
          id, ctx.company.id, ctx.run.id, ctx.run.task_id, "geo-probe", `${brand} · ${new Date().toISOString().slice(0, 10)}`, JSON.stringify({ brand, results, mentions, total: results.length }), Date.now());
        ctx.emit("artifact.created", { kind: "geo-probe", ref: brand, artifact_id: id, mentions, total: results.length });
        if (!results.length) return fail("no_results", "no providers answered");
        return { ok: true, artifact_id: id, mentions, total: results.length, results };
      },
    },
  ],
});
