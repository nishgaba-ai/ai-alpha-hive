const features = [
  {
    title: "What you offer",
    body: "Replace this with the first concrete thing visitors get. Real copy only — this template refuses lorem ipsum.",
  },
  {
    title: "Why it works",
    body: "Replace this with proof: a number, a named customer, a specific outcome.",
  },
  {
    title: "How to start",
    body: "Replace this with the smallest first step a visitor can take today.",
  },
];

export default function Home() {
  return (
    <main>
      <section className="mx-auto max-w-4xl px-6 pt-24 pb-16 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-balance">
          [[.Name]]
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-neutral-600">
          [[.Intent]]
        </p>
        <a
          href="#contact"
          className="mt-10 inline-block rounded-md bg-[var(--brand)] px-6 py-3 font-medium text-white hover:bg-[var(--brand-dark)]"
        >
          Get started
        </a>
      </section>

      <section className="mx-auto grid max-w-5xl gap-8 px-6 py-16 sm:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-lg border border-neutral-200 p-6">
            <h2 className="text-lg font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm text-neutral-600">{f.body}</p>
          </div>
        ))}
      </section>

      <section id="contact" className="mx-auto max-w-4xl px-6 py-16 text-center">
        <h2 className="text-3xl font-bold">Ready when you are</h2>
        <p className="mt-4 text-neutral-600">
          Replace with your real call to action and contact route.
        </p>
      </section>

      <footer className="border-t border-neutral-200 py-8 text-center text-sm text-neutral-500">
        © {new Date().getFullYear()} [[.Name]]
      </footer>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "[[.Name]]",
            description: "[[.Intent]]",
          }),
        }}
      />
    </main>
  );
}
