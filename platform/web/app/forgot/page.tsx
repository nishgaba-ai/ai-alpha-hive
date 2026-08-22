import type { Metadata } from "next";
import Link from "next/link";
import { forgot } from "../login/actions";
import { AuthShell, Field, Notice, SubmitButton } from "../../modules/rbac/ui";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false } };

export default async function Forgot({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  return (
    <AuthShell title="Reset your password" lead="We'll email you a single-use link that works for 30 minutes.">
      {sent ? (
        <Notice>If an account exists for that email, a reset link is on its way.</Notice>
      ) : (
        <form action={forgot} className="space-y-4">
          <Field label="Email" name="email" type="email" autoComplete="email" />
          <SubmitButton>Send reset link</SubmitButton>
        </form>
      )}
      <p className="mt-6 text-sm text-[var(--muted)]">
        <Link href="/login" className="hover:text-[var(--brand)]">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}
