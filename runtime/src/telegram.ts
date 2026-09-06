// Board-side Telegram: pushes approvals to the board chats and long-polls
// for commands. Runs inside the worker for every company that enabled the
// telegram integration and has the two secrets.

import { all, one } from "./db.js";
import { subscribe } from "./bus.js";
import { resolver } from "./vault.js";
import { allowedChats, tgSend, tgSendDocument, TG } from "../integrations/telegram/index.js";
import type { Registry } from "./registry.js";
import { decideApproval } from "./harness/loop.js";
import { statementCsv } from "./erp.js";
import { askBoard } from "./board.js";
import { startMission } from "./scheduler.js";
import type { ApprovalRow } from "./types.js";

type Update = {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
};

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
            const text = u.message?.text?.trim() ?? "";
            if (!text.startsWith("/")) continue;
            const [cmd, ...rest] = text.split(/\s+/);
            const reply = await handleCommand(registry, entry.company.id, cmd, rest, chatId);
            if (reply.document) await tgSendDocument(token, chatId, reply.document.name, reply.document.content, reply.text);
            else await tgSend(token, chatId, reply.text);
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

async function handleCommand(registry: Registry, companyId: string, cmd: string, args: string[], chatId: string): Promise<{ text: string; document?: { name: string; content: string } }> {
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
      return { text: "Commands: /status /approvals /approve <id> /deny <id> [note] /statement YYYY-MM /mission <text> /ask <question>" };
  }
}
