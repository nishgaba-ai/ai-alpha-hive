// Validates every template and every committed company against the schema
// and the loader rules (unknown tool patterns, unknown integration modes,
// budgets over cap, reporting cycles). Run: npm run check:templates
// (from runtime/). Exits 1 on the first file with problems.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import YAML from "yaml";
import { validateConfig } from "../src/loader.js";
import type { CompanyConfig } from "../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const templates = path.join(repo, "templates", "companies");
const companies = path.join(repo, "companies");

const files = [
  ...readdirSync(templates).filter((f) => f.endsWith(".yaml")).map((f) => path.join(templates, f)),
  ...(existsSync(companies) ? readdirSync(companies).map((d) => path.join(companies, d, "company.yaml")).filter((f) => existsSync(f)) : []),
];

let bad = 0;
for (const f of files) {
  const rel = path.relative(repo, f).replace(/\\/g, "/");
  try {
    const problems = validateConfig(YAML.parse(readFileSync(f, "utf8")) as CompanyConfig);
    if (problems.length) {
      bad++;
      console.error(`${rel}:\n  - ${problems.join("\n  - ")}`);
    } else console.log(`ok  ${rel}`);
  } catch (e) {
    bad++;
    console.error(`${rel}: ${(e as Error).message}`);
  }
}
if (bad) process.exit(1);
console.log(`ok: ${files.length} company files validate`);
