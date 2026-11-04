# Web design system

Operate-mode product UI. Dealt with the taste-skill app run (style `framed-sheet`, seed 1111133863)
and checked with its inspector and the impeccable craft floor. Everything the sheet does not fix
follows `.agents/skills/design-taste-frontend/references/app-screens.md`.

## The move

One tinted L-shaped frame (sidebar 228px + 48px top bar, no rule between them) on `#eef3f6`; the
work sits on a white sheet inset 8px from the window's right and bottom edges, 16px corners, 1px
edge, no shadow. The frame tint is one low-chroma step of the accent hue: the product's colour of
verification. Colour budget under 3%: the chrome stays grey, the accent (`#1b6c80`) appears only
on the active tab underline, the score ledger line and the one selected state. Status hues carry
data only: fact-check labels, event values, deltas.

## The face

- Type: IBM Plex Sans (400/500/600), self-hosted through `@fontsource` because the production CSP
  is `style-src 'self'`. IBM Plex Mono for ids, formulas and figures in tables.
- Signature element: the **wave ledger** on `/score`: Q drawn as a step line across finalized
  waves with the open wave's projected Q as a dashed last step (`WaveLedgerChart`). Every value is
  the API's string; the client never computes a score.
- People are themselves: a stable initial on a pale tint derived from the username (`Avatar`).

## Tokens (`tailwind.config.js`)

| Role | Value |
| --- | --- |
| frame / ground / surface / raised / active | `#eef3f6` / `#f9fbfc` / `#ffffff` / `#f4f6f8` / `#e6ebee` |
| border / rule / control | `#e8eaec` / `#f0f1f2` / `#cdced1` |
| ink / muted / faint | `#131416` / `#5d5f60` / `#6b6b6b` (all ≥ 4.5:1 on white) |
| accent | `#1b6c80` (tint `#e3f1f4`, ink `#0f4d5c`) |
| positive / negative / warning | `#1e7b4f` / `#c4242a` / `#92400e`, each with a pale pill pair |
| primary button | near-black `#1d1f20`, white label |
| radii | card 8px · control 6px · sheet 16px · chip 4px |
| type | title 22/600 · section 16/600 · kpi 28/400 · body 14 · small 12 · prose 16/26 |
| controls | 32px toolbar, 36–40px form, 44px touch targets on phones |

## Rules kept on every screen

- A 22px noun title per screen, optional one-line subtitle, the one primary action on the right.
- KPIs are type, not tiles: one container split by hairlines, label over value, no icons, no
  sparklines. The answer figure leads.
- Tables: 12px grey sentence-case headers, no header band, no zebra, numbers right-aligned in
  tabular figures (`font-variant-numeric: tabular-nums` on `body`).
- Pills are pale tints with dark ink of the same hue, never squeezed; one status mark per row.
- Honest states: zeros print as zeros, missing as a dash, loading as grey bars at real size, errors
  inside the block that failed with a retry, empty sections keep their frame and one sentence.
- Shadows only on what floats (menu, dialog). No gradients, glass, emoji or decorative icons.
- Phone: the frame disappears, 48px top bar with menu, 20px margins, tables fold to two-line rows,
  tabs scroll in their own row.

## Checks

```bash
node .agents/skills/design-taste-frontend/scripts/lint.mjs --app apps/web/src
node .agents/skills/design-taste-frontend/scripts/inspect.mjs --app http://localhost:5173/login
npx playwright test   # axe-core WCAG 2.1 AA on every screen (REQ-028)
```

Known inspector warnings that are defended: monospace on figures and ids (the sheet's second face),
and shadows on the menu and dialog (overlays).
