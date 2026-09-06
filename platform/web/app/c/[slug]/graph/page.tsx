import { hive, type CompanySummary, type Graph } from "../../../../lib/hive";
import { PageTitle } from "../../../../components/ui";
import { AgentGraph } from "../../../../components/company/AgentGraph";
import { FloorToggle } from "../../../../components/company/FloorToggle";

export const dynamic = "force-dynamic";

export default async function GraphPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [c, graph] = await Promise.all([hive<CompanySummary>(`/api/companies/${slug}`), hive<Graph>(`/api/companies/${slug}/graph`)]);
  return (
    <main>
      <PageTitle eyebrow="The organisation" title="Org graph">
        <FloorToggle slug={slug} initial={graph} />
      </PageTitle>
      <p className="-mt-3 mb-4 text-sm text-[var(--muted)]">Board → executive → team leads → members. Green edges are working now; amber beacons are waiting for you. Scroll to zoom, drag to pan.</p>
      <AgentGraph slug={slug} currency={c.currency} initial={graph} height={720} pending={c.pending_approvals} />
    </main>
  );
}
