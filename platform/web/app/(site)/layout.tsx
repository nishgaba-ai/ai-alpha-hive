import Link from "next/link";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ground-glow min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="inline-block h-2.5 w-2.5 rotate-45 bg-[var(--brass)] shadow-[0_0_12px_var(--brass-glow)]" />
          Alpha Hive
        </Link>
        <nav className="flex items-center gap-6 text-sm text-[var(--muted)]">
          <Link href="/docs" className="hover:text-[var(--ink)]">
            Docs
          </Link>
          <Link href="/blog" className="hover:text-[var(--ink)]">
            Blog
          </Link>
          <Link href="/founder" className="hover:text-[var(--ink)]">
            Founder
          </Link>
          <a href="https://github.com/nishgaba-ai/ai-alpha-hive" className="hover:text-[var(--ink)]">
            GitHub
          </a>
          <Link href="/c" className="btn btn-glass">
            Open the company
          </Link>
        </nav>
      </header>
      {children}
      <footer className="mx-auto max-w-6xl px-6 py-10 text-sm text-[var(--muted)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--hairline)] pt-8">
          <span>© {new Date().getFullYear()} Alpha Hive · Prodigal AI</span>
          <span>
            Built and shipped by its own engine —{" "}
            <a href="https://github.com/nishgaba-ai/ai-alpha-hive" className="underline decoration-[var(--brass-dim)] underline-offset-4 hover:text-[var(--ink)]">
              open source
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
