// Meta (Facebook/Instagram) Ads — drafts are PAUSED campaigns; launching is
// gated as publish + spend; pausing is always allowed; insights are read.

import { defineIntegration, strictSchema, fail, type OAuthConfig } from "../../src/integrations/registry.js";
import { ensureToken } from "../../src/oauth.js";
export const AUTH: OAuthConfig = {
  kind: "oauth2",
  prefix: "META",
  authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
  tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
  scopes: ["ads_management", "ads_read", "business_management"],
  tokenAuth: "body",
  guide: "developers.facebook.com/apps → Create app (Business) → add Marketing API and Facebook Login for Business → Valid OAuth Redirect URIs = the one shown here → Settings → Basic: App ID is the client id, App Secret the client secret.",
};

const G = "https://graph.facebook.com/v21.0";

async function graph(token: string, path: string, method: "GET" | "POST" = "GET", params: Record<string, unknown> = {}) {
  const url = new URL(`${G}${path}`);
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) form.set(k, typeof v === "string" ? v : JSON.stringify(v));
  form.set("access_token", token);
  const res =
    method === "GET"
      ? await fetch(`${url}?${form}`)
      : await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, body };
}

export default defineIntegration({
  id: "ads-meta",
  auth: AUTH,
  title: "Meta Ads",
  description: "Draft, launch, pause and measure campaigns on Facebook and Instagram.",
  website: "https://developers.facebook.com/docs/marketing-apis",
  guidance: `
## What it does
- **read** — \`ads-meta.insights\`: spend, impressions, clicks, results per campaign.
- **manage** — \`ads-meta.campaign_draft\` creates a **paused** campaign (nothing spends); \`ads-meta.pause\` stops one (always allowed).
- **launch** — \`ads-meta.campaign_launch\` sets a campaign ACTIVE with a lifetime budget. Gated as **publish and spend**: it parks for the board and places a ledger hold for the budget.

## Connecting
1. Meta for Developers → app of type Business with **Marketing API** and **Facebook Login for Business**; add the redirect URI shown here under Valid OAuth Redirect URIs.
2. Paste **App ID** as client id and **App Secret** as client secret into the vault, then **Connect** with an account that manages the ad account.
3. Store the ad account id (\`act_123…\`) as \`META_AD_ACCOUNT_ID\`.

## Or use a system-user token
Business Settings → System Users → generate a token with ads_management, ads_read and store it as \`META_ACCESS_TOKEN\`.

## Enabling
\`\`\`yaml
integrations:
  - id: ads-meta
    modes: [read, manage, launch]
\`\`\`
Grant \`launch\` only to a role with a spending budget.
`,
  secrets: [
    { name: "META_CLIENT_ID", description: "App ID (for Connect)", obtain: "developers.facebook.com → app → Settings → Basic", required: false },
    { name: "META_CLIENT_SECRET", description: "App Secret (for Connect)", obtain: "developers.facebook.com → app → Settings → Basic", required: false },
    { name: "META_ACCESS_TOKEN", description: "Access token (set by Connect, or a system-user token)", obtain: "Connect button, or Business Settings → System Users" },
    { name: "META_AD_ACCOUNT_ID", description: "act_<id>", obtain: "Ads Manager → account dropdown" },
  ],
  modes: [
    { id: "read", title: "Read", description: "Insights", sideEffect: "read" },
    { id: "manage", title: "Manage", description: "Create paused drafts, pause campaigns", sideEffect: "write" },
    { id: "launch", title: "Launch", description: "Set campaigns live with a budget", sideEffect: "publish" },
  ],
  methods: [
    {
      name: "campaign_draft",
      mode: "manage",
      description: "Create a PAUSED campaign shell. Ad sets and creatives are added in Ads Manager or later methods.",
      input: strictSchema(
        {
          name: { type: "string" },
          objective: { type: "string", enum: ["OUTCOME_TRAFFIC", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_AWARENESS", "OUTCOME_ENGAGEMENT"] },
          budget_daily_minor: { type: "integer", description: "Daily budget in minor units" },
        },
        ["name", "objective"],
      ),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        const acct = ctx.secrets.get("META_AD_ACCOUNT_ID");
        if (!token || !acct) return fail("missing_secret", "META_ACCESS_TOKEN and META_AD_ACCOUNT_ID must be in the vault");
        const r = await graph(token, `/${acct}/campaigns`, "POST", {
          name: input.name,
          objective: input.objective,
          status: "PAUSED",
          special_ad_categories: [],
          ...(input.budget_daily_minor ? { daily_budget: input.budget_daily_minor } : {}),
        });
        if (!r.ok) return fail("meta_error", String((r.body.error as { message?: string })?.message ?? "request failed"));
        ctx.emit("artifact.created", { kind: "campaign", ref: String(r.body.id), status: "PAUSED" });
        return { ok: true, campaign_id: r.body.id, status: "PAUSED" };
      },
    },
    {
      name: "campaign_launch",
      mode: "launch",
      description: "Set a campaign ACTIVE with a lifetime budget (minor units). Parks for the board; budget is held in the ledger.",
      sideEffect: "publish",
      input: strictSchema({
        campaign_id: { type: "string" },
        budget_total_minor: { type: "integer", minimum: 1 },
        reason: { type: "string" },
      }),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("missing_secret", "META_ACCESS_TOKEN is not in the vault");
        const r = await graph(token, `/${input.campaign_id}`, "POST", { status: "ACTIVE", lifetime_budget: input.budget_total_minor });
        if (!r.ok) return fail("meta_error", String((r.body.error as { message?: string })?.message ?? "request failed"));
        ctx.emit("spend.authorized", { vendor: "ads-meta", amount: input.budget_total_minor, campaign_id: input.campaign_id });
        return { ok: true, campaign_id: input.campaign_id, status: "ACTIVE" };
      },
    },
    {
      name: "pause",
      mode: "manage",
      description: "Pause a campaign. Always allowed; stopping spend never needs approval.",
      sideEffect: "write",
      input: strictSchema({ campaign_id: { type: "string" } }),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("missing_secret", "META_ACCESS_TOKEN is not in the vault");
        const r = await graph(token, `/${input.campaign_id}`, "POST", { status: "PAUSED" });
        if (!r.ok) return fail("meta_error", String((r.body.error as { message?: string })?.message ?? "request failed"));
        return { ok: true, campaign_id: input.campaign_id, status: "PAUSED" };
      },
    },
    {
      name: "insights",
      mode: "read",
      description: "Spend, impressions, clicks, cpc, results for a campaign over a preset period.",
      input: strictSchema(
        {
          campaign_id: { type: "string" },
          period: { type: "string", enum: ["today", "yesterday", "last_7d", "last_14d", "last_30d", "this_month", "last_month"] },
        },
        ["campaign_id"],
      ),
      async handler(ctx, input) {
        const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
        if (!token) return fail("missing_secret", "META_ACCESS_TOKEN is not in the vault");
        const r = await graph(token, `/${input.campaign_id}/insights`, "GET", {
          date_preset: input.period ?? "last_7d",
          fields: "spend,impressions,clicks,cpc,ctr,reach,actions",
        });
        if (!r.ok) return fail("meta_error", String((r.body.error as { message?: string })?.message ?? "request failed"));
        return { ok: true, insights: (r.body.data as unknown[]) ?? [] };
      },
    },
  ],
});
