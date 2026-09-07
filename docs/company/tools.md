# Tool catalogue

Every capability an agent has is a tool here. Each has a side-effect class
(see [runtime.md](runtime.md)) that the gate enforces, and a `board`-only
marker where humans alone may act. Two sources:

- **Core tools** — [`runtime/tools/manifest.ts`](../../runtime/tools/manifest.ts),
  handlers in `runtime/src/tools/core.ts`. Always available.
- **Integration tools** — contributed by plugins under
  [`runtime/integrations/`](../../runtime/integrations/) when a company
  enables them in `company.yaml`. Authoring guide:
  [integrations.md](integrations.md).

`npm run check:manifest` in `runtime/` asserts this file, the manifest and
the integrations agree, and that every template's tool patterns resolve.

Role `tools:` patterns: `linkedin.*` (family), `wallet.read` (one tool),
`linkedin:publish` (every tool in an integration mode). Unknown patterns
fail company load.

## Conventions

- Inputs are strict JSON Schema objects (`additionalProperties: false`).
- Results are JSON with `ok: boolean`, and on failure `error: {code, hint}`.
- Money fields are integers in minor units with an explicit `currency`.
- Gated tools take a `reason` the approvals inbox shows to the board.
- Wire names replace dots with double underscores and dashes with
  underscores (`linkedin.post` → `linkedin__post`, `ads-meta.pause` →
  `ads_meta__pause`).

## Engine — `hive.*` (core)

| Tool | Class | Input | Notes |
|---|---|---|---|
| `hive.new` | write | `template, name, intent` | scaffolds inside the workspace |
| `hive.check` | read | `gate?` | findings JSON from `hive check --json` |
| `hive.ship` | deploy | `env: preview\|prod, reason` | prod parks by default; the only deploy path |
| `hive.graph_impact` | read | `node` | blast radius |
| `hive.intent_get` / `hive.intent_set` | read / write | — / `patch` | edits `hive.yaml` |

## Organisation (core)

| Tool | Class | Input | Who |
|---|---|---|---|
| `task.plan` | write | `mission, tasks[]` | executive only; writes the DAG atomically |
| `task.create` | write | `title, intent, acceptance, owner_role, depends_on[], budget_cap` | leads |
| `task.update` | write | `task_id, status?, notes?, acceptance?` | owner or lead |
| `task.list` | read | `status?, owner?` | all |
| `task.handoff` | write | `task_id, to_role, note` | owner |
| `agent.list` | read | — | all |
| `agent.hire` | hire | `role_key, name, reason` | always parks |
| `agent.suspend` | hire | `agent_id, reason` | always parks |
| `message.send` | write | `to, body, thread_id?` | board messages surface in the inbox |
| `message.read` | read | `thread_id? \| unread` | |
| `report.weekly` | write | `period` | finance role; writes an artifact |
| `artifact.save` | write | `kind, ref, meta` | any run |

## Web (core, server tools)

| Tool | Class | Input | Backing |
|---|---|---|---|
| `web.search` | read | `query` | Anthropic `web_search_20260209`; other providers get an honest error |
| `web.fetch` | read | `url` | local fetch with the company's allowed domains |

## Treasury (core)

| Tool | Class | Input | Notes |
|---|---|---|---|
| `wallet.read` | read | `wallet_id?` | own wallet by default |
| `wallet.transfer` | hire | `to_wallet, amount, currency, reason` | always parks |
| `card.request` | hire | `purpose, per_tx, monthly, categories[]` | always parks; on approval the worker issues a Stripe Issuing virtual card (ledger-only companies get a clear error) |
| `card.freeze` | write | `card_id` | own card; always allowed |
| `card.purchase` | spend | `vendor, amount, currency, reason, url?` | hold → capture; the gate decides |
| `card.transactions` | read | `period` | |
| `invoice.create` | write | `customer_name, items[], place_of_supply?, customer_gstin?, due_on?` | finance role; GST split from `treasury.gst_state` |
| `invoice.send` | send | `invoice_id, reason` | marks sent, attaches a payment link, emails the customer |
| `payment-link.create` | write | `amount, currency, description, customer_email?` | Razorpay (INR) / Stripe Checkout |
| `payment-link.send` | send | `link_id, to, message` | alias; use email.send |
| `treasury.fund` | board | — | humans only |
| `treasury.raise_cap` | board | — | humans only |

## Infrastructure (core)

| Tool | Class | Input | Notes |
|---|---|---|---|
| `infra.targets` | read | — | vercel / droplet / local |
| `infra.secret.set` | write | `name, value` | write-only; value redacted immediately |
| `infra.secret.list` | read | — | names only |
| `infra.domain.search` | read | `name` | RDAP availability + registrar list price |
| `infra.domain.buy` | spend | `name, years, reason` | Porkbun when its keys are in the vault, else a board task |
| `infra.dns.set` | write | `domain, record{type,name,content,proxied?}` | Cloudflare (`CLOUDFLARE_API_TOKEN`) |
| `github.pr.open` | write | `repo, branch, title, body` | via `gh` |
| `github.pr.merge` | deploy | `pr, reason` | always parks (merges ship code) |
| `github.issue.create` | write | `repo, title, body` | |
| `github.repo.create` | hire | `name, private` | always parks |

## Integration: `content` (drafts, no credentials)

| Tool | Class | Mode | Input |
|---|---|---|---|
| `content.draft` | write | draft | `kind, title, body_md, meta?` |
| `content.list` | read | draft | `status?` |
| `content.get` | read | draft | `draft_id` |
| `content.publish` | publish | publish | `draft_id, reason` |

## Integration: `email` (Postmark)

| Tool | Class | Mode | Input |
|---|---|---|---|
| `email.send` | send | send | `to[], subject, body_md, thread_id?, reason` — first contact parks |
| `email.inbox` | read | read | `since?, limit?` |

## Integration: `linkedin`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `linkedin.me` | read | read | — |
| `linkedin.post` | publish | publish | `text, article_url?, reason` |
| `linkedin.analytics` | read | read | `post_id` (organisation authors) |
| `linkedin.message` | send | outreach | `to_urn, text, reason` — partner access required |

## Integration: `slack`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `slack.post` | write | internal | `channel, text` |
| `slack.post_external` | send | external | `channel, text` |

## Integration: `telegram`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `telegram.notify` | write | notify | `text` — board chats only; board commands are handled by the worker |

## Integration: `ga4`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `ga4.report` | read | read | `metrics[], dimensions?, period, limit?` |

## Integration: `search-console`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `search-console.query` | read | read | `period, dimensions?, limit?` |

## Integration: `ads-meta`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `ads-meta.campaign_draft` | write | manage | `name, objective, budget_daily_minor?` — created PAUSED |
| `ads-meta.campaign_launch` | publish + spend | launch | `campaign_id, budget_total_minor, reason` |
| `ads-meta.pause` | write | manage | `campaign_id` — always allowed |
| `ads-meta.insights` | read | read | `campaign_id, period?` |

## Integration: `blog` (GitHub)

| Tool | Class | Mode | Input |
|---|---|---|---|
| `blog.list` | read | read | — |
| `blog.get` | read | read | `slug` |
| `blog.publish` | publish | publish | `title, description, body_md, slug?, tags?, author?, reason` — commits `<slug>.md`; parks |
| `blog.unpublish` | publish | publish | `slug, reason` — parks |

## Integration: `instagram`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `instagram.account` | read | read | — |
| `instagram.media` | read | read | `limit?` |
| `instagram.post` | publish | publish | `media_url, caption, kind?, reason` — parks |

## Integration: `postiz`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `postiz.channels` | read | read | — |
| `postiz.posts` | read | read | `start, end` |
| `postiz.schedule` | publish | publish | `channel_ids[], text, at?, reason` — parks |

## Integration: `reddit`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `reddit.search` | read | read | `query, subreddit?, time?, limit?` |
| `reddit.thread` | read | read | `post_id` |
| `reddit.draft_reply` | write | engage | `post_id, text, why` |
| `reddit.reply` | send | engage | `post_id, text, reason` — parks |

## Integration: `x`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `x.search` | read | read | `query, limit?` |
| `x.post` | publish | publish | `text, in_reply_to?, reason` — parks |

## Integration: `geo` (no credentials)

| Tool | Class | Mode | Input |
|---|---|---|---|
| `geo.probe` | read | read | `brand, questions[], providers?` — asks configured model providers and records an artifact |

## Integration: `creators` (no credentials)

| Tool | Class | Mode | Input |
|---|---|---|---|
| `creators.add` | write | manage | `name, age_confirmed, handle?, platform?, email?, commission_pct?, notes?` — issues a referral code |
| `creators.update` | write | manage | `creator_id, status?, notes?` |
| `creators.record` | write | manage | `code, kind: video\|signup\|revenue, views?, amount_minor?, ref?, memo?` |
| `creators.list` | read | manage | `status?` |
| `creators.stats` | read | manage | `period?` — per-creator numbers and programme totals |
| `creators.payout` | spend | payout | `creator_id, reason` — files a board-approved expense |

Playbook: [playbooks/ugc-creators.md](playbooks/ugc-creators.md).

## MCP attachments

A board member attaches an MCP server in `company.yaml` with a name and a
side-effect class for the whole server (or per-tool overrides). The
runtime lists its tools under `<name>.*`; the gate treats them by the
assigned class. Servers with no class are not exposed. (Attachment is
declared and validated today; the MCP client bridge lands with C4.)

## Adding a tool

1. Core: add the row here and the schema in `runtime/tools/manifest.ts`
   (`strict`), then the handler in `runtime/src/tools/core.ts`.
2. Integration: add a method to the plugin under `runtime/integrations/<id>/`
   with its mode, and a row in this file's section for it.
3. Add a gate fixture test if the class is not `read`/`write`.
4. `npm run check:manifest`.

## Integration: `google-drive`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `google-drive.search` | read | read | `query, limit?` — plain words or Drive query syntax |
| `google-drive.get` | read | read | `file_id` |
| `google-drive.read` | read | read | `file_id` — Docs → Markdown, Sheets → CSV (first sheet), Slides → text, text files ≤ 200 KB; 30k chars |
| `google-drive.upload` | write | write | `name, content, mime_type?, folder_id?` |
| `google-drive.create_folder` | write | write | `name, parent_id?` |
| `google-drive.create_doc` | write | write | `title, markdown, folder_id?` — # headings become Docs headings |
| `google-drive.share` | send | share | `file_id, role, to? \| anyone?, reason?` — first contact parks |

## Integration: `google-sheets`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `google-sheets.list_sheets` | read | read | `spreadsheet_id` |
| `google-sheets.read_range` | read | read | `spreadsheet_id, range` — ≤ 500 rows |
| `google-sheets.append_rows` | write | write | `spreadsheet_id, range, rows[][]` — USER_ENTERED |
| `google-sheets.update_range` | write | write | `spreadsheet_id, range, rows[][]` — USER_ENTERED |
| `google-sheets.create_spreadsheet` | write | write | `title, sheets[]?` — returns id + url |

## Integration: `google-calendar`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `google-calendar.list_events` | read | read | `calendar_id?, from?, to?, limit?` — default primary, next 7 days |
| `google-calendar.free_busy` | read | read | `from, to, calendar_ids[]?` |
| `google-calendar.create_event` | send | schedule | `title, start, end, description?, to[]?, location?, meet?, calendar_id?, time_zone?, reason?` — invites attendees; first contact parks |

## Integration: `gmail`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `gmail.search` | read | read | `query, limit?` — Gmail query syntax; from, subject, date, snippet |
| `gmail.read_thread` | read | read | `thread_id` — plain text, quotes stripped, 30k chars |
| `gmail.send` | send | send | `to, subject?, body, thread_id?, in_reply_to_message_id?, reason?` — replies thread via In-Reply-To/References; first contact parks |

## Integration: `whatsapp`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `whatsapp.templates` | read | read | `limit?` — needs WHATSAPP_BUSINESS_ACCOUNT_ID |
| `whatsapp.inbox` | read | read | `thread_id?, unread?, since?, limit?` — local store, no network |
| `whatsapp.threads` | read | read | `limit?` — local store, no network |
| `whatsapp.mark_read` | write | read | `message_id` — read receipt + marks the inbox row |
| `whatsapp.send_template` | send | send | `to, template, language?, params[]?, header_image_url?` — first contact parks; works outside the 24-hour window |
| `whatsapp.send_text` | send | send | `to, text` — 24-hour window only; first contact parks |
| `whatsapp.send_media` | send | send | `to, media_url, kind, caption?, filename?` — 24-hour window only; first contact parks |

## Integration: `facebook`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `facebook.pages` | read | read | — |
| `facebook.posts` | read | read | `limit?` |
| `facebook.comments` | read | read | `post_id, limit?` |
| `facebook.insights` | read | read | `metrics[]?, period?` |
| `facebook.post` | publish | publish | `message, link?, media_url?, page_id?, reason` — parks |
| `facebook.reply_comment` | send | engage | `comment_id, message` — public reply, parks as first contact |

## Integration: `youtube`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `youtube.channel` | read | read | — |
| `youtube.videos` | read | read | `limit?, query?` |
| `youtube.analytics` | read | read | `from, to, metrics?, dimensions?, sort?, limit?` |
| `youtube.comments` | read | read | `video_id, limit?, order?` |
| `youtube.reply` | send | engage | `comment_id, text, reason` — no recipient, so first contact: parks |
| `youtube.upload` | publish | publish | `video_url, title, description?, tags?, privacy?, category_id?, reason` — streams a public URL into a resumable upload, ≤ 512 MB, private by default; parks |
| `youtube.update` | publish | publish | `video_id, title?, description?, tags?, privacy?, reason` — parks |

## Integration: `tiktok`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `tiktok.profile` | read | read | — |
| `tiktok.videos` | read | read | `limit?` |
| `tiktok.publish` | publish | publish | `video_url, title, privacy?, reason` — pull-from-URL on a verified domain; SELF_ONLY unless the app is audited; parks |
| `tiktok.status` | read | read | `publish_id` |

## Integration: `discord`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `discord.channels` | read | read | — (needs `DISCORD_GUILD_ID`) |
| `discord.read` | read | read | `channel_id, limit?` |
| `discord.post` | publish | community | `channel_id?, content, reason` — bot token, or `DISCORD_WEBHOOK_URL` when no channel_id; ≤ 2000 chars; parks |
| `discord.reply` | publish | community | `channel_id, message_id, content, reason` — parks |

## Integration: `notion`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `notion.search` | read | read | `query, kind?, limit?` |
| `notion.get_page` | read | read | `page_id` |
| `notion.query_database` | read | read | `database_id, filter?, sorts?, limit?` |
| `notion.create_page` | write | write | `parent_page_id?, parent_database_id?, title, markdown?, properties?` |
| `notion.append` | write | write | `page_id, markdown` |
| `notion.update_page` | write | write | `page_id, properties` |

## Integration: `github`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `github.repos` | read | read | `org?, limit?` |
| `github.issues` | read | read | `repo, state?, labels?, limit?` |
| `github.create_issue` | write | write | `repo, title, body, labels?` |
| `github.comment` | write | write | `repo, number, body` |
| `github.pulls` | read | read | `repo, state?, limit?` |
| `github.create_pr` | write | write | `repo, head, base, title, body` |
| `github.merge_pr` | deploy | ship | `repo, number, env, method?, reason` |
| `github.commits` | read | read | `repo, branch?, limit?` |
| `github.file` | read | read | `repo, path, ref?` |

## Integration: `hubspot`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `hubspot.search_contacts` | read | read | `query, limit?` |
| `hubspot.create_contact` | write | write | `email, firstname?, lastname?, phone?, company?, properties?` |
| `hubspot.update_contact` | write | write | `contact_id, properties` |
| `hubspot.deals` | read | read | `stage?, limit?` |
| `hubspot.create_deal` | write | write | `name, amount?, stage?, pipeline?, contact_id?` |
| `hubspot.add_note` | write | write | `contact_id, body` |

## Integration: `webhook`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `webhook.call` | send | call | `url, method?, body?, headers?, reason` |

## Integration: `stripe`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `stripe.balance` | read | read | — |
| `stripe.payments` | read | read | `limit?, since?` |
| `stripe.customers` | read | read | `query?, limit?` |
| `stripe.payouts` | read | read | `limit?` |

## Integration: `razorpay`

| Tool | Class | Mode | Input |
|---|---|---|---|
| `razorpay.payments` | read | read | `limit?, since?` |
| `razorpay.settlements` | read | read | `limit?` |
| `razorpay.payment_links` | read | read | `limit?` |
| `razorpay.orders` | read | read | `limit?` |
