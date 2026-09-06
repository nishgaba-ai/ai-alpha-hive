import { beforeEach, describe, expect, it } from "vitest";
import { openMemoryDb, closeDb } from "../src/db.js";
import * as ledger from "../src/ledger.js";
import { decide } from "../src/gate.js";
import type { CompanyConfig, RoleConfig, ToolSpec } from "../src/types.js";

const config: CompanyConfig = {
  company: { name: "T", slug: "t", mission: "test mission here", currency: "INR", board: [{ email: "a@b.co", role: "owner" }] },
  treasury: { monthly_cap: 1000, approval_threshold: 100 },
  policies: { spend: { under_threshold: "allow", otherwise: "approve", merchants: { block: ["evil.example"] } }, publish: { default: "approve" }, send: { first_contact: "approve", reply: "allow" } },
  roles: [],
};
const role: RoleConfig = { id: "r", title: "R", harness: "api", reports_to: "board", tools: ["card.purchase", "content.publish"], budget: { monthly: 500, per_tx: 200 } };
const purchase: ToolSpec = { name: "card.purchase", description: "", sideEffect: "spend", input: { type: "object", properties: {} } };
const publish: ToolSpec = { name: "content.publish", description: "", sideEffect: "publish", input: { type: "object", properties: {} } };
const fund: ToolSpec = { name: "treasury.fund", description: "", sideEffect: "board", input: { type: "object", properties: {} } };

describe("gate", () => {
  beforeEach(() => {
    closeDb();
    openMemoryDb();
    ledger.post("c1", [{ account: "wallet:a1", debit: 50000 }, { account: "funding", credit: 50000 }], "seed");
  });
  const base = { config, role, companyId: "c1", agentId: "a1", allowedNames: new Set(["card.purchase", "content.publish"]) };

  it("allows spend under threshold and places a hold", () => {
    const r = decide({ ...base, spec: purchase, input: { vendor: "namecheap.com", amount: 5000, currency: "INR", reason: "x" } });
    expect(r.decision).toBe("allow");
    expect(r.holdRef).toBeTruthy();
    expect(ledger.available("c1", "wallet:a1")).toBe(45000);
  });
  it("parks spend above threshold", () => {
    const r = decide({ ...base, spec: purchase, input: { vendor: "namecheap.com", amount: 15000, currency: "INR", reason: "x" } });
    expect(r.decision).toBe("approve");
    expect(r.holdRef).toBeUndefined();
  });
  it("denies blocked vendors and insufficient wallets", () => {
    expect(decide({ ...base, spec: purchase, input: { vendor: "evil.example", amount: 100, currency: "INR", reason: "x" } }).decision).toBe("deny");
    expect(decide({ ...base, spec: purchase, input: { vendor: "ok.example", amount: 999999, currency: "INR", reason: "x" } }).decision).toBe("deny");
  });
  it("publish parks by default; board tools always deny; unknown tools deny", () => {
    expect(decide({ ...base, spec: publish, input: {} }).decision).toBe("approve");
    expect(decide({ ...base, spec: fund, input: {}, allowedNames: new Set(["treasury.fund"]) }).decision).toBe("deny");
    expect(decide({ ...base, spec: publish, input: {}, allowedNames: new Set() }).decision).toBe("deny");
  });
  it("role policy can only be stricter", () => {
    const strictRole = { ...role, policies: { spend: { under_threshold: "approve" as const } } };
    expect(decide({ ...base, role: strictRole, spec: purchase, input: { vendor: "x.com", amount: 10, currency: "INR", reason: "x" } }).decision).toBe("approve");
  });
});

describe("ledger", () => {
  beforeEach(() => {
    closeDb();
    openMemoryDb();
  });
  it("refuses unbalanced journals and derives balances", () => {
    expect(() => ledger.post("c", [{ account: "a", debit: 10 }], "bad")).toThrow();
    ledger.post("c", [{ account: "wallet:x", debit: 100 }, { account: "funding", credit: 100 }], "seed");
    const h = ledger.hold("c", "wallet:x", 40, "h");
    expect(ledger.available("c", "wallet:x")).toBe(60);
    ledger.capture("c", h, 30);
    expect(ledger.balance("c", "wallet:x")).toBe(70);
    expect(ledger.available("c", "wallet:x")).toBe(70);
    expect(ledger.balance("c", "external")).toBe(30);
  });
});
