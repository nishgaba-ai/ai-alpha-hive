import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, listMemberships } from "../../lib/auth";
import { canCompany } from "../../lib/rbac";
import { hiveOr, workerUp, type CompanySummary } from "../../lib/hive";
import { logout } from "../(site)/login/actions";
import { ThemeToggle } from "../../components/ThemeToggle";
import { CompanySwitcher } from "../../components/company/CompanySwitcher";
import { OrgSwitcher } from "../../components/company/OrgSwitcher";
import { switchOrg } from "./switch-org/actions";

// Group shell: the board's view across every vertical. Session-guarded.
export default async function GroupLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login?next=/c");
  const up = await workerUp();
  // The switcher and the pending badge only cover companies this user can view.
  const companies = (up ? await hiveOr<CompanySummary[]>("/api/companies", []) : []).filter((c) => canCompany(session, c.slug, "company:view"));
  const pending = companies.reduce((s, c) => s + c.pending_approvals, 0);
  // The organisation menu only appears once an invite has put this person
  // in a second org; with one membership there is nothing to switch.
  const orgs = listMemberships(session.userId);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-[var(--hairline)] bg-[var(--surface-glass)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4">
          <Link href="/c" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block h-2.5 w-2.5 rotate-45 rounded-[2px] bg-gradient-to-br from-[var(--accent)] to-[var(--pink)]" />
            <span className="hidden sm:inline">Prodigal AI</span>
          </Link>
          <CompanySwitcher companies={companies.map((c) => ({ slug: c.slug, name: c.name, status: c.status, pending: c.pending_approvals }))} />
          <Link href="/c/new" className="btn btn-primary shrink-0 px-3.5 py-1.5 text-[13px]" title="Launch a company">
            <span aria-hidden>+</span>
            <span className="hidden md:inline">Launch a company</span>
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-2 text-sm">
            {!up ? (
              <span className="rounded-full bg-[rgba(239,71,111,0.12)] px-2.5 py-1 text-[11px] text-[var(--failed)]">worker offline</span>
            ) : pending ? (
              <Link href="/c" className="rounded-full bg-[rgba(245,158,11,0.14)] px-2.5 py-1 text-[11px] font-medium text-[var(--parked)]" title="Approvals waiting across companies">
                {pending} waiting
              </Link>
            ) : null}
            <ThemeToggle />
            {orgs.length > 1 ? <OrgSwitcher orgs={orgs} currentOrgId={session.orgId} action={switchOrg} /> : null}
            <span className="hidden max-w-[180px] truncate text-[var(--muted)] xl:inline">{session.email}</span>
            <form action={logout}>
              <button type="submit" className="btn btn-ghost px-2.5 py-1.5 text-[13px]">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
