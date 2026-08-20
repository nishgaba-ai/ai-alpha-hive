# Bakery Demo

The canonical hive walkthrough — a site scaffolded by:

```bash
hive new marketing "Bakery Demo" --intent "Get Ahmedabad locals to order celebration cakes on WhatsApp"
```

with the template's placeholder copy replaced by real content (the hive rule:
no lorem ipsum ships, ever). To run it:

```bash
npm install
hive check          # all gates green
npm run dev         # local preview
hive ship           # deploy preview to Vercel (VERCEL_TOKEN in .env)
```

Deployable on a free Vercel account. The declared intent lives in
[hive.yaml](hive.yaml).
