import { hive, hiveOr, money, sentence, type CompanySummary, type Task } from "../../../../lib/hive";
import { Card, Label, Badge, PageTitle, Empty } from "../../../../components/ui";
import { addPerson, draftPayroll, payrollAction, submitExpense, expenseAction, logTime, addCashAccount, addCashTxn } from "./actions";

export const dynamic = "force-dynamic";

type Person = { id: string; name: string; email: string | null; title: string | null; kind: string; monthly_salary_minor: number; status: string; telegram_chat_id: string | null };
type Payroll = { id: string; period: string; total_minor: number; status: string; items: { id: string; name?: string; net_minor: number }[] };
type Expense = { id: string; person_id: string | null; agent_id: string | null; category: string; amount_minor: number; description: string; status: string; submitted_at: number };
type TimeEntry = { id: string; person_id: string; task_id: string | null; date: string; minutes: number; note: string | null };
type Cash = { accounts: { id: string; name: string; kind: string; balance_minor: number }[]; txns: { id: string; account_id: string; ts: number; amount_minor: number; counterparty: string | null; category: string; memo: string | null }[] };

export default async function ErpPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string; period?: string }> }) {
  const { slug } = await params;
  const { tab = "people", period = new Date().toISOString().slice(0, 7) } = await searchParams;
  const [c, people, payroll, expenses, time, cash, tasks] = await Promise.all([
    hive<CompanySummary>(`/api/companies/${slug}`),
    hiveOr<Person[]>(`/api/companies/${slug}/erp/people`, []),
    hiveOr<Payroll[]>(`/api/companies/${slug}/erp/payroll`, []),
    hiveOr<Expense[]>(`/api/companies/${slug}/erp/expenses`, []),
    hiveOr<TimeEntry[]>(`/api/companies/${slug}/erp/time`, []),
    hiveOr<Cash>(`/api/companies/${slug}/erp/cash`, { accounts: [], txns: [] }),
    hiveOr<{ tasks: Task[] }>(`/api/companies/${slug}/tasks`, { tasks: [] }),
  ]);
  const cur = c.currency;
  const pName = new Map(people.map((p) => [p.id, p.name]));
  const aName = new Map(cash.accounts.map((a) => [a.id, a.name]));
  const tabs = ["people", "payroll", "expenses", "time", "cash", "statements"];
  const cashTotal = cash.accounts.reduce((s, a) => s + a.balance_minor, 0);
  const salaryBill = people.filter((p) => p.status === "active").reduce((s, p) => s + p.monthly_salary_minor, 0);

  return (
    <main>
      <PageTitle eyebrow="Under one roof" title="ERP">
        {tabs.map((t) => (
          <a key={t} href={`/c/${slug}/erp?tab=${t}`} className={`btn ${t === tab ? "btn-glass" : "btn-ghost"}`}>{sentence(t)}</a>
        ))}
      </PageTitle>
      <div className="mb-5 grid gap-4 sm:grid-cols-4">
        <Card><Label>Cash</Label><p className="mt-1 text-2xl tabular-nums">{money(cashTotal, cur)}</p><p className="text-xs text-[var(--muted)]">{cash.accounts.length} accounts</p></Card>
        <Card><Label>People</Label><p className="mt-1 text-2xl tabular-nums">{people.filter((p) => p.status === "active").length}</p><p className="text-xs text-[var(--muted)]">salary bill {money(salaryBill, cur)}/mo</p></Card>
        <Card><Label>Expenses open</Label><p className="mt-1 text-2xl tabular-nums">{expenses.filter((e) => e.status === "submitted" || e.status === "approved").length}</p><p className="text-xs text-[var(--muted)]">{money(expenses.filter((e) => e.status !== "rejected" && e.status !== "paid").reduce((s, e) => s + e.amount_minor, 0), cur)} pending</p></Card>
        <Card><Label>Hours · month</Label><p className="mt-1 text-2xl tabular-nums">{Math.round(time.filter((t) => t.date.startsWith(period)).reduce((s, t) => s + t.minutes, 0) / 60)}</p><p className="text-xs text-[var(--muted)]">{period}</p></Card>
      </div>

      {tab === "people" ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <Card>
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th className="label pb-2 font-medium">name</th><th className="label pb-2 font-medium">role</th><th className="label pb-2 font-medium">kind</th><th className="label pb-2 text-right font-medium">salary / mo</th><th className="label pb-2 font-medium">telegram</th></tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="border-t border-[var(--hairline)]"><td className="py-2 font-medium">{p.name}<span className="ml-2 text-xs text-[var(--muted)]">{p.email}</span></td><td className="py-2 text-[var(--ink-2)]">{p.title}</td><td className="py-2"><Badge tone={p.kind === "board" ? "brass" : "muted"}>{p.kind}</Badge></td><td className="py-2 text-right tabular-nums">{money(p.monthly_salary_minor, cur)}</td><td className="py-2 font-mono text-xs text-[var(--muted)]">{p.telegram_chat_id ?? "—"}</td></tr>
                ))}
              </tbody>
            </table>
            {people.length === 0 ? <Empty>Add the humans: you, Surabhi, interns.</Empty> : null}
          </Card>
          <Card className="h-fit">
            <Label className="mb-2">Add a person</Label>
            <form action={addPerson} className="space-y-2">
              <input type="hidden" name="slug" value={slug} />
              <input name="name" className="field" placeholder="Name" required />
              <input name="email" className="field" placeholder="Email" type="email" />
              <input name="title" className="field" placeholder="Title" />
              <select name="kind" className="field" defaultValue="employee"><option value="board">board</option><option value="employee">employee</option><option value="intern">intern</option><option value="contractor">contractor</option></select>
              <input name="salary" className="field" placeholder={`Monthly salary (${cur})`} inputMode="decimal" />
              <input name="telegram" className="field" placeholder="Telegram chat id (optional)" />
              <button className="btn btn-primary w-full justify-center" type="submit">Add</button>
            </form>
          </Card>
        </div>
      ) : null}

      {tab === "payroll" ? (
        <div className="space-y-4">
          <Card>
            <form action={draftPayroll} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="slug" value={slug} />
              <div><Label className="mb-1">Period</Label><input name="period" className="field w-40" defaultValue={period} pattern="\d{4}-\d{2}" /></div>
              <button className="btn btn-primary" type="submit">Draft payroll</button>
              <p className="text-xs text-[var(--muted)]">Drafts from active people with a salary. Approve, then mark paid from a cash account — the statement and the ledger update together.</p>
            </form>
          </Card>
          {payroll.length === 0 ? <Empty>No payroll runs yet.</Empty> : null}
          {payroll.map((pr) => (
            <Card key={pr.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="font-display text-xl">{pr.period}</p><p className="text-xs text-[var(--muted)]">{pr.items.length} people · {money(pr.total_minor, cur)}</p></div>
                <div className="flex items-center gap-2">
                  <Badge tone={pr.status === "paid" ? "live" : pr.status === "approved" ? "brass" : "muted"}>{pr.status}</Badge>
                  {pr.status === "draft" ? <form action={payrollAction}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={pr.id} /><input type="hidden" name="action" value="approve" /><button className="btn btn-glass" type="submit">Approve</button></form> : null}
                  {pr.status === "approved" ? (
                    <form action={payrollAction} className="flex items-center gap-2"><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={pr.id} /><input type="hidden" name="action" value="pay" /><select name="account_id" className="field w-44 py-1.5 text-sm" required>{cash.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><button className="btn btn-primary" type="submit">Mark paid</button></form>
                  ) : null}
                </div>
              </div>
              <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
                {pr.items.map((it) => <li key={it.id} className="flex justify-between border-t border-[var(--hairline)] py-1"><span>{it.name}</span><span className="tabular-nums">{money(it.net_minor, cur)}</span></li>)}
              </ul>
            </Card>
          ))}
        </div>
      ) : null}

      {tab === "expenses" ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="space-y-2">
            {expenses.length === 0 ? <Empty>No expenses filed.</Empty> : null}
            {expenses.map((e) => (
              <Card key={e.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div><p className="font-medium">{e.description}</p><p className="text-xs text-[var(--muted)]">{e.category} · {e.person_id ? pName.get(e.person_id) : e.agent_id ? "agent" : "company"} · {new Date(e.submitted_at).toLocaleDateString("en-IN")}</p></div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums">{money(e.amount_minor, cur)}</span>
                  <Badge tone={e.status === "paid" ? "live" : e.status === "approved" ? "brass" : e.status === "rejected" ? "failed" : "parked"}>{e.status}</Badge>
                  {e.status === "submitted" ? <><form action={expenseAction}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={e.id} /><input type="hidden" name="action" value="approved" /><button className="btn btn-glass py-1" type="submit">Approve</button></form><form action={expenseAction}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={e.id} /><input type="hidden" name="action" value="rejected" /><button className="btn btn-danger py-1" type="submit">Reject</button></form></> : null}
                  {e.status === "approved" ? <form action={expenseAction} className="flex gap-1"><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={e.id} /><input type="hidden" name="action" value="pay" /><select name="account_id" className="field w-36 py-1 text-xs" required>{cash.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><button className="btn btn-primary py-1" type="submit">Pay</button></form> : null}
                </div>
              </Card>
            ))}
          </div>
          <Card className="h-fit">
            <Label className="mb-2">File an expense</Label>
            <form action={submitExpense} className="space-y-2">
              <input type="hidden" name="slug" value={slug} />
              <input name="description" className="field" placeholder="What" required />
              <input name="amount" className="field" placeholder={`Amount (${cur})`} inputMode="decimal" required />
              <select name="category" className="field" defaultValue="travel">{["travel", "software", "marketing", "office", "professional-fees", "hardware", "other"].map((k) => <option key={k} value={k}>{k}</option>)}</select>
              <select name="person_id" className="field" defaultValue=""><option value="">company</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <input name="receipt" className="field" placeholder="Receipt ref / link" />
              <button className="btn btn-primary w-full justify-center" type="submit">Submit</button>
            </form>
          </Card>
        </div>
      ) : null}

      {tab === "time" ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <Card>
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th className="label pb-2 font-medium">date</th><th className="label pb-2 font-medium">who</th><th className="label pb-2 font-medium">task</th><th className="label pb-2 text-right font-medium">hours</th></tr></thead>
              <tbody>{time.map((t) => <tr key={t.id} className="border-t border-[var(--hairline)]"><td className="py-2 font-mono text-xs">{t.date}</td><td className="py-2">{pName.get(t.person_id) ?? t.person_id}</td><td className="py-2 text-[var(--ink-2)]">{tasks.tasks.find((x) => x.id === t.task_id)?.title ?? t.note ?? "—"}</td><td className="py-2 text-right tabular-nums">{(t.minutes / 60).toFixed(1)}</td></tr>)}</tbody>
            </table>
            {time.length === 0 ? <Empty>No time logged.</Empty> : null}
          </Card>
          <Card className="h-fit">
            <Label className="mb-2">Log time</Label>
            <form action={logTime} className="space-y-2">
              <input type="hidden" name="slug" value={slug} />
              <select name="person_id" className="field" required>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <input name="date" type="date" className="field" defaultValue={new Date().toISOString().slice(0, 10)} required />
              <input name="hours" className="field" placeholder="Hours" inputMode="decimal" required />
              <select name="task_id" className="field" defaultValue=""><option value="">no task</option>{tasks.tasks.filter((t) => t.key !== "mission").map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
              <input name="note" className="field" placeholder="Note" />
              <button className="btn btn-primary w-full justify-center" type="submit">Log</button>
            </form>
          </Card>
        </div>
      ) : null}

      {tab === "cash" ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {cash.accounts.map((a) => <Card key={a.id}><Label>{a.kind}</Label><p className="font-medium">{a.name}</p><p className="mt-1 text-xl tabular-nums">{money(a.balance_minor, cur)}</p></Card>)}
            </div>
            <Card>
              {cash.txns.length === 0 ? <Empty>No transactions.</Empty> : null}
              <table className="w-full text-sm">
                <tbody>{cash.txns.slice(0, 80).map((t) => <tr key={t.id} className="border-t border-[var(--hairline)] first:border-0"><td className="py-1.5 pr-3 font-mono text-[11px] text-[var(--muted)]">{new Date(t.ts).toLocaleDateString("en-IN")}</td><td className="py-1.5 pr-3 text-[var(--muted)]">{aName.get(t.account_id)}</td><td className="py-1.5 pr-3">{t.counterparty}<span className="ml-2 text-xs text-[var(--muted)]">{t.memo}</span></td><td className="py-1.5 pr-3"><Badge>{t.category}</Badge></td><td className={`py-1.5 text-right tabular-nums ${t.amount_minor < 0 ? "text-[var(--ink-2)]" : "text-[var(--live)]"}`}>{t.amount_minor < 0 ? "−" : "+"}{money(Math.abs(t.amount_minor), cur)}</td></tr>)}</tbody>
              </table>
            </Card>
          </div>
          <div className="space-y-4">
            <Card>
              <Label className="mb-2">Record a transaction</Label>
              <form action={addCashTxn} className="space-y-2">
                <input type="hidden" name="slug" value={slug} />
                <select name="account_id" className="field" required>{cash.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                <div className="flex gap-2"><select name="direction" className="field" defaultValue="out"><option value="in">money in</option><option value="out">money out</option></select><input name="amount" className="field" placeholder="Amount" inputMode="decimal" required /></div>
                <input name="counterparty" className="field" placeholder="Counterparty" />
                <select name="category" className="field" defaultValue="other">{["revenue", "salary", "software", "marketing", "travel", "office", "tax", "professional-fees", "transfer", "other"].map((k) => <option key={k} value={k}>{k}</option>)}</select>
                <input name="memo" className="field" placeholder="Memo / reference" />
                <button className="btn btn-primary w-full justify-center" type="submit">Record</button>
              </form>
            </Card>
            <Card>
              <Label className="mb-2">Add an account</Label>
              <form action={addCashAccount} className="space-y-2">
                <input type="hidden" name="slug" value={slug} />
                <input name="name" className="field" placeholder="HDFC current" required />
                <select name="kind" className="field" defaultValue="bank">{["bank", "cash", "upi", "card", "wallet"].map((k) => <option key={k} value={k}>{k}</option>)}</select>
                <input name="opening" className="field" placeholder="Opening balance" inputMode="decimal" />
                <button className="btn btn-glass w-full justify-center" type="submit">Add account</button>
              </form>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "statements" ? <Statements slug={slug} period={period} cur={cur} /> : null}
    </main>
  );
}

async function Statements({ slug, period, cur }: { slug: string; period: string; cur: string }) {
  type S = { period: string; accounts: { name: string; opening_minor: number; movement_minor: number; closing_minor: number }[]; by_category: Record<string, number>; totals: { inflow_minor: number; outflow_minor: number; net_minor: number }; payroll: { status: string; total_minor: number } | null; expenses: { amount_minor: number }[]; agents: { spend_minor: number; revenue_minor: number } };
  const s = await hive<S>(`/api/companies/${slug}/erp/statement/${period}`);
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - i); return d.toISOString().slice(0, 7); });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {months.map((m) => <a key={m} href={`/c/${slug}/erp?tab=statements&period=${m}`} className={`btn ${m === period ? "btn-glass" : "btn-ghost"}`}>{m}</a>)}
        <a href={`/api/hive/companies/${slug}/erp/statement/${period}?format=csv`} className="btn btn-primary ml-auto">Download CSV for the CA</a>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Card><Label>In</Label><p className="mt-1 text-xl tabular-nums text-[var(--live)]">{money(s.totals.inflow_minor, cur)}</p></Card>
        <Card><Label>Out</Label><p className="mt-1 text-xl tabular-nums">{money(-s.totals.outflow_minor, cur)}</p></Card>
        <Card><Label>Net</Label><p className={`mt-1 text-xl tabular-nums ${s.totals.net_minor < 0 ? "text-[var(--failed)]" : ""}`}>{money(s.totals.net_minor, cur)}</p></Card>
        <Card><Label>Agent spend</Label><p className="mt-1 text-xl tabular-nums">{money(s.agents.spend_minor, cur)}</p><p className="text-xs text-[var(--muted)]">inference + external</p></Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <Label className="mb-2">accounts · {period}</Label>
          <table className="w-full text-sm"><thead><tr className="text-left"><th className="label pb-1 font-medium">account</th><th className="label pb-1 text-right font-medium">opening</th><th className="label pb-1 text-right font-medium">movement</th><th className="label pb-1 text-right font-medium">closing</th></tr></thead>
            <tbody>{s.accounts.map((a) => <tr key={a.name} className="border-t border-[var(--hairline)]"><td className="py-1.5">{a.name}</td><td className="py-1.5 text-right tabular-nums">{money(a.opening_minor, cur)}</td><td className="py-1.5 text-right tabular-nums">{money(a.movement_minor, cur)}</td><td className="py-1.5 text-right tabular-nums">{money(a.closing_minor, cur)}</td></tr>)}</tbody></table>
        </Card>
        <Card>
          <Label className="mb-2">By category</Label>
          <ul className="text-sm">{Object.entries(s.by_category).map(([k, v]) => <li key={k} className="flex justify-between border-t border-[var(--hairline)] py-1.5 first:border-0"><span>{k}</span><span className="tabular-nums">{money(v, cur)}</span></li>)}</ul>
          {s.payroll ? <p className="mt-3 text-xs text-[var(--muted)]">payroll {s.payroll.status}: {money(s.payroll.total_minor, cur)}</p> : null}
        </Card>
      </div>
      <p className="text-xs text-[var(--muted)]">Surabhi can pull the same statement on Telegram with <code className="font-mono text-[var(--brass)]">/statement {period}</code> once the Telegram integration is enabled.</p>
    </div>
  );
}
