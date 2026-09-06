# Design system — "Sunlit"

> Updated 2026-09-06: the product moved from the dark "Obsidian & Brass"
> draft below to a light, colourful system: violet→pink accent, white
> cards with soft coloured shadows, pill buttons, Outfit display type,
> green/amber/coral status colours, Sentence case everywhere. Light is the
> default; dark is a toggle. The live tokens are in
> `platform/web/app/globals.css`; the principles, motion rules, graph and
> 3D-floor guidance below still apply.

## The earlier draft ("Obsidian & Brass")

The current UI is correct and mechanical: flat panels, one-pixel borders,
monospace labels. The company product needs to feel like a living
organisation you are looking into, not a settings page. This document is
the direction and the tokens; the `hive-design` skill is how agents and
we apply it.

## Principles

1. **Depth is information.** Elevation says what is interactive, what is
   live, what is parked. Surfaces stack; nothing is a flat rectangle with a
   border.
2. **Light comes from the work.** Active agents glow; idle ones rest in the
   dark. Motion and colour are driven by events, never decoration for its
   own sake.
3. **One accent, used sparingly.** Brass stays the brand. It marks the
   primary action and the live edge, and nothing else.
4. **Editorial type.** A display serif for headlines gives the product a
   voice; a clean grotesk carries the UI; mono only for identifiers.
5. **Quiet by default, alive on demand.** Respect `prefers-reduced-motion`;
   the 3D floor is a hero, not a requirement to operate the company.

## Tokens

```css
:root {
  /* ground and surfaces: layered, warm-black */
  --ground:      #0b0a08;
  --surface-0:   #12100c;   /* page panels */
  --surface-1:   #1a1711;   /* cards */
  --surface-2:   #221e16;   /* raised cards, popovers */
  --surface-glass: rgba(34, 30, 22, 0.55);  /* backdrop-filter: blur(18px) saturate(1.2) */

  /* ink */
  --ink:         #f2ecdc;
  --ink-2:       #c9bfa6;
  --muted:       #8f8570;

  /* brand */
  --brass:       #e2a82f;
  --brass-2:     #f0c25a;
  --brass-dim:   #8a6717;
  --brass-glow:  rgba(226, 168, 47, 0.35);

  /* status */
  --live:        #7fe0a3;   /* running */
  --parked:      #f2b84b;   /* waiting for the board */
  --failed:      #ef6f5f;
  --idle:        #6f6a5e;

  /* edges and depth */
  --hairline:    rgba(242, 236, 220, 0.08);
  --shadow-1:    0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px rgba(0,0,0,0.45);
  --shadow-2:    0 1px 0 rgba(255,255,255,0.05) inset, 0 16px 48px rgba(0,0,0,0.55);
  --shadow-glow: 0 0 0 1px var(--brass-dim), 0 0 32px var(--brass-glow);

  /* radii and spacing */
  --r-1: 10px;  --r-2: 16px;  --r-3: 24px;
  --space: 4px;                     /* 4-pt grid */

  /* type */
  --font-display: "Fraunces", "Instrument Serif", Georgia, serif;   /* optical size on, soft weight 400–500 */
  --font-ui:      "Geist", "Inter", system-ui, sans-serif;
  --font-mono:    "JetBrains Mono", "Geist Mono", ui-monospace, monospace;
}
```

Light theme exists (`data-theme="light"`) with the same tokens re-valued
(warm paper `#f6f1e6`, ink `#1a1710`, brass unchanged); the product is
dark-first because the graph reads better on dark.

## Surfaces

| Surface | Use | Recipe |
|---|---|---|
| Ground | page | `--ground` with a slow radial gradient of `--brass-glow` at 4% behind the hero, plus a 3% film-grain overlay (SVG noise, `mix-blend-mode: overlay`) |
| Card | any content block | `--surface-1`, `--r-2`, `--shadow-1`, top hairline highlight; hover lifts 2px and moves to `--shadow-2` |
| Glass | overlays on the graph and floor | `--surface-glass` + blur; hairline border; used for node detail, inbox drawer |
| Live edge | anything running | 1px `--live` ring with a 2s breathing opacity animation |
| Parked | waiting on the board | `--parked` ring, static; a small brass dot on the node |

No bare `border: 1px solid` cards. Separation comes from surface value and
shadow, and a hairline only where two surfaces of the same value touch.

## Typography

| Role | Face | Size / leading | Notes |
|---|---|---|---|
| Display | Fraunces 500, opsz 144 | 56/1.02 desktop, 36/1.05 mobile | letter-spacing −0.02em; used once per screen |
| Title | Geist 600 | 22/1.2 | |
| Body | Geist 400 | 15/1.55 | max 68ch |
| Label | Geist 500 | 12/1.2, uppercase, +0.08em | replaces the mono caps used today |
| Code / ids | JetBrains Mono 400 | 12.5/1.5 | ids, hashes, versions only |

## Motion

- Spring everything (`framer-motion`, `type: "spring", stiffness 260, damping 24`).
- Enter: fade + 8px rise, staggered 40ms per item, never more than 12 items.
- Node activity: a pulse travels along the edge from sender to receiver
  when a hand-off event arrives (600ms, ease-out).
- Approvals: the inbox card slides in from the right and the parked node
  glows brass until decided.
- Reduced motion: replace pulses with a colour change; disable the floor's
  auto-orbit.

## 3D

`@react-three/fiber` + `@react-three/drei`, loaded lazily behind a static
poster so first paint is fast.

- **Floor:** a dark plane with a subtle grid, soft area light from above,
  fog at the edges. Teams are islands; agents are spheres with a matte
  obsidian material and an emissive ring that reads status colour.
- **Activity:** a hand-off is a light particle travelling between spheres;
  a running agent's ring breathes; a parked agent gets a brass beacon.
- **Camera:** orbit with damping; double-click a sphere to focus; ESC to
  return. Auto-orbit only when idle and motion is allowed.
- **Truthfulness:** the floor subscribes to the same event stream as the
  graph. Nothing animates that did not happen.
- **Budget:** under 200 draw calls, one directional and one ambient light,
  no post-processing beyond bloom at low intensity; 60fps on an integrated
  GPU laptop is the target.

## Components (v1 inventory)

`Shell` (nav rail + content + inbox drawer), `Card`, `GlassPanel`,
`StatusRing`, `AgentNode`, `TaskNode`, `EdgePulse`, `Meter` (spend, budget),
`Stat`, `InboxItem` (context, cost, approve/deny), `RunStream` (events as a
timeline with tool calls collapsed), `LedgerTable`, `CardTile` (last4 only),
`FloorScene`, `Button` (primary brass, secondary glass, ghost), `Field`,
`Toast`.

Implemented in `platform/web/components/ui/` as server-safe React with
Tailwind 4 utilities bound to the tokens above; graph nodes are client
components.

## Landing page for the rebrand

- Hero: display line "Launch your AI company." with a live floor scene of a
  demo company behind glass; one brass button "Launch a company", one ghost
  "See it run".
- Second fold: the org graph of a real template, animated by a recorded
  event stream.
- Third: "The board seat is yours" — approvals inbox screenshot with three
  real approvals (spend, publish, deploy).
- Fourth: gates, carried from the current page, restyled.
- Fifth: three launch targets (managed, own infra, local) — unchanged
  content, new surfaces.
- Founder page stays.

## Accessibility

Contrast ≥ 4.5:1 for body ink on every surface (checked in CI with the a11y
gate once it lands); all graph interactions have keyboard equivalents (tab
to node, enter to open); the floor is `aria-hidden` with the graph as the
accessible alternative; focus rings are brass.
