import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listDocs, readDoc } from "../../../../lib/docs";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const { slug = ["getting-started"] } = await params;
  const d = readDoc(slug);
  return { title: d ? `${d.title} · Docs` : "Docs" };
}

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = ["getting-started"] } = await params;
  const docs = listDocs();
  const d = readDoc(slug);
  if (!d) notFound();
  const current = slug.join("/");
  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[240px_1fr]">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <p className="label mb-2">Docs</p>
        <nav className="space-y-0.5">
          {docs.map((x) => {
            const s = x.slug.join("/");
            return (
              <Link key={s} href={`/docs/${s}`} className={`block rounded-[var(--r-1)] px-3 py-1.5 text-sm ${s === current ? "bg-[var(--surface-2)] font-medium text-[var(--ink)]" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]"}`}>
                {x.title.replace(/^Playbook: /, "▶ ")}
              </Link>
            );
          })}
        </nav>
      </aside>
      <article>
        <h1 className="font-display text-4xl leading-tight">{d.title}</h1>
        <div className="prose-hive mt-6" dangerouslySetInnerHTML={{ __html: d.html }} />
      </article>
    </main>
  );
}
