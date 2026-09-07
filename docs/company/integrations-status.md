# Integrations — what is built, what is verified

"Built" means the plugin exists with modes, secrets, guidance, handlers
and a gate class, and passes the manifest check. "Verified" means it has
been exercised against the real service with real credentials. As of
2026-09-06 nothing in this table has been verified against a live
account: every call path is written from the provider's public API
documentation and needs a first real run with your keys. The healthcheck
button on each integration is the first thing to press after connecting.

| Integration | Auth | Built | Verified live | Notes |
|---|---|---|---|---|
| content (drafts) | none | yes | n/a | local, no provider |
| creators | none | yes | n/a | local, no provider |
| geo | none (uses providers) | yes | mock only | real probe needs a model key |
| blog (GitHub) | OAuth or PAT | yes | no | Contents API; site route renders posts |
| email (Postmark) | API key | yes | no | send + inbound read |
| postiz | API key | yes | no | public API v1 |
| linkedin | OAuth or token | yes | no | member posts; org analytics need Community Management product |
| instagram | OAuth (Meta) | yes | no | needs Professional account + Page |
| reddit | OAuth | yes | read verified (public JSON), reply no | |
| x | OAuth (PKCE) or bearer | yes | no | |
| slack | OAuth or bot token | yes | no | |
| telegram | bot token | yes | no | commands + approval buttons |
| ga4 | OAuth (Google) or service account | yes | no | |
| search-console | OAuth (Google) or service account | yes | no | |
| ads-meta | OAuth (Meta) or system-user token | yes | no | launch is publish + spend |
| google-drive | OAuth (Google) or service account | yes | no | Docs export as Markdown; create_doc via Docs API batchUpdate; share is send-class |
| google-sheets | OAuth (Google) or service account | yes | no | USER_ENTERED writes; healthcheck uses Drive about.get (drive.file scope) |
| google-calendar | OAuth (Google) | yes | no | create_event sends invites (sendUpdates=all), optional Meet link; no service-account path |
| gmail | OAuth (Google) | yes | no | restricted scopes (test user or verified app; Testing connections expire in 7 days); replies set In-Reply-To/References |
| whatsapp | System User token | yes | no | Cloud API; inbox via /api/webhooks/meta/<slug>; free-form only inside the 24-hour window |
| facebook | OAuth (Meta, shared with ads-meta) or Page token | yes | no | Page token resolved via /me/accounts; reply_comment parks as first contact |
| youtube | OAuth (Google) | yes | no | Data API v3 + Analytics API; upload streams a public URL into a resumable upload (512 MB cap, private by default) |
| tiktok | OAuth (PKCE, client_key) | yes | no | Display API + Content Posting API (pull-from-URL); unaudited apps post SELF_ONLY only; source domain must be verified |
| discord | bot token or webhook | yes | no | REST v10; reading others' message content needs the Message Content intent |
| notion | API key | yes | no | Read and write the pages and databases the board shares with the integration: search, render pages to Markdown |
| github | GITHUB OAuth | yes | no | Repositories, issues, pull requests, commits and files; merging is a deploy the board gates. |
| hubspot | API key | yes | no | CRM contacts, deals and notes: search and create contacts, keep the pipeline current, log notes against people |
| webhook | API key | yes | no | Send JSON to Zapier, Make, n8n or any allowlisted endpoint; signed when a shared secret is set. |
| stripe | API key | yes | no | Read-only view of the Stripe account: balance, payments, customers and payouts. |
| razorpay | API key | yes | no | Read-only view of the Razorpay account: payments, settlements, payment links and orders in INR. |

Not built yet: Pinterest, Shopify, Zoho; Meta Embedded Signup for
WhatsApp (a System User token is pasted today); emailing invite links.

## Core money and infrastructure modules

| Module | Built | Verified against the real service |
|---|---|---|
| Stripe Issuing cards (`runtime/src/cards/`) | yes: issue, freeze, transactions, real-time authorization from the ledger | no (needs an Issuing account; India runs ledger-only) |
| Stripe webhook (`/api/webhooks/stripe/<slug>`) | yes: signature check, idempotency, authorizations, transactions, Checkout revenue | signature and ledger paths unit-tested; not yet hit by Stripe |
| Razorpay webhook (`/api/webhooks/razorpay/<slug>`) | yes: signature check, `payment_link.paid` → revenue + invoice | unit-tested; not yet hit by Razorpay |
| Cloudflare DNS (`infra.dns.set`) | yes: zone lookup, upsert | no |
| Registrar (`infra.domain.search/buy`) | yes: RDAP + Porkbun price list; Porkbun registration; manual fallback creates a board task | search works without keys; buy not exercised |
| MCP bridge (`integrations: - mcp:`) | yes: stdio + Streamable HTTP, per-tool classes | no external server attached yet |

## How to verify one

1. Integrations → open it → connect or paste the key → **Run healthcheck**.
2. Give the company a small mission that uses it ("post one line to the
   test channel"), approve it from the inbox, read the run stream.
3. If it fails, the run shows the provider's error verbatim; fix the
   handler in `runtime/integrations/<id>/index.ts`, `npm run build`,
   restart the worker.
