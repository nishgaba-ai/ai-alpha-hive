// Git-based blog: Markdown files with front matter under content/blog/.
// The `blog` integration commits them; Vercel deploys; this reads them.

import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";

export type Post = { slug: string; title: string; description: string; date: string; author: string; tags: string[]; html: string; excerpt: string };

const DIR = path.join(process.cwd(), "content", "blog");

function parseFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = JSON.parse(v);
    meta[k] = v;
  }
  return { meta, body: m[2] };
}

function tags(v: string | undefined): string[] {
  if (!v) return [];
  try {
    const arr = JSON.parse(v.replace(/^\[/, "[").replace(/\]$/, "]"));
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return v.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
  }
}

export function listPosts(): Post[] {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => /\.mdx?$/.test(f))
    .map((f) => readPost(f.replace(/\.mdx?$/, "")))
    .filter((p): p is Post => p !== null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function readPost(slug: string): Post | null {
  const safe = slug.replace(/[^a-z0-9-]/g, "");
  const file = [".md", ".mdx"].map((e) => path.join(DIR, safe + e)).find((p) => fs.existsSync(p));
  if (!file) return null;
  const { meta, body } = parseFrontMatter(fs.readFileSync(file, "utf8"));
  const html = marked.parse(body, { async: false }) as string;
  const text = body.replace(/[#*_`>\[\]()]/g, "").replace(/\s+/g, " ").trim();
  return {
    slug: safe,
    title: meta.title ?? safe,
    description: meta.description ?? "",
    date: meta.date ?? "",
    author: meta.author ?? "Prodigal AI",
    tags: tags(meta.tags),
    html,
    excerpt: text.slice(0, 200),
  };
}
