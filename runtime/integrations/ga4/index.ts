// Google Analytics 4 — read-only reporting via the Data API.

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
  id: "ga4",
  auth: AUTH,
  title: "Google Analytics 4",
  description: "Run GA4 reports: sessions, users, conversions by page, source, campaign.",
  website: "https://developers.google.com/analytics/devguides/reporting/data/v1",
  guidance: `
## What it does
- **read** — \`ga4.report\` runs a Data API report for a property. Read-only; nothing here can change your analytics.

## Connecting (OAuth, recommended)
1. Google Cloud → APIs & Services → enable **Google Analytics Data API** and **Search Console API** → Credentials → OAuth client, type Web application, redirect URI = the one shown here.
2. Paste Client ID and Client Secret into the vault, then **Connect** with the Google account that can see the property. One connection serves GA4 and Search Console.
3. Store the numeric property id as \`GA4_PROPERTY_ID\`.

## Or a service account
Create a service account, add its email as Viewer in GA4 Admin → Property Access Management, and store the key JSON as \`GA4_SERVICE_ACCOUNT_JSON\`.

## Enabling
\`\`\`yaml
integrations:
  - id: ga4
    modes: [read]
\`\`\`
`,
  secrets: [
    { name: "GOOGLE_CLIENT_ID", description: "OAuth client id (shared with Search Console)", obtain: "Google Cloud → Credentials", required: false },
    { name: "GOOGLE_CLIENT_SECRET", description: "OAuth client secret", obtain: "Google Cloud → Credentials", required: false },
    { name: "GA4_SERVICE_ACCOUNT_JSON", description: "Alternative to Connect: service account key JSON", obtain: "Google Cloud → IAM → Service Accounts → Keys", required: false },
    { name: "GA4_PROPERTY_ID", description: "Numeric GA4 property id", obtain: "GA4 Admin → Property Settings" },
  ],
  modes: [{ id: "read", title: "Read", description: "Reports", sideEffect: "read" }],
  methods: [
    {
      name: "report",
      mode: "read",
      description: "Run a GA4 report. metrics e.g. [sessions, totalUsers, conversions]; dimensions e.g. [pagePath, sessionSource]; period like 7daysAgo..today.",
      input: strictSchema(
        {
          metrics: { type: "array", items: { type: "string" }, minItems: 1 },
          dimensions: { type: "array", items: { type: "string" } },
          period: { type: "string", description: "start..end using GA4 date syntax, e.g. 28daysAgo..today" },
          limit: { type: "integer", maximum: 500 },
        },
        ["metrics", "period"],
      ),
      async handler(ctx, input) {
        const sa = ctx.secrets.get("GA4_SERVICE_ACCOUNT_JSON");
        const prop = ctx.secrets.get("GA4_PROPERTY_ID");
        if (!prop) return fail("missing_secret", "GA4_PROPERTY_ID must be in the vault");
        const [start, end] = String(input.period).split("..");
        let token: string | undefined;
        try {
          token = sa ? await googleAccessToken(sa, "https://www.googleapis.com/auth/analytics.readonly") : await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        } catch (e) {
          return fail("auth_error", (e as Error).message);
        }
        if (!token) return fail("not_connected", "Connect Google, or store GA4_SERVICE_ACCOUNT_JSON");
        const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${prop}:runReport`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            dateRanges: [{ startDate: start, endDate: end ?? "today" }],
            metrics: (input.metrics as string[]).map((name) => ({ name })),
            dimensions: ((input.dimensions as string[]) ?? []).map((name) => ({ name })),
            limit: input.limit ?? 100,
          }),
        });
        const body = (await res.json()) as Record<string, unknown>;
        if (!res.ok) return fail("ga4_error", String((body.error as { message?: string })?.message ?? res.status));
        const dimH = ((body.dimensionHeaders as { name: string }[]) ?? []).map((h) => h.name);
        const metH = ((body.metricHeaders as { name: string }[]) ?? []).map((h) => h.name);
        const rows = ((body.rows as { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[]) ?? []).map((r) => ({
          ...Object.fromEntries(dimH.map((h, i) => [h, r.dimensionValues?.[i]?.value])),
          ...Object.fromEntries(metH.map((h, i) => [h, Number(r.metricValues?.[i]?.value)])),
        }));
        return { ok: true, rows, row_count: body.rowCount ?? rows.length };
      },
    },
  ],
});
