// Cards, webhooks, invoices with GST, bank import and the migration round trip.

import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { openMemoryDb, all, one, run, newId, closeDb } from "../src/db.js";
import { readCompany, syncCompany } from "../src/loader.js";
import * as ledger from "../src/ledger.js";
import { setSecret, resolver } from "../src/vault.js";
import { authorize, settle, reverse, requestCard } from "../src/cards/index.js";
import { handleStripe, handleRazorpay, verifyStripeSignature } from "../src/webhooks.js";
import { createInvoice, gstSplit, gstSummary, invoiceHtml, markInvoicePaidByLink, setInvoiceStatus } from "../src/invoices.js";
import { importBankCsv, parseCsv, parseDate, parseAmount } from "../src/bank-import.js";
import * as erp from "../src/erp.js";
import { exportBundle, importBundle } from "../src/migrate.js";
import { composeMission } from "../src/intake.js";
import type { CompanyConfig, CompanyRow } from "../src/types.js";

const repo = path.resolve(__dirname, "..", "..");

function scaffold(extraYaml = ""): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hive-money-"));
  let yaml = fs.readFileSync(path.join(repo, "templates", "companies", "startup.yaml"), "utf8");
  yaml = yaml.replace(/model: [^\n]+/g, "model: mock").replace("harness: agent-sdk", "harness: api").replace("workspace: true", "workspace: false");
  yaml = yaml.replace(/card_provider: [^\n]+/, "card_provider: stripe-issuing");
  if (!/card_provider/.test(yaml)) yaml = yaml.replace(/(treasury:\n)/, "$1  card_provider: stripe-issuing\n");
  yaml = yaml.replace(/(treasury:\n)/, "$1  gst_state: GJ\n  invoice_prefix: PAI\n");
  fs.writeFileSync(path.join(dir, "company.yaml"), yaml + extraYaml);
  fs.mkdirSync(path.join(dir, "roles"));
  for (const f of fs.readdirSync(path.join(repo, "templates", "companies", "roles"))) fs.copyFileSync(path.join(repo, "templates", "companies", "roles", f), path.join(dir, "roles", f));
  return dir;
}

describe("money: cards, webhooks, invoices, bank import, migration", () => {
  let company: CompanyRow;
  let config: CompanyConfig;
  let dir: string;
  let agent: { id: string; wallet_id: string };
  const whsec = "whsec_test_secret_value_1234567890";

  beforeAll(() => {
    process.env.VAULT_KEY = Buffer.alloc(32, 9).toString("base64");
    openMemoryDb();
    dir = scaffold();
    const lc = readCompany(dir);
    company = syncCompany(lc);
    config = lc.config;
    agent = one<{ id: string; wallet_id: string }>("SELECT id, wallet_id FROM agents WHERE company_id = ? ORDER BY created_at LIMIT 1", company.id)!;
    setSecret(company.id, "STRIPE_WEBHOOK_SECRET", whsec);
    setSecret(company.id, "RAZORPAY_WEBHOOK_SECRET", "rzp_whsec_test");
  });

  it("authorizes within limits, declines over limit, settles by capturing the hold", () => {
    const card = requestCard(company, config, agent, { per_tx: 5000, monthly: 20000, purpose: "ads" });
    run("UPDATE cards SET status = 'active', provider_card_id = 'ic_test_1', last4 = '4242' WHERE id = ?", card.id);
    const acct = ledger.walletAccount(agent.id);
    const before = ledger.available(company.id, acct);
    expect(before).toBeGreaterThan(5000);

    const over = authorize(company, config, { provider_card_id: "ic_test_1", amount_minor: 9000, currency: company.currency, merchant: "Meta Ads", provider_auth_id: "iauth_over" });
    expect(over.approved).toBe(false);
    expect(over.reason).toMatch(/per-transaction/);

    const ok = authorize(company, config, { provider_card_id: "ic_test_1", amount_minor: 4000, currency: company.currency, merchant: "Meta Ads", provider_auth_id: "iauth_ok" });
    expect(ok.approved).toBe(true);
    expect(ledger.available(company.id, acct)).toBe(before - 4000);

    const unknown = authorize(company, config, { provider_card_id: "ic_nope", amount_minor: 100, currency: company.currency, merchant: "x", provider_auth_id: "iauth_x" });
    expect(unknown.approved).toBe(false);

    const s = settle(company, { provider_card_id: "ic_test_1", provider_auth_id: "iauth_ok", amount_minor: 3900, merchant: "Meta Ads", provider_txn_id: "ipi_1" });
    expect("journal" in s).toBe(true);
    expect(ledger.openHolds(company.id, acct)).toBe(0);
    expect(ledger.balance(company.id, acct)).toBe(before - 3900);

    const rev = authorize(company, config, { provider_card_id: "ic_test_1", amount_minor: 1000, currency: company.currency, merchant: "Canva", provider_auth_id: "iauth_rev" });
    expect(rev.approved).toBe(true);
    reverse(company, "iauth_rev");
    expect(ledger.openHolds(company.id, acct)).toBe(0);
  });

  it("verifies Stripe signatures and answers issuing_authorization.request from the ledger, idempotently", async () => {
    const payload = JSON.stringify({ id: "evt_1", type: "issuing_authorization.request", data: { object: { id: "iauth_wh", card: { id: "ic_test_1" }, pending_request: { amount: 2500, currency: company.currency.toLowerCase() }, merchant_data: { name: "Google Ads" } } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${createHmac("sha256", whsec).update(`${t}.${payload}`).digest("hex")}`;
    expect(verifyStripeSignature(payload, sig, whsec)).toBe(true);
    expect(verifyStripeSignature(payload, `t=${t},v1=deadbeef`, whsec)).toBe(false);
    expect(verifyStripeSignature(payload, sig, whsec, 300, Date.now() + 3600_000)).toBe(false);

    const bad = await handleStripe({ company, config }, payload, "t=1,v1=nope");
    expect(bad.status).toBe(400);
    const r1 = await handleStripe({ company, config }, payload, sig);
    expect(r1.status).toBe(200);
    expect(r1.body.approved).toBe(true);
    const r2 = await handleStripe({ company, config }, payload, sig);
    expect(r2.body.approved).toBe(true);
    expect(all("SELECT * FROM webhook_events WHERE provider = 'stripe' AND event_id = 'evt_1'").length).toBe(1);
    expect(all("SELECT * FROM ledger_entries WHERE company_id = ? AND hold_ref = 'auth:iauth_wh' AND kind = 'hold'", company.id).length).toBe(1);
  });

  it("posts revenue from Razorpay payment_link.paid and marks the matching invoice paid", async () => {
    const invoice = createInvoice(company.id, { customer_name: "Acme", customer_email: "a@acme.test", currency: "INR", place_of_supply: "GJ", items: [{ description: "AI CMO retainer", unit_minor: 1000000, gst_rate: 18 }] }, { prefix: "PAI", companyState: "GJ" });
    setInvoiceStatus(company.id, invoice.id, "sent", { payment_link: "plink_test_1" });
    const payload = JSON.stringify({ event: "payment_link.paid", payload: { payment: { entity: { id: "pay_1", amount: invoice.total_minor, currency: "INR" } }, payment_link: { entity: { id: "plink_test_1" } } } });
    const sig = createHmac("sha256", "rzp_whsec_test").update(payload).digest("hex");
    const revBefore = ledger.balance(company.id, "revenue");
    const r = await handleRazorpay({ company, config }, payload, sig, "rzp_evt_1");
    expect(r.status).toBe(200);
    expect(ledger.balance(company.id, "revenue")).toBe(revBefore - invoice.total_minor);
    expect(one<{ status: string }>("SELECT status FROM invoices WHERE id = ?", invoice.id)!.status).toBe("paid");
    const dup = await handleRazorpay({ company, config }, payload, sig, "rzp_evt_1");
    expect(dup.body.duplicate).toBe(true);
    expect(markInvoicePaidByLink(company.id, "plink_test_1", "again")).toBeUndefined();
  });

  it("invoices: GST split, numbering, html, monthly summary", () => {
    expect(gstSplit(1800, "GJ", "GJ", "INR")).toEqual({ cgst: 900, sgst: 900, igst: 0 });
    expect(gstSplit(1800, "GJ", "DL", "INR")).toEqual({ cgst: 0, sgst: 0, igst: 1800 });
    expect(gstSplit(1800, "GJ", "GJ", "USD")).toEqual({ cgst: 0, sgst: 0, igst: 0 });
    const a = createInvoice(company.id, { customer_name: "Delhi Co", currency: "INR", place_of_supply: "DL", issued_on: "2026-09-03", items: [{ description: "Strategy sprint", unit_minor: 500000, quantity: 2, gst_rate: 18 }] }, { prefix: "PAI", companyState: "GJ" });
    expect(a.number).toMatch(/^PAI-\d{4}-\d{4}$/);
    expect(a.subtotal_minor).toBe(1000000);
    expect(a.igst_minor).toBe(180000);
    expect(a.total_minor).toBe(1180000);
    setInvoiceStatus(company.id, a.id, "sent");
    const html = invoiceHtml(a, { name: "Prodigal AI", gstin: "24AAAAA0000A1Z5" });
    expect(html).toContain(a.number);
    expect(html).toContain("IGST");
    erp.submitExpense(company.id, { category: "software", amount_minor: 118000, currency: "INR", description: "Vercel" });
    const exp = erp.expenses(company.id)[0];
    run("UPDATE expenses SET gst_minor = 18000, status = 'approved', submitted_at = ? WHERE id = ?", Date.UTC(2026, 8, 5), exp.id);
    const g = gstSummary(company.id, "2026-09");
    expect(g.invoices).toBeGreaterThanOrEqual(1);
    expect(g.output.igst_minor).toBeGreaterThanOrEqual(180000);
    expect(g.input_credit_minor).toBe(18000);
    expect(g.net_payable_minor).toBe(g.output.cgst_minor + g.output.sgst_minor + g.output.igst_minor - 18000);
  });

  it("bank csv import: parses Indian bank formats, categorises, dedupes on re-import", () => {
    expect(parseDate("03/09/2026", "dmy")).toBe(Date.UTC(2026, 8, 3));
    expect(parseDate("2026-09-03", "iso")).toBe(Date.UTC(2026, 8, 3));
    expect(parseDate("03-Sep-26")).toBe(Date.UTC(2026, 8, 3));
    expect(parseAmount("1,25,000.50")).toBe(12500050);
    expect(parseAmount("(2,000.00)")).toBe(-200000);
    const rows = parseCsv('Date,Narration,"Chq./Ref.No.",Withdrawal Amt.,Deposit Amt.\n01/09/26,"UPI-RAZORPAY-CR, settlement",REF1,,"1,00,000.00"\n02/09/26,AWS INDIA BILL,REF2,"12,500.00",\n');
    expect(rows.length).toBe(2);
    expect(rows[0]["Deposit Amt."]).toBe("1,00,000.00");
    const acc = erp.addCashAccount(company.id, { name: "HDFC current", kind: "bank", currency: "INR" });
    const csv = "Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.\n01/09/26,UPI-RAZORPAY-CR settlement,REF1,,100000.00\n02/09/26,AWS INDIA BILL,REF2,12500.00,\n03/09/26,SALARY SEP,REF3,50000.00,\n";
    const dry = importBankCsv(company.id, acc.id, csv, { date: "Date", narration: "Narration", reference: "Chq./Ref.No.", debit: "Withdrawal Amt.", credit: "Deposit Amt.", dateFormat: "dmy" }, "test", true);
    expect(dry.imported).toBe(3);
    expect(erp.cashTxns(company.id).filter((t) => t.account_id === acc.id).length).toBe(0);
    const first = importBankCsv(company.id, acc.id, csv, { date: "Date", narration: "Narration", reference: "Chq./Ref.No.", debit: "Withdrawal Amt.", credit: "Deposit Amt.", dateFormat: "dmy" }, "test");
    expect(first.imported).toBe(3);
    const txns = erp.cashTxns(company.id).filter((t) => t.account_id === acc.id);
    expect(txns.find((t) => t.memo?.includes("AWS"))?.category).toBe("software");
    expect(txns.find((t) => t.memo?.includes("SALARY"))?.amount_minor).toBe(-5000000);
    const again = importBankCsv(company.id, acc.id, csv, { date: "Date", narration: "Narration", reference: "Chq./Ref.No.", debit: "Withdrawal Amt.", credit: "Deposit Amt.", dateFormat: "dmy" }, "test");
    expect(again.imported).toBe(0);
    expect(again.duplicates).toBe(3);
    expect(erp.cashAccounts(company.id).find((a) => a.id === acc.id)?.balance_minor).toBe(10000000 - 1250000 - 5000000);
  });

  it("intake composes the executive's first mission", () => {
    const m = composeMission({ website: "https://hive.prodigalai.com", product: "Launch your AI company", audience: "founders", goals: "500 sign-ups", competitors: "CrewAI, AutoGen", channels: ["blog", "linkedin"] });
    expect(m).toContain("hive.prodigalai.com");
    expect(m).toContain("CrewAI");
    expect(m).toContain("blog, linkedin");
  });

  it("migration: export from one database, import into a fresh one, everything survives", () => {
    const bundle = exportBundle([{ slug: company.slug, dir }]);
    const rowsBefore = Object.values(bundle.tables).reduce((s, t) => s + t.length, 0);
    expect(rowsBefore).toBeGreaterThan(20);
    expect(bundle.tables.invoices.length).toBeGreaterThan(0);
    expect(bundle.tables.secrets.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(bundle);

    closeDb();
    openMemoryDb();
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "hive-import-"));
    const r = importBundle(JSON.parse(serialised), target);
    expect(r.rows).toBe(rowsBefore);
    expect(fs.existsSync(path.join(target, company.slug, "company.yaml"))).toBe(true);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM invoices WHERE company_id = ?", company.id)!.n).toBe(bundle.tables.invoices.length);
    expect(ledger.balance(company.id, "revenue")).toBeLessThan(0);
    // the vault rows travel encrypted and decrypt with the same key
    expect(resolver(company.id).get("STRIPE_WEBHOOK_SECRET")).toBe(whsec);
    // and the imported company loads + syncs again without duplicating agents
    const lc = readCompany(path.join(target, company.slug));
    const again = syncCompany(lc);
    expect(again.id).toBe(company.id);
    expect(all("SELECT * FROM agents WHERE company_id = ?", company.id).length).toBe(bundle.tables.agents.length);
    void newId;
  });
});
