import { hive, type CompanySummary } from "../../../../lib/hive";
import { PageTitle } from "../../../../components/ui";
import { VoiceConsole } from "../../../../components/company/VoiceConsole";

export const dynamic = "force-dynamic";

export default async function VoicePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await hive<CompanySummary & { config: { voice?: { stt?: string; tts?: string } } }>(`/api/companies/${slug}`);
  const v = c.config.voice ?? {};
  return (
    <main>
      <PageTitle eyebrow="Say it" title={`Talk to ${c.name}`} />
      <VoiceConsole slug={slug} serverTts={!!v.tts && v.tts !== "browser"} serverStt={!!v.stt && v.stt !== "browser"} />
    </main>
  );
}
