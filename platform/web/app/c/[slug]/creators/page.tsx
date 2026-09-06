import { hive, hiveOr, money, ago, type CompanySummary } from "../../../../lib/hive";
import { Card, Label, Badge, PageTitle, Empty, Stat, Meter } from "../../../../components/ui";
import { addCreator, recordEvent, requestPayout, setCreatorStatus } from "./actions";

export const dynamic = "force-dynamic";

type CreatorStats = {
  id: string; name: string; handle: string | null; platform: string; email: string | null; code: string; commission_pct: number; status: string;
  joined_at: number; last_video_at: number | null; videos: number; views: number; signups: number; revenue_minor: number; commission_minor: number; paid_minor: number; owed_minor: number; active: boolean;
};
type Data = { totals: { creators: number; active: number; videos: number; views: number; signups: number; revenue_minor: number; commission_minor: number; owed_minor: number }; creators: CreatorStats[] };

export default async function CreatorsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { slug } = await params;
  const { msg } = await searchParams;
  const [c, d] = await Promise.all([hive<CompanySummary>(`/api/companies/${slug}`), hiveOr<Data>(`/api/companies/${slug}/creators`, { totals: { creators: 0, active: 0, videos: 0, views: 0, signups: 0, revenue_minor: 0, commission_minor: 0, owed_minor: 0 }, creators: [] })]);
  const cur = c.currency;
  const t = d.totals;
  const target = 0.2;
  const share = c.cost_minor ? 0 : 0; // placeholder until revenue attribution to non-creator channels lands
  return (
    <main>
      <PageTitle eyebrow="Creators on commission" title="Creator programme" />
      {msg ? <p className="mb-4 rounded-[var(--r-1)] bg-[var(--surface-2)] p-3 text-sm">{msg}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Creators" value={t.creators} hint={`${t.active} posted in the last 3 days`} tone={t.active ? "live" : undefined} />
        <Stat label="Videos · views" value={`${t.videos} · ${t.views.toLocaleString("en-IN")}`} hint="all time" />
        <Stat label="Signups · revenue" value={`${t.signups} · ${money(t.revenue_minor, cur)}`} hint="attributed by referral code" />
        <Stat label="Commission owed" value={money(t.owed_minor, cur)} hint={`${money(t.commission_minor, cur)} earned in total`} tone={t.owed_minor ? "parked" : undefined} />
      </div>

      <Card className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Label>The offer</Label>
            <p className="mt-1 text-sm text-[var(--ink-2)]">30% lifetime commission · one video a day · no paid ads · zero-follower accounts welcome. Prove the format yourself first; recruit only after one clip converts.</p>
          </div>
          <a href="https://github.com/nishgaba-ai/ai-alpha-hive/blob/main/docs/company/playbooks/ugc-creators.md" className="btn btn-ghost">Playbook →</a>
        </div>
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-[var(--muted)]"><span>Creator share of new revenue</span><span>target {Math.round(target * 100)}%</span></div>
          <Meter value={share} max={target} tone="live" />
        </div>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card>
          <Label className="mb-3">Roster</Label>
          {d.creators.length === 0 ? <Empty>No creators yet. Recruiters add them once the format is proven; you can add one by hand on the right.</Empty> : null}
          <div className="space-y-2">
            {d.creators.map((cr) => (
              <div key={cr.id} className="raised flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${cr.active ? "bg-[var(--live)]" : cr.status === "active" ? "bg-[var(--parked)]" : "bg-[var(--idle)]"}`} />
                    <p className="font-medium">{cr.name}</p>
                    <span className="text-xs text-[var(--muted)]">{cr.handle ? `@${cr.handle} · ` : ""}{cr.platform}</span>
                    <Badge tone={cr.status === "active" ? "live" : cr.status === "churned" ? "failed" : "muted"}>{cr.status}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">code <code className="font-mono text-[var(--accent)]">{cr.code}</code> · {cr.commission_pct}% · joined {ago(cr.joined_at)} ago{cr.last_video_at ? ` · last video ${ago(cr.last_video_at)} ago` : " · no videos yet"}</p>
                </div>
                <div className="flex items-center gap-4 text-xs tabular-nums">
                  <span>{cr.videos} videos</span>
                  <span>{cr.views.toLocaleString("en-IN")} views</span>
                  <span>{cr.signups} signups</span>
                  <span>{money(cr.revenue_minor, cur)}</span>
                  <span className={cr.owed_minor ? "font-medium text-[var(--parked)]" : "text-[var(--muted)]"}>{money(cr.owed_minor, cur)} owed</span>
                </div>
                <div className="flex items-center gap-1">
                  <form action={recordEvent} className="flex items-center gap-1">
                    <input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={cr.id} />
                    <select name="kind" className="field w-24 py-1 text-xs" defaultValue="video"><option value="video">video</option><option value="signup">signup</option><option value="revenue">revenue</option></select>
                    <input name="value" className="field w-20 py-1 text-xs" placeholder="views / ₹" />
                    <button className="btn btn-glass py-1 text-xs" type="submit">Record</button>
                  </form>
                  {cr.owed_minor ? <form action={requestPayout}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={cr.id} /><button className="btn btn-primary py-1 text-xs" type="submit">Pay out</button></form> : null}
                  <form action={setCreatorStatus}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={cr.id} /><input type="hidden" name="status" value={cr.status === "active" ? "inactive" : "active"} /><button className="btn btn-ghost py-1 text-xs" type="submit">{cr.status === "active" ? "Pause" : "Activate"}</button></form>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="h-fit">
          <Label className="mb-2">Add a creator</Label>
          <form action={addCreator} className="space-y-2">
            <input type="hidden" name="slug" value={slug} />
            <input name="name" className="field" placeholder="Name" required />
            <input name="handle" className="field" placeholder="Handle (without @)" />
            <select name="platform" className="field" defaultValue="tiktok">{["tiktok", "instagram", "youtube", "linkedin", "x"].map((p) => <option key={p} value={p}>{p}</option>)}</select>
            <input name="email" type="email" className="field" placeholder="Email" />
            <input name="commission_pct" className="field" placeholder="Commission % (30)" inputMode="numeric" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="age_confirmed" required /> Age confirmed, 18 or over</label>
            <button className="btn btn-primary w-full justify-center" type="submit">Add and issue a code</button>
          </form>
          <p className="mt-3 text-xs text-[var(--muted)]">Payouts file an expense under creator-commission; approve and pay it from a cash account in ERP so the statement shows it.</p>
        </Card>
      </div>
    </main>
  );
}
