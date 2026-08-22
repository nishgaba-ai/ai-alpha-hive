import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import { login } from "./actions";
import { AuthShell, Field, Notice, SubmitButton } from "../../modules/rbac/ui";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Nish Alpha Hive dashboard.",
  robots: { index: false },
};

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; registered?: string; verified?: string; reset?: string }>;
}) {
  if (await getSession()) redirect("/dashboard");
  const q = await searchParams;

  return (
    <AuthShell title="Sign in" lead="Access your products, deployments, and infrastructure.">
      {q.registered ? <Notice>Check your inbox to verify your email, then sign in.</Notice> : null}
      {q.verified ? <Notice>Email verified — sign in to continue.</Notice> : null}
      {q.reset ? <Notice>Password updated. All other sessions were signed out.</Notice> : null}
      <form action={login} className="space-y-4">
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
        {q.error ? <Notice tone="error">{q.error}</Notice> : null}
        <SubmitButton>Sign in</SubmitButton>
      </form>
      <p className="mt-6 flex justify-between text-sm text-[var(--muted)]">
        <Link href="/register" className="hover:text-[var(--brand)]">Create an account</Link>
        <Link href="/forgot" className="hover:text-[var(--brand)]">Forgot password?</Link>
      </p>
    </AuthShell>
  );
}
