// Generic OAuth 2.0 for integrations. The board creates the provider app
// once and pastes the client id/secret into the vault; the runtime does
// the authorize → callback → token exchange, stores the tokens in the
// vault under the integration's prefix, and refreshes them when they
// expire. Handlers never see client secrets; they call ensureToken().
//
//   GET /api/companies/:slug/integrations/:id/oauth/start → { url }
//   GET /api/oauth/callback?code&state                    → stores tokens, redirects to the UI

import { createHash, randomBytes } from "node:crypto";
import type { OAuthConfig } from "./integrations/registry.js";
import type { SecretResolver } from "./types.js";
import { setSecret } from "./vault.js";
import { emit } from "./bus.js";

type Pending = { companyId: string; integrationId: string; slug: string; auth: OAuthConfig; verifier?: string; created: number };
const pending = new Map<string, Pending>();

export function publicUrl(): string {
  return (process.env.HIVE_PUBLIC_URL ?? `http://localhost:${process.env.HIVE_API_PORT ?? 4700}`).replace(/\/$/, "");
}
export function uiUrl(): string {
  return (process.env.HIVE_UI_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
export function redirectUri(): string {
  return `${publicUrl()}/api/oauth/callback`;
}

function b64url(b: Buffer): string {
  return b.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Integrations that share a prefix (every Google one, the Meta pair) share
 * one token, so one Connect must ask for every scope the company will use.
 * `extraScopes` is the union the server computes from the integrations the
 * company enabled with the same prefix.
 */
export function startOAuth(companyId: string, slug: string, integrationId: string, auth: OAuthConfig, secrets: SecretResolver, extraScopes: string[] = []): { url: string } {
  const clientId = secrets.get(`${auth.prefix}_CLIENT_ID`);
  if (!clientId) throw new Error(`${auth.prefix}_CLIENT_ID is not in the vault — create the app first (see the integration's guidance)`);
  for (const [k, v] of pending) if (Date.now() - v.created > 10 * 60_000) pending.delete(k);
  const state = b64url(randomBytes(24));
  const entry: Pending = { companyId, integrationId, slug, auth, created: Date.now() };
  const u = new URL(auth.authorizeUrl);
  u.searchParams.set("response_type", "code");
  u.searchParams.set(auth.clientIdParam ?? "client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("scope", [...new Set([...auth.scopes, ...extraScopes])].join(" "));
  u.searchParams.set("state", state);
  if (auth.pkce) {
    entry.verifier = b64url(randomBytes(48));
    u.searchParams.set("code_challenge", b64url(createHash("sha256").update(entry.verifier).digest()));
    u.searchParams.set("code_challenge_method", "S256");
  }
  for (const [k, v] of Object.entries(auth.extraAuthorizeParams ?? {})) u.searchParams.set(k, v);
  pending.set(state, entry);
  return { url: u.toString() };
}

async function tokenRequest(auth: OAuthConfig, secrets: SecretResolver, params: Record<string, string>): Promise<Record<string, unknown>> {
  const clientId = secrets.get(`${auth.prefix}_CLIENT_ID`) ?? "";
  const clientSecret = secrets.get(`${auth.prefix}_CLIENT_SECRET`) ?? "";
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (auth.tokenAuth === "basic") headers.Authorization = "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  else {
    body.set(auth.clientIdParam ?? "client_id", clientId);
    if (clientSecret) body.set("client_secret", clientSecret);
  }
  const res = await fetch(auth.tokenUrl, { method: "POST", headers, body });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.error) throw new Error(String(json.error_description ?? json.error ?? `token endpoint HTTP ${res.status}`));
  return json;
}

function store(companyId: string, auth: OAuthConfig, json: Record<string, unknown>) {
  // Slack returns the bot token top-level as access_token; Google/LinkedIn/Reddit/X/Meta the same.
  const access = String(json.access_token ?? "");
  if (!access) throw new Error("no access_token in the token response");
  setSecret(companyId, `${auth.prefix}_ACCESS_TOKEN`, access);
  if (json.refresh_token) setSecret(companyId, `${auth.prefix}_REFRESH_TOKEN`, String(json.refresh_token));
  if (json.expires_in) setSecret(companyId, `${auth.prefix}_TOKEN_EXPIRES_AT`, String(Date.now() + Number(json.expires_in) * 1000 - 60_000));
}

export async function handleCallback(state: string, code: string, resolverFor: (companyId: string) => SecretResolver): Promise<{ slug: string; integrationId: string }> {
  const p = pending.get(state);
  if (!p) throw new Error("unknown or expired OAuth state — start the connection again");
  pending.delete(state);
  const params: Record<string, string> = { grant_type: "authorization_code", code, redirect_uri: redirectUri() };
  if (p.verifier) params.code_verifier = p.verifier;
  const json = await tokenRequest(p.auth, resolverFor(p.companyId), params);
  store(p.companyId, p.auth, json);
  emit(p.companyId, "integration.connected", { integration: p.integrationId, prefix: p.auth.prefix });
  return { slug: p.slug, integrationId: p.integrationId };
}

/** Access token for handlers: refreshes when expired and a refresh token exists. */
export async function ensureToken(companyId: string, secrets: SecretResolver, auth: OAuthConfig): Promise<string | undefined> {
  const access = secrets.get(`${auth.prefix}_ACCESS_TOKEN`);
  const exp = Number(secrets.get(`${auth.prefix}_TOKEN_EXPIRES_AT`) ?? 0);
  const refresh = secrets.get(`${auth.prefix}_REFRESH_TOKEN`);
  if (access && (!exp || Date.now() < exp)) return access;
  if (!refresh) return access;
  try {
    const json = await tokenRequest(auth, secrets, { grant_type: "refresh_token", refresh_token: refresh });
    store(companyId, auth, json);
    return String(json.access_token);
  } catch {
    return access;
  }
}

export function connected(secrets: SecretResolver, auth: OAuthConfig): { connected: boolean; expires_at: number | null; can_refresh: boolean; has_client: boolean } {
  return {
    connected: !!secrets.get(`${auth.prefix}_ACCESS_TOKEN`),
    expires_at: Number(secrets.get(`${auth.prefix}_TOKEN_EXPIRES_AT`) ?? 0) || null,
    can_refresh: !!secrets.get(`${auth.prefix}_REFRESH_TOKEN`),
    has_client: !!secrets.get(`${auth.prefix}_CLIENT_ID`) && !!secrets.get(`${auth.prefix}_CLIENT_SECRET`),
  };
}
