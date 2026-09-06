import { hive, money, ago, displayName } from "../../../../lib/hive";
import { Card, Label, Meter, PageTitle, Empty, Badge } from "../../../../components/ui";
import { cardAction } from "./actions";

export const dynamic = "force-dynamic";

type Treasury = {
  currency: string;
  wallets: { id: string; owner_type: string; owner_id: string; name: string; role: string | null; balance_minor: number; holds_minor: number; available_minor: number; mtd_spend_minor: number }[];
  accounts: { account: string; balance: number; holds: number }[];
  entries: { id: string; journal_id: string; account: string; debit: number; credit: number; kind: string; memo: string | null; ts: number; released: number }[];
  cards: { id: string; status: string; last4: string | null; controls_json: string; agent_id: string | null; provider_card_id: string | null; created_at: number }[];
  config: { monthly_cap: number; approval_threshold: number; reserve?: number; card_provider?: string };
  card_provider: { id: string; ready: boolean; missing_secrets: string[]; webhook_url: string } | null;
  revenue_webhooks: { stripe: string; razorpay: string };
  webhook_events: { id: string; provider: string; type: string; received_at: number; outcome: string | null }[];
};

export default async function TreasuryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { slug } = await params;
  const { msg } = await searchParams;
  const t = await hive<Treasury>(`/api/companies/${slug}/treasury`);
  const cur = t.currency;
  const company = t.wallets.find((w) => w.owner_type === "company");
  const agents = t.wallets.filter((w) => w.owner_type === "agent");
  const spend = t.accounts.filter((a) => a.account === "api-spend" || a.account === "external").reduce((s, a) => s + a.balance, 0);
  const agentName = new Map(agents.map((w) => [w.owner_id, displayName(w.name, null, w.role)]));
  const cardTone = (st: string) => (st === "active" ? "live" : st === "requested" ? "parked" : st === "failed" ? "failed" : "muted");
  return (
    <main>
      <PageTitle eyebrow="Ledger-backed, gate-capped" title="Treasury" />
      {msg ? <Card className="mb-4"><p className="text-sm">{msg}</p></Card> : null}
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

      <Label className="mb-2 mt-6">Cards</Label>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          {(t.cards ?? []).length === 0 ? <Empty>{t.card_provider ? "No cards yet. An agent calls card.request; you approve it in the Inbox; the worker issues it." : "Ledger-only: agents place holds, you pay approved items by hand."}</Empty> : null}
          <div className="space-y-2">
            {t.cards.map((c) => {
              const ctl = JSON.parse(c.controls_json || "{}") as { per_tx?: number; monthly?: number; purpose?: string; categories?: string[] };
              return (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--r-2)] border border-[var(--hairline)] p-3 text-sm">
                  <div>
                    <p className="font-medium">{c.agent_id ? agentName.get(c.agent_id) ?? "Agent" : "Company"} {c.last4 ? <span className="ml-1 font-mono text-xs text-[var(--muted)]">•••• {c.last4}</span> : null}</p>
                    <p className="text-xs text-[var(--muted)]">{ctl.purpose ?? "no purpose given"} · per tx {ctl.per_tx ? money(ctl.per_tx, cur) : "—"} · monthly {ctl.monthly ? money(ctl.monthly, cur) : "—"}{ctl.categories?.length ? ` · ${ctl.categories.join(", ")}` : ""} · {ago(c.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={cardTone(c.status)}>{c.status}</Badge>
                    <form action={cardAction} className="flex gap-1">
                      <input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={c.id} />
                      {(c.status === "requested" || c.status === "failed") && t.card_provider ? <button name="action" value="issue" className="btn btn-ghost py-0.5 text-xs">Issue</button> : null}
                      {c.status === "active" ? <button name="action" value="freeze" className="btn btn-ghost py-0.5 text-xs">Freeze</button> : null}
                      {c.status === "frozen" ? <button name="action" value="unfreeze" className="btn btn-ghost py-0.5 text-xs">Unfreeze</button> : null}
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card className="h-fit">
          <Label className="mb-2">Provider</Label>
          {t.card_provider ? (
            <div className="text-sm">
              <p className="font-medium">Stripe Issuing <Badge tone={t.card_provider.ready ? "live" : "parked"}>{t.card_provider.ready ? "ready" : "secrets missing"}</Badge></p>
              {t.card_provider.missing_secrets.length ? <p className="mt-1 text-xs text-[var(--muted)]">Store in the vault (Integrations → secrets): {t.card_provider.missing_secrets.join(", ")}</p> : null}
              <p className="mt-3 text-xs text-[var(--muted)]">Issuing webhook (issuing_authorization.request, issuing_transaction.created):</p>
              <code className="mt-1 block break-all rounded-[var(--r-1)] bg-[var(--surface-0)] p-2 font-mono text-[11px]">{t.card_provider.webhook_url}</code>
              <p className="mt-2 text-xs text-[var(--muted)]">Authorizations are answered from the ledger in real time: active card, merchant policy, per-transaction and monthly limits, available balance. Numbers never leave Stripe.</p>
            </div>
          ) : (
            <p className="text-sm text-[var(--ink-2)]">Set <code className="font-mono text-xs">treasury.card_provider: stripe-issuing</code> in Settings, create a cardholder in the Stripe dashboard, and store STRIPE_SECRET_KEY, STRIPE_CARDHOLDER_ID and STRIPE_WEBHOOK_SECRET in the vault.</p>
          )}
          <Label className="mb-1 mt-4">Revenue webhooks</Label>
          <p className="text-xs text-[var(--muted)]">Stripe Checkout / Payment Links:</p>
          <code className="mt-1 block break-all rounded-[var(--r-1)] bg-[var(--surface-0)] p-2 font-mono text-[11px]">{t.revenue_webhooks?.stripe ?? "(worker update pending)"}</code>
          <p className="mt-2 text-xs text-[var(--muted)]">Razorpay (payment_link.paid), secret RAZORPAY_WEBHOOK_SECRET:</p>
          <code className="mt-1 block break-all rounded-[var(--r-1)] bg-[var(--surface-0)] p-2 font-mono text-[11px]">{t.revenue_webhooks?.razorpay ?? "(worker update pending)"}</code>
        </Card>
      </div>
      {t.webhook_events?.length ? (
        <>
          <Label className="mb-2 mt-6">Webhooks received</Label>
          <Card>
            <table className="w-full text-sm">
              <tbody>
                {t.webhook_events.slice(0, 20).map((w) => (
                  <tr key={w.id} className="border-t border-[var(--hairline)] first:border-0"><td className="py-1.5 pr-3 font-mono text-[11px] text-[var(--muted)]">{ago(w.received_at)}</td><td className="py-1.5 pr-3">{w.provider}</td><td className="py-1.5 pr-3 font-mono text-xs">{w.type}</td><td className="py-1.5 text-[var(--ink-2)]">{w.outcome}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : null}

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
