// Export / import: the whole company (config, prompts, every table, the
// encrypted vault rows) as one JSON bundle. Move machines = export here,
// import there, carry VAULT_KEY separately. Nothing else references a host.

import fs from "node:fs";
import path from "node:path";
import { getDb, TABLES, all } from "./db.js";

export type Bundle = {
  version: 1;
  exported_at: number;
  companies: { slug: string; dir_files: Record<string, string> }[];
  tables: Record<string, Record<string, unknown>[]>;
  note: string;
};

function readDir(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["workspace", "node_modules", ".git", "data"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) Object.assign(out, readDir(p, base));
    else out[path.relative(base, p).replace(/\\/g, "/")] = fs.readFileSync(p, "utf8");
  }
  return out;
}

export function exportBundle(companyDirs: { slug: string; dir: string }[]): Bundle {
  const tables: Bundle["tables"] = {};
  for (const t of TABLES) tables[t] = all<Record<string, unknown>>(`SELECT * FROM ${t}`);
  return {
    version: 1,
    exported_at: Date.now(),
    companies: companyDirs.map((c) => ({ slug: c.slug, dir_files: readDir(c.dir) })),
    tables,
    note: "Secrets are included encrypted; the importing machine needs the same VAULT_KEY. Workspaces (git checkouts) are not included — clone them again.",
  };
}

export function importBundle(bundle: Bundle, targetRoot: string): { dirs: string[]; rows: number } {
  if (bundle.version !== 1) throw new Error("unsupported bundle version");
  const dirs: string[] = [];
  for (const c of bundle.companies) {
    const dir = path.join(targetRoot, c.slug);
    for (const [rel, content] of Object.entries(c.dir_files)) {
      const p = path.join(dir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
    dirs.push(dir);
  }
  const db = getDb();
  let rows = 0;
  // Rows arrive in TABLES order, which is not FK order (agents reference
  // wallets, items reference runs); the bundle is internally consistent, so
  // suspend FK checks for the transaction and verify afterwards.
  db.pragma("foreign_keys = OFF");
  const tx = db.transaction(() => {
    for (const t of TABLES) {
      const list = bundle.tables[t] ?? [];
      for (const row of list) {
        const cols = Object.keys(row);
        db.prepare(`INSERT OR REPLACE INTO ${t} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c]));
        rows++;
      }
    }
  });
  try {
    tx();
    const violations = db.pragma("foreign_key_check") as unknown[];
    if (violations.length) throw new Error(`bundle has ${violations.length} dangling references`);
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return { dirs, rows };
}
