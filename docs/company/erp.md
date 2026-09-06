# ERP under one roof

The group runs several verticals (Prodigal AI, Prodigal Realty, later
waste management) with two humans on the board, occasional interns, and
companies of agents. The ERP layer gives every company the same books and
the same rituals, and the group view sums them.

Status: **v1 shipped** with the runtime — tables, API, UI, CSV export,
Telegram commands. Below: what exists, what the CA gets, and what comes
next.

## Entities (per company)

| Table | What it holds |
|---|---|
| `people` | humans: board, employees, interns, contractors; title, kind, monthly salary, Telegram chat id |
| `payroll_runs` / `payroll_items` | one run per month: draft → approved → paid; items per person |
| `expenses` | filed by a person or an agent; submitted → approved/rejected → paid |
| `time_entries` | per person, per day, optional task link |
| `cash_accounts` / `cash_txns` | bank, cash, UPI, card, wallet accounts; signed transactions with category, counterparty, memo, ref |
| `tasks` (shared with agents) | `owner_role: human` + `assignee_person_id` makes a task a human task; the tracker shows both |

The agent ledger (`ledger_entries`) is separate by design: it holds
budgets and inference/external spend in minor units. Paying payroll or an
expense mirrors into the ledger (`salaries`, `expense:<category>` against
`cash`) so the weekly report and the statement agree.

## Rituals

- **Monthly payroll:** draft from active salaries → board approves → mark
  paid from a cash account. Each person gets a cash transaction; the
  statement shows it under `salary`.
- **Expenses:** anyone files; the board approves; paid from an account.
  Agents can file expenses too (their card spend is separate and gated).
- **Time:** interns and board log hours against tasks; the month's total
  is on the ERP header.
- **Cash:** record every movement or import a bank CSV (next); balances are
  opening + sum of transactions.
- **Statement pack:** `GET /api/companies/:slug/erp/statement/YYYY-MM`
  (JSON) or `?format=csv`. Accounts with opening/movement/closing, all
  transactions, totals by category, payroll, expenses, agent spend and
  revenue. Surabhi pulls it with `/statement 2026-08` on Telegram and
  forwards it to the CA.

## Group view

`/c` sums companies: agents, running, approvals waiting, spend vs cap,
available. **/c/statement?period=YYYY-MM** is the CA's month across every
vertical: cash in/out/net, payroll, agent spend, revenue and GST payable per
company, one CSV (`GET /api/group/statement/<period>/csv`). Each company
keeps its own books; the group page only adds them up.

## Invoices and GST

`invoices` + `invoice_items` (runtime/src/invoices.ts). Numbers are
sequential per company and year (`treasury.invoice_prefix`, e.g.
`PAI-2026-0001`). The split follows Indian GST: same state as
`treasury.gst_state` → CGST + SGST (half each); another state → IGST; a
non-INR invoice carries no GST. `treasury.gstin` and `treasury.address`
print on the invoice (`GET /api/companies/<slug>/erp/invoices/<id>/html`,
save as PDF from the browser).

Lifecycle `draft → sent → paid` (or `void`). Marking paid by hand posts
`cash ← revenue`; a Razorpay or Stripe webhook does the same automatically
when the invoice's `payment_link` matches. Agents in the finance role draft
with `invoice.create` and send with `invoice.send` (class `send`, so first
contact parks).

**GST summary** (`ERP → GST`, `GET .../erp/gst/<period>`) is GSTR-3B shaped:
output tax from invoices sent or paid in the month, input credit from
approved or paid expenses that carry a `gst_minor`, net payable or carry
forward. It is a summary for the CA, not a filing.

## Bank statement import

`ERP → Import` takes a CSV from HDFC, ICICI, SBI, Kotak, RazorpayX or a
generic `date, description, reference, amount` file
(runtime/src/bank-import.ts, presets at `GET /api/erp/bank/presets`).
Dates in dd/mm/yyyy, ISO or `03-Sep-26`; amounts with Indian grouping and
DR/CR markers; separate debit/credit columns or one signed column. Rows are
deduplicated on account + date + amount + reference, so overlapping
statements are safe to re-import. Categories are guessed from the narration
(salary, software, tax, revenue, rent, bank-charges…) and can be edited in
the Cash tab. **Preview** runs the whole import without writing.

## What comes next (in order)

1. TDS on payments to contractors and a quarterly pack.
2. Documents: attach receipts and invoices as artifacts.
3. Inter-company transfers with a matching entry on both sides.
4. Counterparty rules that remember the category you chose last time.

