import Link from "next/link";
import { hiveOr, workerUp, type Template } from "../../../lib/hive";
import { Card, Label, PageTitle } from "../../../components/ui";
import { TemplatePreview } from "../../../components/company/TemplatePreview";
import { launchCompany } from "./actions";

export const dynamic = "force-dynamic";

const FALLBACK = { accent: "#6c5ce7", icon: "◇", tagline: "", highlights: [] as string[], best_for: "", tree: [] as Template["tree"], teams: [] as Template["teams"] };

function cleanName(t: Template): string {
  return t.name.replace(/^Replace Me ?/i, "") || t.id;
}

function capLabel(cap: number, currency: string): string {
  const sym = currency === "INR" ? "₹" : currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : `${currency} `;
  return `${sym}${cap.toLocaleString("en-IN")}/month`;
}

export default async function NewCompany({ searchParams }: { searchParams: Promise<{ error?: string; template?: string }> }) {
  const { error, template: picked } = await searchParams;
  const up = await workerUp();
  const raw = up ? await hiveOr<Template[]>("/api/templates", []) : [];
  // Older workers return templates without the gallery fields; fill so the cards still render.
  const templates: Template[] = raw.map((t) => ({ ...FALLBACK, ...t, highlights: t.highlights ?? [], tree: t.tree ?? [], teams: t.teams ?? [] }));
  const selected = templates.some((t) => t.id === picked) ? picked : templates[0]?.id;

  return (
    <main className="ground-glow mx-auto max-w-[1400px] px-5 py-8">
      <PageTitle eyebrow="Templates" title="Launch a company" />
      {error ? <p className="mb-4 rounded-[var(--r-1)] bg-[rgba(239,71,111,0.12)] p-3 text-sm text-[var(--failed)]">{error}</p> : null}
      {!up ? <Card>The worker is offline; start it and templates appear here.</Card> : null}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="grid gap-4 sm:grid-cols-2">
          {templates.map((t) => {
            const isPicked = t.id === selected;
            return (
              <article
                key={t.id}
                className="card card-hover relative flex flex-col overflow-hidden p-5 rise"
                style={isPicked ? { boxShadow: `0 0 0 2px ${t.accent}, var(--shadow-2)` } : undefined}
              >
                <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${t.accent}, ${t.accent}55)` }} />
                <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-[0.14] blur-2xl" style={{ background: t.accent }} />

                <header className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--r-1)] text-[22px]" style={{ background: `${t.accent}1f` }} aria-hidden>
                    {t.icon}
                  </span>
                  <div className="min-w-0">
                    <Label>{t.id}</Label>
                    <h2 className="font-display text-xl leading-tight">{cleanName(t)}</h2>
                    {t.tagline ? <p className="mt-1 text-sm text-[var(--ink-2)]">{t.tagline}</p> : null}
                  </div>
                </header>

                <div className="mt-4 rounded-[var(--r-1)] bg-[var(--surface-0)] px-2 py-1">
                  <TemplatePreview tree={t.tree} accent={t.accent} />
                </div>

                {t.highlights.length ? (
                  <ul className="mt-4 space-y-1.5 text-xs leading-snug text-[var(--ink-2)]">
                    {t.highlights.map((h) => (
                      <li key={h} className="flex gap-2">
                        <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: t.accent }} aria-hidden />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 line-clamp-3 text-xs text-[var(--muted)]">{t.blurb}</p>
                )}
                {t.best_for ? (
                  <p className="mt-3 text-xs text-[var(--muted)]">
                    <span className="font-medium text-[var(--ink-2)]">Best for</span> {t.best_for}
                  </p>
                ) : null}

                {t.integrations.length ? (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {t.integrations.map((i) => (
                      <span key={i} className="raised px-2 py-0.5 font-mono text-[10.5px] text-[var(--ink-2)]">{i}</span>
                    ))}
                  </div>
                ) : null}

                <footer className="mt-auto flex items-center justify-between gap-3 pt-5">
                  <p className="text-xs text-[var(--muted)]">
                    <span className="font-medium tabular-nums text-[var(--ink-2)]">{capLabel(t.monthly_cap, t.currency)}</span>
                    {" · "}
                    {t.roles.length} roles
                  </p>
                  <Link
                    href={`/c/new?template=${encodeURIComponent(t.id)}#launch`}
                    className="btn btn-glass px-3 py-1.5 text-xs"
                    style={isPicked ? { boxShadow: `0 0 0 1px ${t.accent}, var(--shadow-1)`, color: t.accent } : undefined}
                    aria-current={isPicked ? "true" : undefined}
                  >
                    {isPicked ? "Selected" : "Use this template"}
                  </Link>
                </footer>
              </article>
            );
          })}
        </section>

        <form id="launch" action={launchCompany} className="glass sticky top-20 h-fit p-6">
          <h2 className="font-display text-2xl">Name it, give it a mission</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">The template becomes a directory with a company.yaml you own. Budgets and policies are yours to edit before it runs.</p>
          <div className="mt-5 space-y-4">
            <div>
              <Label className="mb-1">Template</Label>
              <select name="template" className="field" required defaultValue={selected} key={selected}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.icon} {cleanName(t)}</option>
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
