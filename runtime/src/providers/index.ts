// Resolve "<provider>/<model>" into a Provider + model id from company.yaml.
//   anthropic/claude-opus-5     → built-in Anthropic (ANTHROPIC_API_KEY)
//   claude-opus-5               → same (bare Anthropic id)
//   openrouter/<vendor>/<model> → providers.openrouter (kind openai-compatible)
//   ollama/<model>              → providers.ollama  (kind openai-compatible, local)
//   mock                        → deterministic demo provider
//   claude-code                 → not a chat provider; handled by harness/claude-code.ts

import type { CompanyConfig, ProviderConfig, SecretResolver } from "../types.js";
import { anthropicProvider } from "./anthropic.js";
import { openaiCompatibleProvider } from "./openai-compatible.js";
import { mockProvider } from "./mock.js";
import type { Provider } from "./types.js";

const cache = new Map<string, Provider>();

function keyFrom(ref: string | undefined, secrets: SecretResolver): string | undefined {
  if (!ref) return undefined;
  const [kind, name] = ref.split(":");
  if (kind === "env") return process.env[name];
  if (kind === "vault") return secrets.get(name);
  return undefined;
}

export function parseModelRef(ref: string): { provider: string; model: string } {
  if (ref === "mock" || ref === "claude-code") return { provider: ref, model: ref };
  if (ref.startsWith("claude-")) return { provider: "anthropic", model: ref };
  const i = ref.indexOf("/");
  if (i < 0) return { provider: "anthropic", model: ref };
  return { provider: ref.slice(0, i), model: ref.slice(i + 1) };
}

export function providerFor(ref: string, config: CompanyConfig, secrets: SecretResolver): { provider: Provider; model: string } {
  const { provider: name, model } = parseModelRef(ref);
  const hit = cache.get(name);
  if (hit) return { provider: hit, model };
  const declared = config.providers?.[name];
  const pc: ProviderConfig | undefined = typeof declared === "object" ? declared : undefined;
  let p: Provider;
  if (name === "mock" || pc?.kind === "mock") p = mockProvider();
  else if (name === "anthropic" || pc?.kind === "anthropic") {
    p = anthropicProvider(name, { apiKey: keyFrom(pc?.api_key, secrets) ?? process.env.ANTHROPIC_API_KEY, baseURL: pc?.base_url });
  } else if (pc?.kind === "openai-compatible") {
    const base = pc.base_url ?? (name === "ollama" ? "http://localhost:11434/v1" : name === "openrouter" ? "https://openrouter.ai/api/v1" : undefined);
    if (!base) throw new Error(`provider ${name}: base_url required`);
    p = openaiCompatibleProvider(name, { baseURL: base, apiKey: keyFrom(pc.api_key, secrets), headers: pc.headers });
  } else if (name === "ollama") {
    p = openaiCompatibleProvider(name, { baseURL: "http://localhost:11434/v1" });
  } else if (name === "openrouter") {
    p = openaiCompatibleProvider(name, { baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY });
  } else throw new Error(`unknown provider "${name}" — declare it under providers: in company.yaml`);
  cache.set(name, p);
  return { provider: p, model };
}

export function resetProviders(): void {
  cache.clear();
}
