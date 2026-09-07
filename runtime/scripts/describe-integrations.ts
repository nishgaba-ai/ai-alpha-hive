// Prints the docs rows for integrations straight from their definitions, so
// docs/company/tools.md, integrations.md and integrations-status.md never
// drift from the code. Run: npx tsx scripts/describe-integrations.ts [id…]
// (no ids = every integration). Output is Markdown in the merge format the
// coordinator pastes into the three docs.

import { INTEGRATIONS } from "../integrations/index.js";
import { describe } from "../src/integrations/registry.js";

const ids = process.argv.slice(2);
const list = ids.length ? INTEGRATIONS.filter((i) => ids.includes(i.id)) : INTEGRATIONS;

function inputSummary(schema: { properties?: Record<string, unknown>; required?: string[] }): string {
  const props = Object.keys(schema.properties ?? {});
  if (!props.length) return "—";
  const req = new Set(schema.required ?? []);
  return "`" + props.map((p) => (req.has(p) ? p : p + "?")).join(", ") + "`";
}

const tools: string[] = [];
const library: string[] = [];
const status: string[] = [];
for (const i of list) {
  const d = describe(i);
  tools.push(`## Integration: \`${i.id}\`\n\n| Tool | Class | Mode | Input |\n|---|---|---|---|`);
  for (const m of i.methods) {
    const cls = m.sideEffect ?? i.modes.find((x) => x.id === m.mode)?.sideEffect;
    tools.push(`| \`${i.id}.${m.name}\` | ${cls} | ${m.mode} | ${inputSummary(m.input as { properties?: Record<string, unknown>; required?: string[] })} |`);
  }
  tools.push("");
  const needs = i.secrets.filter((s) => s.required !== false).map((s) => s.name);
  const auth = d.auth.kind === "oauth2" ? `${d.auth.prefix} OAuth` : d.auth.kind === "api_key" ? "API key" : "none";
  library.push(`| \`${i.id}\` | ${i.modes.map((m) => m.id).join(", ")} | ${needs.length ? needs.join(", ") : auth === "none" ? "nothing" : auth} |`);
  status.push(`| ${i.id} | ${auth} | yes | no | ${i.description.replace(/\|/g, "/").slice(0, 110)} |`);
}
console.log("### TOOLS\n" + tools.join("\n") + "\n### LIBRARY\n" + library.join("\n") + "\n\n### STATUS\n" + status.join("\n") + "\n");
