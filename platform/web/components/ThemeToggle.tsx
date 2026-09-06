"use client";

import { useEffect, useState } from "react";

type Mode = "light" | "dark" | "system";

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem("theme") as Mode | null;
      if (t) setMode(t);
    } catch {
      /* ignore */
    }
  }, []);
  function apply(next: Mode) {
    setMode(next);
    try {
      if (next === "system") {
        localStorage.removeItem("theme");
        document.documentElement.removeAttribute("data-theme");
      } else {
        localStorage.setItem("theme", next);
        document.documentElement.setAttribute("data-theme", next);
      }
    } catch {
      /* ignore */
    }
  }
  const next: Mode = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
  const icon = mode === "light" ? "☀" : mode === "dark" ? "☾" : "◐";
  return (
    <button type="button" onClick={() => apply(next)} className="btn btn-glass h-9 w-9 justify-center p-0 text-base" title={`Theme: ${mode} (click for ${next})`} aria-label="Toggle theme">
      {icon}
    </button>
  );
}
