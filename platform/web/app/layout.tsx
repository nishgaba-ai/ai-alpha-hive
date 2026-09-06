import type { Metadata } from "next";
import { Outfit, Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";

const display = Outfit({ subsets: ["latin"], variable: "--font-display", weight: ["500", "600", "700"] });
const ui = Geist({ subsets: ["latin"], variable: "--font-ui" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500"] });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Launch your AI company · Alpha Hive",
    template: "%s · Alpha Hive",
  },
  description:
    "Launch your AI company: one human board, a company of agents with real tools, budgets and infrastructure — every external action a gate you control.",
  openGraph: {
    title: "Launch your AI company",
    description: "One human board, a company of agents. Engineers, marketers, finance — with budgets, gates and a live graph.",
    url: siteUrl,
    siteName: "Alpha Hive",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}" }} />
        <div className="grain" aria-hidden />
        {children}
      </body>
    </html>
  );
}
