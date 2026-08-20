# Login / RBAC — design-architecture library specification

> **What a "library" means here.** Not a code-style library — a *design
> architecture library*: a complete, opinionated blueprint of the problem
> domain (entities, flows, threats, presets, integration contract) that any
> hive product instantiates via `hive add systems/rbac`. The code is one
> rendering of this spec; the spec is the asset. Every systems/* library in
> the registry follows this document's structure.

Status: SPEC v1 (2026-08-20). Reference implementation: bootstrap preset live
in `platform/web` (§14); full DB-backed implementation lands with platform
Stage B and is extracted into `modules/systems/rbac`.

---

## 1. Scope & philosophy

- **The AI proposes, the guard disposes**: every rule here is enforced
  server-side in engine/module code. UI hiding is never the security
  boundary.
- **Tiered presets** (product decision): teams pick a tier and grow through
  them without rework — the data model beneath is identical in all tiers.
- **No unguarded surface**: a route/action/API added by any module that
  mutates state or reads private data MUST declare its permission. Registry
  lint rejects violations. This is the rule that makes forgetting RBAC
  structurally impossible.

## 2. Tiered presets (the product surface)

| Preset | Contents | Typical user |
|---|---|---|
| **standard** | email+password, verified email, forgot/reset, sessions, personal org, 4 fixed roles | every new product |
| **custom** | standard + brandable UI (logo/colors/copy/fields), phone-number variant (OTP login), magic links, invitations | funded products |
| **advanced** | custom + 2FA (TOTP + recovery codes, SMS fallback), passkeys/WebAuthn, OAuth (GitHub/Google), custom roles, API keys, step-up auth, SSO (OIDC/SAML) + SCIM | teams/enterprise |

A preset is configuration over one schema — upgrading tiers never migrates
data destructively.

## 3. Identity model (entities)

- **user** — global identity: id (ULID), email (citext unique), email_verified_at,
  phone (E.164, unique, nullable), phone_verified_at, password_hash (argon2id),
  name, avatar, status (active/suspended/deleted), created/updated.
- **org** — the tenant. Every user gets a personal org at signup (multi-product
  needs a container; teams come free). name, slug, owner cascade rules.
- **membership** — user↔org: role, status (invited/active/suspended), invited_by,
  joined_at. Uniqueness (user, org).
- **product** — belongs to org (the multi-product unit hive manages).
- **session** — server-side record: id (opaque 256-bit), user_id, org_id (active
  context), created_at, last_seen, expires_at (absolute), idle_expires_at,
  ip, user_agent, revoked_at. Cookie carries only the opaque id.
- **credential** (advanced) — per-factor rows: type (totp/webauthn/recovery),
  secret (encrypted at rest), label, last_used.
- **api_key** (advanced) — hashed key, scopes[], org_id, expires, last_used.
- **invitation** — email, org, role, token_hash, expires, accepted_at.
- **audit_event** — §10.
- **service account** (advanced) — non-human member for automations; API-key
  auth only, never password.

## 4. Authentication methods

| Method | Tier | Notes |
|---|---|---|
| email + password | standard | argon2id (m=64MB, t=3, p=4 baseline); password policy: length ≥ 10, no composition theater, block top-10k breached list |
| forgot / reset | standard | single-use token (hash stored), 30-min TTL, all sessions revoked on reset |
| magic link | custom | same token discipline as reset |
| phone OTP | custom | 6-digit, 5-min TTL, 5 attempts, provider-agnostic SMS adapter |
| OAuth (GitHub, Google) | advanced | account-link flow, email-collision policy: verified-email match links, else block with uniform error |
| TOTP 2FA + recovery codes | advanced | 10 single-use codes shown once; org policy can REQUIRE 2FA |
| passkeys / WebAuthn | advanced | as first factor (passwordless) or second factor |
| SSO OIDC/SAML + SCIM | advanced | org-scoped IdP config; JIT provisioning; SCIM deprovision revokes sessions ≤60s |

## 5. Credential & account lifecycle

register → verify email (24h token; unverified accounts limited, purged in 7
days) → change email (verify NEW address, notify OLD, 24h undo link) →
change password (requires current password OR step-up; revokes other
sessions) → account deletion (soft-delete, 30-day grace, then PII scrub —
audit rows keep opaque ids only).

## 6. Sessions

- Opaque server-side ids; cookie `HttpOnly; Secure; SameSite=Lax; Path=/`,
  host-only. Never JWTs for browser sessions — revocation must be real.
- Idle timeout 14d (rolling), absolute 90d; remember-me toggles idle 24h↔14d.
- Session list UI ("this device", last seen, revoke one/all) — standard tier.
- Rotate session id on privilege change (login, 2FA success, role elevation)
  — kills fixation.
- Active-org context stored on session; switching orgs re-checks membership.

## 7. Authorization (the RBAC core)

- **Fixed roles** (standard): `owner` (billing+delete org+transfer),
  `admin` (manage members/products), `developer` (create/deploy products),
  `viewer` (read-only). One owner minimum invariant enforced.
- **Permissions are named constants**, never inline role checks:
  `product:create`, `product:deploy`, `product:delete`, `member:invite`,
  `member:role:set`, `org:billing`, `org:delete`, `audit:read`, …
  Role→permission matrix is data (a table/map), not code branches.
- **Check API** (the only doorway):
  `can(session, permission, resource?) → allow | deny(reason)`.
  Resource carries org scoping; product-level overrides are additive
  (advanced). Deny is default; unknown permission is a hard error (fail
  closed, catches typos at test time).
- **Enforcement points**: route middleware/layout guards (redirect),
  server actions & API handlers (403 + audit), background jobs (service
  context), UI only *reflects* (`can()` exposed read-only to render state).
- **Custom roles** (advanced): named permission sets per org; cannot exceed
  creator's own permissions (no privilege escalation by construction).
- **ABAC hooks** (advanced): optional predicate per permission
  (e.g. `product:deploy` requires product.status != frozen).

## 8. Multi-tenancy rules

Org isolation is absolute: every query is org-scoped by construction
(repository layer takes org_id from session, never from client input).
Invitations: email + role, 7-day expiry, inviter must hold `member:invite`
and cannot grant a role above their own. Ownership transfer: owner-initiated,
acceptance required, audit both sides. Suspension: immediate session
revocation, memberships kept.

## 9. Delegation & machine access (advanced)

API keys: org-scoped, permission-subset scopes, hash-stored, prefix-visible
(`ahk_live_…`), expiry + last_used, revocation immediate. Impersonation
(support mode): explicit user consent OR break-glass with dual audit entry;
banner shown; every impersonated action tagged `acting_as`.

## 10. Audit & observability

`audit_event`: id, ts, actor (user/service/impersonator), org, action
(named constant = permission names + auth.* events), resource type+id,
before/after diff (JSON, PII-minimized), ip, user_agent, request_id.
Append-only; auth events included (login.success/fail, lockout,
password.reset, 2fa.enroll, session.revoke). Org admins read their org's
trail (`audit:read`); export CSV/JSON; retention 400d default. Metrics:
login success rate, lockouts, resets, active sessions.

## 11. Attack resistance (the checklist that ships as tests)

- **Enumeration**: uniform errors + uniform timing on login/reset/invite
  ("if an account exists, we emailed it").
- **Brute force**: per-account (10 fails → 15-min lock + email) AND per-IP
  sliding-window rate limits; OTP/2FA attempt caps.
- **CSRF**: SameSite=Lax + origin check on mutations (defense in depth).
- **Fixation**: rotate on auth (§6). **Replay**: single-use tokens, hashed
  at rest. **Redirects**: allowlist relative paths only on `?next=`.
- **Timing**: constant-time compares everywhere secrets are compared.
- **Secrets at rest**: token/key columns store hashes; TOTP secrets
  encrypted (AES-GCM, key from env per portability contract).
- **Headers**: HSTS, X-Content-Type-Options, frame-ancestors none on auth
  pages. **Logging**: never log credentials, tokens, or full cookies.

## 12. Privacy & compliance

PII minimization (collect email+optional phone+name, nothing else by
default); DPDP (India) + GDPR alignment: export-my-data and delete-my-account
as standard-tier features; consent timestamps for marketing contact;
processor list per SMS/email adapter documented in module manifest.

## 13. Integration contract (what `hive add systems/rbac` wires)

```yaml
name: systems/rbac
provides: [auth, sessions, rbac, audit, login-ui]
requires:
  env: [AUTH_SECRET]                # + per-adapter: POSTMARK_SERVER_TOKEN, SMS_*
  modules: []                       # rbac is the root — others require IT
adds:
  routes: [/login, /register, /verify, /reset, /settings/security, /api/auth/*]
  middleware: [auth-guard]
  migrations: [0001_identity.sql …] # SQLite + Postgres variants
  gates: [rbac-unguarded-routes]    # fails any mutating route without a declared permission
events: [user.created, user.deleted, member.invited, session.revoked, login.failed]
extension_points:
  - onRegister / onLogin hooks
  - custom fields (custom tier)
  - role matrix overrides (advanced tier)
```

UI presets ship as themable components (standard = drop-in pages; custom =
tokens + slots; advanced = headless hooks + reference UI).

## 14. Reference implementation status

| Piece | Status |
|---|---|
| Bootstrap admin preset (env credential, HMAC-signed server session cookie, guarded /dashboard, uniform errors, logout) | ✅ live on platform/web — this round |
| DB-backed users/orgs/sessions (SQLite, argon2id, register+verify+reset) | Stage B |
| Roles/permissions + audit + invitations | Stage B |
| custom/advanced presets (phone OTP, 2FA, OAuth, passkeys) | Stage C+ |
| Extraction to `modules/systems/rbac` | engine phase 3 |

## 15. Acceptance gates (how we know it's the gold standard)

Conformance suite the module must pass: every route in `adds.routes`
declares auth level; login timing variance < 20%; reset token single-use
proven; session revoked ≤1s after logout/suspension; org isolation fuzz
(cross-org id probing returns 404, never 403-with-existence-leak); lockout
triggers at policy; audit rows for 100% of mutations.
