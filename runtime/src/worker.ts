// The worker: loads one company or a whole group (a directory of company
// directories), syncs them to the control plane, then runs the scheduler,
// the API server and the Telegram bridge until stopped.

import fs from "node:fs";
import path from "node:path";
import { openDb } from "./db.js";
import { readCompany, syncCompany } from "./loader.js";
import { Registry } from "./registry.js";
import { recover, startScheduler } from "./scheduler.js";
import { startServer } from "./server.js";
import { startTelegram } from "./telegram.js";
import { vaultConfigured } from "./vault.js";
import { emit } from "./bus.js";
import { connectMcp, closeMcp } from "./integrations/mcp-bridge.js";
import { isMcpEnable } from "./loader.js";
import { resolver } from "./vault.js";
import type { Entry } from "./registry.js";

export type WorkerOptions = { companyDirs: string[]; port?: number; once?: boolean; noServer?: boolean; companiesRoot?: string };

export function discoverCompanies(root: string): string[] {
  if (fs.existsSync(path.join(root, "company.yaml"))) return [root];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, "company.yaml")))
    .map((e) => path.join(root, e.name));
}

export async function startWorker(opts: WorkerOptions): Promise<{ registry: Registry; stop: () => void }> {
  openDb();
  if (!vaultConfigured()) console.warn("[worker] VAULT_KEY not set — secrets cannot be read; integrations will fail closed");
  const registry = new Registry();
  for (const dir of opts.companyDirs) {
    const loaded = readCompany(dir);
    const company = syncCompany(loaded);
    registry.add({ company, loaded, deps: { company, config: loaded.config, companyDir: dir } });
    recover(registry.bySlug(company.slug)!.deps);
    await warmBridges(registry.bySlug(company.slug)!);
    emit(company.id, "company.started", { slug: company.slug, roles: loaded.config.roles.length });
    console.log(`[worker] ${company.name} (${company.slug}) — ${loaded.config.roles.length} roles, status ${company.status}`);
  }
  const stops: (() => void)[] = [];
  if (!opts.once) stops.push(startScheduler(() => registry.all().map((e) => e.deps)));
  if (!opts.noServer) {
    const port = opts.port ?? Number(process.env.HIVE_API_PORT ?? 4700);
    const server = startServer(registry, port, { companiesRoot: opts.companiesRoot, onReload: (slug) => { const e = registry.bySlug(slug); if (e) warmBridges(e).catch(() => {}); } });
    stops.push(() => server.close());
    console.log(`[worker] API on http://localhost:${port}/api`);
  }
  stops.push(startTelegram(registry));
  stops.push(() => { for (const e of registry.all()) closeMcp(e.company.id).catch(() => {}); });
  return { registry, stop: () => stops.forEach((s) => s()) };
}

/** Connect every MCP bridge the company declares so its tools are known before the first run. Failures are logged, never fatal. */
export async function warmBridges(e: Entry): Promise<void> {
  const entries = (e.loaded.config.integrations ?? []).filter(isMcpEnable);
  if (!entries.length) return;
  await closeMcp(e.company.id);
  const secrets = resolver(e.company.id);
  for (const en of entries) {
    const c = await connectMcp(e.company.id, en, secrets, e.loaded.dir);
    if (c.error) console.warn(`[worker] ${e.company.slug}: MCP "${en.name}" failed: ${c.error}`);
    else console.log(`[worker] ${e.company.slug}: MCP "${en.name}" — ${c.tools.length} tools`);
  }
}
