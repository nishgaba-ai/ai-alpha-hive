"use client";

import { useState } from "react";

export function YamlEditor({ slug, initial, hash }: { slug: string; initial: string; hash: string }) {
  const [text, setText] = useState(initial);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [status, setStatus] = useState<string>("");
  const dirty = text !== initial;

  async function validate() {
    setStatus("validating…");
    const r = await fetch(`/api/hive/companies/${slug}/yaml/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ yaml: text }) });
    const b = (await r.json()) as { problems: string[] };
    setProblems(b.problems);
    setStatus(b.problems.length ? `${b.problems.length} problem(s)` : "valid");
  }
  async function apply() {
    setStatus("applying…");
    const r = await fetch(`/api/hive/companies/${slug}/yaml`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ yaml: text }) });
    const b = (await r.json()) as { ok?: boolean; error?: string; problems?: string[]; yaml_hash?: string };
    if (b.ok) {
      setStatus(`applied · ${b.yaml_hash}`);
      setProblems([]);
      window.location.reload();
    } else {
      setProblems(b.problems ?? [b.error ?? "failed"]);
      setStatus("rejected — file restored");
    }
  }

  return (
    <div className="card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="label">company.yaml · {hash}{dirty ? " · edited" : ""}</p>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${problems?.length ? "text-[var(--failed)]" : "text-[var(--muted)]"}`}>{status}</span>
          <button type="button" onClick={validate} className="btn btn-glass py-1.5">Validate</button>
          <button type="button" onClick={apply} disabled={!dirty} className="btn btn-primary py-1.5 disabled:opacity-40">Apply</button>
        </div>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="field min-h-[640px] w-full resize-y font-mono text-[12.5px] leading-relaxed" />
      {problems?.length ? (
        <ul className="mt-3 space-y-1 text-sm text-[var(--failed)]">
          {problems.map((p, i) => <li key={i}>• {p}</li>)}
        </ul>
      ) : null}
      <p className="mt-2 text-[11px] text-[var(--muted)]">Apply validates against the schema and the rules (one root role, budgets under cap, tool patterns resolve), writes the file, and reloads the worker. A rejected edit restores the previous file.</p>
    </div>
  );
}
