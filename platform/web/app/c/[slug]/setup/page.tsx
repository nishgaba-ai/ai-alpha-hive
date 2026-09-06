import Link from "next/link";
import { hive, hiveOr, type CompanySummary, type Task } from "../../../../lib/hive";
import { Card, Label, Badge, PageTitle } from "../../../../components/ui";

export const dynamic = "force-dynamic";

type Health = { ok: boolean; vault: boolean; providers: { anthropic: boolean; openrouter: boolean } };
type Detail = CompanySummary & { config: { roles: { id: string; title: string; model?: string; tools: string[] }[]; integrations?: { id?: string; modes?: string[] }[]; automations?: unknown[] } };
type Integration = { id: string; title: string; auth: { kind: string }; oauth: { connected: boolean; has_client: boolean } | null; enabled: boolean; missing_secrets: string[]; secrets_present: string[]; secrets: { name: string; required?: boolean }[] };
type Person = { id: string; kind: string; telegram_chat_id: string | null };

type Step = { title: string; detail: string; status: "done" | "todo" | "optional"; href: string; action: string };

export default async function SetupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [health, c, integrations, people, { tasks }, approvals] = await Promise.all([
    hiveOr<Health>("/api/health", { ok: false, vault: false, providers: { anthropic: false, openrouter: false } }),
    hive<Detail>(`/api/companies/${slug}`),
    hiveOr<Integration[]>(`/api/companies/${slug}/integrations`, []),
    hiveOr<Person[]>(`/api/companies/${slug}/erp/people`, []),
    hiveOr<{ tasks: Task[] }>(`/api/companies/${slug}/tasks`, { tasks: [] }),
    hiveOr<unknown[]>(`/api/companies/${slug}/approvals?status=approved`, []),
  ]);
  const roles = c.config.roles;
  const usedIds = new Set<string>();
  for (const r of roles) for (const p of r.tools) {
    const id = p.split(/[.:]/)[0];
    if (integrations.some((i) => i.id === id)) usedIds.add(id);
  }
  const used = integrations.filter((i) => usedIds.has(i.id));
  const mockRoles = roles.filter((r) => (r.model ?? "") === "mock");
  const providersNeeded = new Set(roles.map((r) => (r.model ?? "anthropic").split("/")[0]).filter((p) => p !== "mock" && p !== "claude-code"));
  const keyReady = [...providersNeeded].every((p) => (p === "anthropic" ? health.providers.anthropic : p === "openrouter" ? health.providers.openrouter : true));

  const steps: Step[] = [
    { title: "Worker running with a vault key", detail: health.ok ? (health.vault ? "Worker reachable, VAULT_KEY set: secrets can be stored." : "Worker reachable but VAULT_KEY is missing: run `hive company secret keygen`, put it in .env, restart.") : "Start it: hive company run --group companies --port 4700", status: health.ok && health.vault ? "done" : "todo", href: "/docs/getting-started", action: "Getting started" },
    { title: "Board added under People", detail: people.some((p) => p.kind === "board") ? `${people.filter((p) => p.kind === "board").length} board member(s)${people.some((p) => p.telegram_chat_id) ? ", Telegram linked" : ""}.` : "Add yourself and your co-reviewer so approvals, payroll and Telegram know who you are.", status: people.some((p) => p.kind === "board") ? "done" : "todo", href: `/c/${slug}/erp?tab=people`, action: "ERP → People" },
    { title: "Models", detail: mockRoles.length === roles.length ? "Every role runs on the mock provider (demo). Add ANTHROPIC_API_KEY to .env, restart the worker, then change model: per role in Settings." : keyReady ? `Real providers configured for ${roles.length - mockRoles.length} role(s).` : `Roles reference ${[...providersNeeded].join(", ")} but no key is set in .env.`, status: mockRoles.length === roles.length ? "optional" : keyReady ? "done" : "todo", href: `/c/${slug}/settings`, action: "Settings" },
    ...used.map<Step>((i) => {
      const connected = i.auth.kind === "oauth2" ? !!i.oauth?.connected || i.missing_secrets.length === 0 && i.secrets_present.length > 0 : i.missing_secrets.length === 0;
      const detail = !i.enabled ? "Roles reference it but it is not enabled." : i.auth.kind === "oauth2" ? (i.oauth?.connected ? "Connected." : i.oauth?.has_client ? "Client id and secret stored; click Connect." : "Create the provider app, paste client id and secret, then Connect (or paste a token).") : i.auth.kind === "none" ? "No credentials needed." : i.missing_secrets.length ? `Missing ${i.missing_secrets.join(", ")}.` : "Keys stored; run the healthcheck.";
      return { title: `Connect ${i.title}`, detail, status: i.enabled && (i.auth.kind === "none" || connected) ? "done" : "todo", href: `/c/${slug}/integrations?open=${i.id}`, action: "Integrations" };
    }),
    { title: "First mission", detail: tasks.some((t) => t.key === "mission") ? `${tasks.filter((t) => t.key === "mission").length} mission(s) given.` : "Give the company its first mission from the Overview, Telegram (/mission) or the Voice screen.", status: tasks.some((t) => t.key === "mission") ? "done" : "todo", href: `/c/${slug}`, action: "Overview" },
    { title: "First decision", detail: approvals.length ? `${approvals.length} approval(s) decided.` : "Approve or deny something from the Inbox once, so you have felt the gate.", status: approvals.length ? "done" : "todo", href: `/c/${slug}/inbox`, action: "Inbox" },
    { title: "Schedules", detail: c.config.automations?.length ? `${c.config.automations.length} automation(s) run recurring missions.` : "Optional: add automations: to company.yaml for daily and weekly rhythms.", status: c.config.automations?.length ? "done" : "optional", href: `/c/${slug}/firm`, action: "The firm" },
    { title: "Backup", detail: "Optional: hive company export --group companies writes a bundle you can import on another machine with the same VAULT_KEY.", status: "optional", href: "/docs/group", action: "Docs" },
  ];
  const done = steps.filter((s) => s.status === "done").length;
  const todo = steps.filter((s) => s.status === "todo").length;

  return (
    <main>
      <PageTitle eyebrow="Get this company ready" title="Setup">
        <Link href="/docs/getting-started" className="btn btn-glass">Read the guide</Link>
      </PageTitle>
      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><Label>Progress</Label><p className="mt-1 text-2xl font-semibold tabular-nums">{done} <span className="text-base font-normal text-[var(--muted)]">of {steps.length} done · {todo} to do</span></p></div>
          <div className="h-2 w-64 overflow-hidden rounded-full bg-[var(--surface-0)]"><div className="h-full rounded-full" style={{ width: `${Math.round((done / steps.length) * 100)}%`, background: "linear-gradient(90deg, var(--accent), var(--pink))" }} /></div>
        </div>
      </Card>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${s.status === "done" ? "bg-[var(--live)] text-white" : s.status === "optional" ? "bg-[var(--surface-2)] text-[var(--muted)]" : "bg-[var(--parked)] text-white"}`}>{s.status === "done" ? "✓" : i + 1}</span>
              <div className="min-w-0">
                <p className="font-medium">{s.title} {s.status === "optional" ? <Badge>optional</Badge> : null}</p>
                <p className="text-sm text-[var(--ink-2)]">{s.detail}</p>
              </div>
            </div>
            <Link href={s.href} className={`btn ${s.status === "todo" ? "btn-primary" : "btn-ghost"} shrink-0`}>{s.action} →</Link>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-xs text-[var(--muted)]">Integrations listed here are the ones this company&apos;s roles actually use. Everything else in the library stays optional.</p>
    </main>
  );
}
