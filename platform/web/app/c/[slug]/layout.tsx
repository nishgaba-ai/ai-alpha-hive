import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { companyRole } from "../../../lib/rbac";
import { hiveOr, type CompanySummary } from "../../../lib/hive";
import { Rail } from "../../../components/company/Rail";

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/c/${slug}`);

  // Company-level access (lib/rbac.ts): no row, no page — but a friendly
  // card rather than a 404, since the company may well exist.
  const role = companyRole(session, slug);
  if (!role) {
    return (
      <div className="mx-auto max-w-[1400px] px-5 py-12">
        <div className="card mx-auto max-w-lg p-8 text-center">
          <p className="label">Access</p>
          <h1 className="font-display mt-1 text-2xl">You do not have access to this company</h1>
          <p className="mt-3 text-sm text-[var(--ink-2)]">
            Signed in as {session.email}. Ask the board to grant you a role on this company from its Access page.
          </p>
          <Link href="/c" className="btn btn-glass mt-6 inline-flex">Back to the group</Link>
        </div>
      </div>
    );
  }

  const company = await hiveOr<CompanySummary | null>(`/api/companies/${slug}`, null);
  if (!company) notFound();
  return (
    <div className="mx-auto flex max-w-[1400px] gap-6 px-5 py-6">
      <Rail slug={slug} name={company.name} status={company.status} pending={company.pending_approvals} running={company.running} role={role} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
