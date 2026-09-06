// Integration plugin contract. An integration is a folder under
// runtime/integrations/<id>/ exporting defineIntegration({...}). It declares:
//   - secrets it needs (names + how to obtain them; values live in the vault)
//   - modes: named permission bundles (read / publish / outreach ...), each
//     with a side-effect class the gate enforces
//   - methods: the tools agents call, each belonging to one mode
//   - guidance: markdown the UI shows when enabling it
// A company enables an integration in specific modes; only methods in those
// modes become tools. Roles then reference them as `linkedin.*`,
// `linkedin.post`, or by mode `linkedin:publish`.

import type Anthropic from "@anthropic-ai/sdk";
import type { ResolvedTool, SideEffect, ToolContext, ToolHandler, ToolResult } from "../types.js";

export type IntegrationSecret = {
  name: string;
  description: string;
  /** URL or instructions for obtaining it */
  obtain: string;
  required?: boolean;
  /** only needed for these modes; omit = all */
  modes?: string[];
};

export type IntegrationMode = {
  id: string;
  title: string;
  description: string;
  sideEffect: SideEffect;
};

export type IntegrationMethod = {
  name: string;
  mode: string;
  description: string;
  /** defaults to the mode's side effect; may only be stricter */
  sideEffect?: SideEffect;
  alwaysApprove?: boolean;
  input: Anthropic.Tool.InputSchema;
  handler: ToolHandler;
};

/**
 * How an integration authenticates. `api_key`: the board pastes tokens
 * into the vault. `oauth2`: the runtime runs the authorize → callback →
 * token flow and stores <PREFIX>_ACCESS_TOKEN / _REFRESH_TOKEN /
 * _TOKEN_EXPIRES_AT in the vault; handlers call ensureToken() to get a
 * fresh token. `none`: no credentials.
 */
export type OAuthConfig = {
  kind: "oauth2";
  /** vault secret prefix, e.g. LINKEDIN → LINKEDIN_CLIENT_ID, LINKEDIN_ACCESS_TOKEN … */
  prefix: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** PKCE (X requires it) */
  pkce?: boolean;
  /** how client credentials go to the token endpoint */
  tokenAuth?: "basic" | "body";
  extraAuthorizeParams?: Record<string, string>;
  /** where to create the app and what to paste as the redirect URI */
  guide: string;
};
export type AuthConfig = { kind: "api_key"; guide?: string } | OAuthConfig | { kind: "none" };

export type Integration = {
  id: string;
  /** default: api_key when secrets exist, none otherwise */
  auth?: AuthConfig;
  title: string;
  description: string;
  website?: string;
  /** markdown: what it does, how to get credentials, what each mode allows */
  guidance: string;
  secrets: IntegrationSecret[];
  modes: IntegrationMode[];
  methods: IntegrationMethod[];
  /** optional: verify credentials work; never returns secret values */
  healthcheck?: (ctx: Pick<ToolContext, "secrets">) => Promise<{ ok: boolean; detail: string }>;
};

const STRICTNESS: SideEffect[] = ["read", "write", "send", "publish", "spend", "deploy", "hire", "board"];
export function stricter(a: SideEffect, b: SideEffect): SideEffect {
  return STRICTNESS.indexOf(a) >= STRICTNESS.indexOf(b) ? a : b;
}

export function defineIntegration(i: Integration): Integration {
  const modeIds = new Set(i.modes.map((m) => m.id));
  for (const m of i.methods) {
    if (!modeIds.has(m.mode)) throw new Error(`${i.id}.${m.name}: unknown mode ${m.mode}`);
    if (!/^[a-z][a-z0-9_]*$/.test(m.name)) throw new Error(`${i.id}.${m.name}: method names are snake_case`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(i.id)) throw new Error(`integration id must be kebab-case: ${i.id}`);
  return i;
}

export function strictSchema(
  properties: Record<string, unknown>,
  required: string[] = Object.keys(properties),
): Anthropic.Tool.InputSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

export function fail(code: string, hint: string, extra: Record<string, unknown> = {}): ToolResult {
  return { ok: false, error: { code, hint }, ...extra };
}

/** Tools an integration contributes for a set of enabled modes. */
export function toolsFor(i: Integration, enabledModes: string[], override?: SideEffect): ResolvedTool[] {
  const modes = new Map(i.modes.map((m) => [m.id, m]));
  return i.methods
    .filter((m) => enabledModes.includes(m.mode))
    .map((m) => {
      const mode = modes.get(m.mode)!;
      let sideEffect = m.sideEffect ? stricter(m.sideEffect, mode.sideEffect) : mode.sideEffect;
      if (override) sideEffect = stricter(sideEffect, override);
      return {
        integration: i.id,
        mode: m.mode,
        handler: m.handler,
        spec: {
          name: `${i.id}.${m.name}`,
          description: m.description,
          sideEffect,
          alwaysApprove: m.alwaysApprove,
          input: m.input,
        },
      };
    });
}

/** Secrets missing for the requested modes (names only). */
export function missingSecrets(i: Integration, modes: string[], present: Set<string>): string[] {
  return i.secrets
    .filter((s) => s.required !== false)
    .filter((s) => !s.modes || s.modes.some((m) => modes.includes(m)))
    .filter((s) => !present.has(s.name))
    .map((s) => s.name);
}

/** Public catalogue shape for the UI and CLI (no handlers). */
export function describe(i: Integration) {
  return {
    id: i.id,
    title: i.title,
    description: i.description,
    website: i.website,
    guidance: i.guidance,
    secrets: i.secrets,
    auth: i.auth ?? (i.secrets.length ? { kind: "api_key" } : { kind: "none" }),
    modes: i.modes,
    methods: i.methods.map((m) => ({
      name: `${i.id}.${m.name}`,
      mode: m.mode,
      description: m.description,
      sideEffect: m.sideEffect ?? i.modes.find((x) => x.id === m.mode)?.sideEffect,
    })),
  };
}
