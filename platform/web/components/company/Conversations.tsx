import Link from "next/link";
import { ago } from "../../lib/hive";
import { Card, Label, Badge, Empty } from "../ui";

export type Thread = { id: string; channel: string; thread_id: string; from_id: string; from_name: string | null; body: string; ts: number; read_at: number | null; replied_at: number | null; count: number; unread: number };
export type Inbound = { id: string; channel: string; thread_id: string; from_id: string; from_name: string | null; body: string; ts: number; read_at: number | null; replied_at: number | null };

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger", discord: "Discord" };

/** Inbound conversations from messaging channels; replies go out through the agents' gated send tools. */
export function Conversations({ slug, threads, open, messages, markRead }: { slug: string; threads: Thread[]; open?: { channel: string; thread_id: string }; messages: Inbound[]; markRead: (form: FormData) => Promise<void> }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card className="p-0">
        <div className="border-b border-[var(--hairline)] px-4 py-3"><Label>Threads · {threads.length}</Label></div>
        {threads.length === 0 ? <div className="p-4"><Empty>No inbound messages yet. Connect WhatsApp, Instagram or Messenger and point the Meta webhook at this company.</Empty></div> : null}
        <ul className="max-h-[520px] overflow-y-auto">
          {threads.map((t) => {
            const active = open && open.channel === t.channel && open.thread_id === t.thread_id;
            return (
              <li key={`${t.channel}:${t.thread_id}`}>
                <Link href={`/c/${slug}/inbox?tab=conversations&channel=${t.channel}&thread=${encodeURIComponent(t.thread_id)}`} className={`block border-b border-[var(--hairline)] px-4 py-3 text-sm hover:bg-[var(--surface-0)] ${active ? "bg-[var(--surface-0)]" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{t.from_name ?? t.from_id}</span>
                    <span className="shrink-0 text-[11px] text-[var(--muted)]">{ago(t.ts)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <Badge tone="muted">{CHANNEL_LABEL[t.channel] ?? t.channel}</Badge>
                    {t.unread ? <Badge tone="parked">{t.unread} new</Badge> : null}
                    {t.replied_at ? <Badge tone="live">replied</Badge> : null}
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-[var(--ink-2)]">{t.body}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card>
        {!open ? <Empty>Pick a thread. Agents with the channel&apos;s send tool answer these; first contact parks for you, replies flow.</Empty> : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{messages[0]?.from_name ?? open.thread_id}</p>
                <p className="text-xs text-[var(--muted)]">{CHANNEL_LABEL[open.channel] ?? open.channel} · {open.thread_id}</p>
              </div>
              <form action={markRead}>
                <input type="hidden" name="slug" value={slug} /><input type="hidden" name="channel" value={open.channel} /><input type="hidden" name="thread_id" value={open.thread_id} />
                <button className="btn btn-ghost py-1 text-xs" type="submit">Mark read</button>
              </form>
            </div>
            <div className="mt-4 space-y-2">
              {[...messages].reverse().map((m) => (
                <div key={m.id} className={`max-w-[80%] rounded-[var(--r-2)] px-3 py-2 text-sm ${m.read_at ? "bg-[var(--surface-0)]" : "bg-[var(--surface-0)] ring-1 ring-[var(--parked)]"}`}>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">{ago(m.ts)} ago</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-[var(--muted)]">To reply, give a role the channel&apos;s send tool (for WhatsApp: <code className="font-mono">whatsapp.send_text</code>) and ask it, or start a mission. Outgoing messages stay gated.</p>
          </>
        )}
      </Card>
    </div>
  );
}
