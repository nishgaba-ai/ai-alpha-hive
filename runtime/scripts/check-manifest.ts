// Asserts docs/company/tools.md, tools/manifest.ts and integrations/ agree,
// and that every tool pattern in templates/companies/*.yaml resolves.
// Run: npm run check:manifest (from runtime/). Exits 1 on any drift.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import YAML from "yaml";
import { TOOLS } from "../tools/manifest.js";
import { INTEGRATIONS } from "../integrations/index.js";
import { expandPatterns } from "../src/loader.js";
import type { CompanyConfig } from "../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const doc = readFileSync(path.join(here, "..", "..", "docs", "company", "tools.md"), "utf8");

const documented = new Set<string>();
for (const m of doc.matchAll(/^\|\s*`([a-z][a-z0-9.\-_*]*)`(?:\s*\/\s*`([a-z][a-z0-9.\-_]*)`)?\s*\|/gm)) {
  documented.add(m[1]);
  if (m[2]) documented.add(m[2]);
}

const coded = new Set<string>(TOOLS.map((t) => t.name));
for (const i of INTEGRATIONS) for (const m of i.methods) coded.add(`${i.id}.${m.name}`);

const missingInCode = [...documented].filter((n) => !coded.has(n) && !n.includes("*"));
const missingInDocs = [...coded].filter((n) => !documented.has(n));

const templatesDir = path.join(here, "..", "..", "templates", "companies");
const badPatterns: string[] = [];
for (const file of readdirSync(templatesDir).filter((f) => f.endsWith(".yaml"))) {
  const config = YAML.parse(readFileSync(path.join(templatesDir, file), "utf8")) as CompanyConfig;
  for (const role of config.roles) {
    const { unknown } = expandPatterns(role.tools, config);
    for (const u of unknown) badPatterns.push(`${file} role ${role.id}: ${u}`);
  }
}

if (missingInCode.length || missingInDocs.length || badPatterns.length) {
  if (missingInCode.length) console.error("documented but not in manifest/integrations:", missingInCode.join(", "));
  if (missingInDocs.length) console.error("in manifest/integrations but not documented:", missingInDocs.join(", "));
  if (badPatterns.length) console.error("template tool patterns matching nothing:", badPatterns.join("; "));
  process.exit(1);
}
console.log(`ok: ${TOOLS.length} core tools + ${coded.size - TOOLS.length} integration tools match docs; template patterns resolve`);
