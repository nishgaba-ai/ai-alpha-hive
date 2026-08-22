import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import { register } from "../login/actions";
import { AuthShell, Field, Notice, SubmitButton } from "../../modules/rbac/ui";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create your Nish Alpha Hive account.",
  robots: { index: false },
};

export default async function Register({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getSession()) redirect("/dashboard");
  const { error } = await searchParams;

  return (
    <AuthShell title="Create your account" lead="A personal workspace is created with it — launch your first product right after.">
      <form action={register} className="space-y-4">
        <Field label="Name" name="name" type="text" autoComplete="name" />
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Password (10+ characters)" name="password" type="password" autoComplete="new-password" minLength={10} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <SubmitButton>Create account</SubmitButton>
      </form>
      <p className="mt-6 text-sm text-[var(--muted)]">
        Already have one?{" "}
        <Link href="/login" className="hover:text-[var(--brand)]">Sign in</Link>
      </p>
    </AuthShell>
  );
}
