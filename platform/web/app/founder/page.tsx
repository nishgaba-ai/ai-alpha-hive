import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Founder",
  description:
    "Nishchal Gaba — original creator of Nish Alpha Hive and the ai-alpha-hive engine.",
};

const roles = [
  ["2021 — now", "Founder & CEO, Prodigal AI"],
  ["2024 — 25", "CTO, Peer2Play"],
  ["2022 — 23", "CTO, ZeeQ (Singapore)"],
  ["2021 — 22", "Tech Lead, Credmark (USA)"],
  ["2018 — 21", "CTO, Unreal AI"],
];

export default function Founder() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--brand)]">
        original creator
      </p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight">Nishchal Gaba</h1>
      <p className="mt-6 text-lg leading-relaxed text-[var(--muted)]">
        Founder &amp; CEO of Prodigal AI, building the world&apos;s cheapest
        content distribution and monetization ecosystem — AI-native publishing,
        agentic workflows, and autonomous multi-agent systems that take work
        from research to published product end-to-end. Dhanur Content OS runs
        30 brands in English and Hindi on that engine. Nish Alpha Hive applies
        the same conviction to software itself: launching a real product
        should take minutes, and the checks should never be optional.
      </p>

      <h2 className="mt-12 text-xl font-semibold">Background</h2>
      <ul className="mt-4 space-y-2">
        {roles.map(([when, what]) => (
          <li key={what} className="flex gap-4 border-b border-[var(--line)] pb-2 text-sm">
            <span className="w-24 shrink-0 font-mono text-[var(--muted)]">{when}</span>
            <span>{what}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm leading-relaxed text-[var(--muted)]">
        M.Sc. Artificial Intelligence, University of Edinburgh · B.Tech CSE,
        GGSIPU Delhi · National AI Merit Award for Multi-Agent Systems
        Research (CII, 2024) · Contribution Award, Delhi CM (2024).
      </p>

      <div className="mt-8 flex gap-5 text-sm">
        <a
          href="https://www.linkedin.com/in/nishchal-gaba-295701a5/"
          className="underline decoration-[var(--brand-dim)] underline-offset-4 hover:text-[var(--brand)]"
        >
          LinkedIn
        </a>
        <a
          href="https://github.com/nishgaba-ai"
          className="underline decoration-[var(--brand-dim)] underline-offset-4 hover:text-[var(--brand)]"
        >
          GitHub
        </a>
      </div>

      <p className="mt-12 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 text-sm text-[var(--muted)]">
        This page ships as the default &quot;creator&quot; page on every Nish
        Alpha Hive deployment — if you run your own instance, make it yours.
      </p>
    </main>
  );
}
