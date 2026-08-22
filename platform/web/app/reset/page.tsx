import type { Metadata } from "next";
import Link from "next/link";
import { reset } from "../login/actions";
import { AuthShell, Field, Notice, SubmitButton } from "../../modules/rbac/ui";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default async function Reset({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  if (!token) {
    return (
      <AuthShell title="Reset link missing" lead="Open the link from your email, or request a new one.">
        <Link href="/forgot" className="text-sm text-[var(--muted)] hover:text-[var(--brand)]">Request a reset link</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Choose a new password" lead="Every other session will be signed out once you save it.">
      <form action={reset} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <Field label="New password (10+ characters)" name="password" type="password" autoComplete="new-password" minLength={10} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <SubmitButton>Save password</SubmitButton>
      </form>
    </AuthShell>
  );
}
