# Policy gates

Gates are deterministic checks every project passes before `hive ship`
deploys. They are Go code — an agent cannot skip, reorder, or reinterpret
them. Output is JSON (`hive check --json`) with `file:line`, severity, and a
`fix_hint`, so the agent loop is: check → fix → re-check.

## Built-in gates

| Gate | Enforces | Blocking | Status |
|---|---|---|---|
| secrets | no credentials/private keys in tracked files | yes | ✅ implemented |
| types | `tsc --noEmit` clean | yes | phase 1 |
| lint | eslint (shared config) | yes | phase 1 |
| build | `next build` succeeds | yes | phase 1 |
| test | vitest/playwright if present | yes | phase 1 |
| links | no broken internal links | yes | phase 1 |
| seo | meta/OG/schema.org/sitemap/robots complete | yes* | phase 1 |
| a11y | axe on built pages | warn→yes | phase 2 |
| geo | AI-citability score, llms.txt | warn | phase 4 |
| perf | Lighthouse budget per template | warn→yes | phase 4 |
| drift | content still serves declared intent/keywords | warn | phase 2 |

\* blocking on product templates.

## Escape hatch

The only sanctioned suppression is a same-line `hive:allow-secret` comment for
known-fake fixture values. It is grep-able and reviewed like code.

## Writing a gate

Implement `gates.Gate` (`Name`, `Description`, `Blocking`, `Check`) and
register it in `gates.Registry()`. A gate ships with a passing fixture, a
failing fixture, and findings that carry fix hints. Gates must be pure
functions of the project directory — no network, no global state — so results
are reproducible everywhere.
