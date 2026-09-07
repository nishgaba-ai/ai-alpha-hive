// The side-effect gate. One pure-ish function every tool call passes
// through, in both harnesses. Fail closed; nothing in a prompt changes it.

import type { CompanyConfig, Decision, Policies, RoleConfig, SideEffect, ToolSpec } from "./types.js";
import * as ledger from "./ledger.js";
import { knownContact } from "./contacts.js";

export type GateInput = {
  config: CompanyConfig;
  role: RoleConfig;
  companyId: string;
  agentId: string;
  spec: ToolSpec;
  input: Record<string, unknown>;
  allowedNames: Set<string>;
  now?: Date;
};

export type GateResult = {
  decision: Decision | "park";
  sideEffect: SideEffect;
  reason: string;
  /** minor units held on the wallet when allowed spend */
  holdRef?: string;
  amount?: number;
};

const ORDER: Decision[] = ["allow", "approve", "deny"];
function stricter(a: Decision | undefined, b: Decision | undefined): Decision {
  const x = a ?? "allow";
  const y = b ?? "allow";
  return ORDER.indexOf(x) >= ORDER.indexOf(y) ? x : y;
}

function merged(config: CompanyConfig, role: RoleConfig): Policies {
  const c = config.policies ?? {};
  const r = role.policies ?? {};
  return {
    spend: {
      under_threshold: stricter(c.spend?.under_threshold ?? "allow", r.spend?.under_threshold),
      otherwise: stricter(c.spend?.otherwise ?? "approve", r.spend?.otherwise),
      strict: c.spend?.strict || r.spend?.strict,
      merchants: {
        allow: [...(c.spend?.merchants?.allow ?? []), ...(r.spend?.merchants?.allow ?? [])],
        block: [...(c.spend?.merchants?.block ?? []), ...(r.spend?.merchants?.block ?? [])],
      },
    },
    send: {
      first_contact: stricter(c.send?.first_contact ?? "approve", r.send?.first_contact),
      reply: stricter(c.send?.reply ?? "allow", r.send?.reply),
    },
    publish: { default: stricter(c.publish?.default ?? "approve", r.publish?.default) },
    deploy: { preview: stricter(c.deploy?.preview ?? "allow", r.deploy?.preview), prod: stricter(c.deploy?.prod ?? "approve", r.deploy?.prod) },
    hire: { default: stricter(c.hire?.default ?? "approve", r.hire?.default) },
    quiet_hours: r.quiet_hours ?? c.quiet_hours,
  };
}

function inQuietHours(q: Policies["quiet_hours"], now: Date): boolean {
  if (!q) return false;
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: q.tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const hhmm = fmt.format(now).replace(/[^\d:]/g, "");
  const cur = Number(hhmm.replace(":", ""));
  const from = Number(q.from.replace(":", ""));
  const to = Number(q.to.replace(":", ""));
  return from > to ? cur >= from || cur < to : cur >= from && cur < to;
}

export function amountOf(input: Record<string, unknown>): number {
  for (const k of ["amount", "budget_total_minor", "budget_total", "budget_daily_minor"]) {
    const v = input[k];
    if (typeof v === "number" && v > 0) return v;
  }
  return 0;
}

function hostOf(s: string): string {
  try {
    return new URL(s.includes("://") ? s : `https://${s}`).hostname.toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

export function decide(g: GateInput): GateResult {
  const { spec, input } = g;
  const now = g.now ?? new Date();
  const classes: SideEffect[] = [spec.sideEffect, ...(spec.alsoGates ?? [])];
  const primary = spec.sideEffect;

  if (!g.allowedNames.has(spec.name)) return { decision: "deny", sideEffect: primary, reason: `tool ${spec.name} is not in this role's tool list` };
  if (classes.includes("board")) return { decision: "deny", sideEffect: "board", reason: "board-only action; a human does this in the treasury screen" };

  const p = merged(g.config, g.role);
  if (p.quiet_hours && classes.some((c) => p.quiet_hours!.block.includes(c)) && inQuietHours(p.quiet_hours, now)) {
    return { decision: "park", sideEffect: primary, reason: `quiet hours (${p.quiet_hours.from}–${p.quiet_hours.to} ${p.quiet_hours.tz}) block ${primary}` };
  }
  if (spec.alwaysApprove) return { decision: "approve", sideEffect: primary, reason: `${spec.name} always needs the board` };

  let result: Decision = "allow";
  let reason = "no external side effect";
  let holdRef: string | undefined;
  let amount: number | undefined;

  for (const c of classes) {
    if (c === "read" || c === "write") continue;
    if (c === "hire") {
      result = stricter(result, p.hire!.default);
      reason = "changes the organisation";
    }
    if (c === "publish") {
      result = stricter(result, p.publish!.default);
      reason = "public content";
    }
    if (c === "deploy") {
      const env = String(input.env ?? "preview");
      result = stricter(result, env === "prod" ? p.deploy!.prod : p.deploy!.preview);
      reason = `deploy to ${env}`;
    }
    if (c === "send") {
      const targets = ([] as string[]).concat((input.to as string[] | string) ?? [], (input.to_urn as string) ?? []).filter(Boolean);
      const firstContact = targets.length === 0 || targets.some((t) => !knownContact(g.companyId, String(t)));
      result = stricter(result, firstContact ? p.send!.first_contact : p.send!.reply);
      reason = firstContact ? "first contact with a new recipient" : "reply in an existing thread";
    }
    if (c === "spend") {
      amount = amountOf(input);
      const vendor = hostOf(String(input.vendor ?? input.url ?? spec.name.split(".")[0]));
      const block = p.spend!.merchants!.block!.map(hostOf);
      const allow = p.spend!.merchants!.allow!.map(hostOf);
      if (block.some((b) => vendor.endsWith(b))) return { decision: "deny", sideEffect: "spend", reason: `vendor ${vendor} is blocked by policy` };
      const account = ledger.walletAccount(g.agentId);
      const avail = ledger.available(g.companyId, account);
      if (amount > avail) return { decision: "deny", sideEffect: "spend", reason: `wallet has ${avail} available, needs ${amount}`, amount };
      const threshold = g.config.treasury.approval_threshold * 100;
      const perTx = (g.role.budget.per_tx ?? Number.MAX_SAFE_INTEGER) * 100;
      const under = amount <= threshold && amount <= perTx;
      let d: Decision = under ? p.spend!.under_threshold! : p.spend!.otherwise!;
      if (p.spend!.strict && allow.length && !allow.some((a) => vendor.endsWith(a))) d = stricter(d, "approve");
      result = stricter(result, d);
      reason = under ? `${amount} under threshold` : `${amount} above threshold ${threshold}`;
      if (result === "allow" && amount > 0) holdRef = ledger.hold(g.companyId, account, amount, `hold:${spec.name}`);
    }
  }
  return { decision: result, sideEffect: primary, reason, holdRef, amount };
}
