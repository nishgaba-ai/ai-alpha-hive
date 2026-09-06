// Anthropic provider. Adaptive thinking (default), effort from the role,
// strict tools, streaming for long outputs, refusal fallbacks on by default.

import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatRequest, ChatResponse, Provider, ToolCall } from "./types.js";

const PRICES: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-fable-5": [10, 50],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-opus-4-7": [5, 25],
  "claude-opus-4-6": [5, 25],
  "claude-sonnet-5": [2, 10],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-4-5": [1, 5],
};

function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  let pendingResults: Anthropic.ToolResultBlockParam[] = [];
  const flush = () => {
    if (pendingResults.length) {
      out.push({ role: "user", content: pendingResults });
      pendingResults = [];
    }
  };
  for (const m of messages) {
    if (m.role === "tool") {
      pendingResults.push({ type: "tool_result", tool_use_id: m.toolCallId, content: m.content, is_error: m.isError });
      continue;
    }
    flush();
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const c of m.toolCalls ?? []) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
      out.push({ role: "assistant", content: blocks.length ? blocks : [{ type: "text", text: "(no content)" }] });
    }
  }
  flush();
  return out;
}

export function anthropicProvider(id: string, opts: { apiKey?: string; baseURL?: string } = {}): Provider {
  const client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL });
  return {
    id,
    kind: "anthropic",
    price(model) {
      return PRICES[model] ?? [5, 25];
    },
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const tools: Anthropic.ToolUnion[] = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input as Anthropic.Tool.InputSchema,
        strict: true,
      }));
      const params = {
        model: req.model,
        max_tokens: req.maxTokens ?? 32000,
        system: [{ type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } }],
        messages: toAnthropicMessages(req.messages),
        tools,
        tool_choice: { type: "auto" as const },
        output_config: req.effort ? { effort: req.effort } : undefined,
      };
      let msg: Anthropic.Message;
      let fallbackModel: string | undefined;
      try {
        // Server-side refusal fallbacks: a policy decline is re-served by a
        // fallback model inside the same call instead of parking the company.
        type BetaParams = Parameters<typeof client.beta.messages.stream>[0];
        const beta = client.beta.messages.stream({
          ...(params as unknown as BetaParams),
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        } as unknown as BetaParams);
        const final = (await beta.finalMessage()) as unknown as Anthropic.Message & { model: string };
        msg = final as Anthropic.Message;
        if (final.model && final.model !== req.model) fallbackModel = final.model;
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status !== 400) throw e;
        // Older accounts / platforms without the beta: plain request.
        msg = await client.messages.stream(params as unknown as Anthropic.MessageStreamParams).finalMessage();
      }
      let text = "";
      let serverToolText = "";
      const toolCalls: ToolCall[] = [];
      for (const block of msg.content) {
        if (block.type === "text") text += block.text;
        else if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, input: block.input as Record<string, unknown> });
        else if ((block as { type: string }).type === "web_search_tool_result" || (block as { type: string }).type === "web_fetch_tool_result") {
          serverToolText += JSON.stringify(block).slice(0, 4000);
        }
      }
      const stop: ChatResponse["stop"] =
        msg.stop_reason === "tool_use" ? "tool_use"
        : msg.stop_reason === "end_turn" ? "end"
        : msg.stop_reason === "max_tokens" ? "max_tokens"
        : msg.stop_reason === "refusal" ? "refusal"
        : "other";
      return {
        text,
        toolCalls,
        stop,
        refusalCategory: stop === "refusal" ? (msg as unknown as { stop_details?: { category?: string } }).stop_details?.category : undefined,
        fallbackModel,
        serverToolText: serverToolText || undefined,
        usage: {
          input: msg.usage.input_tokens,
          output: msg.usage.output_tokens,
          cacheRead: msg.usage.cache_read_input_tokens ?? 0,
        },
      };
    },
  };
}
