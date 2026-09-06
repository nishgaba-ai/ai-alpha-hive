import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { acceptInviteAsCurrentUser, getSession } from "../../../lib/auth";
import { peekInvite } from "../../../lib/invites";
import { login } from "./actions";
import { AuthShell, Field, Notice, SubmitButton } from "../../../modules/rbac/ui";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Nish Alpha Hive dashboard.",
  robots: { index: false },
};

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; registered?: string; verified?: string; reset?: string; invite?: string }>;
}) {
  const q = await searchParams;
  const session = await getSession();
  if (session) {
    // Already signed in and holding an invite link: accept it for this
    // account and land in the new organisation.
    if (q.invite) {
      const res = acceptInviteAsCurrentUser(session, q.invite);
      redirect("/c?msg=" + encodeURIComponent(res.ok ? `You joined ${res.orgName} as ${res.role}.` : res.error));
    }
    redirect("/dashboard");
  }
  const invite = q.invite ? peekInvite(q.invite) : null;

  return (
    <AuthShell title="Sign in" lead="Access your products, deployments, and infrastructure.">
      {q.registered ? <Notice>Check your inbox to verify your email, then sign in.</Notice> : null}
      {q.verified ? <Notice>Email verified — sign in to continue.</Notice> : null}
      {q.reset ? <Notice>Password updated. All other sessions were signed out.</Notice> : null}
      {q.invite ? (
        invite ? (
          <Notice>
            You are invited to join <strong>{invite.orgName}</strong> as {invite.orgRole}. Sign in as {invite.email} to accept.
          </Notice>
        ) : (
          <Notice tone="error">This invite link is invalid, expired or already used. You can still sign in.</Notice>
        )
      ) : null}
      <form action={login} className="space-y-4">
        {invite ? <input type="hidden" name="invite" value={q.invite} /> : null}
        <Field label="Email" name="email" type="email" autoComplete="email" defaultValue={invite?.email} />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
        {q.error ? <Notice tone="error">{q.error}</Notice> : null}
        <SubmitButton>{invite ? "Sign in and accept" : "Sign in"}</SubmitButton>
      </form>
      <p className="mt-6 flex justify-between text-sm text-[var(--muted)]">
        <Link href={invite ? `/register?invite=${encodeURIComponent(q.invite ?? "")}` : "/register"} className="hover:text-[var(--brand)]">Create an account</Link>
        <Link href="/forgot" className="hover:text-[var(--brand)]">Forgot password?</Link>
      </p>
    </AuthShell>
  );
}
