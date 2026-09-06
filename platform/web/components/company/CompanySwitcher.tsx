"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { slug: string; name: string; status: string; pending: number };

// One row, never wraps: pills on wide screens, a select on narrow ones.
export function CompanySwitcher({ companies }: { companies: Item[] }) {
  const path = usePathname();
  const current = companies.find((c) => path.startsWith(`/c/${c.slug}`));
  const dot = (s: string) => (s === "running" ? "bg-[var(--live)]" : s === "paused" ? "bg-[var(--parked)]" : "bg-[var(--idle)]");
  return (
    <>
      <nav className="hidden min-w-0 items-center gap-1 overflow-x-auto lg:flex">
        {companies.map((c) => {
          const active = current?.slug === c.slug;
          return (
            <Link key={c.slug} href={`/c/${c.slug}`} className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] transition ${active ? "bg-[var(--surface-2)] text-[var(--ink)] font-medium" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${dot(c.status)}`} />
              {c.name}
              {c.pending ? <span className="rounded-full bg-[var(--parked)] px-1.5 text-[10px] font-semibold text-white">{c.pending}</span> : null}
            </Link>
          );
        })}
      </nav>
      <select
        aria-label="Company"
        className="field w-auto max-w-[200px] py-1.5 text-[13px] lg:hidden"
        value={current?.slug ?? ""}
        onChange={(e) => {
          if (e.target.value) window.location.assign(`/c/${e.target.value}`);
        }}
      >
        <option value="">All companies</option>
        {companies.map((c) => (
          <option key={c.slug} value={c.slug}>{c.name}{c.pending ? ` (${c.pending})` : ""}</option>
        ))}
      </select>
    </>
  );
}
