---
name: hive-design
description: Build or restyle hive product UI to the "Obsidian & Brass" design system — depth, glass, motion, editorial type, live graph nodes, and the 3D floor — instead of flat bordered panels. Use when creating any screen, component, landing page, or dashboard in platform/web or a hive template, or when the user says the UI looks mechanical, flat, or needs a designer's touch.
---

# hive-design

Read `docs/company/design-system.md` first; it holds the tokens and the
reasons. This skill is how to apply it without drifting.

## Before writing a component

1. Name the surface: ground, card, glass, live edge, or parked. If it is
   none of these, it is probably text on ground.
2. Name the one thing the screen is for and give it the display face; there
   is one display line per screen.
3. Decide what is live. Only live things move or glow; everything else
   rests.

## Recipes

**Card**
```tsx
<div className="rounded-[var(--r-2)] bg-[var(--surface-1)] shadow-[var(--shadow-1)] p-6 transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-2)]">
```
No `border`. If two cards of the same surface touch, add
`ring-1 ring-[var(--hairline)]`.

**Glass panel** (over the graph or floor)
```tsx
<div className="rounded-[var(--r-3)] bg-[var(--surface-glass)] backdrop-blur-xl backdrop-saturate-125 ring-1 ring-[var(--hairline)] shadow-[var(--shadow-2)]">
```

**Status ring** — a 2px ring in the status token; running adds
`animate-breathe` (opacity 0.6→1, 2s, ease-in-out, infinite); parked adds a
brass dot at the top-right; reduced motion removes the animation.

**Primary button** — brass fill, ink `#141005`, `--r-1`, subtle inner
highlight, 120ms spring on press; one per view. Secondary is glass; ghost is
text with a hairline on hover.

**Labels** — `text-[12px] font-medium uppercase tracking-[0.08em]` in
`--muted`, Geist, not mono. Mono is for ids only.

**Ground** — `bg-[var(--ground)]` plus the radial brass glow behind the
hero and the grain overlay component (`<Grain />`, fixed, pointer-events
none, 3% opacity).

## Graph nodes

`AgentNode` and `TaskNode` are client components using React Flow's
`Handle`s. Layout comes from the server (`/graph` endpoint) so first paint
has no jump. Edge pulses are a single `motion.circle` travelling along the
edge path on hand-off events; batch events within 100ms so a burst does not
spawn fifty particles.

## 3D floor

Lazy-load `FloorScene` behind a poster image; never block the graph on it.
One directional light, one ambient, low bloom, fog. Spheres per agent with
emissive ring colour bound to status; a particle per hand-off. Orbit
controls with damping; auto-orbit only when idle and motion allowed;
`aria-hidden`. Keep under 200 draw calls and test on an integrated GPU.

## Landing page

Follow the fold order in the design system doc. Real content only: a
recorded event stream from a real template run drives the demo graph; no
fake numbers.

## Checks before you finish

- `hive check` green (seo and links gates cover the new pages).
- Contrast: body ink on every surface ≥ 4.5:1.
- Keyboard: every node and inbox item reachable and operable.
- `prefers-reduced-motion`: pulses become colour changes; floor stops.
- No `border-[var(--line)]` left on new surfaces; the old tokens are
  aliases during migration and disappear when the last consumer moves.
- Screenshot desktop and mobile; the page must never scroll horizontally.
