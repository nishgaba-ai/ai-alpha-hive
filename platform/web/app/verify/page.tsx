import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifyEmailToken } from "../../lib/auth";
import { AuthShell, Notice } from "../../modules/rbac/ui";
import Link from "next/link";

export const metadata: Metadata = { title: "Verify email", robots: { index: false } };

export default async function Verify({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (token && verifyEmailToken(token)) redirect("/login?verified=1");

  return (
    <AuthShell title="Verification link invalid" lead="The link is missing, expired, or already used.">
      <Notice tone="error">Request a fresh link by signing in — we&apos;ll resend it.</Notice>
      <Link href="/login" className="text-sm text-[var(--muted)] hover:text-[var(--brand)]">Back to sign in</Link>
    </AuthShell>
  );
}
