// Build a role's tool set: core manifest + enabled integrations, filtered by
// the role's patterns, with wire-safe names for providers.

import { TOOLS } from "../../tools/manifest.js";
import { INTEGRATIONS, integrationById } from "../../integrations/index.js";
import { toolsFor } from "../integrations/registry.js";
import { expandPatterns, isIntegrationEnable, isMcpEnable, companyIdFor } from "../loader.js";
import { bridgedTools } from "../integrations/mcp-bridge.js";
import { coreHandlers } from "./core.js";
import type { CompanyConfig, ResolvedTool, RoleConfig } from "../types.js";
import type { ToolDef } from "../providers/types.js";

export function wireName(name: string): string {
  return name.replace(/\./g, "__").replace(/-/g, "_");
}

export type ToolSet = {
  byName: Map<string, ResolvedTool>;
  byWire: Map<string, ResolvedTool>;
  defs: ToolDef[];
  allowedNames: Set<string>;
};

export function allTools(config: CompanyConfig, companyId?: string): ResolvedTool[] {
  const out: ResolvedTool[] = TOOLS.map((spec) => ({
    spec,
    handler: coreHandlers[spec.name] ?? (async () => ({ ok: false, error: { code: "unimplemented", hint: `${spec.name} has no handler yet` } })),
  }));
  for (const en of config.integrations ?? []) {
    if (!isIntegrationEnable(en)) continue;
    const i = integrationById(en.id);
    if (!i) continue;
    out.push(...toolsFor(i, en.modes ?? i.modes.map((m) => m.id), en.side_effect));
  }
  const mcp = (config.integrations ?? []).filter(isMcpEnable);
  if (mcp.length) out.push(...bridgedTools(companyId ?? companyIdFor(config), mcp));
  return out;
}

export function toolsForRole(config: CompanyConfig, role: RoleConfig, companyId?: string): ToolSet {
  const { names } = expandPatterns(role.tools, config);
  const allowed = new Set(names);
  const byName = new Map<string, ResolvedTool>();
  const byWire = new Map<string, ResolvedTool>();
  for (const t of allTools(config, companyId)) {
    if (!allowed.has(t.spec.name)) continue;
    byName.set(t.spec.name, t);
    byWire.set(wireName(t.spec.name), t);
  }
  const defs: ToolDef[] = [...byName.values()]
    .filter((t) => !t.spec.server)
    .sort((a, b) => a.spec.name.localeCompare(b.spec.name))
    .map((t) => ({ name: wireName(t.spec.name), description: t.spec.description, input: t.spec.input as Record<string, unknown> }));
  return { byName, byWire, defs, allowedNames: allowed };
}

export function catalogue() {
  return {
    core: TOOLS.map((t) => ({ name: t.name, sideEffect: t.sideEffect, description: t.description })),
    integrations: INTEGRATIONS.map((i) => i.id),
  };
}
