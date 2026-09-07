// Outbound webhooks — the escape hatch to Zapier, Make, n8n or any
// endpoint the board names. The guard that matters is the host allowlist
// in the vault: a call to any other host is refused before any network,
// and an Authorization header from the model is never forwarded. There
// is no recipient field, so the gate treats every call as first contact
// (`send`) and parks it unless the board relaxes
// policies.send.first_contact.

import { createHmac } from "node:crypto";
import { defineIntegration, strictSchema, fail } from "../../src/integrations/registry.js";

const MAX_BODY = 4096;
const TIMEOUT_MS = 15_000;
/** request headers the model may not set */
const STRIP = new Set(["authorization", "proxy-authorization", "cookie", "host", "content-length"]);

const allowedHosts = (s: string) => s.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

/** Exact hostname match, or `*.example.com` for a domain and its subdomains. Exported for tests. */
export function hostAllowed(hostname: string, allowed: string[]): boolean {
  const h = hostname.toLowerCase();
  return allowed.some((a) => (a.startsWith("*.") ? h === a.slice(2) || h.endsWith(a.slice(1)) : h === a));
}

export default defineIntegration({
  id: "webhook",
  auth: { kind: "api_key", guide: "No provider account. The board lists the hostnames the company may call (hooks.zapier.com, hook.eu1.make.com, your n8n host) and, optionally, a shared secret the receiver uses to verify X-Hive-Signature." },
  title: "Outbound webhook",
  description: "Send JSON to Zapier, Make, n8n or any allowlisted endpoint; signed when a shared secret is set.",
  website: "https://zapier.com/apps/webhook/integrations",
  guidance: `
## What it does
- **call** — \`webhook.call\` sends an HTTP request (POST by default; PUT or GET) with a JSON body to a URL whose host is in \`WEBHOOK_ALLOWED_HOSTS\`, and returns the status and the first 4k of the response. Any other host is refused before the network is touched. Redirects are not followed.

Every call is a \`send\` with no recipient, so the gate treats it as **first contact and parks it for the board by default**. A company that trusts its automations can set \`policies.send.first_contact: allow\` — for the whole company or just for the role that owns the automations.

Security: an \`Authorization\` header supplied by the agent is stripped (so are Cookie and Host). Authenticate the receiver with the signature instead, or put a token in the URL path the way Zapier and Make do. When \`WEBHOOK_SIGNING_SECRET\` is set every request carries \`X-Hive-Signature: sha256=<hex HMAC-SHA256 of the raw body>\`, plus \`X-Hive-Company: <slug>\`.

## Connecting
1. Create the receiving hook (Zapier "Catch Hook", Make "Custom webhook", an n8n Webhook node, or your own endpoint) and copy its URL.
2. Store the hostnames the company may call, comma-separated, as \`WEBHOOK_ALLOWED_HOSTS\` (e.g. \`hooks.zapier.com, hook.eu1.make.com, *.n8n.example\`).
3. Optionally store a random string as \`WEBHOOK_SIGNING_SECRET\` and verify \`X-Hive-Signature\` on the receiver.

## Enabling
\`\`\`yaml
integrations:
  - id: webhook
    modes: [call]
roles:
  - id: ops
    tools: [webhook.call]
    policies:
      send: { first_contact: allow }   # only if the board trusts these automations
\`\`\`
`,
  secrets: [
    { name: "WEBHOOK_ALLOWED_HOSTS", description: "Comma-separated hostnames the company may call (*.example.com allowed)", obtain: "the host part of your Zapier / Make / n8n hook URLs" },
    { name: "WEBHOOK_SIGNING_SECRET", description: "Shared secret for X-Hive-Signature (HMAC-SHA256 of the body)", obtain: "any long random string; verify it on the receiver", required: false },
  ],
  modes: [
    { id: "call", title: "Call", description: "Send requests to allowlisted hosts", sideEffect: "send" },
  ],
  methods: [
    {
      name: "call", mode: "call",
      description: "Send a JSON request to an allowlisted host (POST by default). Returns the status and the first 4k of the response. Parks as first contact unless policy allows.",
      input: strictSchema(
        {
          url: { type: "string", description: "absolute http(s) URL; host must be in WEBHOOK_ALLOWED_HOSTS" },
          method: { type: "string", enum: ["POST", "PUT", "GET"] },
          body: { type: "object", description: "JSON body (ignored for GET)" },
          headers: { type: "object", description: "extra headers; Authorization is never forwarded" },
          reason: { type: "string" },
        },
        ["url", "reason"],
      ),
      async handler(ctx, input) {
        const allow = ctx.secrets.get("WEBHOOK_ALLOWED_HOSTS");
        if (!allow) return fail("missing_secret", "WEBHOOK_ALLOWED_HOSTS is not in the vault (comma-separated hostnames the company may call)");
        let u: URL;
        try {
          u = new URL(String(input.url));
        } catch {
          return fail("bad_input", "url must be an absolute http(s) URL");
        }
        if (u.protocol !== "https:" && u.protocol !== "http:") return fail("bad_input", "only http(s) URLs can be called");
        if (!hostAllowed(u.hostname, allowedHosts(allow))) return fail("blocked", `${u.hostname} is not in WEBHOOK_ALLOWED_HOSTS (${allowedHosts(allow).join(", ")}); ask the board to add it`);
        const method = String(input.method ?? "POST").toUpperCase();
        const headers: Record<string, string> = { "User-Agent": "alpha-hive-company/0.1" };
        for (const [k, v] of Object.entries((input.headers as Record<string, unknown>) ?? {})) if (!STRIP.has(k.toLowerCase())) headers[k] = String(v);
        const body = method === "GET" ? undefined : JSON.stringify(input.body ?? {});
        if (body !== undefined) headers["Content-Type"] = "application/json";
        headers["X-Hive-Company"] = ctx.company.slug;
        const secret = ctx.secrets.get("WEBHOOK_SIGNING_SECRET");
        if (secret) headers["X-Hive-Signature"] = `sha256=${createHmac("sha256", secret).update(body ?? "").digest("hex")}`;
        let res: Response;
        try {
          res = await fetch(u, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
        } catch (e) {
          return fail("network_error", e instanceof Error ? e.message : String(e));
        }
        const text = (await res.text().catch(() => "")).slice(0, MAX_BODY);
        if (res.status >= 300 && res.status < 400) return fail("redirect_not_followed", `HTTP ${res.status} → ${res.headers.get("location") ?? "?"}; call the final URL directly (its host must be allowlisted)`, { status: res.status });
        if (!res.ok) return fail("webhook_error", `HTTP ${res.status}`, { status: res.status, body: text });
        return { ok: true, status: res.status, body: text, content_type: res.headers.get("content-type") };
      },
    },
  ],
  async healthcheck(ctx) {
    const allow = ctx.secrets.get("WEBHOOK_ALLOWED_HOSTS");
    if (!allow) return { ok: false, detail: "WEBHOOK_ALLOWED_HOSTS missing" };
    const hosts = allowedHosts(allow);
    if (!hosts.length) return { ok: false, detail: "WEBHOOK_ALLOWED_HOSTS is empty" };
    return { ok: true, detail: `${hosts.length} host(s) allowed: ${hosts.join(", ")}${ctx.secrets.get("WEBHOOK_SIGNING_SECRET") ? "; requests are signed" : "; unsigned (set WEBHOOK_SIGNING_SECRET to sign)"}` };
  },
});
