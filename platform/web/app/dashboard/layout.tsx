import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import { logout } from "../login/actions";

// Server-side guard — the enforcement point, not the UI (spec §7).
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <>
      <div className="border-y border-[var(--line)] bg-[var(--panel)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-2.5 text-sm">
          <span className="text-[var(--muted)]">
            Signed in as <span className="text-[var(--ink)]">{session.email}</span>
            <span className="ml-3 font-mono text-[11px] text-[var(--brand)]">
              rbac@bootstrap
            </span>
          </span>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border border-[var(--line)] px-3 py-1 text-[var(--muted)] hover:border-[var(--brand-dim)] hover:text-[var(--ink)]"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
      {children}
    </>
  );
}
