# ZENVORA DESIGN LANGUAGE — "Petrol & Porcelain Editorial Commerce"

**Written concept, Round 6 (created before implementation, per brief §3).**
Companion to: `FRONTEND_AUDIT_REPORT.md`, `FRONTEND_REDESIGN_REPORT.md`, `FINAL_EXPERIENCE_UPGRADE.md`.

## 0. Visual philosophy (5-second recognition test)

A visitor should see: **a porcelain canvas, midnight ink, one deep-petrol action colour, one
quiet champagne rule, big editorial type, real product photography treated like a magazine
spread — and motion that behaves like physics, not decoration.** Zenvora reads as "a considered
Indian commerce house," not a template: no gradients-for-their-own-sake, glass only on the few
overlay surfaces listed in §1a, no faked hype.

Principle stack (extracted from 2026 research — Apple-style restraint, Aesop-style editorial
composition, Linear/Stripe-style motion discipline; nothing copied):
1. Function over flash — every animation communicates state or depth.
2. Restraint is the luxury signal — one accent, two neutrals, layered ink surfaces.
3. Real data only — the design has nowhere to hide fakery, so none exists.
4. Performance is a design material — 0 kB added where CSS can do it; JS only where CSS cannot.
5. Mobile is the product — most visitors arrive from Instagram on mid-range Androids.

## 1. Color system — "Petrol & Porcelain" (2026-10-25 refresh; tokens in `tailwind.config.ts` / `globals.css`)
Full comparison, measured contrast and token map: `docs/DESIGN_SYSTEM.md` §2.
Five named colours, each with one job:
- **Midnight Ink `#111820`** (`ink-900`, `--color-midnight`, `--surface-ink`): branding, dark
  surfaces (announcement, hero, footer, dark glass, toasts), primary text.
- **Porcelain Mist `#F6F5F0`** (`cream-50`, `--color-porcelain`, `--surface-canvas`): every
  shopping surface. White (`--surface-card`) for cards, forms, tables.
- **Deep Petrol `#174A50`** (`brand-600`, `--color-petrol`, `--brand-primary`): the action
  colour. Primary button fill (white text **9.85:1**), active nav, selected states;
  `brand-700 #113C41` for links/eyebrows on light; `brand-500 #1F5A60` for the light focus ring.
  Continuous with the existing app icon (petrol field + champagne Z), so the brand stays
  recognisable.
- **Iridescent Teal `#77C9C1`** (`brand-400`, `--color-teal`): highlight on **dark surfaces
  only** — focus rings on dark glass, hero accents, active icons on Midnight (9.3:1). **Never
  text on light** (1.9:1).
- **Muted Champagne `#C6AD7A`** (`accent-400` / `brass-400`, `--color-champagne`): sparingly —
  eyebrows and rules on dark surfaces, hero numerals. **Never text on light** (2.2:1).
- **Pale Sage `#E2ECE5`** (`sage-100`, `--surface-sage`): success / calm *surfaces* only.
  Success text is `sage-600`/`success-600`/`emerald-600 #347455` (5.6:1 on white).
- **Semantic:** muted text `#59636B` (`ink-400`, 5.6:1 on Porcelain); error `#B33A42`
  (`danger-600`, `red-600` re-pointed to it, 5.8:1); borders `#DCE1DE` (`cream-200`). Amber
  stays for "pending" states.
All ratios above were computed (WCAG 2.2 relative luminance), not estimated.

### 1a. Liquid-Glass system (role classes)
Role classes: `.glass-header` `.glass-nav` `.glass-floating-control` (bars),
`.glass-popover` `.glass-drawer` `.glass-dialog` `.glass-filter-panel` (light panels),
`.glass-toast` (dark). Material primitives `.glass-panel` `.glass-bar` `.glass-dark`
`.glass-scrim` and the opt-out `.crisp` remain. Allowed **only** on: header, search overlays,
floating/mobile nav, dialogs, drawers, filter panels, toasts. **Never** on product photos,
prices, checkout/payment forms, admin tables — those stay opaque. Each class ships an opaque
fallback first and adds translucency + `backdrop-filter` only inside `@supports` **and** when
`prefers-reduced-transparency` is not set. Blur values are static tokens (`--glass-blur` 14px,
`--glass-blur-bar` 10px) and are **never transitioned or animated**. Each role class also
carries its layer from the z-index ladder (`--z-floating 30 … --z-skip 80`, see
`docs/DESIGN_SYSTEM.md` §4).

## 2. Typography
Inter Variable, **self-hosted** from `@fontsource-variable/inter` (one `woff2` per unicode
subset, `font-display: swap`, no third-party font request — see §14), falling back to the
system stack. Hierarchy:
- **Display** (`.display`): extrabold, tracking −0.02em — hero h1, page h1s, 404.
- **Eyebrow** (`.eyebrow`): 11px semibold uppercase, tracking +0.14em — section labels; brand-700
  on light, brass-200/300 on dark.
- **Body/labels/meta:** ink-900/700/500/400 steps; prices always `tabular-nums`.
- No weight below 400, no size below 11px, no line-height below 1.25 on body.

## 3. Spacing rhythm & grid
4px base; sections in 8/10/12/14 steps (py-10→sm:py-12→lg:py-14). `container-store` max-width
with gutter. Hero grid 1.15fr/0.85fr asymmetric ≥lg; product grids 2-col mobile → 4-col desktop;
PDP 50/50 ≥lg. Mobile rails snap-scroll (`.snap-rail`).

## 4. Border / radius / shadow language
- Borders: hairline ink at low alpha (`ink-900/5…/20`) — warm, never cool gray lines.
- Radius scale: `rounded-lg` (controls) → `rounded-xl` (cards) → `rounded-2xl` (medallions).
  No mixed radii inside one component. Pills only for badges/count chips.
- Shadows: named — `hair` (resting card), `soft` (interactive card), `lift` (sticky bars/menus),
  `glow` (focus-adjacent emphasis). Never default Tailwind gray blurs.

## 5. Texture language
Ink-950 surfaces carry `.grain` (inline-SVG feTurbulence, opacity .06, static, zero requests):
hero, footer. Cream surfaces stay clean. Texture = depth on dark only.

## 6. Icon language
`ui/icons.tsx`: 24px grid, 1.7 stroke, round caps/joins, `currentColor`, always `aria-hidden`
with adjacent text labels. Emoji are banned as UI icons on customer surfaces (verified 0).

## 7. Button language
Component-only (no loose `btn` classes): primary brand / secondary ink / outline hairline /
ghost. Every interactive: `btn-press` physics (1px sink + 0.985 scale on active), `transition-colors`
150ms, `focus-visible:ring-2 ring-brand-500 ring-offset-2`. Touch height ≥40px on mobile money CTAs.

## 8. Image treatment
Fixed aspect ratios everywhere (cards 4:5, gallery 1:1) → zero CLS. `object-cover`, cream-100
underlay + shimmer skeleton until `onLoad`. Hover: 1.05 breathe on cards; **crossfade to the real
second product image where one exists** (signature, §D); desktop zoom 1.12 on PDP main image
(pointer:fine + hover:hover gated). SVG bag-glyph placeholder when a product has no image.

## 9. Motion language ("Zenvora ease")
Tokens (`globals.css`): `--duration-micro 120ms` (hover tint, press), `--duration-fast 160ms`
(toggles, chips), `--duration-normal 220ms` (dropdowns, toasts, drawers), `--duration-slow 240ms`
(dialogs), `--duration-enter 450ms` (one-shot section reveal). Easing `--ease-zenvora`
`cubic-bezier(0.22,1,0.36,1)` and `--ease-out` `cubic-bezier(0.16,1,0.3,1)`.
Utilities: `.motion-reveal` (opacity + 6px translate), `.motion-fade`, `.motion-pop` (0.96→1),
`.motion-lift` (hover −1px), `.success-check` (single stroke draw, 420ms).
Rules:
- transform/opacity only — never animate blur, box-shadow, width/height or colour-heavy layers;
- micro-interactions 120–240ms; entrances ≤450ms; nothing loops except the skeleton shimmer;
- no scroll hijacking, no parallax on text, **no per-card scroll animation** (the grid stagger
  runs once per section via a single IntersectionObserver, capped at 8 children);
- `prefers-reduced-motion: reduce` collapses every animation/transition to its final state
  (global kill-switch at the end of `globals.css`), and smooth anchor scrolling is disabled;
- the payment-success mark animates **only** on the order confirmation branch that the server
  rendered from a confirmed database state — never on an optimistic client guess.

## 10. Interaction language
Whole-card tap target via stretched link (Add-to-cart stays independently clickable above it);
hover gated by `(hover:hover)` so touch never sticks; active nav carries a brass dot + ink weight;
forms validate server-side with field-level errors wired through `aria-describedby`; destructive
actions require confirmation; every empty state = what happened → what to do next.

## 11. Component states (every interactive component defines)
rest · hover (fine pointers) · active/press · focus-visible · busy/loading (skeleton or spinner in
button) · disabled (opacity .6, cursor) · error · empty. No component ships without them.

## 12. Trust design (truthful only)
Trust row = real settings (COD/prepaid from payment provider state, delivery window from settings,
return window from policies). Low-stock chip only when `stock ≤ configured threshold`. Sale badge
only when `compareAtPrice > sellingPrice`. No reviews/ratings/counters/timers — the backend has
none, so the design shows none.

## 13. Responsive breakpoints & mobile law
sm 640 / md 768 / lg 1024 / xl 1280. Mobile law: 16px inputs (no iOS zoom), safe-area insets on
every fixed bar, toasts clear the buy bar, snap-scroll rails instead of cramped grids, products
before filters on listings, thumb-reachable primary CTAs, `overflow-x: clip` page guard.

## 14. Performance law (design constraint, not afterthought)
Budget: shared JS ≤105 kB (baseline 103 kB); no third-party webfont requests (Inter is
self-hosted and served from `/_next/static/media`, so CSP stays `font-src 'self'`);
grain/icons inline; parallax island <2 kB and desktop-gated; images `sizes`-correct, lazy by
default, `priority` only for LCP hero; no animation on layout properties (no CLS); reduced-motion
and no-JS both yield the full, static, complete experience.

## 15. Anti-template commitments (enforced by grep in QA)
No emoji UI · no cool grays on customer surfaces · no purple/indigo/fuchsia gradients ·
backdrop-blur only where functionally required (sticky header, buy bar) · no bento/organic
anti-grids for product listings · no glass cards · no 3D without real assets (rejected with
measurement, see report §F) · no fabricated social proof anywhere.

## 16. Accessibility floor (WCAG 2.2 AA practices)
Skip link · global focus-visible · semantic landmarks/headings · labeled controls with
aria-describedby errors · AA contrast (ink-400 minimum for small text) · ≥24px targets (≥40px for
money CTAs) · dialogs/drawers with aria-expanded/controls · reduced-motion honored · no keyboard
traps; gallery thumbs keyboard-navigable (arrows).
