import { hive, hiveOr, ago, type CompanySummary, type Task } from "../../../../lib/hive";
import { Card, Label, StatusDot, PageTitle, Empty } from "../../../../components/ui";
import { createTask, updateTask } from "../actions";

export const dynamic = "force-dynamic";

type Person = { id: string; name: string; kind: string };

const COLUMNS: [string, string[]][] = [
  ["Planned", ["planned"]],
  ["Ready", ["ready"]],
  ["In progress", ["running", "parked"]],
  ["Done", ["done", "failed", "cancelled"]],
];

export default async function TasksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [c, { tasks }, people] = await Promise.all([
    hive<CompanySummary>(`/api/companies/${slug}`),
    hive<{ tasks: Task[] }>(`/api/companies/${slug}/tasks`),
    hiveOr<Person[]>(`/api/companies/${slug}/erp/people`, []),
  ]);
  const pName = new Map(people.map((p) => [p.id, p.name]));
  const visible = tasks.filter((t) => t.key !== "mission");
  return (
    <main>
      <PageTitle eyebrow="Agents and humans" title="Task tracker" />
      <Card className="mb-5">
        <Label className="mb-2">Add a task</Label>
        <form action={createTask} className="grid gap-2 md:grid-cols-[2fr_2fr_1fr_1fr_1fr_auto]">
          <input type="hidden" name="slug" value={slug} />
          <input name="title" className="field" placeholder="Title" required />
          <input name="intent" className="field" placeholder="Why / what done looks like" />
          <select name="owner_role" className="field" defaultValue="">
            <option value="">human</option>
            {c.roles.map((r) => (
              <option key={r.id} value={r.id}>{r.title} (agent)</option>
            ))}
          </select>
          <select name="assignee_person_id" className="field" defaultValue="">
            <option value="">unassigned</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input name="due" type="date" className="field" />
          <button className="btn btn-primary" type="submit">Add</button>
        </form>
        <p className="mt-2 text-xs text-[var(--muted)]">Choose an agent role and the task is queued for the runtime; leave it human and it is tracked here for you, Surabhi or an intern.</p>
      </Card>
      <div className="grid gap-4 md:grid-cols-4">
        {COLUMNS.map(([title, statuses]) => {
          const items = visible.filter((t) => statuses.includes(t.status));
          return (
            <div key={title} className="rounded-[var(--r-2)] bg-[var(--surface-0)] p-3">
              <Label className="mb-2">{title} · {items.length}</Label>
              <div className="space-y-2">
                {items.length === 0 ? <Empty>—</Empty> : null}
                {items.map((t) => (
                  <div key={t.id} className="card p-3 text-sm rise">
                    <div className="flex items-start gap-2"><StatusDot status={t.status} pulse /><p className="font-medium leading-snug">{t.title}</p></div>
                    <p className="mt-1 text-[11px] text-[var(--muted)]">{t.owner_role === "human" ? (t.assignee_person_id ? pName.get(t.assignee_person_id) ?? "human" : "human · unassigned") : `${t.owner_role} · agent`}{t.due_at ? ` · due ${new Date(t.due_at).toLocaleDateString("en-IN")}` : ""} · {ago(t.updated_at)}</p>
                    {t.notes ? <p className="mt-1 line-clamp-2 text-xs text-[var(--ink-2)]">{t.notes}</p> : null}
                    {t.owner_role === "human" ? (
                      <form action={updateTask} className="mt-2 flex gap-1">
                        <input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={t.id} />
                        {t.status !== "running" ? <button name="status" value="running" className="btn btn-ghost py-0.5 text-xs">Start</button> : null}
                        {t.status !== "done" ? <button name="status" value="done" className="btn btn-ghost py-0.5 text-xs">Done</button> : null}
                        {t.status !== "cancelled" ? <button name="status" value="cancelled" className="btn btn-ghost py-0.5 text-xs">Drop</button> : null}
                      </form>
                    ) : null}
                    {t.owner_role !== "human" && t.status === "failed" ? (
                      <form action={updateTask} className="mt-2 flex gap-1">
                        <input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={t.id} />
                        <button name="status" value="ready" className="btn btn-ghost py-0.5 text-xs">Retry</button>
                        <button name="status" value="cancelled" className="btn btn-ghost py-0.5 text-xs">Drop</button>
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
