---
name: hive-audit
description: Run hive's policy gates on the current project, fix every finding, and re-check until green. Use when the user asks to audit, check, or fix a hive-managed project, or before any deploy.
---

# hive-audit

You are auditing a hive-managed project. Never re-implement a check yourself —
the gates are the single source of truth.

## Loop

1. Run `hive check --json` from the project root.
2. If every gate passed: report the green board and stop.
3. For each finding, open `file:line`, apply the `fix_hint`, and make the
   smallest correct change. Do not suppress findings; the only sanctioned
   escape hatch is a `hive:allow-secret` comment for known-fake fixture values,
   and it requires a justification in the same line.
4. Re-run `hive check --json`. Repeat until green or a finding needs a human
   decision (e.g. a real credential that must be rotated) — then stop and
   report exactly which finding and why.

## Rules

- A blocking-gate failure means `hive ship` will refuse the build. Never work
  around the engine (no direct `vercel deploy`, no editing gate code).
- Real leaked credentials: remove from source, tell the user to rotate them.
  Never print the credential value back in chat.
