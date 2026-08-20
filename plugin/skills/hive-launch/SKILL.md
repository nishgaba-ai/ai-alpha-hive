---
name: hive-launch
description: Take a site idea from prompt to deployed URL using the hive engine — elicit intent, scaffold from a template, customize, pass gates, ship. Use when the user wants to launch, create, or deploy a website or landing page.
---

# hive-launch (golden path)

## Steps

1. **Elicit the five things that matter** (ask only what's missing):
   business name, audience, the one action a visitor should take (the intent),
   tone, and any assets (logo, colors, copy).
2. **Scaffold**: `hive new <template> "<Display Name>" --intent "<intent>"`
   (templates today: marketing; more come with the registry). This writes
   hive.yaml, the site, and runs npm install.
3. **Declare before you build**: fill hive.yaml's audience, journeys, and
   per-page intents/keywords before customizing code. Intent is data; code
   follows it. Customize copy, sections, and brand — replace every
   "Replace this" placeholder with real content; do not restructure the
   template skeleton. Keep the default /about page but make it the user's own.
4. **Gate**: `hive check --json`; fix findings per the hive-audit skill.
5. **Ship**: `hive ship` (preview), share the URL, iterate on feedback, then
   `hive ship --env prod`. Requires VERCEL_TOKEN in .env (see .env.example);
   if it's missing, ask the user to add it — never ask them to paste the
   token in chat.

## Rules

- Never deploy around the engine. If `hive ship` refuses, the build is not
  done.
- Real content only — no lorem ipsum anywhere in a shipped site.
- Every page you add must appear in hive.yaml with an intent.
