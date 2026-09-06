// takeApproval: the column-free pre-approval lookup the Claude Code MCP
// tool wrapper uses when a parked session is resumed. The SDK itself is
// not exercised here.

import { beforeAll, describe, expect, it } from "vitest";
import { closeDb, openMemoryDb, run } from "../src/db.js";
import { drainApprovals, takeApproval } from "../src/harness/claude-code.js";

function insert(id: string, runId: string, tool: string, status: string, decidedAt?: number) {
  run(
    "INSERT INTO approvals (id, company_id, run_id, agent_id, tool, side_effect, request_json, status, decided_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    id, "c1", runId, "a1", tool, "publish", JSON.stringify({ input: {}, harness: "claude-code" }), status, decidedAt ?? null, Date.now(),
  );
}

describe("takeApproval", () => {
  beforeAll(() => {
    closeDb();
    openMemoryDb();
  });

  it("returns nothing for pending or unknown approvals", () => {
    insert("p1", "run-pending", "linkedin.post", "pending");
    expect(takeApproval("run-pending", "linkedin.post")).toBeUndefined();
    expect(takeApproval("run-none", "linkedin.post")).toBeUndefined();
  });

  it("honours an approved row exactly once", () => {
    insert("ap1", "run-a", "linkedin.post", "approved", 10);
    expect(takeApproval("run-a", "linkedin.post")).toBe("ap1");
    expect(takeApproval("run-a", "linkedin.post")).toBeUndefined();
  });

  it("is scoped to run and tool", () => {
    insert("ap2", "run-b", "linkedin.post", "approved", 10);
    expect(takeApproval("run-b", "card.purchase")).toBeUndefined();
    expect(takeApproval("run-other", "linkedin.post")).toBeUndefined();
    expect(takeApproval("run-b", "linkedin.post")).toBe("ap2");
  });

  it("hands out several approvals in decision order, each once", () => {
    insert("ap4", "run-c", "hive.ship", "approved", 200);
    insert("ap3", "run-c", "hive.ship", "approved", 100);
    expect(takeApproval("run-c", "hive.ship")).toBe("ap3");
    expect(takeApproval("run-c", "hive.ship")).toBe("ap4");
    expect(takeApproval("run-c", "hive.ship")).toBeUndefined();
  });

  it("keeps approved and denied lookups apart", () => {
    insert("dn1", "run-d", "card.purchase", "denied", 10);
    expect(takeApproval("run-d", "card.purchase")).toBeUndefined();
    expect(takeApproval("run-d", "card.purchase", "denied")).toBe("dn1");
    expect(takeApproval("run-d", "card.purchase", "denied")).toBeUndefined();
  });

  it("drainApprovals consumes every decided row of a run", () => {
    insert("ap5", "run-e", "hive.ship", "approved", 10);
    insert("dn2", "run-e", "card.purchase", "denied", 10);
    insert("p2", "run-e", "linkedin.post", "pending");
    drainApprovals("run-e");
    expect(takeApproval("run-e", "hive.ship")).toBeUndefined();
    expect(takeApproval("run-e", "card.purchase", "denied")).toBeUndefined();
    // a later decision on the still-pending row is unaffected
    run("UPDATE approvals SET status = 'approved', decided_at = 20 WHERE id = 'p2'");
    expect(takeApproval("run-e", "linkedin.post")).toBe("p2");
  });
});
