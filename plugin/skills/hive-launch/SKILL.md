---
name: hive-launch
description: Take a site idea from prompt to deployed URL using the hive engine — elicit intent, scaffold from a template, customize, pass gates, ship. Use when the user wants to launch, create, or deploy a website or landing page.
---

# hive-launch (golden path)

> Status: partial — `hive new` and `hive ship` land in phase 1. Until then,
> scaffold manually but STILL write hive.yaml and pass `hive check`.

## Steps

1. **Elicit the five things that matter** (ask only what's missing):
   business name, audience, the one action a visitor should take (the intent),
   tone, and any assets (logo, colors, copy).
2. **Declare intent first**: run `hive init --name <name> --intent "<intent>"`,
   then fill `hive.yaml` with audience, journeys, and per-page intents/keywords
   before writing any code. Intent is data; code follows it.
3. **Scaffold**: `hive new <template> <name>` (templates: marketing, blog,
   store, docs, portfolio). Pick the closest template; customize copy,
   sections, and brand — do not restructure the template skeleton.
4. **Gate**: `hive check --json`; fix findings per the hive-audit skill.
5. **Ship**: `hive ship --env preview`, share the preview URL, iterate on
   feedback, then `hive ship --env prod`.

## Rules

- Never deploy around the engine. If `hive ship` refuses, the build is not
  done.
- Real content only — no lorem ipsum anywhere in a shipped site.
- Every page you add must appear in hive.yaml with an intent.
