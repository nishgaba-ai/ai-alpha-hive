"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavLink } from "../ui";

const ITEMS = [
  ["", "Overview"],
  ["/setup", "Setup"],
  ["/firm", "The firm"],
  ["/graph", "Graph & floor"],
  ["/missions", "Missions"],
  ["/tasks", "Task tracker"],
  ["/inbox", "Inbox"],
  ["/creators", "Creators"],
  ["/treasury", "Treasury"],
  ["/erp", "ERP"],
  ["/integrations", "Integrations"],
  ["/voice", "Voice"],
  ["/settings", "Settings"],
] as const;

export function Rail({ slug, name, status, pending, running }: { slug: string; name: string; status: string; pending: number; running: number }) {
  const path = usePathname();
  const base = `/c/${slug}`;
  return (
    <aside className="sticky top-[68px] hidden h-[calc(100vh-88px)] w-56 shrink-0 flex-col md:flex">
      <div className="card p-4">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${running ? "bg-[var(--live)] breathe" : status === "paused" ? "bg-[var(--parked)]" : "bg-[var(--idle)]"}`} />
          <p className="label">{status.charAt(0).toUpperCase() + status.slice(1)}</p>
        </div>
        <Link href={base} className="font-display mt-1 block text-xl leading-tight">{name}</Link>
      </div>
      <nav className="mt-3 space-y-0.5">
        {ITEMS.map(([suffix, label]) => (
          <NavLink key={suffix} href={base + suffix} active={suffix === "" ? path === base : path.startsWith(base + suffix)} badge={suffix === "/inbox" ? pending : undefined}>
            {label}
          </NavLink>
        ))}
      </nav>
      <p className="mt-auto px-3 text-[11px] text-[var(--muted)]">Every action here is an event in the audit log.</p>
    </aside>
  );
}
