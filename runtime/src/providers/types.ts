// Provider contract: one chat turn in, text + tool calls out. The loop in
// harness/loop.ts owns the agentic cycle so every provider (Anthropic,
// OpenRouter, Ollama, mock) runs through the same gate and ledger.

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export type ToolDef = {
  /** wire-safe name (letters, digits, _), see tools/resolve.ts */
  name: string;
  description: string;
  input: Record<string, unknown>;
};

export type ChatRequest = {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolDef[];
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  /** allowed/blocked domains for server-side web tools (Anthropic only) */
  web?: { allowed?: string[]; blocked?: string[] };
};

export type Usage = { input: number; output: number; cacheRead: number };

export type ChatResponse = {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  stop: "end" | "tool_use" | "max_tokens" | "refusal" | "other";
  refusalCategory?: string;
  fallbackModel?: string;
  /** raw provider blocks for server tools that already ran (web search results) */
  serverToolText?: string;
};

export interface Provider {
  readonly id: string;
  readonly kind: "anthropic" | "openai-compatible" | "mock";
  chat(req: ChatRequest): Promise<ChatResponse>;
  /** USD per million tokens [input, output] for cost accounting; 0 for local */
  price(model: string): [number, number];
}
