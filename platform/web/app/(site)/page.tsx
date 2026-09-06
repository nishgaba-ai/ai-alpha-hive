import Link from "next/link";

const roles = [
  { glyph: "◈", title: "Chief executive", body: "Turns your mission into a task plan and keeps the team honest." },
  { glyph: "⌘", title: "Engineer", body: "Ships through eight deterministic gates. Nothing deploys unchecked." },
  { glyph: "◎", title: "Growth marketer", body: "Drafts, researches, publishes — after you approve, never before." },
  { glyph: "¤", title: "Finance", body: "Closes the week: spend by agent, cost per outcome, a plan for next week." },
  { glyph: "▶", title: "Creator ops", body: "Runs a creator programme on commission, one video a day, no ads." },
  { glyph: "☎", title: "Sales", body: "Qualifies, follows up, prepares the deal you sign." },
];

const gates = ["spend", "send", "publish", "deploy", "hire"];

export default function Home() {
  return (
    <main>
      <section className="mx-auto max-w-5xl px-6 pb-16 pt-16 text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-[var(--surface-1)] px-4 py-1.5 text-sm font-medium text-[var(--ink-2)] shadow-[var(--shadow-1)]">
          <span className="h-2 w-2 rounded-full bg-[var(--live)]" /> Open source · runs on your machine
        </span>
        <h1 className="font-display mt-6 text-5xl leading-[1.05] sm:text-7xl">
          Launch your <span className="bg-gradient-to-r from-[var(--accent)] to-[var(--pink)] bg-clip-text text-transparent">AI company</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[var(--ink-2)]">
          One human board, a company of agents. Engineers, marketers, sales and finance with real tools, real budgets and a treasury the engine caps. Watch it run as a live graph. Approve from your phone.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link href="/c/new" className="btn btn-primary px-7 py-3.5 text-base">Launch a company</Link>
          <Link href="/c" className="btn btn-glass px-7 py-3.5 text-base">See it run</Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="glass p-6 sm:p-8">
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              ["01", "Describe it", "A mission with a number and a date. The executive plans the work; teams take their part."],
              ["02", "Watch it run", "An org graph that lights up as agents work, a 3D floor, a run stream you can read."],
              ["03", "Decide", "Spend, public posts, first contact, production deploys and hires park for you. One tap, from the inbox, Telegram or by voice."],
            ].map(([n, title, body]) => (
              <div key={n}>
                <p className="font-mono text-sm text-[var(--accent)]">{n}</p>
                <h3 className="font-display mt-1 text-xl">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ink-2)]">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <h2 className="font-display text-center text-3xl sm:text-4xl">The roles you would hire, ready on day one</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((r) => (
            <div key={r.title} className="card card-hover p-6">
              <span className="grid h-11 w-11 place-items-center rounded-[14px] bg-[var(--surface-2)] text-xl text-[var(--accent)]">{r.glyph}</span>
              <h3 className="font-display mt-4 text-lg">{r.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-2)]">{r.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-16 text-center">
        <h2 className="font-display text-3xl sm:text-4xl">The board seat is yours</h2>
        <p className="mx-auto mt-4 max-w-2xl text-[var(--ink-2)]">
          Every external side effect is a gate in a file you own. Agents propose; the engine disposes. Money is ledger-backed and capped; secrets never reach a model.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {gates.map((g) => (
            <span key={g} className="rounded-full bg-[var(--surface-1)] px-4 py-1.5 text-sm font-medium text-[var(--ink)] shadow-[var(--shadow-1)]">
              <span className="mr-1.5 text-[var(--parked)]">●</span>
              {g} parks for you
            </span>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["Any model", "Anthropic, Claude Code, OpenRouter, Ollama — per role. A mock provider runs the demo with no key."],
            ["Your infra, your data", "SQLite on your laptop, a droplet, or Vercel for the UI. Export the whole company to move it."],
            ["ERP under one roof", "People, payroll, expenses, time, cash, and a monthly statement your accountant can open."],
          ].map(([t, b]) => (
            <div key={t} className="card p-6">
              <h3 className="font-display text-lg">{t}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-2)]">{b}</p>
            </div>
          ))}
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Launch your AI company · Alpha Hive",
            applicationCategory: "BusinessApplication",
            description: "One human board, a company of agents with real tools, budgets and gates — open source, runs on your machine.",
            author: { "@type": "Person", name: "Nishchal Gaba" },
          }),
        }}
      />
    </main>
  );
}
