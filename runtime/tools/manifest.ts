// Tool contracts for the company runtime.
//
// This file is the code form of docs/company/tools.md. Every tool an agent
// can call is declared here with a strict JSON schema and a side-effect
// class the gate enforces. Harnesses build their Anthropic tool lists from
// this manifest filtered by the role's `tools:` patterns; the gate reads
// `sideEffect` before any wrapper runs. A test asserts that every name in
// docs/company/tools.md appears here and vice versa.

import type Anthropic from "@anthropic-ai/sdk";

export type SideEffect =
  | "read"
  | "write"
  | "spend"
  | "send"
  | "publish"
  | "deploy"
  | "hire"
  | "board";

export type ToolSpec = {
  name: string;
  description: string;
  sideEffect: SideEffect;
  /** Secondary class: e.g. ads launch is publish AND spend. */
  alsoGates?: SideEffect[];
  /** When true the gate parks for the board regardless of thresholds. */
  alwaysApprove?: boolean;
  /**
   * Anthropic server tool this maps to. The harness emits the server tool
   * block (with the company's domain lists) instead of a custom tool; the
   * gate still sees the call by this name.
   */
  server?: "web_search_20260209" | "web_fetch_20260209";
  input: Anthropic.Tool.InputSchema;
};

const money = {
  amount: { type: "integer", description: "Amount in minor units (paise, cents)" },
  currency: { type: "string", description: "ISO 4217, must equal the company currency" },
} as const;

const reason = {
  reason: { type: "string", description: "One or two sentences the board will read in the approvals inbox" },
} as const;

function strict(
  properties: Record<string, unknown>,
  required: string[] = Object.keys(properties),
): Anthropic.Tool.InputSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

export const TOOLS: ToolSpec[] = [
  // ---------------------------------------------------------------- hive.*
  {
    name: "hive.new",
    description: "Scaffold a new hive project from a template inside the company workspace.",
    sideEffect: "write",
    input: strict({
      template: { type: "string", enum: ["marketing"] },
      name: { type: "string" },
      intent: { type: "string" },
    }),
  },
  {
    name: "hive.check",
    description: "Run policy gates on the current project and return machine-readable findings.",
    sideEffect: "read",
    input: strict({ gate: { type: "string", description: "Run a single gate; omit for all" } }, []),
  },
  {
    name: "hive.ship",
    description: "Gates then deploy. The only path to a live URL. Preview is allowed; prod parks for the board.",
    sideEffect: "deploy",
    input: strict({ env: { type: "string", enum: ["preview", "prod"] }, ...reason }),
  },
  {
    name: "hive.graph_impact",
    description: "Blast radius of a change to a component, page, intent or module.",
    sideEffect: "read",
    input: strict({ node: { type: "string" } }),
  },
  {
    name: "hive.intent_get",
    description: "Read the project's declared intent (hive.yaml).",
    sideEffect: "read",
    input: strict({}),
  },
  {
    name: "hive.intent_set",
    description: "Patch hive.yaml. Every new page needs an intent.",
    sideEffect: "write",
    input: strict({ patch: { type: "object", additionalProperties: true } }),
  },

  // ---------------------------------------------------------- organisation
  {
    name: "task.plan",
    description: "Write the task DAG for a mission in one transaction. CEO only.",
    sideEffect: "write",
    input: strict({
      mission: { type: "string" },
      tasks: {
        type: "array",
        items: strict({
          key: { type: "string" },
          title: { type: "string" },
          intent: { type: "string" },
          acceptance: { type: "string" },
          owner_role: { type: "string" },
          depends_on: { type: "array", items: { type: "string" } },
          budget_cap: { type: "integer", description: "Minor units" },
          priority: { type: "integer", minimum: 1, maximum: 5 },
        }),
      },
    }),
  },
  {
    name: "task.create",
    description: "Create one task inside your team.",
    sideEffect: "write",
    input: strict({
      title: { type: "string" },
      intent: { type: "string" },
      acceptance: { type: "string" },
      owner_role: { type: "string" },
      depends_on: { type: "array", items: { type: "string" } },
      budget_cap: { type: "integer" },
    }),
  },
  {
    name: "task.update",
    description: "Update a task you own or lead: status, notes, acceptance.",
    sideEffect: "write",
    input: strict(
      {
        task_id: { type: "string" },
        status: { type: "string", enum: ["ready", "running", "done", "failed", "cancelled"] },
        notes: { type: "string" },
        acceptance: { type: "string" },
      },
      ["task_id"],
    ),
  },
  {
    name: "task.list",
    description: "List tasks, optionally filtered.",
    sideEffect: "read",
    input: strict({ status: { type: "string" }, owner: { type: "string" } }, []),
  },
  {
    name: "task.handoff",
    description: "Hand a task to another role with a note.",
    sideEffect: "write",
    input: strict({ task_id: { type: "string" }, to_role: { type: "string" }, note: { type: "string" } }),
  },
  {
    name: "agent.list",
    description: "List agents in the company with status and role.",
    sideEffect: "read",
    input: strict({}),
  },
  {
    name: "agent.hire",
    description: "Request a new agent beyond the plan. Always parks for the board.",
    sideEffect: "hire",
    alwaysApprove: true,
    input: strict({ role_key: { type: "string" }, name: { type: "string" }, ...reason }),
  },
  {
    name: "agent.suspend",
    description: "Request suspension of an agent. Parks for the board.",
    sideEffect: "hire",
    alwaysApprove: true,
    input: strict({ agent_id: { type: "string" }, ...reason }),
  },
  {
    name: "message.send",
    description: "Message another agent, or the board. Board messages appear in the inbox.",
    sideEffect: "write",
    input: strict(
      { to: { type: "string", description: "agent id or 'board'" }, body: { type: "string" }, thread_id: { type: "string" } },
      ["to", "body"],
    ),
  },
  {
    name: "message.read",
    description: "Read a thread or your unread messages.",
    sideEffect: "read",
    input: strict({ thread_id: { type: "string" }, unread: { type: "boolean" } }, []),
  },
  {
    name: "report.weekly",
    description: "Write the weekly finance and outcomes report as an artifact and notify the board.",
    sideEffect: "write",
    input: strict({ period: { type: "string", description: "ISO week, e.g. 2026-W36" } }),
  },
  {
    name: "artifact.save",
    description: "Record an output of this run.",
    sideEffect: "write",
    input: strict({
      kind: { type: "string", enum: ["file", "url", "post", "pr", "report", "campaign"] },
      ref: { type: "string" },
      meta: { type: "object", additionalProperties: true },
    }),
  },

  // ------------------------------------------------------------ web (server)
  {
    name: "web.search",
    description: "Search the web within the company's allowed domains (Anthropic server tool).",
    sideEffect: "read",
    server: "web_search_20260209",
    input: strict({ query: { type: "string" } }),
  },
  {
    name: "web.fetch",
    description: "Fetch a URL already present in the conversation, within allowed domains (Anthropic server tool).",
    sideEffect: "read",
    server: "web_fetch_20260209",
    input: strict({ url: { type: "string" } }),
  },

  // Communication, marketing and content tools (email.*, linkedin.*, slack.*,
  // ads-meta.*, ga4.*, search-console.*, content.*) are contributed by
  // integrations/ plugins when a company enables them — see
  // src/integrations/registry.ts and docs/company/integrations.md.

  // --------------------------------------------------------------- treasury
  {
    name: "wallet.read",
    description: "Balance, holds and month-to-date spend for a wallet (yours by default).",
    sideEffect: "read",
    input: strict({ wallet_id: { type: "string" } }, []),
  },
  {
    name: "wallet.transfer",
    description: "Move budget between agent wallets. Parks for the board.",
    sideEffect: "hire",
    alwaysApprove: true,
    input: strict({ to_wallet: { type: "string" }, ...money, ...reason }),
  },
  {
    name: "card.request",
    description: "Request a virtual card with limits. Parks for the board; the worker issues it with spending controls.",
    sideEffect: "hire",
    alwaysApprove: true,
    input: strict({
      purpose: { type: "string" },
      per_tx: { type: "integer" },
      monthly: { type: "integer" },
      categories: { type: "array", items: { type: "string" } },
    }),
  },
  {
    name: "card.freeze",
    description: "Freeze your own card. Always allowed.",
    sideEffect: "write",
    input: strict({ card_id: { type: "string" } }),
  },
  {
    name: "card.purchase",
    description: "Place a hold to buy from a vendor. The gate allows under threshold and parks otherwise.",
    sideEffect: "spend",
    input: strict({ vendor: { type: "string" }, ...money, url: { type: "string" }, ...reason }, ["vendor", "amount", "currency", "reason"]),
  },
  {
    name: "card.transactions",
    description: "List card transactions for a period.",
    sideEffect: "read",
    input: strict({ period: { type: "string" } }),
  },
  {
    name: "payment-link.create",
    description: "Create a payment link (Razorpay for INR, Stripe Checkout otherwise).",
    sideEffect: "write",
    input: strict(
      { ...money, description: { type: "string" }, customer_email: { type: "string" } },
      ["amount", "currency", "description"],
    ),
  },
  {
    name: "payment-link.send",
    description: "Send a payment link to a customer.",
    sideEffect: "send",
    input: strict({ link_id: { type: "string" }, to: { type: "string" }, message: { type: "string" } }),
  },
  {
    name: "treasury.fund",
    description: "Board only: fund the company balance.",
    sideEffect: "board",
    input: strict({ ...money }),
  },
  {
    name: "treasury.raise_cap",
    description: "Board only: raise a wallet or company cap.",
    sideEffect: "board",
    input: strict({ wallet_id: { type: "string" }, monthly: { type: "integer" } }),
  },

  // ---------------------------------------------------------- infrastructure
  {
    name: "infra.targets",
    description: "Launch targets configured for this company.",
    sideEffect: "read",
    input: strict({}),
  },
  {
    name: "infra.secret.set",
    description: "Store a secret by name. Write-only; the value is redacted from the transcript.",
    sideEffect: "write",
    input: strict({ name: { type: "string" }, value: { type: "string" } }),
  },
  {
    name: "infra.secret.list",
    description: "Names of stored secrets.",
    sideEffect: "read",
    input: strict({}),
  },
  {
    name: "infra.domain.search",
    description: "Check domain availability and price.",
    sideEffect: "read",
    input: strict({ name: { type: "string" } }),
  },
  {
    name: "infra.domain.buy",
    description: "Buy a domain. Spend-gated.",
    sideEffect: "spend",
    input: strict({ name: { type: "string" }, years: { type: "integer", minimum: 1 }, ...reason }),
  },
  {
    name: "infra.dns.set",
    description: "Set a DNS record on a company domain.",
    sideEffect: "write",
    input: strict({ domain: { type: "string" }, record: { type: "object", additionalProperties: true } }),
  },
  {
    name: "github.pr.open",
    description: "Open a pull request.",
    sideEffect: "write",
    input: strict({ repo: { type: "string" }, branch: { type: "string" }, title: { type: "string" }, body: { type: "string" } }),
  },
  {
    name: "github.pr.merge",
    description: "Merge a pull request. Parks for the board when the target is the production branch.",
    sideEffect: "deploy",
    input: strict({ pr: { type: "string" }, ...reason }),
  },
  {
    name: "github.issue.create",
    description: "Open an issue.",
    sideEffect: "write",
    input: strict({ repo: { type: "string" }, title: { type: "string" }, body: { type: "string" } }),
  },
  {
    name: "github.repo.create",
    description: "Create a repository. Parks for the board.",
    sideEffect: "hire",
    alwaysApprove: true,
    input: strict({ name: { type: "string" }, private: { type: "boolean" } }),
  },
];

/** Match a role's tool patterns (`linkedin.*`, `wallet.read`) against the catalogue. */
export function toolsForPatterns(patterns: string[]): ToolSpec[] {
  const matchers = patterns.map((p) => {
    if (p.endsWith(".*")) {
      const prefix = p.slice(0, -1);
      return (name: string) => name.startsWith(prefix);
    }
    return (name: string) => name === p;
  });
  return TOOLS.filter((t) => matchers.some((m) => m(t.name)));
}

/** Fail closed: any pattern that matches nothing is a load error. */
export function unknownPatterns(patterns: string[]): string[] {
  return patterns.filter((p) => toolsForPatterns([p]).length === 0);
}

/**
 * Custom Anthropic tool definitions for a role, sorted for a stable cache
 * prefix. Server tools (`server` set) are excluded here; the harness adds
 * them as server tool blocks with the company's domain lists.
 */
export function toAnthropicTools(specs: ToolSpec[]): Anthropic.Tool[] {
  return [...specs]
    .filter((t) => !t.server)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({
      name: t.name.replace(/[.-]/g, "_"),
      description: t.description,
      input_schema: t.input,
      strict: true,
    }));
}

/** Reverse of the name mangling above, for the gate and wrappers. */
export function specByWireName(wire: string): ToolSpec | undefined {
  return TOOLS.find((t) => t.name.replace(/[.-]/g, "_") === wire);
}
