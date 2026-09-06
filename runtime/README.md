# runtime/

The company runtime worker. Status: **C0 — contracts only.** What exists:

- `tools/manifest.ts` — every tool an agent can call, with strict schemas
  and side-effect classes. The gate and both harnesses consume this.
- `company.schema.json` — JSON Schema for `company.yaml`.
- `package.json` — dependency intent (Anthropic SDK for office roles, the
  Claude Agent SDK for coding roles, SQLite shared with `platform/web`).

C1 adds `src/worker.ts`, `src/loader.ts`, `src/scheduler.ts`,
`src/gate.ts`, `src/harness/{api,agent-sdk}.ts`, `src/bus.ts`,
`src/treasury/`. Spec: [docs/company/runtime.md](../docs/company/runtime.md).

Run locally (after C1):

```bash
hive company init startup "My Company"
cd my-company
hive company validate
hive company run
```
