import Link from "next/link";
import { hive, hiveOr, money, displayName, sentence, type CompanySummary, type Task } from "../../../../lib/hive";
import { Card, Label, Badge, sideEffectTone, PageTitle, Empty } from "../../../../components/ui";

export const dynamic = "force-dynamic";

type RoleCfg = { id: string; title: string; harness: string; model?: string; effort?: string; reports_to: string; tools: string[]; budget: { monthly: number; per_tx?: number }; count?: number; escalate?: { on: string[]; to: string } };
type Detail = CompanySummary & {
  config: { roles: RoleCfg[]; teams?: { id: string; lead: string; members: string[] }[]; automations?: { id: string; every: string; at?: string; mission: string; enabled?: boolean }[]; policies: { quiet_hours?: { tz: string; from: string; to: string; block: string[] }; spend?: { under_threshold?: string; otherwise?: string }; publish?: { default?: string }; send?: { first_contact?: string; reply?: string }; deploy?: { prod?: string } }; treasury: { monthly_cap: number; approval_threshold: number; reserve?: number }; integrations?: { id?: string; modes?: string[] }[] };
  prompts: Record<string, string>;
};
type Catalogue = { core: { name: string; sideEffect: string }[]; integrations: { id: string; methods: { name: string; mode: string; sideEffect?: string }[] }[] };
type Person = { id: string; name: string; title: string | null; kind: string; monthly_salary_minor: number; telegram_chat_id: string | null };
type Agent = { id: string; name: string; role: string; status: string };

function section(md: string, heading: string): string {
  const re = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |\\s*$)`, "m");
  const m = re.exec(md);
  return (m?.[1] ?? "").trim();
}
function intro(md: string): string {
  return md.split("\n").filter((l) => l.trim() && !l.startsWith("#")).slice(0, 4).join(" ").replace(/\s+/g, " ");
}
function bullets(text: string): string[] {
  return text.split("\n").filter((l) => /^\s*-\s/.test(l)).map((l) => l.replace(/^\s*-\s/, "").replace(/`/g, ""));
}

export default async function FirmPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [c, cat, people, graph, { tasks }] = await Promise.all([
    hive<Detail>(`/api/companies/${slug}`),
    hiveOr<Catalogue>("/api/catalogue", { core: [], integrations: [] }),
    hiveOr<Person[]>(`/api/companies/${slug}/erp/people`, []),
    hiveOr<{ nodes: { id: string; type: string; data: Record<string, unknown> }[] }>(`/api/companies/${slug}/graph`, { nodes: [] }),
    hiveOr<{ tasks: Task[] }>(`/api/companies/${slug}/tasks`, { tasks: [] }),
  ]);
  const cur = c.currency;
  const cfg = c.config;
  const effect = new Map<string, string>();
  for (const t of cat.core) effect.set(t.name, t.sideEffect);
  const enabledModes = new Map((cfg.integrations ?? []).filter((i) => i.id).map((i) => [i.id as string, i.modes ?? []]));
  for (const i of cat.integrations) for (const m of i.methods) if ((enabledModes.get(i.id) ?? []).includes(m.mode) || enabledModes.has(i.id) && (enabledModes.get(i.id) ?? []).length === 0) effect.set(m.name, m.sideEffect ?? "read");
  const expand = (patterns: string[]) => {
    const out = new Set<string>();
    for (const p of patterns) {
      if (p.includes(":")) {
        const [id, mode] = p.split(":");
        for (const m of cat.integrations.find((i) => i.id === id)?.methods ?? []) if (m.mode === mode) out.add(m.name);
      } else if (p.endsWith(".*")) {
        for (const n of effect.keys()) if (n.startsWith(p.slice(0, -1))) out.add(n);
      } else out.add(p);
    }
    return [...out];
  };
  const agents: Agent[] = graph.nodes.filter((n) => n.type === "agent").map((n) => ({ id: n.id, name: String(n.data.name), role: String(n.data.role), status: String(n.data.status) }));
  const teamOf = (role: string) => cfg.teams?.find((t) => t.members.includes(role) || t.lead === role);
  const leadOf = (role: string) => cfg.teams?.find((t) => t.members.includes(role) && t.lead !== role)?.lead;
  const openFor = (role: string) => tasks.filter((t) => t.owner_role === role && !["done", "failed", "cancelled"].includes(t.status)).length;
  const doneFor = (role: string) => tasks.filter((t) => t.owner_role === role && t.status === "done").length;
  const humanTasks = (pid: string) => tasks.filter((t) => t.assignee_person_id === pid && !["done", "cancelled"].includes(t.status));
  const order = [...cfg.roles].sort((a, b) => (a.reports_to === "board" ? -1 : b.reports_to === "board" ? 1 : 0));
  const q = cfg.policies.quiet_hours;

  return (
    <main>
      <PageTitle eyebrow="Who does what" title="The firm">
        <Link href={`/c/${slug}/settings`} className="btn btn-glass">Edit in Settings</Link>
      </PageTitle>
      <p className="-mt-3 mb-6 max-w-3xl text-sm text-[var(--ink-2)]">{c.mission}</p>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <Label>The board</Label>
          <ul className="mt-2 space-y-2 text-sm">
            {people.filter((p) => p.kind === "board").map((p) => (
              <li key={p.id} className="raised p-2.5">
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-[var(--muted)]">{p.title ?? "board"} · decides spend, publish, first contact, deploys, hires{p.telegram_chat_id ? " · Telegram" : ""}</p>
                {humanTasks(p.id).length ? <p className="mt-1 text-xs text-[var(--accent)]">{humanTasks(p.id).length} open task{humanTasks(p.id).length > 1 ? "s" : ""}</p> : null}
              </li>
            ))}
            {people.filter((p) => p.kind === "board").length === 0 ? <Empty>Add the board under ERP → People.</Empty> : null}
          </ul>
        </Card>
        <Card>
          <Label>Humans on staff</Label>
          <ul className="mt-2 space-y-2 text-sm">
            {people.filter((p) => p.kind !== "board").map((p) => (
              <li key={p.id} className="raised p-2.5">
                <p className="font-medium">{p.name} <span className="text-xs text-[var(--muted)]">· {sentence(p.kind)}</span></p>
                <p className="text-xs text-[var(--muted)]">{p.title ?? ""}{p.monthly_salary_minor ? ` · ${money(p.monthly_salary_minor, cur)}/mo` : ""}</p>
                {humanTasks(p.id).map((t) => <p key={t.id} className="mt-1 text-xs text-[var(--ink-2)]">• {t.title}</p>)}
              </li>
            ))}
            {people.filter((p) => p.kind !== "board").length === 0 ? <p className="text-xs text-[var(--muted)]">No employees or interns yet.</p> : null}
          </ul>
        </Card>
        <Card>
          <Label>Rhythm and rules</Label>
          <ul className="mt-2 space-y-1.5 text-sm text-[var(--ink-2)]">
            <li><span className="font-medium text-[var(--ink)]">Budget:</span> {money(cfg.treasury.monthly_cap * 100, cur)}/month, allocated to wallets on the 1st; reserve {money((cfg.treasury.reserve ?? 0) * 100, cur)}.</li>
            <li><span className="font-medium text-[var(--ink)]">Spend:</span> under {money(cfg.treasury.approval_threshold * 100, cur)} → {cfg.policies.spend?.under_threshold ?? "allow"}; above → {cfg.policies.spend?.otherwise ?? "approve"}.</li>
            <li><span className="font-medium text-[var(--ink)]">Public content:</span> {cfg.policies.publish?.default ?? "approve"} · <span className="font-medium text-[var(--ink)]">first contact:</span> {cfg.policies.send?.first_contact ?? "approve"} · <span className="font-medium text-[var(--ink)]">prod deploy:</span> {cfg.policies.deploy?.prod ?? "approve"}.</li>
            {q ? <li><span className="font-medium text-[var(--ink)]">Quiet hours:</span> {q.from}–{q.to} {q.tz}; no {q.block.join(", ")}.</li> : null}
            <li><span className="font-medium text-[var(--ink)]">Weekly:</span> the finance/analyst role closes the week with a report; the board adjusts company.yaml.</li>
            <li><span className="font-medium text-[var(--ink)]">Monthly:</span> payroll drafted from ERP salaries, approved and paid from a cash account; statement exported for the CA.</li>
          </ul>
        </Card>
      </section>

      <Label className="mb-2 mt-8">Schedules · automations</Label>
      <Card>
        {cfg.automations?.length ? (
          <ul className="space-y-2 text-sm">
            {cfg.automations.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--hairline)] py-2 first:border-0">
                <span><Badge tone={a.enabled === false ? "muted" : "live"}>{a.enabled === false ? "off" : "on"}</Badge> <span className="ml-2 font-medium">{a.id}</span> <span className="text-[var(--muted)]">every {a.every}{a.at ? ` at ${a.at}` : ""}</span></span>
                <span className="max-w-xl text-[var(--ink-2)]">{a.mission}</span>
              </li>
            ))}
          </ul>
        ) : <Empty>No automations. Add <code className="font-mono">automations:</code> to company.yaml for recurring missions (daily conversations, weekly post, monthly statement).</Empty>}
      </Card>

      <Label className="mb-2 mt-8">Roles · responsibilities, tools, budgets</Label>
      <div className="space-y-4">
        {order.map((r) => {
          const prompt = c.prompts[r.id] ?? "";
          const tools = expand(r.tools);
          const groups: Record<string, string[]> = {};
          for (const t of tools) (groups[effect.get(t) ?? "read"] ??= []).push(t);
          const mine = agents.filter((a) => a.role === r.id);
          const team = teamOf(r.id);
          const lead = leadOf(r.id);
          return (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-xl">{r.title}</h2>
                    {r.reports_to === "board" ? <Badge tone="brass">reports to the board</Badge> : <Badge>reports to {cfg.roles.find((x) => x.id === (lead ?? r.reports_to))?.title ?? r.reports_to}</Badge>}
                    {team ? <Badge tone="muted">team {team.id}{team.lead === r.id ? " · lead" : ""}</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">{mine.map((a) => `${displayName(a.name, r.title, r.id)} (${a.status})`).join(" · ") || "no agents"} · {r.model ?? "claude-code"}{r.effort ? ` · effort ${r.effort}` : ""} · {money(r.budget.monthly * 100, cur)}/mo{r.budget.per_tx ? ` · ${money(r.budget.per_tx * 100, cur)} per purchase` : ""}</p>
                </div>
                <div className="text-right text-xs text-[var(--muted)]"><span className="text-[var(--ink)]">{openFor(r.id)}</span> open · {doneFor(r.id)} done</div>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                <div>
                  <p className="text-sm text-[var(--ink-2)]">{intro(prompt)}</p>
                  {section(prompt, "What good looks like") ? <><Label className="mb-1 mt-3">Accountable for</Label><p className="text-sm text-[var(--ink-2)]">{section(prompt, "What good looks like").replace(/\n/g, " ")}</p></> : null}
                  {bullets(section(prompt, "Boundaries")).length ? <><Label className="mb-1 mt-3">Never</Label><ul className="list-inside list-disc text-sm text-[var(--ink-2)]">{bullets(section(prompt, "Boundaries")).map((b, i) => <li key={i}>{b}</li>)}</ul></> : null}
                </div>
                <div>
                  <Label className="mb-1">Tools by gate</Label>
                  {(["read", "write", "send", "publish", "spend", "deploy", "hire"] as const).filter((k) => groups[k]?.length).map((k) => (
                    <div key={k} className="mb-2 flex flex-wrap items-center gap-1">
                      <Badge tone={sideEffectTone(k)}>{k}</Badge>
                      {groups[k].map((t) => <code key={t} className="font-mono text-[11px] text-[var(--ink-2)]">{t}</code>)}
                    </div>
                  ))}
                  {r.escalate ? <p className="mt-2 text-xs text-[var(--muted)]">Escalates {r.escalate.on.join(", ")} to {cfg.roles.find((x) => x.id === r.escalate!.to)?.title ?? r.escalate.to}.</p> : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
