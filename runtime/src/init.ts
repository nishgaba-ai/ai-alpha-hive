// Scaffold a company directory from templates/companies. Used by the CLI
// (`hive company init`) and by the API (`POST /api/companies`) so the UI's
// template gallery can launch a company without a terminal.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));

export function repoRoot(): string {
  // dist/src → runtime → repo, or src → runtime → repo
  for (const up of ["../../..", "../.."]) {
    const p = path.resolve(here, up);
    if (fs.existsSync(path.join(p, "templates", "companies"))) return p;
  }
  return path.resolve(here, "../..");
}

export function templatesDir(): string {
  return path.join(repoRoot(), "templates", "companies");
}

/** Gallery presentation per template, from templates/companies/meta.json. */
export type TemplateMeta = { accent: string; icon: string; tagline: string; highlights: string[]; best_for: string };
export type TemplateTreeNode = { id: string; title: string; reports_to: string; model: string; count?: number };
export type TemplateTeam = { id: string; lead: string; members: string[] };
export type TemplateInfo = TemplateMeta & {
  id: string;
  name: string;
  mission: string;
  roles: { id: string; title: string }[];
  integrations: string[];
  blurb: string;
  currency: string;
  monthly_cap: number;
  /** Reporting tree derived from roles' reports_to (board is implicit). */
  tree: TemplateTreeNode[];
  teams: TemplateTeam[];
};

const DEFAULT_META: TemplateMeta = { accent: "#6c5ce7", icon: "◇", tagline: "", highlights: [], best_for: "" };

function readMeta(dir: string): Record<string, Partial<TemplateMeta>> {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, Partial<TemplateMeta>>) : {};
  } catch {
    return {};
  }
}

function metaFor(all: Record<string, Partial<TemplateMeta>>, id: string): TemplateMeta {
  const m = all[id] ?? {};
  return {
    accent: typeof m.accent === "string" && m.accent ? m.accent : DEFAULT_META.accent,
    icon: typeof m.icon === "string" && m.icon ? m.icon : DEFAULT_META.icon,
    tagline: typeof m.tagline === "string" ? m.tagline : DEFAULT_META.tagline,
    highlights: Array.isArray(m.highlights) ? m.highlights.filter((h): h is string => typeof h === "string") : DEFAULT_META.highlights,
    best_for: typeof m.best_for === "string" ? m.best_for : DEFAULT_META.best_for,
  };
}

// Loose shape of a template yaml; only the keys the gallery reads.
type TemplateDoc = {
  company?: { name?: unknown; mission?: unknown; currency?: unknown };
  treasury?: { monthly_cap?: unknown };
  roles?: { id?: unknown; title?: unknown; reports_to?: unknown; model?: unknown; count?: unknown }[];
  teams?: { id?: unknown; lead?: unknown; members?: unknown }[];
  integrations?: { id?: unknown }[];
};

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback);

export function listTemplates(): TemplateInfo[] {
  const dir = templatesDir();
  const meta = readMeta(dir);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => {
      const id = f.replace(".yaml", "");
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      const blurb = text.split("\n").filter((l) => l.startsWith("#")).slice(1).map((l) => l.replace(/^#\s?/, "")).join(" ").split("  ")[0].trim();
      let doc: TemplateDoc = {};
      try {
        const parsed = parseYaml(text) as unknown;
        if (parsed && typeof parsed === "object") doc = parsed as TemplateDoc;
      } catch {
        /* keep the template listed even if the yaml is mid-edit */
      }
      const roleDocs = Array.isArray(doc.roles) ? doc.roles.filter((r) => r && typeof r === "object" && typeof r.id === "string") : [];
      const tree: TemplateTreeNode[] = roleDocs.map((r) => {
        const count = Number(r.count);
        const node: TemplateTreeNode = { id: str(r.id), title: str(r.title, str(r.id)), reports_to: str(r.reports_to, "board"), model: str(r.model) };
        if (Number.isFinite(count) && count > 1) node.count = count;
        return node;
      });
      const teams: TemplateTeam[] = (Array.isArray(doc.teams) ? doc.teams : [])
        .filter((t) => t && typeof t === "object" && typeof t.id === "string")
        .map((t) => ({ id: str(t.id), lead: str(t.lead), members: Array.isArray(t.members) ? t.members.map((m) => str(m)).filter(Boolean) : [] }));
      const integrations = (Array.isArray(doc.integrations) ? doc.integrations : []).map((i) => str(i?.id)).filter(Boolean);
      return {
        id,
        name: str(doc.company?.name, f),
        mission: str(doc.company?.mission),
        currency: str(doc.company?.currency, "INR"),
        monthly_cap: Number(doc.treasury?.monthly_cap ?? 0) || 0,
        roles: tree.map((r) => ({ id: r.id, title: r.title })),
        integrations,
        blurb,
        tree,
        teams,
        ...metaFor(meta, id),
      };
    });
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function scaffoldCompany(template: string, name: string, dir: string, opts: { mission?: string; boardEmail?: string; model?: string } = {}): string {
  const src = path.join(templatesDir(), `${template}.yaml`);
  if (!fs.existsSync(src)) throw new Error(`no template ${template}`);
  if (fs.existsSync(path.join(dir, "company.yaml"))) throw new Error(`${dir} already has a company.yaml`);
  const slug = slugify(name);
  fs.mkdirSync(path.join(dir, "roles"), { recursive: true });
  let yaml = fs.readFileSync(src, "utf8");
  yaml = yaml.replace(/^(\s*name:\s*).*$/m, `$1"${name}"`).replace(/^(\s*slug:\s*).*$/m, `$1${slug}`);
  if (opts.mission) yaml = yaml.replace(/^(\s*mission:\s*).*$/m, `$1"${opts.mission.replace(/"/g, "'")}"`);
  if (opts.boardEmail) yaml = yaml.replace(/you@example\.com/g, opts.boardEmail);
  if (opts.model) yaml = yaml.replace(/model: [^\n]+/g, `model: ${opts.model}`).replace("harness: agent-sdk", opts.model === "claude-code" ? "harness: agent-sdk" : "harness: api").replace("workspace: true", opts.model === "claude-code" ? "workspace: true" : "workspace: false");
  fs.writeFileSync(path.join(dir, "company.yaml"), yaml);
  const rolesSrc = path.join(templatesDir(), "roles");
  for (const m of yaml.matchAll(/prompt:\s*roles\/([\w-]+)\.md/g)) {
    const f = path.join(rolesSrc, `${m[1]}.md`);
    if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dir, "roles", `${m[1]}.md`));
  }
  fs.mkdirSync(path.join(dir, "workspace"), { recursive: true });
  return slug;
}
