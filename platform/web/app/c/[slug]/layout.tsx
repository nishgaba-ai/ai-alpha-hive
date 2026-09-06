import { notFound } from "next/navigation";
import { hiveOr, type CompanySummary } from "../../../lib/hive";
import { Rail } from "../../../components/company/Rail";

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const company = await hiveOr<CompanySummary | null>(`/api/companies/${slug}`, null);
  if (!company) notFound();
  return (
    <div className="mx-auto flex max-w-[1400px] gap-6 px-5 py-6">
      <Rail slug={slug} name={company.name} status={company.status} pending={company.pending_approvals} running={company.running} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
