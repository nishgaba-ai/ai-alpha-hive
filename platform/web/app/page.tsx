import Link from "next/link";

const targets = [
  {
    title: "Launch with us",
    body: "Describe your product, watch it go live on managed infrastructure. Metered by what you actually use — build minutes, bandwidth, storage.",
    tag: "for founders",
  },
  {
    title: "Launch on your infra",
    body: "Your Vercel account, your VPS, your cloud. Same engine, same gates, your credentials — leaving the managed tier is always possible.",
    tag: "for teams",
  },
  {
    title: "Launch from your desktop",
    body: "The hive CLI and desktop app run the whole engine locally. Heavy builds on your own compute, deploys wherever you point them.",
    tag: "for developers",
  },
];

const gates = [
  "secrets",
  "deps",
  "types",
  "lint",
  "build",
  "test",
  "links",
  "seo",
];

export default function Home() {
  return (
    <main>
      <section className="mx-auto max-w-4xl px-6 pt-20 pb-14 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--brand)]">
          your ai product deployment assistant
        </p>
        <h1 className="mt-4 text-5xl font-bold tracking-tight text-balance">
          Launch your product live, in minutes
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-[var(--muted)]">
          Nish Alpha Hive is an AI assistant that takes your product from idea
          to production — for developers and non-developers. The assistant
          proposes; eight deterministic gates dispose. Nothing ships unless
          every check passes.
        </p>
        <div className="mt-10 flex justify-center gap-4">
          <Link
            href="/dashboard"
            className="rounded-md bg-[var(--brand)] px-6 py-3 font-medium text-[#141005] hover:bg-[#f0bd52]"
          >
            Open the dashboard
          </Link>
          <a
            href="https://github.com/nishgaba-ai/ai-alpha-hive"
            className="rounded-md border border-[var(--line)] px-6 py-3 font-medium text-[var(--ink)] hover:border-[var(--brand-dim)]"
          >
            Read the source
          </a>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-5 px-6 py-14 sm:grid-cols-3">
        {targets.map((t) => (
          <div
            key={t.title}
            className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-6"
          >
            <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--brand)]">
              {t.tag}
            </p>
            <h2 className="mt-2 text-lg font-semibold">{t.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              {t.body}
            </p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-4xl px-6 py-14 text-center">
        <h2 className="text-3xl font-bold">Ships only when every gate passes</h2>
        <p className="mx-auto mt-4 max-w-2xl text-[var(--muted)]">
          Checks aren&apos;t best-effort prompts — they are engine code your
          deploy cannot skip. A launch that fails a blocking gate does not
          launch.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {gates.map((g) => (
            <span
              key={g}
              className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-4 py-1.5 font-mono text-sm text-[var(--good)]"
            >
              ✓ {g}
            </span>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-14">
        <ol className="grid gap-6 sm:grid-cols-3">
          {[
            ["01", "Describe it", "Your product, your audience, the one thing a visitor should do. Intent is data the engine keeps enforcing."],
            ["02", "Gates run", "Types, build, tests, links, SEO, secrets — verified on every single launch, not just the first."],
            ["03", "It's live", "A public URL in minutes. Connect GitHub to own the code outright — no lock-in, ever."],
          ].map(([n, title, body]) => (
            <li key={n}>
              <p className="font-mono text-sm text-[var(--brand)]">{n}</p>
              <h3 className="mt-1 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Nish Alpha Hive",
            alternateName: "AI product deployment assistant",
            applicationCategory: "DeveloperApplication",
            description:
              "An AI product deployment assistant that launches products to production in minutes with deterministic policy gates — managed, BYO infra, or local desktop.",
            author: { "@type": "Person", name: "Nishchal Gaba" },
          }),
        }}
      />
    </main>
  );
}
