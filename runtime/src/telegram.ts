// Board-side Telegram: pushes approvals to the board chats and long-polls
// for commands. Runs inside the worker for every company that enabled the
// telegram integration and has the two secrets. Voice notes are
// transcribed through the company's configured STT and routed like text
// commands; when TTS is configured the answer is spoken back.

import { all, one } from "./db.js";
import { emit, subscribe } from "./bus.js";
import { resolver } from "./vault.js";
import { allowedChats, tgSend, tgSendDocument, tgSendVoice, TG } from "../integrations/telegram/index.js";
import type { Entry, Registry } from "./registry.js";
import { decideApproval } from "./harness/loop.js";
import { statementCsv } from "./erp.js";
import { askBoard } from "./board.js";
import { startMission } from "./scheduler.js";
import { synthesize, transcribe, type VoiceConfig } from "./voice.js";
import type { ApprovalRow, SecretResolver } from "./types.js";

type TgFile = { file_id: string; mime_type?: string; duration?: number };
type Update = {
  update_id: number;
  message?: { chat: { id: number }; text?: string; voice?: TgFile; audio?: TgFile };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
};

type Reply = { text: string; document?: { name: string; content: string }; speak?: boolean };

export function startTelegram(registry: Registry): () => void {
  const stops: (() => void)[] = [];
  for (const entry of registry.all()) {
    const enabled = one("SELECT 1 FROM integrations_enabled WHERE company_id = ? AND integration_id = 'telegram'", entry.company.id);
    if (!enabled) continue;
    const secrets = resolver(entry.company.id);
    const token = secrets.get("TELEGRAM_BOT_TOKEN");
    const chats = allowedChats(secrets);
    if (!token || !chats.length) continue;
    const slug = entry.company.slug;

    // push approvals
    stops.push(
      subscribe(entry.company.id, (e) => {
        if (e.type !== "approval.requested") return;
        const p = e.payload as { approval_id: string; tool: string; side_effect: string; reason: string; amount?: number; input?: Record<string, unknown> };
        const text = [
          `*${entry.company.name}* needs a decision`,
          `Tool: \`${p.tool}\` (${p.side_effect})`,
          `Why: ${p.reason}`,
          p.amount ? `Amount: ${(p.amount / 100).toFixed(2)} ${entry.company.currency}` : "",
          p.input?.text ? `\n${String(p.input.text).slice(0, 800)}` : p.input?.reason ? `\n${String(p.input.reason).slice(0, 500)}` : "",
          `\nid: \`${p.approval_id}\``,
        ].filter(Boolean).join("\n");
        const markup = { inline_keyboard: [[{ text: "Approve", callback_data: `a:${slug}:${p.approval_id}` }, { text: "Deny", callback_data: `d:${slug}:${p.approval_id}` }]] };
        for (const c of chats) tgSend(token, c, text, { reply_markup: markup }).catch(() => {});
      }),
    );

    // poll commands
    let offset = 0;
    let alive = true;
    const loop = async () => {
      while (alive) {
        try {
          const res = await fetch(`${TG}${token}/getUpdates?timeout=25&offset=${offset}`);
          const body = (await res.json()) as { ok: boolean; result?: Update[] };
          for (const u of body.result ?? []) {
            offset = u.update_id + 1;
            const chatId = String(u.message?.chat.id ?? u.callback_query?.message?.chat.id ?? "");
            if (!chats.includes(chatId)) continue;
            if (u.callback_query?.data) {
              const [kind, s, id] = u.callback_query.data.split(":");
              const target = registry.bySlug(s);
              if (target) {
                try {
                  await decideApproval(target.deps, id, kind === "a" ? "approved" : "denied", `telegram:${chatId}`);
                  await tgSend(token, chatId, `${kind === "a" ? "Approved" : "Denied"} \`${id}\``);
                } catch (e) {
                  await tgSend(token, chatId, `Could not decide: ${(e as Error).message}`);
                }
              }
              await fetch(`${TG}${token}/answerCallbackQuery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callback_query_id: u.callback_query.id }) });
              continue;
            }
            const file = u.message?.voice ?? u.message?.audio;
            if (file) {
              const reply = await handleVoice(registry, entry, token, secrets, chatId, file);
              await deliver(entry, token, secrets, chatId, reply);
              continue;
            }
            const text = u.message?.text?.trim() ?? "";
            if (!text.startsWith("/")) continue;
            const [cmd, ...rest] = text.split(/\s+/);
            const reply = await handleCommand(registry, entry.company.id, cmd, rest, chatId);
            await deliver(entry, token, secrets, chatId, reply);
          }
        } catch {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    };
    loop();
    stops.push(() => {
      alive = false;
    });
  }
  return () => stops.forEach((s) => s());
}

function voiceConfig(entry: Entry): VoiceConfig {
  return ((entry.loaded.config as unknown as { voice?: VoiceConfig }).voice ?? {}) as VoiceConfig;
}

/** Text (or document) reply; a spoken copy follows when asked for and the company has server TTS. */
async function deliver(entry: Entry, token: string, secrets: SecretResolver, chatId: string, reply: Reply): Promise<void> {
  if (reply.document) await tgSendDocument(token, chatId, reply.document.name, reply.document.content, reply.text);
  else await tgSend(token, chatId, reply.text);
  const cfg = voiceConfig(entry);
  if (!reply.speak || !cfg.tts || cfg.tts === "browser") return;
  try {
    const { audio, mime } = await synthesize(cfg, secrets, reply.text.replace(/[`*_]/g, "").slice(0, 1500));
    await tgSendVoice(token, chatId, audio, mime);
  } catch {
    /* text already delivered; a TTS hiccup is not worth a second message */
  }
}

/** Download a voice note, transcribe it, and route the transcript like a typed command. */
async function handleVoice(registry: Registry, entry: Entry, token: string, secrets: SecretResolver, chatId: string, file: TgFile): Promise<Reply> {
  const cfg = voiceConfig(entry);
  if (cfg.stt !== "openai" && cfg.stt !== "deepgram") {
    return { text: "Voice notes need server STT: store OPENAI_API_KEY (or DEEPGRAM_API_KEY) in the vault and set `voice: { stt: openai }` (or `deepgram`) in the company yaml." };
  }
  let transcript: string;
  try {
    const meta = (await (await fetch(`${TG}${token}/getFile?file_id=${encodeURIComponent(file.file_id)}`)).json()) as { ok: boolean; result?: { file_path?: string }; description?: string };
    if (!meta.ok || !meta.result?.file_path) return { text: `Could not fetch the voice note: ${meta.description ?? "no file path"}` };
    const dl = await fetch(`https://api.telegram.org/file/bot${token}/${meta.result.file_path}`);
    if (!dl.ok) return { text: `Could not download the voice note: HTTP ${dl.status}` };
    const audio = Buffer.from(await dl.arrayBuffer());
    transcript = (await transcribe(cfg, secrets, audio, file.mime_type ?? "audio/ogg")).text.trim();
  } catch (e) {
    return { text: `Could not transcribe: ${(e as Error).message}` };
  }
  if (!transcript) return { text: "I could not make out any words in that voice note." };
  emit(entry.company.id, "telegram.voice", { chat_id: chatId, transcript_preview: transcript.slice(0, 200) });

  const words = transcript.replace(/^[\s\p{P}]+/u, "").split(/\s+/);
  const head = (words[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
  let reply: Reply;
  if (head === "mission" && words.length > 1) {
    reply = await handleCommand(registry, entry.company.id, "/mission", words.slice(1), chatId);
  } else if ((head === "approve" || head === "deny") && words.length > 1) {
    // Spoken ids are rarely exact; match a prefix of a pending approval id, else let the assistant find it by name.
    const spoken = words[1].replace(/[^0-9a-z]/gi, "");
    const pending = all<{ id: string }>("SELECT id FROM approvals WHERE company_id = ? AND status = 'pending' ORDER BY created_at", entry.company.id);
    const hit = spoken.length >= 4 ? pending.find((p) => p.id.toLowerCase().startsWith(spoken.toLowerCase())) : undefined;
    reply = hit
      ? await handleCommand(registry, entry.company.id, `/${head}`, [hit.id, ...words.slice(2)], chatId)
      : await handleCommand(registry, entry.company.id, "/ask", words, chatId);
  } else {
    reply = await handleCommand(registry, entry.company.id, "/ask", words, chatId);
  }
  return { ...reply, text: `\u{1F399} "${transcript.slice(0, 300)}"\n\n${reply.text}`.slice(0, 3900), speak: true };
}

async function handleCommand(registry: Registry, companyId: string, cmd: string, args: string[], chatId: string): Promise<Reply> {
  const entry = registry.all().find((e) => e.company.id === companyId)!;
  switch (cmd) {
    case "/status": {
      const agents = all<{ name: string; status: string }>("SELECT name, status FROM agents WHERE company_id = ?", companyId);
      const pending = one<{ n: number }>("SELECT COUNT(*) AS n FROM approvals WHERE company_id = ? AND status = 'pending'", companyId)?.n ?? 0;
      const tasks = one<{ open: number; done: number }>("SELECT SUM(status IN ('ready','running','parked','planned')) AS open, SUM(status='done') AS done FROM tasks WHERE company_id = ?", companyId);
      return { text: `*${entry.company.name}*\nAgents: ${agents.map((a) => `${a.name} (${a.status})`).join(", ")}\nTasks: ${tasks?.open ?? 0} open, ${tasks?.done ?? 0} done\nPending approvals: ${pending}` };
    }
    case "/approvals": {
      const rows = all<ApprovalRow>("SELECT * FROM approvals WHERE company_id = ? AND status = 'pending' ORDER BY created_at LIMIT 10", companyId);
      if (!rows.length) return { text: "Nothing pending." };
      return { text: rows.map((r) => `\`${r.id}\` ${r.tool} (${r.side_effect}) — ${(JSON.parse(r.request_json) as { reason?: string }).reason ?? ""}`).join("\n") };
    }
    case "/approve":
    case "/deny": {
      const id = args[0];
      if (!id) return { text: `usage: ${cmd} <approval id> [note]` };
      try {
        await decideApproval(entry.deps, id, cmd === "/approve" ? "approved" : "denied", `telegram:${chatId}`, args.slice(1).join(" ") || undefined);
        return { text: `${cmd === "/approve" ? "Approved" : "Denied"} \`${id}\`` };
      } catch (e) {
        return { text: `Could not decide: ${(e as Error).message}` };
      }
    }
    case "/statement": {
      const period = args[0] ?? new Date().toISOString().slice(0, 7);
      return { text: `Statement ${period} for ${entry.company.name}`, document: { name: `${entry.company.slug}-${period}.csv`, content: statementCsv(companyId, period) } };
    }
    case "/mission": {
      const text = args.join(" ");
      if (!text) return { text: "usage: /mission <what the company should achieve>" };
      const t = startMission(entry.deps, text, `telegram:${chatId}`);
      return { text: `Mission started: \`${t.id}\`` };
    }
    case "/ask": {
      const q = args.join(" ");
      if (!q) return { text: "usage: /ask <question about the company>" };
      const a = await askBoard(entry.deps, q, `telegram:${chatId}`);
      return { text: a.text.slice(0, 3500) };
    }
    default:
      return { text: "Commands: /status /approvals /approve <id> /deny <id> [note] /statement YYYY-MM /mission <text> /ask <question> — or send a voice note." };
  }
}
