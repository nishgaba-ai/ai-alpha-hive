// Telegram — the board's pocket channel. Agents can notify allowed chats;
// the worker's poller (src/telegram.ts) lets the board approve, deny, ask
// for status and receive statements with /commands.

import { defineIntegration, strictSchema, fail } from "../../src/integrations/registry.js";

export const TG = "https://api.telegram.org/bot";

export function allowedChats(secrets: { get(n: string): string | undefined }): string[] {
  return (secrets.get("TELEGRAM_BOARD_CHAT_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export async function tgSend(token: string, chatId: string, text: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(`${TG}${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", ...extra }),
  });
  return (await res.json()) as { ok: boolean; description?: string; result?: { message_id: number } };
}

export async function tgSendDocument(token: string, chatId: string, filename: string, content: string, caption?: string) {
  const form = new FormData();
  form.set("chat_id", chatId);
  if (caption) form.set("caption", caption);
  form.set("document", new Blob([content], { type: "text/csv" }), filename);
  const res = await fetch(`${TG}${token}/sendDocument`, { method: "POST", body: form });
  return (await res.json()) as { ok: boolean; description?: string };
}

/**
 * Spoken reply. Telegram renders OGG/Opus and MP3 as a voice bubble via
 * sendVoice; anything else (m4a, wav) goes through sendAudio so it still
 * plays. The mime decides the method, field and filename.
 */
export async function tgSendVoice(token: string, chatId: string, audio: Buffer, mime: string, caption?: string) {
  const m = mime.toLowerCase();
  const ext = m.includes("ogg") || m.includes("opus") ? "ogg" : m.includes("mpeg") || m.includes("mp3") ? "mp3" : m.includes("mp4") || m.includes("m4a") ? "m4a" : m.includes("wav") ? "wav" : "bin";
  const asVoice = ext === "ogg" || ext === "mp3";
  const form = new FormData();
  form.set("chat_id", chatId);
  if (caption) form.set("caption", caption.slice(0, 1000));
  form.set(asVoice ? "voice" : "audio", new Blob([new Uint8Array(audio)], { type: mime }), `reply.${ext}`);
  const res = await fetch(`${TG}${token}/${asVoice ? "sendVoice" : "sendAudio"}`, { method: "POST", body: form });
  return (await res.json()) as { ok: boolean; description?: string };
}

export default defineIntegration({
  id: "telegram",
  auth: { kind: "api_key", guide: "Telegram bots use a token from @BotFather; there is no OAuth." },
  title: "Telegram",
  description: "Notify the board on Telegram; approve, deny and pull statements from your phone.",
  website: "https://core.telegram.org/bots",
  guidance: `
## What it does
- **notify** — \`telegram.notify\` sends a message to the board chats (internal, \`write\`).
- **Board commands** (handled by the worker, not by agents): \`/status\`, \`/approvals\`, \`/approve <id>\`, \`/deny <id> [note]\`, \`/statement 2026-08\`, \`/mission <text>\`, \`/ask <question>\`. Only chat ids in \`TELEGRAM_BOARD_CHAT_IDS\` are obeyed; everyone else gets silence.
- Approval requests are pushed to the board chats automatically with inline **Approve / Deny** buttons.

## Voice notes
- Send a voice note (or an audio file) to the bot instead of typing. The worker downloads it, transcribes it through the company's server STT and routes the words like a command: a note starting with **"mission …"** starts a mission, **"approve …"** / **"deny …"** followed by (the first characters of) a pending approval id decides it, anything else is asked of the board assistant.
- Needs server STT in the company config, since Telegram cannot transcribe in the browser for us:
  \`\`\`yaml
  voice:
    stt: openai        # openai | deepgram   (OPENAI_API_KEY or DEEPGRAM_API_KEY in the vault)
    tts: elevenlabs    # optional: openai | elevenlabs; the answer comes back as a voice bubble too
    voice_id: 21m00Tcm4TlvDq8ikWAM
  \`\`\`
- Without \`voice.stt\` the bot replies with a one-line hint naming the secret and the yaml line. Without \`voice.tts\` you get the text answer only.
- Each transcript is logged as \`telegram.voice\` (chat id + preview); the decision or mission it triggers is audited like a typed command.

## Getting credentials
1. Talk to @BotFather → \`/newbot\` → copy the token → \`TELEGRAM_BOT_TOKEN\`.
2. Start a chat with your bot (and have Surabhi do the same), then open \`https://api.telegram.org/bot<token>/getUpdates\` to read each \`chat.id\`; store them comma-separated as \`TELEGRAM_BOARD_CHAT_IDS\`.
3. Enable the integration; the worker starts polling on the next run.
`,
  secrets: [
    { name: "TELEGRAM_BOT_TOKEN", description: "Bot token from @BotFather", obtain: "https://t.me/BotFather" },
    { name: "TELEGRAM_BOARD_CHAT_IDS", description: "Comma-separated chat ids allowed to command the company", obtain: "getUpdates after messaging the bot" },
  ],
  modes: [{ id: "notify", title: "Notify", description: "Message the board chats", sideEffect: "write" }],
  methods: [
    {
      name: "notify",
      mode: "notify",
      description: "Send a short message to the board's Telegram chats.",
      input: strictSchema({ text: { type: "string", maxLength: 3000 } }),
      async handler(ctx, input) {
        const token = ctx.secrets.get("TELEGRAM_BOT_TOKEN");
        const chats = allowedChats(ctx.secrets);
        if (!token || !chats.length) return fail("missing_secret", "TELEGRAM_BOT_TOKEN and TELEGRAM_BOARD_CHAT_IDS must be in the vault");
        const results = await Promise.all(chats.map((c) => tgSend(token, c, `*${ctx.company.name}* · ${ctx.agent.name}\n${input.text}`)));
        return { ok: results.every((r) => r.ok), sent: results.filter((r) => r.ok).length };
      },
    },
  ],
  async healthcheck(ctx) {
    const token = ctx.secrets.get("TELEGRAM_BOT_TOKEN");
    if (!token) return { ok: false, detail: "TELEGRAM_BOT_TOKEN missing" };
    const res = await fetch(`${TG}${token}/getMe`);
    const body = (await res.json()) as { ok: boolean; result?: { username?: string } };
    return body.ok ? { ok: true, detail: `@${body.result?.username}` } : { ok: false, detail: "token rejected" };
  },
});
