import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Bakery Demo",
    template: "%s · Bakery Demo",
  },
  description: "Get Ahmedabad locals to order celebration cakes on WhatsApp",
  openGraph: {
    title: "Bakery Demo",
    description: "Get Ahmedabad locals to order celebration cakes on WhatsApp",
    url: siteUrl,
    siteName: "Bakery Demo",
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
      <body className="bg-white text-neutral-900 antialiased">
        <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-semibold">
            Bakery Demo
          </Link>
          <nav className="flex gap-6 text-sm text-neutral-600">
            <Link href="/about" className="hover:text-neutral-900">
              About
            </Link>
            <Link href="/#contact" className="hover:text-neutral-900">
              Contact
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
