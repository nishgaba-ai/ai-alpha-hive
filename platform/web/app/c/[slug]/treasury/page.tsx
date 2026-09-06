import { hive, money, ago, displayName } from "../../../../lib/hive";
import { Card, Label, Meter, PageTitle, Empty, Badge } from "../../../../components/ui";

export const dynamic = "force-dynamic";

type Treasury = {
  currency: string;
  wallets: { id: string; owner_type: string; name: string; role: string | null; balance_minor: number; holds_minor: number; available_minor: number; mtd_spend_minor: number }[];
  accounts: { account: string; balance: number; holds: number }[];
  entries: { id: string; journal_id: string; account: string; debit: number; credit: number; kind: string; memo: string | null; ts: number; released: number }[];
  cards: { id: string; status: string; last4: string | null; controls_json: string }[];
  config: { monthly_cap: number; approval_threshold: number; reserve?: number; card_provider?: string };
};

export default async function TreasuryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await hive<Treasury>(`/api/companies/${slug}/treasury`);
  const cur = t.currency;
  const company = t.wallets.find((w) => w.owner_type === "company");
  const agents = t.wallets.filter((w) => w.owner_type === "agent");
  const spend = t.accounts.filter((a) => a.account === "api-spend" || a.account === "external").reduce((s, a) => s + a.balance, 0);
  return (
    <main>
      <PageTitle eyebrow="Ledger-backed, gate-capped" title="Treasury" />
      <div className="grid gap-4 sm:grid-cols-4">
        <Card><Label>Monthly cap</Label><p className="mt-1 text-2xl tabular-nums">{money(t.config.monthly_cap * 100, cur)}</p><p className="text-xs text-[var(--muted)]">approval above {money(t.config.approval_threshold * 100, cur)}</p></Card>
        <Card><Label>Spent this cycle</Label><p className="mt-1 text-2xl tabular-nums">{money(spend, cur)}</p><Meter value={spend} max={t.config.monthly_cap * 100} /></Card>
        <Card><Label>Company wallet</Label><p className="mt-1 text-2xl tabular-nums">{money(company?.available_minor ?? 0, cur)}</p><p className="text-xs text-[var(--muted)]">unallocated · reserve {money((t.config.reserve ?? 0) * 100, cur)}</p></Card>
        <Card><Label>Cards</Label><p className="mt-1 text-2xl">{t.config.card_provider === "stripe-issuing" ? t.cards.length : "ledger-only"}</p><p className="text-xs text-[var(--muted)]">{t.config.card_provider === "stripe-issuing" ? "Stripe Issuing" : "board pays approved items by hand"}</p></Card>
      </div>

      <Label className="mb-2 mt-6">Agent wallets</Label>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((w) => (
          <Card key={w.id}>
            <div className="flex items-center justify-between"><p className="font-medium">{displayName(w.name, null, w.role)}</p><span className="text-xs text-[var(--muted)]">{w.role ? displayName(w.role) : ""}</span></div>
            <p className="mt-1 text-xl tabular-nums">{money(w.available_minor, cur)} <span className="text-xs text-[var(--muted)]">available</span></p>
            <div className="mt-2"><Meter value={w.mtd_spend_minor} max={w.balance_minor + w.mtd_spend_minor} /></div>
            <p className="mt-1 text-xs text-[var(--muted)]">{money(w.mtd_spend_minor, cur)} spent · {money(w.holds_minor, cur)} on hold</p>
          </Card>
        ))}
      </div>

      <Label className="mb-2 mt-6">Accounts</Label>
      <Card>
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th className="label pb-2 font-medium">account</th><th className="label pb-2 text-right font-medium">balance</th><th className="label pb-2 text-right font-medium">holds</th></tr></thead>
          <tbody>
            {t.accounts.map((a) => (
              <tr key={a.account} className="border-t border-[var(--hairline)]"><td className="py-2 font-mono text-xs">{a.account}</td><td className="py-2 text-right tabular-nums">{money(a.balance, cur)}</td><td className="py-2 text-right tabular-nums text-[var(--muted)]">{a.holds ? money(a.holds, cur) : "—"}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Label className="mb-2 mt-6">Journal · latest</Label>
      <Card>
        {t.entries.length === 0 ? <Empty>No entries yet.</Empty> : null}
        <table className="w-full text-sm">
          <tbody>
            {t.entries.slice(0, 60).map((e) => (
              <tr key={e.id} className="border-t border-[var(--hairline)] first:border-0">
                <td className="py-1.5 pr-3 font-mono text-[11px] text-[var(--muted)]">{ago(e.ts)}</td>
                <td className="py-1.5 pr-3 font-mono text-xs">{e.account}</td>
                <td className="py-1.5 pr-3 text-[var(--ink-2)]">{e.memo}</td>
                <td className="py-1.5 pr-3"><Badge tone={e.kind === "hold" ? (e.released ? "muted" : "parked") : "muted"}>{e.kind}{e.kind === "hold" && e.released ? " · released" : ""}</Badge></td>
                <td className="py-1.5 text-right tabular-nums">{e.debit ? <span className="text-[var(--ink)]">+{money(e.debit, cur)}</span> : <span className="text-[var(--muted)]">−{money(e.credit, cur)}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-4 text-xs text-[var(--muted)]">Funding, card issuance and cap changes are board actions: fund on the provider&apos;s page, then edit company.yaml. The app never collects payment details.</p>
    </main>
  );
}
