import Link from "next/link";
import { hive, hiveOr, ago, type CompanySummary } from "../../../../lib/hive";
import { Card, Label, PageTitle, Badge, Empty } from "../../../../components/ui";
import { submitIntake } from "./actions";

export const dynamic = "force-dynamic";

type Intake = { id: string; created_at: number; mission_id: string | null; fields: { website: string; product: string; audience: string; goals: string; competitors?: string; tone?: string; channels?: string[]; budget_note?: string; deadline?: string; by?: string } };

const CHANNELS = ["blog", "linkedin", "instagram", "x", "reddit", "youtube", "email", "creators"] as const;

export default async function IntakePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { slug } = await params;
  const { msg } = await searchParams;
  const [c, data] = await Promise.all([hive<CompanySummary>(`/api/companies/${slug}`), hiveOr<{ latest: Intake | null; history: Intake[] }>(`/api/companies/${slug}/intake`, { latest: null, history: [] })]);
  const latest = data.latest;
  const exec = c.roles[0];

  return (
    <main>
      <PageTitle eyebrow="Tell the company about the product once" title="Website intake" />
      {msg ? <Card className="mb-4 border-[var(--accent)]"><p className="text-sm">{msg}</p></Card> : null}
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card>
          <p className="text-sm text-[var(--ink-2)]">The executive ({exec?.title ?? "your first role"}) turns this into the first mission: brand brief, 90-day content strategy, positioning map, SEO audit, GEO probe, first drafts. Everything external stays parked in the Inbox until you approve it.</p>
          <form action={submitIntake} className="mt-4 grid gap-3 md:grid-cols-2">
            <input type="hidden" name="slug" value={slug} />
            <div className="md:col-span-2"><Label className="mb-1">Website</Label><input name="website" className="field" placeholder="https://…" required defaultValue={latest?.fields.website ?? ""} /></div>
            <div className="md:col-span-2"><Label className="mb-1">Product in one line</Label><input name="product" className="field" required defaultValue={latest?.fields.product ?? ""} placeholder="What it is and who pays for it" /></div>
            <div><Label className="mb-1">Audience</Label><textarea name="audience" className="field min-h-[80px]" required defaultValue={latest?.fields.audience ?? ""} placeholder="Who, where, what they already use" /></div>
            <div><Label className="mb-1">Goals this quarter</Label><textarea name="goals" className="field min-h-[80px]" required defaultValue={latest?.fields.goals ?? ""} placeholder="Numbers and dates" /></div>
            <div><Label className="mb-1">Competitors</Label><input name="competitors" className="field" defaultValue={latest?.fields.competitors ?? ""} placeholder="Comma-separated" /></div>
            <div><Label className="mb-1">Tone of voice</Label><input name="tone" className="field" defaultValue={latest?.fields.tone ?? ""} placeholder="Plain, confident, no hype" /></div>
            <div className="md:col-span-2">
              <Label className="mb-1">Channels in scope</Label>
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map((ch) => (
                  <label key={ch} className="raised flex cursor-pointer items-center gap-1.5 px-2.5 py-1 text-sm">
                    <input type="checkbox" name="channels" value={ch} defaultChecked={latest?.fields.channels?.includes(ch) ?? ["blog", "linkedin", "instagram"].includes(ch)} />
                    {ch.charAt(0).toUpperCase() + ch.slice(1)}
                  </label>
                ))}
              </div>
            </div>
            <div><Label className="mb-1">Budget notes</Label><input name="budget_note" className="field" defaultValue={latest?.fields.budget_note ?? ""} placeholder="Paid media yes/no, creator budget" /></div>
            <div><Label className="mb-1">Deadline</Label><input name="deadline" className="field" defaultValue={latest?.fields.deadline ?? ""} placeholder="30 November 2026" /></div>
            <div className="md:col-span-2 flex flex-wrap items-center gap-2">
              <button className="btn btn-primary" type="submit" name="start" value="yes">Save and start the mission</button>
              <button className="btn btn-ghost" type="submit" name="start" value="no">Save only</button>
              <span className="text-xs text-[var(--muted)]">Saved as an artifact every agent can read.</span>
            </div>
          </form>
        </Card>
        <div className="space-y-4">
          <Card>
            <Label className="mb-2">Latest intake</Label>
            {latest ? (
              <div className="text-sm">
                <p className="font-medium">{latest.fields.product}</p>
                <p className="text-[var(--muted)]"><a href={latest.fields.website} className="underline" target="_blank" rel="noreferrer">{latest.fields.website}</a> · {ago(latest.created_at)} ago</p>
                <div className="mt-2 flex flex-wrap gap-1">{(latest.fields.channels ?? []).map((ch) => <Badge key={ch} tone="muted">{ch}</Badge>)}</div>
                {latest.mission_id ? <Link href={`/c/${slug}/missions/${latest.mission_id}`} className="btn btn-ghost mt-3">Open the mission</Link> : null}
              </div>
            ) : <Empty>Nothing yet. The first intake starts the company.</Empty>}
          </Card>
          <Card>
            <Label className="mb-2">History</Label>
            {data.history.length === 0 ? <Empty>—</Empty> : (
              <ul className="space-y-1 text-sm">
                {data.history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between border-t border-[var(--hairline)] py-1.5 first:border-0">
                    <span className="truncate">{h.fields.product}</span>
                    <span className="text-xs text-[var(--muted)]">{ago(h.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <Label className="mb-2">What happens next</Label>
            <ol className="list-decimal space-y-1 pl-4 text-sm text-[var(--ink-2)]">
              <li>The executive plans tasks for strategy, SEO, GEO, writers and social.</li>
              <li>Drafts land as artifacts on the mission page.</li>
              <li>Publishing, spend and outreach wait in the Inbox for you.</li>
              <li>Weekly automations keep the cadence after launch.</li>
            </ol>
          </Card>
        </div>
      </div>
    </main>
  );
}
