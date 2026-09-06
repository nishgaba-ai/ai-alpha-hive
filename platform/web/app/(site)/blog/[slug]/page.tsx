import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listPosts, readPost } from "../../../../lib/blog";

export function generateStaticParams() {
  return listPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = readPost(slug);
  return p ? { title: p.title, description: p.description, openGraph: { title: p.title, description: p.description, type: "article" } } : {};
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = readPost(slug);
  if (!p) notFound();
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/blog" className="text-sm text-[var(--accent)] hover:underline">← Blog</Link>
      <p className="label mt-6">{p.date} · {p.author}</p>
      <h1 className="font-display mt-1 text-4xl leading-tight sm:text-5xl">{p.title}</h1>
      {p.description ? <p className="mt-4 text-lg text-[var(--ink-2)]">{p.description}</p> : null}
      <article className="prose-hive mt-8" dangerouslySetInnerHTML={{ __html: p.html }} />
      {p.tags.length ? <div className="mt-10 flex flex-wrap gap-1.5">{p.tags.map((t) => <span key={t} className="raised px-2 py-0.5 text-[11px] text-[var(--ink-2)]">{t}</span>)}</div> : null}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline: p.title, description: p.description, datePublished: p.date, author: { "@type": "Organization", name: p.author } }) }}
      />
    </main>
  );
}
