# Policy gates

Gates are deterministic checks every project passes before `hive ship`
deploys. They are Go code — an agent cannot skip, reorder, or reinterpret
them. Output is JSON (`hive check --json`) with `file:line`, severity, and a
`fix_hint`, so the agent loop is: check → fix → re-check.

## Built-in gates

| Gate | Enforces | Blocking | Status |
|---|---|---|---|
| secrets | no credentials/private keys in tracked files | yes | ✅ implemented |
| deps | node_modules installed for web projects | yes | ✅ implemented |
| types | `tsc --noEmit` clean | yes | ✅ implemented |
| lint | eslint clean (errors block, warnings reported) | yes | ✅ implemented |
| build | `npm run build` succeeds | yes | ✅ implemented |
| links | internal links resolve to routes or public files | yes | ✅ implemented |
| seo | metadata+description, robots, sitemap (errors); OG, JSON-LD (warnings) | yes | ✅ implemented |
| test | the project's `npm test` script, when a real one exists | yes | ✅ implemented |
| a11y | axe on built pages | warn→yes | phase 2 |
| drift | content still serves declared intent/keywords | warn | phase 2 |
| geo | AI-citability score, llms.txt | warn | phase 4 |
| perf | Lighthouse budget per template | warn→yes | phase 4 |

Gates that don't apply to a project (e.g. web gates on a non-web repo, toolchain
gates before `npm install`) report `skip`, never a false pass. Warnings are
reported but only `error`-severity findings fail a gate.

## Escape hatch

The only sanctioned suppression is a same-line `hive:allow-secret` comment for
known-fake fixture values. It is grep-able and reviewed like code.

## Writing a gate

Implement `gates.Gate` (`Name`, `Description`, `Blocking`, `Check`) and
register it in `gates.Registry()`. A gate ships with a passing fixture, a
failing fixture, and findings that carry fix hints. Gates must be pure
functions of the project directory — no network, no global state — so results
are reproducible everywhere.
