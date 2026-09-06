import { hive, type CompanySummary } from "../../../../lib/hive";
import { Card, Label, PageTitle } from "../../../../components/ui";
import { YamlEditor } from "../../../../components/company/YamlEditor";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await hive<CompanySummary & { yaml: string; config: { roles: { id: string; title: string; model?: string; tools: string[]; budget: { monthly: number } }[]; policies: Record<string, unknown>; providers?: Record<string, unknown> } }>(`/api/companies/${slug}`);
  return (
    <main>
      <PageTitle eyebrow="The board owns this file" title="Settings" />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <YamlEditor slug={slug} initial={c.yaml} hash={c.yaml_hash} />
        <div className="space-y-4">
          <Card>
            <Label className="mb-2">Roles</Label>
            <ul className="space-y-2 text-sm">
              {c.config.roles.map((r) => (
                <li key={r.id} className="raised p-2.5">
                  <div className="flex justify-between"><span className="font-medium">{r.title}</span><span className="font-mono text-[11px] text-[var(--muted)]">{r.model ?? "claude-code"}</span></div>
                  <p className="mt-1 font-mono text-[11px] text-[var(--ink-2)]">{r.tools.join("  ")}</p>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">budget {r.budget.monthly.toLocaleString("en-IN")} {c.currency}/mo</p>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <Label className="mb-2">Policies</Label>
            <pre className="overflow-x-auto font-mono text-[11px] text-[var(--ink-2)]">{JSON.stringify(c.config.policies, null, 1).replace(/[{}",]/g, "")}</pre>
          </Card>
          <Card>
            <Label className="mb-2">Models</Label>
            <p className="text-xs text-[var(--ink-2)]">Per role: <code className="font-mono">anthropic/claude-opus-5</code>, <code className="font-mono">openrouter/&lt;vendor&gt;/&lt;model&gt;</code>, <code className="font-mono">ollama/&lt;model&gt;</code>, <code className="font-mono">claude-code</code> (uses your Claude Code login), or <code className="font-mono">mock</code>. Providers are declared under <code className="font-mono">providers:</code> with keys referenced as <code className="font-mono">env:NAME</code> or <code className="font-mono">vault:NAME</code>, never literal.</p>
          </Card>
          <Card>
            <Label className="mb-2">Voice</Label>
            <p className="text-xs text-[var(--ink-2)]">Optional server voices: add <code className="font-mono">voice: {"{ stt: openai | deepgram, tts: openai | elevenlabs, voice_id: ... }"}</code> and store <code className="font-mono">OPENAI_API_KEY</code>, <code className="font-mono">DEEPGRAM_API_KEY</code> or <code className="font-mono">ELEVENLABS_API_KEY</code> in the vault. Without it the browser speaks and listens.</p>
          </Card>
          <Card>
            <Label className="mb-2">Migrate</Label>
            <p className="text-xs text-[var(--ink-2)]"><code className="font-mono">hive company export --group ./companies</code> writes one JSON bundle: config, prompts, every table, encrypted secrets. Import on the new machine with the same VAULT_KEY. Workspaces are git repos; clone them again.</p>
          </Card>
        </div>
      </div>
    </main>
  );
}
