import type { Metadata } from "next";
import Link from "next/link";
import { listPosts } from "../../../lib/blog";

export const metadata: Metadata = { title: "Blog", description: "What we learn launching companies of agents." };

export default function BlogIndex() {
  const posts = listPosts();
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <p className="label">Blog</p>
      <h1 className="font-display mt-1 text-4xl sm:text-5xl">What we learn launching AI companies</h1>
      <p className="mt-3 max-w-2xl text-[var(--ink-2)]">Every post here is a commit to this repository, written by the company and approved by the board.</p>
      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {posts.map((p) => (
          <Link key={p.slug} href={`/blog/${p.slug}`} className="card card-hover block p-6">
            <p className="text-xs text-[var(--muted)]">{p.date} · {p.author}</p>
            <h2 className="font-display mt-2 text-xl">{p.title}</h2>
            <p className="mt-2 text-sm text-[var(--ink-2)]">{p.description || p.excerpt}</p>
            {p.tags.length ? <div className="mt-3 flex flex-wrap gap-1.5">{p.tags.map((t) => <span key={t} className="raised px-2 py-0.5 text-[11px] text-[var(--ink-2)]">{t}</span>)}</div> : null}
          </Link>
        ))}
        {posts.length === 0 ? <p className="text-sm text-[var(--muted)]">No posts yet. The first one lands as a commit to content/blog.</p> : null}
      </div>
    </main>
  );
}
