import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import { login } from "./actions";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Nish Alpha Hive dashboard.",
  robots: { index: false },
};

// The "standard" login template preset (docs/specs/login-rbac.md §2),
// rendered by the rbac module. Custom/advanced presets add branding slots,
// phone OTP, and 2FA on this same form contract.
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getSession()) redirect("/dashboard");
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex max-w-md flex-col px-6 py-20">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--brand)]">
        rbac · standard preset
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Access your products, deployments, and infrastructure.
      </p>

      <form action={login} className="mt-8 space-y-4">
        <label className="block text-sm">
          <span className="text-[var(--muted)]">Email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="mt-1.5 w-full rounded-md border border-[var(--line)] bg-[var(--panel)] px-3.5 py-2.5 outline-none focus:border-[var(--brand-dim)]"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--muted)]">Password</span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="mt-1.5 w-full rounded-md border border-[var(--line)] bg-[var(--panel)] px-3.5 py-2.5 outline-none focus:border-[var(--brand-dim)]"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-[#e07a6a]">
            Invalid credentials.
          </p>
        ) : null}
        <button
          type="submit"
          className="w-full rounded-md bg-[var(--brand)] px-4 py-2.5 font-medium text-[#141005] hover:bg-[#f0bd52]"
        >
          Sign in
        </button>
      </form>

      <p className="mt-6 text-xs leading-relaxed text-[var(--muted)]">
        Registration, phone sign-in, forgot-password, and 2FA arrive with the
        full RBAC library — the spec is public in the{" "}
        <a
          href="https://github.com/nishgaba-ai/ai-alpha-hive/blob/main/docs/specs/login-rbac.md"
          className="underline decoration-[var(--brand-dim)] underline-offset-4"
        >
          engine repo
        </a>
        .
      </p>
    </main>
  );
}
