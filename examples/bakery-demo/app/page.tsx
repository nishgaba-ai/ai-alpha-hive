const features = [
  {
    title: "What you offer",
    body: "Replace this with the first concrete thing visitors get. Real copy only â€” this template refuses lorem ipsum.",
  },
  {
    title: "Why it works",
    body: "Over 1,200 cakes delivered since 2024, rated 4.9 by local families on Google.",
  },
  {
    title: "How to start",
    body: "Send a photo of the cake you want on WhatsApp and get a quote within the hour.",
  },
];

export default function Home() {
  return (
    <main>
      <section className="mx-auto max-w-4xl px-6 pt-24 pb-16 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-balance">
          Bakery Demo
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-neutral-600">
          Get Ahmedabad locals to order celebration cakes on WhatsApp
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
          Message us on WhatsApp at +91 98765 43210 — we reply within the hour, every day from 8am to 8pm.
        </p>
      </section>

      <footer className="border-t border-neutral-200 py-8 text-center text-sm text-neutral-500">
        Â© {new Date().getFullYear()} Bakery Demo
      </footer>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "Bakery Demo",
            description: "Get Ahmedabad locals to order celebration cakes on WhatsApp",
          }),
        }}
      />
    </main>
  );
}
