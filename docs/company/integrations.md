# Integrations — building a plugin

An integration is a folder under `runtime/integrations/<id>/` that default-
exports `defineIntegration({...})`. It declares what it needs (secrets),
what it can do (methods), and how dangerous each capability is (modes with
side-effect classes). A company enables it in specific modes; roles get
its tools by pattern. Nothing else in the system needs to change: the
gate, the vault, the inbox, the audit log and the UI all read the
declaration.

## Anatomy

```ts
// runtime/integrations/linkedin/index.ts
import { defineIntegration, strictSchema, fail } from "../../src/integrations/registry.js";

export default defineIntegration({
  id: "linkedin",                         // kebab-case; tools become linkedin.<method>
  title: "LinkedIn",
  description: "Publish posts, read analytics.",
  website: "https://www.linkedin.com/developers/",
  guidance: `## What it does … ## Getting credentials … ## Enabling …`,   // markdown shown in the UI
  secrets: [
    { name: "LINKEDIN_ACCESS_TOKEN", description: "OAuth token", obtain: "…" },
    { name: "LINKEDIN_AUTHOR_URN", description: "urn:li:…", obtain: "…", modes: ["publish"] },
  ],
  modes: [
    { id: "read",    title: "Read",    description: "Profile and analytics", sideEffect: "read" },
    { id: "publish", title: "Publish", description: "Create posts",          sideEffect: "publish" },
  ],
  methods: [
    {
      name: "post", mode: "publish",
      description: "Publish a text post as the configured author.",
      input: strictSchema({ text: { type: "string" }, reason: { type: "string" } }),
      async handler(ctx, input) {
        const token = ctx.secrets.get("LINKEDIN_ACCESS_TOKEN");   // decrypted here, never returned
        if (!token) return fail("missing_secret", "LINKEDIN_ACCESS_TOKEN is not in the vault");
        // … call the API …
        ctx.emit("artifact.created", { kind: "post", ref: id });
        return { ok: true, post_id: id };
      },
    },
  ],
  async healthcheck(ctx) { /* verify the token; return { ok, detail } */ },
});
```

Then list it in `runtime/integrations/index.ts`.

## Modes are permissions

A mode is a named bundle of methods with one side-effect class. The
company enables modes, not methods:

```yaml
integrations:
  - id: linkedin
    modes: [read, publish]        # outreach stays off
roles:
  - id: cmo
    tools: [linkedin.*]           # every enabled method
  - id: researcher
    tools: [linkedin:read]        # only the read mode
```

A method may declare a stricter `sideEffect` than its mode, never a looser
one; the company may add a `side_effect` override on the enable entry
that tightens every method. The gate then applies the company's policies:
`read`/`write` pass, `send`/`publish`/`spend`/`deploy`/`hire` consult
policy and park for the board when required.

## Keys or OAuth: how an integration authenticates

Declare it once with `auth` and the whole product follows: the
Integrations screen shows the right form, the vault stores the right
names, handlers get fresh tokens.

```ts
// API key: the board pastes tokens. The default when secrets exist.
auth: { kind: "api_key", guide: "Postiz → Settings → Public API" }

// OAuth 2.0: the runtime runs the flow and refreshes tokens.
export const AUTH: OAuthConfig = {
  kind: "oauth2",
  prefix: "LINKEDIN",                                   // LINKEDIN_CLIENT_ID, _CLIENT_SECRET, _ACCESS_TOKEN, _REFRESH_TOKEN, _TOKEN_EXPIRES_AT
  authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
  tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
  scopes: ["openid", "profile", "w_member_social"],
  tokenAuth: "body",                                    // or "basic" (Reddit, X)
  pkce: false,                                          // true for X
  extraAuthorizeParams: { duration: "permanent" },      // provider quirks
  guide: "where to create the app and what to paste as the redirect URI",
};
auth: AUTH,
```

In a handler, never read the access token directly when the integration
uses OAuth — call `ensureToken(ctx.company.id, ctx.secrets, AUTH)`; it
returns the current token and refreshes it when the stored expiry has
passed and a refresh token exists.

**What the board does** (the Integrations screen walks them through it):

1. Create the provider app once and paste the **redirect URI** the screen
   shows (`<HIVE_PUBLIC_URL>/api/oauth/callback`, `http://localhost:4700/api/oauth/callback`
   locally) into the provider's OAuth settings.
2. Paste **Client ID** and **Client Secret** into the vault fields.
3. Click **Connect**, approve at the provider, land back on the screen
   with a "connected" badge. Tokens live in the vault; agents never see
   them.

Providers with no OAuth (Telegram bots, Postmark, Postiz public API)
stay `api_key`; the screen shows a masked field per secret and a
healthcheck button. Both paths can coexist: LinkedIn accepts a pasted
Token Generator token as well as Connect.

Running the worker somewhere other than localhost: set `HIVE_PUBLIC_URL`
to the worker's public origin (the callback must reach it) and
`HIVE_UI_URL` to the web app, and register the same redirect URI with
each provider.

## Secrets

- Declare every secret with a description and where to get it. The UI
  renders this next to a masked input; the CLI reads values from stdin.
- Values are AES-256-GCM encrypted in the `secrets` table with
  `VAULT_KEY`; the resolver decrypts inside the handler only.
- Every tool result passes through `redact()`, which strips any stored
  secret value before the model sees it. Do not log values.
- A secret may be scoped to modes (`modes: ["publish"]`) so `missing_secrets`
  only complains for what is enabled.

## Handlers

`handler(ctx, input)` receives a `ToolContext`: the company row and config,
the agent and role, the run, `secrets`, and `emit(type, payload)` for
events. Return `{ ok: true, ... }` or `fail(code, hint)`. Hints are read
by the agent, so say what to do next ("store X in the vault", "use
email.send instead").

Handlers must be idempotent where the provider allows it (use the run id
as an idempotency key), must not call account/payout/settings endpoints
(those are `board` actions outside the runtime), and must not fetch
arbitrary URLs from model input without an allowlist.

## Healthcheck

Optional `healthcheck(ctx)` verifies credentials without side effects.
The Integrations screen has a button for it; the answer is `{ ok, detail }`
and never includes secret values.

## Checklist before listing

1. `npm run check:manifest` — the docs table in `docs/company/tools.md`
   lists every method with its class.
2. A gate fixture if any method is not `read`/`write`.
3. Guidance covers: what each mode allows, how to get credentials step by
   step, the YAML to enable it.
4. Names: integration ids kebab-case, methods snake_case.

## The library today

| id | modes | needs |
|---|---|---|
| `content` | draft, publish | nothing |
| `email` (Postmark) | send, read | POSTMARK_SERVER_TOKEN, POSTMARK_FROM |
| `linkedin` | read, publish, outreach | LINKEDIN_ACCESS_TOKEN, LINKEDIN_AUTHOR_URN |
| `slack` | internal, external | SLACK_BOT_TOKEN |
| `telegram` | notify (+ board commands) | TELEGRAM_BOT_TOKEN, TELEGRAM_BOARD_CHAT_IDS |
| `ga4` | read | GA4_SERVICE_ACCOUNT_JSON, GA4_PROPERTY_ID |
| `search-console` | read | GSC_SERVICE_ACCOUNT_JSON, GSC_SITE_URL |
| `ads-meta` | read, manage, launch | META_ACCESS_TOKEN, META_AD_ACCOUNT_ID |
| `creators` | manage, payout | nothing |
| `reddit` | read, engage | REDDIT_ACCESS_TOKEN (engage only) |
| `x` | read, publish | X_BEARER_TOKEN, X_USER_ACCESS_TOKEN |
| `geo` | read | nothing (uses declared providers) |
| `postiz` | read, publish | POSTIZ_API_KEY (channels connect inside Postiz) |
| `blog` | read, publish | GitHub OAuth or GITHUB_ACCESS_TOKEN + BLOG_REPO (Markdown commits, host deploys) |
| `instagram` | read, publish | Meta login (instagram_content_publish) |

Next in line: `razorpay`/`stripe` (payment links exist as core tools; the
webhooks that post revenue), `github` (the core tools shell out to `gh`
today), `whatsapp` (Meta Cloud API), `google-drive`, `notion`, and an MCP
bridge that turns any MCP server into an integration with a board-assigned
class.
