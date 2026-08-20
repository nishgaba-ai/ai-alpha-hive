import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description: "Who is behind Bakery Demo.",
};

export default function About() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-4xl font-bold tracking-tight">About</h1>
      <p className="mt-6 text-lg text-neutral-600">
        Replace this with who you are and why this exists. Sites scaffolded by
        AI Alpha Hive ship with this page by default — visitors trust a site
        that says who is behind it.
      </p>
      <p className="mt-4 text-neutral-600">
        Built with{" "}
        <a
          href="https://github.com/nishgaba-ai/ai-alpha-hive"
          className="underline decoration-[var(--brand)] underline-offset-4"
        >
          AI Alpha Hive
        </a>
        , originally created by Nishchal Gaba.
      </p>
    </main>
  );
}
