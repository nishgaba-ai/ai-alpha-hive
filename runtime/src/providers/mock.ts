// Deterministic provider for tests, demos and UI work. Behaves like a
// sensible agent: the executive plans, workers read, draft, then try one
// gated action so the approvals inbox has something real to show.

import type { ChatRequest, ChatResponse, Provider } from "./types.js";

function has(req: ChatRequest, name: string) {
  return req.tools.some((t) => t.name === name);
}
function calls(req: ChatRequest, name: string) {
  return req.messages.filter((m) => m.role === "assistant").flatMap((m) => m.toolCalls ?? []).filter((c) => c.name === name).length;
}
function lastToolResult(req: ChatRequest) {
  const last = [...req.messages].reverse().find((m) => m.role === "tool");
  return last && last.role === "tool" ? last : undefined;
}

let n = 0;
const id = () => `mock_${Date.now()}_${n++}`;
const usage = { input: 1200, output: 180, cacheRead: 900 };

export function mockProvider(): Provider {
  return {
    id: "mock",
    kind: "mock",
    price() {
      return [0, 0];
    },
    async chat(req): Promise<ChatResponse> {
      const first = req.messages[0];
      const brief = first?.role === "user" ? first.content : "";
      const mission = /Mission:\s*(.+)/.exec(brief)?.[1]?.trim() ?? "the mission";
      const roles = [...brief.matchAll(/^- (\w[\w-]*) \(/gm)].map((m) => m[1]);
      const workers = roles.filter((r) => r !== "ceo" && r !== "cmo") ;

      // Executive: plan once.
      if (has(req, "task__plan") && calls(req, "task__plan") === 0) {
        const pick = (pref: string[]) => workers.find((w) => pref.some((p) => w.includes(p))) ?? workers[0] ?? "ceo";
        const tasks = [
          { key: "research", title: "Research the audience and competitors", intent: `Ground ${mission} in what the market actually says`, acceptance: "A research artifact with three sourced findings", owner_role: pick(["research", "marketer", "writer"]), depends_on: [], budget_cap: 50000, priority: 1 },
          { key: "draft", title: "Draft the launch announcement", intent: "One post the founder would sign", acceptance: "A draft saved with reader, claim and sources", owner_role: pick(["writer", "marketer"]), depends_on: ["research"], budget_cap: 50000, priority: 2 },
          { key: "publish", title: "Publish the announcement", intent: "Get the announcement in front of the audience", acceptance: "Post published after board approval", owner_role: pick(["marketer", "paid", "writer"]), depends_on: ["draft"], budget_cap: 20000, priority: 2 },
        ];
        if (roles.includes("engineer")) {
          tasks.push({ key: "ship", title: "Ship the landing page preview", intent: "A gate-passing preview URL", acceptance: "hive check green and a preview URL in the task", owner_role: "engineer", depends_on: [], budget_cap: 80000, priority: 1 });
        }
        return { text: `Planning ${mission}.`, toolCalls: [{ id: id(), name: "task__plan", input: { mission, tasks } }], stop: "tool_use", usage };
      }
      if (has(req, "task__plan")) return { text: "Plan is in place. I will review outcomes when the team reports.", toolCalls: [], stop: "end", usage };

      // Workers: read → act → gated action → done.
      const step = req.messages.filter((m) => m.role === "assistant").length;
      const last = lastToolResult(req);
      if (last && /parked|waiting for the board/i.test(last.content)) {
        return { text: "Parked for the board; I will continue once decided.", toolCalls: [], stop: "end", usage };
      }
      if (step === 0 && has(req, "task__list")) {
        return { text: "Checking the board.", toolCalls: [{ id: id(), name: "task__list", input: {} }], stop: "tool_use", usage };
      }
      if (step <= 1 && has(req, "content__draft") && calls(req, "content__draft") === 0) {
        return {
          text: "Drafting.",
          toolCalls: [{ id: id(), name: "content__draft", input: { kind: "post", title: "Launch: eight checks before anything goes live", body_md: "We launch products through eight deterministic checks. If one fails, nothing ships. Here is what that means for you.", meta: { reader: "founders", sources: ["docs/gates.md"] } } }],
          stop: "tool_use", usage,
        };
      }
      if (has(req, "hive__check") && calls(req, "hive__check") === 0) {
        return { text: "Running gates.", toolCalls: [{ id: id(), name: "hive__check", input: {} }], stop: "tool_use", usage };
      }
      if (has(req, "linkedin__post") && calls(req, "linkedin__post") === 0) {
        return {
          text: "Ready to publish.",
          toolCalls: [{ id: id(), name: "linkedin__post", input: { text: "We launch products through eight deterministic checks. If one fails, nothing ships.", reason: "Launch announcement for the mission; audience: founders." } }],
          stop: "tool_use", usage,
        };
      }
      if (has(req, "content__publish") && calls(req, "content__publish") === 0) {
        const draft = /draft_id":"([^"]+)/.exec(req.messages.map((m) => (m.role === "tool" ? m.content : "")).join(" "))?.[1] ?? "unknown";
        return { text: "Requesting publish.", toolCalls: [{ id: id(), name: "content__publish", input: { draft_id: draft, reason: "Draft reviewed against the voice; ready for the board." } }], stop: "tool_use", usage };
      }
      if (has(req, "artifact__save") && calls(req, "artifact__save") === 0) {
        return { text: "Recording findings.", toolCalls: [{ id: id(), name: "artifact__save", input: { kind: "report", ref: "research-notes", meta: { findings: ["Founders search for 'launch checklist' before shipping", "Competitors promise speed, not verification", "Nobody shows the checks"] } } }], stop: "tool_use", usage };
      }
      return { text: "Done. Summary: completed the task within budget; artifacts recorded.", toolCalls: [], stop: "end", usage };
    },
  };
}
