# Contributing

## Ground rules

- **Every feature lands with docs, tests, and (where user-facing) an example.**
- **Gates are sacred**: never merge a change that lets anything bypass
  `hive ship`'s gate run. New gates need a passing fixture, a failing fixture,
  and machine-readable findings with fix hints.
- **Portability contract**: no machine-specific paths or state outside
  environment variables. If you add a variable, document it in `.env.example`.
- **Modules** must conform to `docs/module-spec.md` and pass
  `hive module lint` (phase 3) to enter the registry.

## Dev loop

```bash
go build ./...
go test ./...
go vet ./...
```

CI runs the same on Linux, macOS, and Windows — the README quickstart is an
integration test; if you change it, make sure it still works verbatim.

## Commit style

Conventional-ish, present tense: `gates: add link checker`, `cli: fix doctor
exit code`. Reference the master plan section when implementing planned work.
