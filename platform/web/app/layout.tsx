import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Nish Alpha Hive",
    template: "%s · Nish Alpha Hive",
  },
  description:
    "Launch your product to production in minutes — with us, on your own infra, or from your desktop. Every deploy passes eight policy gates first.",
  openGraph: {
    title: "Nish Alpha Hive",
    description:
      "From prompt to production: gate-checked launches for devs and non-devs.",
    url: siteUrl,
    siteName: "Nish Alpha Hive",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block h-2.5 w-2.5 rotate-45 bg-[var(--brand)]" />
            Nish Alpha Hive
          </Link>
          <nav className="flex items-center gap-6 text-sm text-[var(--muted)]">
            <Link href="/founder" className="hover:text-[var(--ink)]">
              Founder
            </Link>
            <a
              href="https://github.com/nishgaba-ai/ai-alpha-hive"
              className="hover:text-[var(--ink)]"
            >
              GitHub
            </a>
            <Link
              href="/dashboard"
              className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-4 py-1.5 text-[var(--ink)] hover:border-[var(--brand-dim)]"
            >
              Dashboard
            </Link>
          </nav>
        </header>
        {children}
        <footer className="mx-auto max-w-6xl border-t border-[var(--line)] px-6 py-8 text-sm text-[var(--muted)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span>© {new Date().getFullYear()} Nish Alpha Hive</span>
            <span>
              Built and shipped by its own engine —{" "}
              <a
                href="https://github.com/nishgaba-ai/ai-alpha-hive"
                className="underline decoration-[var(--brand-dim)] underline-offset-4 hover:text-[var(--ink)]"
              >
                open source
              </a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
