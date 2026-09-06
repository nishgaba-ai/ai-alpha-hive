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
available. A group-level statement (all companies in one CSV with a
company column) is next.

## What comes next (in order)

1. Bank CSV import with a matching rule per counterparty → category.
2. GST/TDS fields on transactions and a quarterly pack.
3. Invoices: create, send (gated `send`), track receipt into `revenue`.
4. Documents: attach receipts and invoices as artifacts.
5. Group statement and inter-company transfers.
6. Roles for humans in the platform RBAC mapped to ERP permissions
   (viewer can read statements, admin can approve payroll, owner can pay).
