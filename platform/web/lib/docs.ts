// Product docs: Markdown copied from docs/company by scripts/sync-docs.mjs.

import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";

const DIR = path.join(process.cwd(), "content", "docs");

export type DocPage = { slug: string[]; title: string; html: string };

const ORDER = [
  "getting-started", "playbooks/publishing", "integrations", "integrations-status", "tools", "runtime", "schema", "treasury", "erp", "voice", "group", "deploy",
  "playbooks/ugc-creators", "design-system", "ui-graph",
];

export function listDocs(): { slug: string[]; title: string }[] {
  if (!fs.existsSync(DIR)) return [];
  const out: { slug: string[]; title: string }[] = [];
  const walk = (dir: string, rel: string[]) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), [...rel, e.name]);
      else if (e.name.endsWith(".md")) {
        const slug = [...rel, e.name.replace(/\.md$/, "")];
        const first = fs.readFileSync(path.join(dir, e.name), "utf8").split("\n").find((l) => l.startsWith("# "));
        out.push({ slug, title: first ? first.slice(2).trim() : slug.join("/") });
      }
    }
  };
  walk(DIR, []);
  const rank = (s: string[]) => {
    const i = ORDER.indexOf(s.join("/"));
    return i < 0 ? 999 : i;
  };
  return out.sort((a, b) => rank(a.slug) - rank(b.slug) || a.title.localeCompare(b.title));
}

export function readDoc(slug: string[]): DocPage | null {
  const safe = slug.map((s) => s.replace(/[^a-z0-9-]/g, ""));
  const file = path.join(DIR, ...safe) + ".md";
  if (!file.startsWith(DIR) || !fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  const title = raw.split("\n").find((l) => l.startsWith("# "))?.slice(2).trim() ?? safe.join("/");
  // rewrite relative .md links to /docs routes
  const body = raw.replace(/\]\((?!https?:)([^)]+?)\.md\)/g, (_m, p: string) => `](/docs/${path.posix.normalize(path.posix.join(safe.slice(0, -1).join("/"), p)).replace(/^\.\//, "")})`);
  const html = marked.parse(body.replace(/^# .*\n/, ""), { async: false }) as string;
  return { slug: safe, title, html };
}
