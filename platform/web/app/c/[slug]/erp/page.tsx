import { hive, hiveOr, money, sentence, type CompanySummary, type Task } from "../../../../lib/hive";
import { Card, Label, Badge, PageTitle, Empty } from "../../../../components/ui";
import { addPerson, draftPayroll, payrollAction, submitExpense, expenseAction, logTime, addCashAccount, addCashTxn, createInvoice, invoiceStatus, importBank } from "./actions";

export const dynamic = "force-dynamic";

type Person = { id: string; name: string; email: string | null; title: string | null; kind: string; monthly_salary_minor: number; status: string; telegram_chat_id: string | null };
type Payroll = { id: string; period: string; total_minor: number; status: string; items: { id: string; name?: string; net_minor: number }[] };
type Expense = { id: string; person_id: string | null; agent_id: string | null; category: string; amount_minor: number; description: string; status: string; submitted_at: number };
type TimeEntry = { id: string; person_id: string; task_id: string | null; date: string; minutes: number; note: string | null };
type Cash = { accounts: { id: string; name: string; kind: string; balance_minor: number }[]; txns: { id: string; account_id: string; ts: number; amount_minor: number; counterparty: string | null; category: string; memo: string | null }[] };

export default async function ErpPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string; period?: string; msg?: string }> }) {
  const { slug } = await params;
  const { tab = "people", period = new Date().toISOString().slice(0, 7), msg } = await searchParams;
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
  const tabs = ["people", "payroll", "expenses", "time", "cash", "invoices", "gst", "import", "statements"];
  const cashTotal = cash.accounts.reduce((s, a) => s + a.balance_minor, 0);
  const salaryBill = people.filter((p) => p.status === "active").reduce((s, p) => s + p.monthly_salary_minor, 0);

  return (
    <main>
      <PageTitle eyebrow="Under one roof" title="ERP">
        {tabs.map((t) => (
          <a key={t} href={`/c/${slug}/erp?tab=${t}`} className={`btn ${t === tab ? "btn-glass" : "btn-ghost"}`}>{t === "gst" ? "GST" : sentence(t)}</a>
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

      {msg ? <Card className="mb-4"><p className="text-sm">{msg}</p></Card> : null}
      {tab === "invoices" ? <Invoices slug={slug} cur={cur} /> : null}
      {tab === "gst" ? <Gst slug={slug} period={period} cur={cur} /> : null}
      {tab === "import" ? <BankImport slug={slug} accounts={cash.accounts} /> : null}
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

type Invoice = { id: string; number: string; customer_name: string; customer_email: string | null; place_of_supply: string | null; currency: string; issued_on: string; due_on: string | null; subtotal_minor: number; cgst_minor: number; sgst_minor: number; igst_minor: number; total_minor: number; status: string; payment_link: string | null; items?: { id: string; description: string; quantity: number; unit_minor: number; gst_rate: number; amount_minor: number }[] };

async function Invoices({ slug, cur }: { slug: string; cur: string }) {
  const list = await hiveOr<Invoice[]>(`/api/companies/${slug}/erp/invoices`, []);
  const tone = (s: string) => (s === "paid" ? "live" : s === "sent" ? "parked" : s === "void" ? "failed" : "muted");
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <Card>
        {list.length === 0 ? <Empty>No invoices yet. Agents in the finance role can draft them too (invoice.create).</Empty> : null}
        <div className="space-y-2">
          {list.map((i) => (
            <div key={i.id} className="rounded-[var(--r-2)] border border-[var(--hairline)] p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><span className="font-mono text-xs text-[var(--muted)]">{i.number}</span> <span className="ml-2 font-medium">{i.customer_name}</span> <span className="ml-2 text-xs text-[var(--muted)]">{i.issued_on}{i.due_on ? ` · due ${i.due_on}` : ""}</span></div>
                <div className="flex items-center gap-2"><Badge tone={tone(i.status)}>{i.status}</Badge><span className="tabular-nums font-medium">{money(i.total_minor, i.currency)}</span></div>
              </div>
              <p className="mt-1 text-xs text-[var(--muted)]">{(i.items ?? []).map((it) => `${it.description} × ${it.quantity}`).join(" · ")} · GST {money(i.cgst_minor + i.sgst_minor + i.igst_minor, i.currency)}{i.igst_minor ? " (IGST)" : i.cgst_minor ? " (CGST+SGST)" : ""}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <a href={`/api/hive/companies/${slug}/erp/invoices/${i.id}/html`} target="_blank" rel="noreferrer" className="btn btn-ghost py-0.5 text-xs">Print</a>
                {i.payment_link ? <a href={i.payment_link} target="_blank" rel="noreferrer" className="btn btn-ghost py-0.5 text-xs">Payment link</a> : null}
                <form action={invoiceStatus} className="flex items-center gap-1">
                  <input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={i.id} />
                  {i.status === "draft" ? <><input name="payment_link" className="field w-44 py-0.5 text-xs" placeholder="Payment link (optional)" /><button name="status" value="sent" className="btn btn-ghost py-0.5 text-xs">Mark sent</button></> : null}
                  {i.status === "sent" ? <button name="status" value="paid" className="btn btn-ghost py-0.5 text-xs">Mark paid</button> : null}
                  {i.status !== "void" && i.status !== "paid" ? <button name="status" value="void" className="btn btn-ghost py-0.5 text-xs">Void</button> : null}
                </form>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card className="h-fit">
        <Label className="mb-2">New invoice</Label>
        <form action={createInvoice} className="space-y-2 text-sm">
          <input type="hidden" name="slug" value={slug} />
          <input name="customer_name" className="field" placeholder="Customer" required />
          <input name="customer_email" className="field" placeholder="Customer email" type="email" />
          <div className="grid grid-cols-2 gap-2"><input name="customer_gstin" className="field" placeholder="Customer GSTIN" /><input name="place_of_supply" className="field" placeholder="State code (GJ)" maxLength={2} /></div>
          <input name="due_on" className="field" placeholder="Due YYYY-MM-DD" />
          <Label className="mt-2">Lines</Label>
          {[0, 1, 2].map((n) => (
            <div key={n} className="grid grid-cols-[1fr_52px_84px_52px] gap-1">
              <input name={`item_desc_${n}`} className="field" placeholder={n === 0 ? "Description" : "…"} required={n === 0} />
              <input name={`item_qty_${n}`} className="field" placeholder="Qty" defaultValue={1} inputMode="numeric" />
              <input name={`item_unit_${n}`} className="field" placeholder={`Rate ${cur}`} inputMode="decimal" />
              <input name={`item_gst_${n}`} className="field" placeholder="GST%" defaultValue={18} inputMode="numeric" />
            </div>
          ))}
          <textarea name="notes" className="field min-h-[56px]" placeholder="Notes on the invoice" />
          <button className="btn btn-primary w-full justify-center" type="submit">Create draft</button>
          <p className="text-xs text-[var(--muted)]">Same state as treasury.gst_state → CGST + SGST; otherwise IGST. Exports carry no GST.</p>
        </form>
      </Card>
    </div>
  );
}

async function Gst({ slug, period, cur }: { slug: string; period: string; cur: string }) {
  type G = { period: string; invoices: number; output: { taxable_minor: number; cgst_minor: number; sgst_minor: number; igst_minor: number }; input_credit_minor: number; expenses_with_gst: number; net_payable_minor: number; carry_forward_minor: number; note: string };
  const g = await hiveOr<G | null>(`/api/companies/${slug}/erp/gst/${period}`, null);
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - i); return d.toISOString().slice(0, 7); });
  if (!g) return <Card><Empty>Worker unavailable.</Empty></Card>;
  const output = g.output.cgst_minor + g.output.sgst_minor + g.output.igst_minor;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">{months.map((m) => <a key={m} href={`/c/${slug}/erp?tab=gst&period=${m}`} className={`btn ${m === period ? "btn-glass" : "btn-ghost"}`}>{m}</a>)}</div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Card><Label>Taxable sales</Label><p className="mt-1 text-xl tabular-nums">{money(g.output.taxable_minor, cur)}</p><p className="text-xs text-[var(--muted)]">{g.invoices} invoices sent or paid</p></Card>
        <Card><Label>Output tax</Label><p className="mt-1 text-xl tabular-nums">{money(output, cur)}</p><p className="text-xs text-[var(--muted)]">CGST {money(g.output.cgst_minor, cur)} · SGST {money(g.output.sgst_minor, cur)} · IGST {money(g.output.igst_minor, cur)}</p></Card>
        <Card><Label>Input credit</Label><p className="mt-1 text-xl tabular-nums">{money(g.input_credit_minor, cur)}</p><p className="text-xs text-[var(--muted)]">{g.expenses_with_gst} expenses with GST</p></Card>
        <Card><Label>Net payable</Label><p className={`mt-1 text-xl tabular-nums ${g.net_payable_minor ? "text-[var(--parked)]" : "text-[var(--live)]"}`}>{money(g.net_payable_minor, cur)}</p><p className="text-xs text-[var(--muted)]">{g.carry_forward_minor ? `carry forward ${money(g.carry_forward_minor, cur)}` : "nothing to carry forward"}</p></Card>
      </div>
      <p className="text-xs text-[var(--muted)]">{g.note} Record the GST amount on each expense (Expenses tab) so the credit side is complete.</p>
    </div>
  );
}

function BankImport({ slug, accounts }: { slug: string; accounts: { id: string; name: string; kind: string }[] }) {
  const presets = ["hdfc", "icici", "sbi", "kotak", "razorpayx", "generic"];
  return (
    <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
      <Card>
        <Label className="mb-2">Import a bank statement (CSV)</Label>
        {accounts.length === 0 ? <Empty>Add a cash account first (Cash tab).</Empty> : (
          <form action={importBank} className="space-y-2 text-sm">
            <input type="hidden" name="slug" value={slug} />
            <select name="account_id" className="field">{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.kind}</option>)}</select>
            <select name="preset" className="field" defaultValue="hdfc">{presets.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}</select>
            <input type="file" name="file" accept=".csv,text/csv" className="field" />
            <textarea name="csv" className="field min-h-[80px] font-mono text-xs" placeholder="…or paste CSV rows here" />
            <div className="flex gap-2">
              <button className="btn btn-ghost" type="submit" name="dry_run" value="yes">Preview</button>
              <button className="btn btn-primary" type="submit" name="dry_run" value="no">Import</button>
            </div>
          </form>
        )}
      </Card>
      <Card>
        <Label className="mb-2">How it works</Label>
        <ul className="list-disc space-y-1 pl-4 text-sm text-[var(--ink-2)]">
          <li>Presets know the column names HDFC, ICICI, SBI, Kotak and RazorpayX export; Generic expects date, description, reference, amount.</li>
          <li>Rows are deduplicated on account + date + amount + reference, so re-importing an overlapping statement is safe.</li>
          <li>Categories are guessed from the narration (salary, software, tax, revenue…); edit them in the Cash tab.</li>
          <li>Preview shows counts without writing anything.</li>
        </ul>
      </Card>
    </div>
  );
}
