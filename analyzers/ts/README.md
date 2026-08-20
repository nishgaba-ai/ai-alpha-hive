# TypeScript analyzer (phase 2)

A small npm package (ts-morph) that emits the generated half of the intent
graph as JSON — component imports, routes, content usage, type-aware component
references — consumed by the Go engine. tree-sitter in Go covers the cheap
80% first; this sidecar adds the edges only the TS compiler can see.
