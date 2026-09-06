import { hiveOr, workerUp, type Template } from "../../../lib/hive";
import { Card, Label, PageTitle } from "../../../components/ui";
import { launchCompany } from "./actions";

export const dynamic = "force-dynamic";

const VISUALS: Record<string, { accent: string; glyph: string; tagline: string }> = {
  startup: { accent: "#6c5ce7", glyph: "◈", tagline: "Ship a product through gates" },
  cmo: { accent: "#ff7eb3", glyph: "◎", tagline: "Marketing as a company" },
  "ugc-growth": { accent: "#ff9f43", glyph: "▶", tagline: "Creators on commission, daily videos" },
  "trading-research": { accent: "#16b981", glyph: "◬", tagline: "Research desk, no execution" },
  "real-estate": { accent: "#0ea5e9", glyph: "▣", tagline: "Pipeline, outreach, deals" },
  "waste-management": { accent: "#14b8a6", glyph: "♻", tagline: "Market entry with compliance" },
};

export default async function NewCompany({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const up = await workerUp();
  const templates = up ? await hiveOr<Template[]>("/api/templates", []) : [];

  return (
    <main className="ground-glow mx-auto max-w-[1400px] px-5 py-8">
      <PageTitle eyebrow="Templates" title="Launch a company" />
      {error ? <p className="mb-4 rounded-[var(--r-1)] bg-[rgba(239,71,111,0.12)] p-3 text-sm text-[var(--failed)]">{error}</p> : null}
      {!up ? <Card>The worker is offline; start it and templates appear here.</Card> : null}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="grid gap-4 sm:grid-cols-2">
          {templates.map((t) => {
            const v = VISUALS[t.id] ?? { accent: "#6c5ce7", glyph: "◇", tagline: "" };
            return (
              <div key={t.id} className="card card-hover relative overflow-hidden p-6 rise">
                <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full opacity-20 blur-2xl" style={{ background: v.accent }} />
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-[var(--r-1)] text-xl" style={{ background: `${v.accent}22`, color: v.accent }}>{v.glyph}</span>
                  <div>
                    <Label>{t.id}</Label>
                    <h2 className="font-display text-xl">{t.name.replace(/^Replace Me ?/i, "") || t.id}</h2>
                  </div>
                </div>
                <p className="mt-3 text-sm text-[var(--ink-2)]">{v.tagline || t.blurb}</p>
                <p className="mt-2 line-clamp-2 text-xs text-[var(--muted)]">{t.blurb}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {t.roles.map((r) => (
                    <span key={r.id} className="raised px-2 py-0.5 text-[11px] text-[var(--ink-2)]">{r.title}</span>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {t.integrations.map((i) => (
                    <span key={i} className="text-[11px] text-[var(--muted)]">#{i}</span>
                  ))}
                </div>
                <p className="mt-4 text-xs text-[var(--muted)]">Cap {t.monthly_cap.toLocaleString("en-IN")} {t.currency}/month · {t.roles.length} roles</p>
              </div>
            );
          })}
        </section>

        <form action={launchCompany} className="glass sticky top-20 h-fit p-6">
          <h2 className="font-display text-2xl">Name it, give it a mission</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">The template becomes a directory with a company.yaml you own. Budgets and policies are yours to edit before it runs.</p>
          <div className="mt-5 space-y-4">
            <div>
              <Label className="mb-1">Template</Label>
              <select name="template" className="field" required defaultValue={templates[0]?.id}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.id}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="mb-1">Company name</Label>
              <input name="name" className="field" placeholder="Prodigal Waste" required maxLength={80} />
            </div>
            <div>
              <Label className="mb-1">Mission (this quarter)</Label>
              <textarea name="mission" className="field min-h-24" placeholder="Win one municipal contract in Gujarat with a costed ops plan" />
            </div>
            <div>
              <Label className="mb-1">Models</Label>
              <select name="model" className="field" defaultValue="">
                <option value="">As in the template (Anthropic + Claude Code)</option>
                <option value="mock">Demo — mock provider, no API key</option>
                <option value="ollama/qwen2.5:14b">Local — Ollama qwen2.5:14b</option>
                <option value="openrouter/anthropic/claude-opus-5">OpenRouter — claude-opus-5</option>
              </select>
            </div>
            <button type="submit" className="btn btn-primary w-full justify-center">Launch</button>
            <p className="text-xs text-[var(--muted)]">Or from a terminal: <code className="font-mono text-[var(--brass)]">hive company init &lt;template&gt; &quot;Name&quot;</code></p>
          </div>
        </form>
      </div>
    </main>
  );
}
