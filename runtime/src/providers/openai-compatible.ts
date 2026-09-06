// OpenAI-compatible chat completions: OpenRouter, Ollama (/v1), vLLM,
// LM Studio, Groq, Together… Anything that speaks the tools/function-call
// shape. No SDK dependency — one fetch.

import type { ChatMessage, ChatRequest, ChatResponse, Provider, ToolCall } from "./types.js";

type OAIMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

function toOAI(system: string, messages: ChatMessage[]): OAIMessage[] {
  const out: OAIMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant")
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls?.length
          ? m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } }))
          : undefined,
      });
    else out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
  }
  return out;
}

export function openaiCompatibleProvider(
  id: string,
  opts: { baseURL: string; apiKey?: string; headers?: Record<string, string>; price?: [number, number] },
): Provider {
  const base = opts.baseURL.replace(/\/$/, "");
  return {
    id,
    kind: "openai-compatible",
    price() {
      return opts.price ?? [0, 0];
    },
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: toOAI(req.system, req.messages),
        max_tokens: req.maxTokens ?? 8192,
      };
      if (req.tools.length) {
        body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input } }));
        body.tool_choice = "auto";
      }
      // OpenRouter reasoning effort passthrough; ignored by servers that don't support it.
      if (req.effort && base.includes("openrouter")) body.reasoning = { effort: req.effort === "xhigh" || req.effort === "max" ? "high" : req.effort };
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
          ...(opts.headers ?? {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`${id}: HTTP ${res.status} ${t.slice(0, 500)}`);
      }
      const data = (await res.json()) as {
        choices: { message: { content?: string | null; tool_calls?: { id?: string; function: { name: string; arguments: string } }[] }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
        model?: string;
      };
      const choice = data.choices?.[0];
      const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? []).map((c, i) => {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(c.function.arguments || "{}");
        } catch {
          input = { _raw: c.function.arguments };
        }
        return { id: c.id ?? `call_${Date.now()}_${i}`, name: c.function.name, input };
      });
      return {
        text: choice?.message.content ?? "",
        toolCalls,
        stop: toolCalls.length ? "tool_use" : choice?.finish_reason === "length" ? "max_tokens" : "end",
        usage: {
          input: data.usage?.prompt_tokens ?? 0,
          output: data.usage?.completion_tokens ?? 0,
          cacheRead: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        },
      };
    },
  };
}
