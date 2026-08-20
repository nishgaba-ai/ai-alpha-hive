# Intent graph (v0 draft — lands in phase 2)

The answer to "intent changed — what's affected?" Two halves, reconciled:

**Declared** — `hive.yaml` (see `internal/config`): site intent, audience,
journeys, per-page intents/keywords/sections. Intent is data: diffable,
queryable, agent-editable.

**Generated** — `analyzers/ts` emits the code-side graph as JSON: component
imports, routes, content usage, integration touchpoints, internal links,
env-var consumers. tree-sitter covers the cheap 80%; ts-morph adds type-aware
edges.

Both merge into `.hive/graph.db` (SQLite, gitignored — rebuildable anywhere,
per the portability contract).

## Queries

```bash
hive graph impact component:RateTable   # pages, journeys, keywords, tests affected
hive graph impact intent:book-consult   # every artifact serving that journey
hive intent diff                        # declared intent changed → ordered TODO
```

**Drift detection**: a page declares keyword X but content no longer mentions
it → gate warning. Declared and actual are never allowed to silently diverge.
