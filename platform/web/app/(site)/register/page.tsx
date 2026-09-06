import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { acceptInviteAsCurrentUser, getSession } from "../../../lib/auth";
import { peekInvite } from "../../../lib/invites";
import { register } from "../login/actions";
import { AuthShell, Field, Notice, SubmitButton } from "../../../modules/rbac/ui";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create your Nish Alpha Hive account.",
  robots: { index: false },
};

export default async function Register({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; invite?: string }>;
}) {
  const q = await searchParams;
  const session = await getSession();
  if (session) {
    if (q.invite) {
      const res = acceptInviteAsCurrentUser(session, q.invite);
      redirect("/c?msg=" + encodeURIComponent(res.ok ? `You joined ${res.orgName} as ${res.role}.` : res.error));
    }
    redirect("/dashboard");
  }
  const invite = q.invite ? peekInvite(q.invite) : null;

  return (
    <AuthShell
      title={invite ? `Join ${invite.orgName}` : "Create your account"}
      lead={invite ? `You are invited as ${invite.orgRole}. Create your account with ${invite.email} and the invite is accepted at your first sign-in.` : "A personal workspace is created with it — launch your first product right after."}
    >
      {q.invite && !invite ? <Notice tone="error">This invite link is invalid, expired or already used. You can still create an account.</Notice> : null}
      <form action={register} className="space-y-4">
        {invite ? <input type="hidden" name="invite" value={q.invite} /> : null}
        <Field label="Name" name="name" type="text" autoComplete="name" />
        <Field label="Email" name="email" type="email" autoComplete="email" defaultValue={invite?.email} />
        <Field label="Password (10+ characters)" name="password" type="password" autoComplete="new-password" minLength={10} />
        {q.error ? <Notice tone="error">{q.error}</Notice> : null}
        <SubmitButton>{invite ? "Create account and join" : "Create account"}</SubmitButton>
      </form>
      <p className="mt-6 text-sm text-[var(--muted)]">
        Already have one?{" "}
        <Link href={invite ? `/login?invite=${encodeURIComponent(q.invite ?? "")}` : "/login"} className="hover:text-[var(--brand)]">Sign in</Link>
      </p>
    </AuthShell>
  );
}
