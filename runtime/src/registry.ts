// In-process registry of loaded companies (a group runs under one worker).

import type { LoopDeps } from "./harness/loop.js";
import type { CompanyRow, LoadedCompany } from "./types.js";

export type Entry = { company: CompanyRow; loaded: LoadedCompany; deps: LoopDeps };

export class Registry {
  private entries = new Map<string, Entry>();
  add(e: Entry) {
    this.entries.set(e.company.slug, e);
  }
  bySlug(slug: string): Entry | undefined {
    return this.entries.get(slug);
  }
  byId(id: string): Entry | undefined {
    return [...this.entries.values()].find((e) => e.company.id === id);
  }
  all(): Entry[] {
    return [...this.entries.values()];
  }
}
