import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { canCompany } from "../../../lib/rbac";
import { hiveOr, money, workerUp } from "../../../lib/hive";
import { Card, Label, PageTitle, Empty, Stat } from "../../../components/ui";

export const dynamic = "force-dynamic";

type Group = {
  period: string;
  companies: { slug: string; name: string; currency: string; statement: { totals: { inflow_minor: number; outflow_minor: number; net_minor: number }; payroll: { status: string; total_minor: number } | null; agents: { spend_minor: number; revenue_minor: number }; accounts: { name: string; closing_minor: number }[] }; gst: { net_payable_minor: number; input_credit_minor: number; output: { cgst_minor: number; sgst_minor: number; igst_minor: number } } }[];
  totals: { inflow_minor: number; outflow_minor: number; net_minor: number; payroll_minor: number; agent_spend_minor: number; revenue_minor: number; gst_payable_minor: number };
};

// The CA's month: every vertical on one page, one CSV.
export default async function GroupStatementPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login?next=/c/statement");
  const { period = new Date().toISOString().slice(0, 7) } = await searchParams;
  const up = await workerUp();
  const g = up ? await hiveOr<Group | null>(`/api/group/statement/${period}`, null) : null;
  const visible = g ? { ...g, companies: g.companies.filter((c) => canCompany(session, c.slug, "company:view")) } : null;
  const months = Array.from({ length: 8 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - i); return d.toISOString().slice(0, 7); });
  const cur = visible?.companies[0]?.currency ?? "INR";
  const t = visible?.totals;

  return (
    <main className="mx-auto max-w-[1400px] px-5 py-8">
      <PageTitle eyebrow="The group, one month" title="Group statement">
        <Link href="/c" className="btn btn-ghost">Back to the group</Link>
        {up ? <a href={`/api/hive/group/statement/${period}/csv`} className="btn btn-primary">Download CSV for the CA</a> : null}
      </PageTitle>
      <div className="mb-5 flex flex-wrap gap-2">
        {months.map((m) => <Link key={m} href={`/c/statement?period=${m}`} className={`btn ${m === period ? "btn-glass" : "btn-ghost"}`}>{m}</Link>)}
      </div>
      {!visible ? <Card><Empty>The worker is not running, or you cannot view any company.</Empty></Card> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Cash in" value={money(t!.inflow_minor, cur)} tone="live" />
            <Stat label="Cash out" value={money(-t!.outflow_minor, cur)} />
            <Stat label="Net" value={money(t!.net_minor, cur)} tone={t!.net_minor < 0 ? "failed" : undefined} />
            <Stat label="GST payable" value={money(t!.gst_payable_minor, cur)} hint="output minus input credit" />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Stat label="Payroll" value={money(t!.payroll_minor, cur)} />
            <Stat label="Agent spend" value={money(t!.agent_spend_minor, cur)} hint="inference + external" />
            <Stat label="Revenue (ledger)" value={money(t!.revenue_minor, cur)} />
          </div>
          <Card className="mt-6">
            <Label className="mb-2">By company · {period}</Label>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left"><th className="label pb-2 font-medium">company</th><th className="label pb-2 text-right font-medium">in</th><th className="label pb-2 text-right font-medium">out</th><th className="label pb-2 text-right font-medium">net</th><th className="label pb-2 text-right font-medium">payroll</th><th className="label pb-2 text-right font-medium">agents</th><th className="label pb-2 text-right font-medium">GST payable</th><th className="label pb-2 text-right font-medium">closing cash</th></tr></thead>
                <tbody>
                  {visible.companies.map((c) => (
                    <tr key={c.slug} className="border-t border-[var(--hairline)]">
                      <td className="py-2"><Link href={`/c/${c.slug}/erp?tab=statements&period=${period}`} className="font-medium underline-offset-2 hover:underline">{c.name}</Link></td>
                      <td className="py-2 text-right tabular-nums">{money(c.statement.totals.inflow_minor, c.currency)}</td>
                      <td className="py-2 text-right tabular-nums">{money(-c.statement.totals.outflow_minor, c.currency)}</td>
                      <td className={`py-2 text-right tabular-nums ${c.statement.totals.net_minor < 0 ? "text-[var(--failed)]" : ""}`}>{money(c.statement.totals.net_minor, c.currency)}</td>
                      <td className="py-2 text-right tabular-nums">{c.statement.payroll ? money(c.statement.payroll.total_minor, c.currency) : "—"}</td>
                      <td className="py-2 text-right tabular-nums">{money(c.statement.agents.spend_minor, c.currency)}</td>
                      <td className="py-2 text-right tabular-nums">{money(c.gst.net_payable_minor, c.currency)}</td>
                      <td className="py-2 text-right tabular-nums">{money(c.statement.accounts.reduce((s, a) => s + a.closing_minor, 0), c.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="mt-4 text-xs text-[var(--muted)]">Each company keeps its own books; this page only adds them up. Currencies are shown per company and the totals assume one group currency.</p>
        </>
      )}
    </main>
  );
}
