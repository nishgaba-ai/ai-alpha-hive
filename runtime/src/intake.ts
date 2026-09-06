// Website intake (the Okara-style first screen): the board describes the
// product once; the runtime stores it as an artifact every agent can read
// and turns it into the executive's first mission. Later missions reference
// the same intake instead of re-explaining the company.

import { all, newId, one, run } from "./db.js";
import { emit } from "./bus.js";
import { startMission } from "./scheduler.js";
import type { LoopDeps } from "./harness/loop.js";

export type Intake = {
  website: string;
  product: string;
  audience: string;
  goals: string;
  competitors?: string;
  tone?: string;
  channels?: string[];
  budget_note?: string;
  deadline?: string;
  by?: string;
};

export type IntakeRow = { id: string; created_at: number; fields: Intake; mission_id: string | null };

export function latestIntake(companyId: string): IntakeRow | undefined {
  const r = one<{ id: string; created_at: number; meta_json: string; task_id: string | null }>("SELECT id, created_at, meta_json, task_id FROM artifacts WHERE company_id = ? AND kind = 'intake' ORDER BY created_at DESC LIMIT 1", companyId);
  return r ? { id: r.id, created_at: r.created_at, fields: JSON.parse(r.meta_json ?? "{}") as Intake, mission_id: r.task_id } : undefined;
}

export function intakes(companyId: string): IntakeRow[] {
  return all<{ id: string; created_at: number; meta_json: string; task_id: string | null }>("SELECT id, created_at, meta_json, task_id FROM artifacts WHERE company_id = ? AND kind = 'intake' ORDER BY created_at DESC LIMIT 20", companyId)
    .map((r) => ({ id: r.id, created_at: r.created_at, fields: JSON.parse(r.meta_json ?? "{}") as Intake, mission_id: r.task_id }));
}

/** The first mission, written the way the CMO template's executive expects it. */
export function composeMission(f: Intake): string {
  const channels = f.channels?.length ? f.channels.join(", ") : "blog, LinkedIn, Instagram, Reddit, X";
  return [
    `Website intake for ${f.product} (${f.website}).`,
    `Audience: ${f.audience}. Goals: ${f.goals}.`,
    f.competitors ? `Competitors to position against: ${f.competitors}.` : "",
    f.tone ? `Tone of voice: ${f.tone}.` : "",
    `Channels in scope: ${channels}.`,
    f.budget_note ? `Budget notes: ${f.budget_note}.` : "",
    f.deadline ? `Deadline: ${f.deadline}.` : "",
    "Deliver as artifacts: (1) a brand brief, (2) a 90-day content strategy with pillars and a weekly cadence, (3) a positioning map, (4) an SEO audit of the site, (5) a GEO probe of how AI assistants describe the brand. Draft, do not publish, the first blog post and the first social posts for each channel in scope, and brief the first creator clip. Everything external stays parked for the board.",
  ].filter(Boolean).join(" ");
}

export function submitIntake(deps: LoopDeps, f: Intake, start = true): IntakeRow {
  const id = newId();
  let missionId: string | null = null;
  if (start) missionId = startMission(deps, composeMission(f), f.by ?? "board").id;
  run("INSERT INTO artifacts (id, company_id, run_id, task_id, kind, ref, meta_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
    id, deps.company.id, null, missionId, "intake", f.website, JSON.stringify(f), Date.now());
  emit(deps.company.id, "intake.submitted", { intake_id: id, website: f.website, mission_id: missionId });
  return { id, created_at: Date.now(), fields: f, mission_id: missionId };
}
