# Module spec (v0 draft — lands in phase 3)

A module is anything pluggable: an integration, a payment provider, the CMS,
an ads engine, a video pipeline. Build once, `hive add` forever.

## Layout

```
modules/<category>/<name>/
├── module.yaml     # manifest (below)
├── README.md       # human docs
├── skill.md        # agent usage patterns + pitfalls (surfaced by the plugin)
├── src/            # files copied/wired into the target project
└── tests/          # conformance + behavior tests
```

## module.yaml

```yaml
name: integrations/linkedin
version: 0.1.0
provides: [oauth-login, share-post, company-feed]
requires:
  env: [LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET]   # documented in .env.example
  node: ">=20"
adds:
  routes: [app/api/linkedin/callback/route.ts]
  components: [components/linkedin/ShareButton.tsx]
  server: [lib/linkedin/client.ts]
gates:
  - name: linkedin-env
    check: env-present
docs: README.md
skill: skill.md
tests: tests/
```

## Versioning, compatibility & audit trail

Modules are versioned artifacts, not copy-paste:

- **Semver, enforced.** Every module has `version`; breaking changes to its
  provides/routes/env surface REQUIRE a major bump. `hive module lint` diffs
  the manifest against the previous released version and fails a minor/patch
  bump that changes the surface.
- **CHANGELOG.md is mandatory** per module — no changelog entry for the new
  version, no registry entry.
- **Lockfile in consumer projects.** `hive add` records
  `{module, version, content-hash}` in `hive.lock`. A site always knows
  exactly which module versions it runs; CI can verify the hash.
- **`hive module update`** (phase 3) shows the changelog delta between locked
  and latest, warns on semver-major, and refuses cross-major updates without
  `--allow-major`. Engine compatibility is declared via `requires.hive`
  (version range), checked at add/update time.
- **Audit journal.** Every add/update/remove appends to the project's
  `.hive/journal.jsonl` (who/when/module/from→to version), and every deploy
  already writes `.hive/releases/`. "What changed across modules since the
  last ship" is a query, not an investigation.

## Module dependencies & the RBAC rule

Modules can require other modules (`requires.modules`). This exists chiefly
because access control is the thing every rebuilt system forgets:

- **`systems/rbac` is foundational** — roles, permissions, route guards,
  and an ownership model, exposed as helpers other modules consume.
- Any module that adds authenticated routes or mutating APIs (e-com, credits,
  referrals, CMS write paths) MUST declare `requires.modules: [systems/rbac]`
  and annotate each added route with the role it requires. A registry lint
  rejects `systems/*` modules with unguarded mutating routes.

## Rules

- Declared env vars are the module's *entire* configuration surface
  (portability contract).
- A module may add gates; it may never weaken or remove existing ones.
- `hive module lint` (phase 3) enforces this spec before registry entry.
- v1 registry targets:
  - `cms/core`, `seo/og-images`
  - `integrations/{postmark, do-spaces, ga4, linkedin}`
  - `payments/{razorpay, stripe}`
  - `systems/{rbac, ecom, credits, referrals}` — the always-rebuilt business
    systems, done once: rbac first (others depend on it), then ecom
    (catalog/cart/orders), credits (wallet + double-entry ledger), referrals
    (codes, attribution, rewards).
