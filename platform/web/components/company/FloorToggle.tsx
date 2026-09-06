"use client";

// The 3D floor is a hero, not the way you operate the company. Off by
// default; one click shows it above the graph.

import { useState } from "react";
import { FloorLazy } from "./FloorLazy";
import type { Graph } from "../../lib/hive";

export function FloorToggle({ slug, initial }: { slug: string; initial: Graph }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)} className={`btn ${open ? "btn-glass" : "btn-ghost"}`}>
        {open ? "Hide 3D floor" : "Show 3D floor"}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--ground)] p-4" role="dialog" aria-label="3D floor">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-[var(--muted)]">Drag to orbit · scroll to zoom · each sphere is an agent, the ring is its status, the disc is the board</p>
            <button type="button" onClick={() => setOpen(false)} className="btn btn-glass">Close</button>
          </div>
          <div className="min-h-0 flex-1">
            <FloorLazy slug={slug} initial={initial} height="100%" />
          </div>
        </div>
      ) : null}
    </>
  );
}
