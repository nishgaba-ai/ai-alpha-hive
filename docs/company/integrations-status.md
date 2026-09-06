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

Not built yet (declared in plans): Razorpay/Stripe webhooks that post
revenue, WhatsApp, Google Drive, Notion, the MCP bridge, Stripe Issuing
cards, registrar/DNS.

## How to verify one

1. Integrations → open it → connect or paste the key → **Run healthcheck**.
2. Give the company a small mission that uses it ("post one line to the
   test channel"), approve it from the inbox, read the run stream.
3. If it fails, the run shows the provider's error verbatim; fix the
   handler in `runtime/integrations/<id>/index.ts`, `npm run build`,
   restart the worker.
