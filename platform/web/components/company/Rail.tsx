"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge, NavLink } from "../ui";
import type { CompanyRole } from "../../lib/rbac";

const ITEMS = [
  ["", "Overview"],
  ["/setup", "Setup"],
  ["/intake", "Intake"],
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
  ["/access", "Access"],
] as const;

// Only company owners manage access; everyone else keeps the other links
// and the pages' write actions are what is guarded.
const OWNER_ONLY = new Set<string>(["/access"]);

export function Rail({ slug, name, status, pending, running, role }: { slug: string; name: string; status: string; pending: number; running: number; role: CompanyRole }) {
  const path = usePathname();
  const base = `/c/${slug}`;
  return (
    <aside className="sticky top-[68px] hidden h-[calc(100vh-88px)] w-56 shrink-0 flex-col md:flex">
      <div className="card p-4">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${running ? "bg-[var(--live)] breathe" : status === "paused" ? "bg-[var(--parked)]" : "bg-[var(--idle)]"}`} />
          <p className="label">{status.charAt(0).toUpperCase() + status.slice(1)}</p>
        </div>
        <div className="mt-1 flex items-start justify-between gap-2">
          <Link href={base} className="font-display block text-xl leading-tight">{name}</Link>
          {role !== "owner" ? <Badge tone="brass">{role === "reviewer" ? "Reviewer" : "Viewer"}</Badge> : null}
        </div>
      </div>
      <nav className="mt-3 space-y-0.5">
        {ITEMS.filter(([suffix]) => role === "owner" || !OWNER_ONLY.has(suffix)).map(([suffix, label]) => (
          <NavLink key={suffix} href={base + suffix} active={suffix === "" ? path === base : path.startsWith(base + suffix)} badge={suffix === "/inbox" ? pending : undefined}>
            {label}
          </NavLink>
        ))}
      </nav>
      <p className="mt-auto px-3 text-[11px] text-[var(--muted)]">Every action here is an event in the audit log.</p>
    </aside>
  );
}
