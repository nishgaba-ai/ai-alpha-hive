// Obsidian & Brass primitives (server-safe). docs/company/design-system.md

import Link from "next/link";
import type { ReactNode } from "react";

export function Card({ children, className = "", hover = false }: { children: ReactNode; className?: string; hover?: boolean }) {
  return <div className={`card ${hover ? "card-hover" : ""} p-5 ${className}`}>{children}</div>;
}

export function Glass({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`glass p-5 ${className}`}>{children}</div>;
}

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`label ${className}`}>{children}</p>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "live" | "parked" | "failed" }) {
  const color = tone === "live" ? "text-[var(--live)]" : tone === "parked" ? "text-[var(--parked)]" : tone === "failed" ? "text-[var(--failed)]" : "";
  return (
    <div className="card p-4">
      <Label>{label}</Label>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}

export function Meter({ value, max, tone = "brass" }: { value: number; max: number; tone?: "brass" | "live" | "failed" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = tone === "live" ? "var(--live)" : tone === "failed" ? "var(--failed)" : "linear-gradient(90deg, var(--brass-dim), var(--brass-2))";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-0)]" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function StatusDot({ status, pulse = false }: { status: string; pulse?: boolean }) {
  const map: Record<string, string> = { running: "var(--live)", live: "var(--live)", done: "var(--live)", parked: "var(--parked)", pending: "var(--parked)", ready: "var(--brass)", failed: "var(--failed)", denied: "var(--failed)", idle: "var(--idle)", planned: "var(--idle)" };
  const c = map[status] ?? "var(--idle)";
  return <span className={`relative inline-block h-2 w-2 rounded-full ${pulse && status === "running" ? "pulse-dot" : ""}`} style={{ background: c, color: c }} aria-label={status} />;
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "brass" | "live" | "parked" | "failed" }) {
  const t: Record<string, string> = {
    muted: "text-[var(--ink-2)] bg-[var(--surface-2)]",
    brass: "text-[var(--brass-2)] bg-[rgba(108,92,231,0.12)]",
    live: "text-[var(--live)] bg-[rgba(22,185,129,0.12)]",
    parked: "text-[var(--parked)] bg-[rgba(245,158,11,0.14)]",
    failed: "text-[var(--failed)] bg-[rgba(239,71,111,0.12)]",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${t[tone]}`}>{children}</span>;
}

export function sideEffectTone(s: string): "muted" | "brass" | "live" | "parked" | "failed" {
  if (s === "read" || s === "write") return "muted";
  if (s === "spend" || s === "deploy") return "failed";
  if (s === "publish" || s === "send") return "parked";
  return "brass";
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-[var(--r-2)] bg-[var(--surface-0)] p-6 text-center text-sm text-[var(--muted)]">{children}</div>;
}

export function PageTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? <Label className="mb-1">{eyebrow}</Label> : null}
        <h1 className="font-display text-3xl font-medium leading-tight sm:text-4xl">{title}</h1>
      </div>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function NavLink({ href, active, children, badge }: { href: string; active: boolean; children: ReactNode; badge?: number }) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between rounded-[var(--r-1)] px-3 py-2 text-sm transition ${active ? "bg-[var(--surface-2)] text-[var(--ink)] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]" : "text-[var(--ink-2)] hover:bg-[var(--surface-1)] hover:text-[var(--ink)]"}`}
    >
      <span>{children}</span>
      {badge ? <span className="rounded-full bg-[var(--brass)] px-1.5 py-0.5 text-[10px] font-semibold text-white">{badge}</span> : null}
    </Link>
  );
}
