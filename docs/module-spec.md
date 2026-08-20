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

## Rules

- Declared env vars are the module's *entire* configuration surface
  (portability contract).
- A module may add gates; it may never weaken or remove existing ones.
- `hive module lint` (phase 3) enforces this spec before registry entry.
- v1 registry targets: cms/core, integrations/{postmark, do-spaces, ga4,
  linkedin}, payments/{razorpay, stripe}, seo/og-images.
