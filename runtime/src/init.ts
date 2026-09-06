// Scaffold a company directory from templates/companies. Used by the CLI
// (`hive company init`) and by the API (`POST /api/companies`) so the UI's
// template gallery can launch a company without a terminal.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export type TemplateInfo = { id: string; name: string; mission: string; roles: { id: string; title: string }[]; integrations: string[]; blurb: string; currency: string; monthly_cap: number };

export function listTemplates(): TemplateInfo[] {
  const dir = templatesDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      const blurb = text.split("\n").filter((l) => l.startsWith("#")).slice(1).map((l) => l.replace(/^#\s?/, "")).join(" ").split("  ")[0].trim();
      const roles = [...text.matchAll(/^\s*- id: ([\w-]+)\n\s*title: (.+)$/gm)].map((m) => ({ id: m[1], title: m[2].trim() }));
      const integrations = [...text.matchAll(/^\s*- id: ([\w-]+)\n\s*modes:/gm)].map((m) => m[1]);
      return {
        id: f.replace(".yaml", ""),
        name: /^\s*name: "?([^"\n]+)"?$/m.exec(text)?.[1] ?? f,
        mission: /^\s*mission: "?([^"\n]+)"?$/m.exec(text)?.[1] ?? "",
        currency: /^\s*currency: (\w+)/m.exec(text)?.[1] ?? "INR",
        monthly_cap: Number(/^\s*monthly_cap: (\d+)/m.exec(text)?.[1] ?? 0),
        roles,
        integrations,
        blurb,
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
