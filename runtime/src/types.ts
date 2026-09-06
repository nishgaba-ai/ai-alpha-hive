// Shared types for the company runtime. company.yaml → CompanyConfig;
// tables → the *Row types; tools → ToolSpec (tools/manifest.ts) + handlers.

import type { SideEffect, ToolSpec } from "../tools/manifest.js";
export type { SideEffect, ToolSpec };

export type Decision = "allow" | "approve" | "deny";

export type Policies = {
  spend?: {
    under_threshold?: Decision;
    otherwise?: Decision;
    strict?: boolean;
    merchants?: { allow?: string[]; block?: string[] };
  };
  send?: { first_contact?: Decision; reply?: Decision };
  publish?: { default?: Decision };
  deploy?: { preview?: Decision; prod?: Decision };
  hire?: { default?: Decision };
  quiet_hours?: { tz: string; from: string; to: string; block: SideEffect[] };
};

/**
 * Model reference: "<provider>/<model>" or a bare Anthropic model id.
 *   anthropic/claude-opus-5      openrouter/meta-llama/llama-3.3-70b-instruct
 *   ollama/qwen2.5:14b           claude-code            mock
 */
export type RoleConfig = {
  id: string;
  title: string;
  harness: "api" | "agent-sdk";
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  reports_to: string;
  tools: string[];
  budget: { monthly: number; per_tx?: number; rollover?: boolean };
  card?: { allowed_categories?: string[] };
  prompt?: string;
  workspace?: boolean;
  count?: number;
  escalate?: { on: string[]; to: string };
  policies?: Policies;
};

export type ProviderConfig = {
  /** anthropic | openai-compatible | claude-code | mock */
  kind: "anthropic" | "openai-compatible" | "claude-code" | "mock";
  base_url?: string;
  /** "env:NAME" or "vault:NAME"; never a literal value */
  api_key?: string;
  /** extra headers, e.g. OpenRouter attribution */
  headers?: Record<string, string>;
};

export type IntegrationEnable = {
  id: string;
  modes?: string[];
  /** optional override of the side-effect class for every method (stricter only) */
  side_effect?: SideEffect;
};

export type McpEnable = {
  mcp: string;
  name: string;
  side_effect: SideEffect;
  overrides?: Record<string, SideEffect>;
};

export type CompanyConfig = {
  company: {
    name: string;
    slug: string;
    mission: string;
    currency: string;
    board: { email: string; role: "owner" | "admin" }[];
    workspace?: { repo?: string; hive_project?: string; path?: string };
    concurrency?: number;
  };
  treasury: {
    monthly_cap: number;
    approval_threshold: number;
    reserve?: number;
    card_provider?: "none" | "stripe-issuing";
  };
  policies: Policies;
  providers?: { default?: string } & Record<string, ProviderConfig | string | undefined>;
  roles: RoleConfig[];
  teams?: { id: string; lead: string; members: string[] }[];
  automations?: { id: string; every: string; at?: string; mission: string; enabled?: boolean }[];
  voice?: { stt?: string; tts?: string; voice_id?: string };
  integrations?: (IntegrationEnable | McpEnable | { module: string; secrets?: string[] })[];
};

export type LoadedCompany = {
  dir: string;
  config: CompanyConfig;
  yamlText: string;
  yamlHash: string;
  /** role id → prompt markdown */
  prompts: Record<string, string>;
};

// ------------------------------------------------------------------ rows

export type CompanyRow = {
  id: string;
  org_id: string | null;
  slug: string;
  name: string;
  mission: string;
  currency: string;
  yaml_hash: string;
  status: "draft" | "running" | "paused" | "archived";
  created_at: number;
};

export type RoleRow = {
  id: string;
  company_id: string;
  role_key: string;
  title: string;
  harness: string;
  model: string;
  effort: string;
  reports_to: string;
  tools_json: string;
  budget_json: string;
  prompt: string;
};

export type AgentRow = {
  id: string;
  company_id: string;
  role_id: string;
  role_key: string;
  name: string;
  status: "idle" | "running" | "parked" | "suspended";
  wallet_id: string;
  created_at: number;
};

export type TaskRow = {
  id: string;
  company_id: string;
  parent_id: string | null;
  mission_id: string | null;
  key: string | null;
  title: string;
  intent: string;
  acceptance: string;
  owner_role: string;
  owner_agent_id: string | null;
  status: "planned" | "ready" | "running" | "parked" | "done" | "failed" | "cancelled";
  budget_cap: number;
  priority: number;
  notes: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
};

export type RunRow = {
  id: string;
  company_id: string;
  task_id: string;
  agent_id: string;
  status: "running" | "parked" | "done" | "failed" | "interrupted";
  started_at: number;
  ended_at: number | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_minor: number;
  turns: number;
  state_json: string | null;
  outcome_json: string | null;
};

export type EventRow = {
  id: string;
  seq: number;
  company_id: string;
  run_id: string | null;
  agent_id: string | null;
  ts: number;
  type: string;
  payload_json: string;
};

export type ApprovalRow = {
  id: string;
  company_id: string;
  run_id: string;
  agent_id: string;
  tool: string;
  side_effect: string;
  request_json: string;
  status: "pending" | "approved" | "denied" | "expired";
  decided_by: string | null;
  decided_at: number | null;
  reason: string | null;
  created_at: number;
};

export type WalletRow = {
  id: string;
  company_id: string;
  owner_type: "company" | "agent" | "system";
  owner_id: string;
  currency: string;
  card_id: string | null;
};

// -------------------------------------------------------------- tool exec

export type SecretResolver = {
  get(name: string): string | undefined;
  names(): string[];
};

export type ToolContext = {
  company: CompanyRow;
  config: CompanyConfig;
  companyDir: string;
  agent: AgentRow;
  role: RoleRow;
  run: RunRow;
  secrets: SecretResolver;
  emit(type: string, payload: Record<string, unknown>): void;
};

export type ToolResult = { ok: boolean; [k: string]: unknown };
export type ToolHandler = (ctx: ToolContext, input: Record<string, unknown>) => Promise<ToolResult>;

export type ResolvedTool = { spec: ToolSpec; handler: ToolHandler; integration?: string; mode?: string };
