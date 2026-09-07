// Google Search Console — queries and pages, read-only.

import { defineIntegration, strictSchema, fail, type OAuthConfig } from "../../src/integrations/registry.js";
import { ensureToken } from "../../src/oauth.js";
export const AUTH: OAuthConfig = {
  kind: "oauth2",
  prefix: "GOOGLE",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: ["https://www.googleapis.com/auth/analytics.readonly", "https://www.googleapis.com/auth/webmasters.readonly"],
  tokenAuth: "body",
  extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  guide: "console.cloud.google.com → APIs & Services → enable Google Analytics Data API and Search Console API → Credentials → OAuth client (Web application) → Authorized redirect URIs = the one shown here; copy Client ID and Client Secret. One Google connection serves every Google integration you enable (GA4, Search Console, Drive, Sheets, Calendar, Gmail, YouTube).",
};
import { googleAccessToken } from "../../src/integrations/google.js";

export default defineIntegration({
  id: "search-console",
  auth: AUTH,
  title: "Google Search Console",
  description: "Search queries, clicks, impressions and positions for a verified site.",
  website: "https://developers.google.com/webmaster-tools",
  guidance: `
## What it does
- **read** — \`search-console.query\` returns clicks, impressions, CTR and position by query or page.

## Connecting (OAuth, recommended)
The Google connection made for GA4 serves Search Console too (same client, same Connect button). Store the property as \`GSC_SITE_URL\` (\`https://example.com/\` or \`sc-domain:example.com\`).

## Or a service account
Add the service account email under Search Console → Settings → Users and permissions, and store the key JSON as \`GSC_SERVICE_ACCOUNT_JSON\`.
`,
  secrets: [
    { name: "GOOGLE_CLIENT_ID", description: "OAuth client id (shared with GA4)", obtain: "Google Cloud → Credentials", required: false },
    { name: "GOOGLE_CLIENT_SECRET", description: "OAuth client secret", obtain: "Google Cloud → Credentials", required: false },
    { name: "GSC_SERVICE_ACCOUNT_JSON", description: "Alternative to Connect: service account key JSON", obtain: "Google Cloud → IAM → Service Accounts → Keys", required: false },
    { name: "GSC_SITE_URL", description: "Verified property", obtain: "Search Console property selector" },
  ],
  modes: [{ id: "read", title: "Read", description: "Performance data", sideEffect: "read" }],
  methods: [
    {
      name: "query",
      mode: "read",
      description: "Search performance for a period. dimensions: query | page | country | device.",
      input: strictSchema(
        {
          period: { type: "string", description: "YYYY-MM-DD..YYYY-MM-DD" },
          dimensions: { type: "array", items: { type: "string", enum: ["query", "page", "country", "device", "date"] } },
          limit: { type: "integer", maximum: 1000 },
        },
        ["period"],
      ),
      async handler(ctx, input) {
        const sa = ctx.secrets.get("GSC_SERVICE_ACCOUNT_JSON");
        const site = ctx.secrets.get("GSC_SITE_URL");
        if (!site) return fail("missing_secret", "GSC_SITE_URL must be in the vault");
        const [startDate, endDate] = String(input.period).split("..");
        let token: string | undefined;
        try {
          token = sa ? await googleAccessToken(sa, "https://www.googleapis.com/auth/webmasters.readonly") : await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        } catch (e) {
          return fail("auth_error", (e as Error).message);
        }
        if (!token) return fail("not_connected", "Connect Google, or store GSC_SERVICE_ACCOUNT_JSON");
        const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ startDate, endDate: endDate ?? startDate, dimensions: input.dimensions ?? ["query"], rowLimit: input.limit ?? 100 }),
        });
        const body = (await res.json()) as Record<string, unknown>;
        if (!res.ok) return fail("gsc_error", String((body.error as { message?: string })?.message ?? res.status));
        return { ok: true, rows: body.rows ?? [] };
      },
    },
  ],
});
