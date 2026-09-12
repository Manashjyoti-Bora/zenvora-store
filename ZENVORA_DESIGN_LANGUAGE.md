# ZENVORA DESIGN LANGUAGE — "Ink & Cream Editorial Commerce"

**Written concept, Round 6 (created before implementation, per brief §3).**
Companion to: `FRONTEND_AUDIT_REPORT.md`, `FRONTEND_REDESIGN_REPORT.md`, `FINAL_EXPERIENCE_UPGRADE.md`.

## 0. Visual philosophy (5-second recognition test)

A visitor should see: **a warm paper canvas, deep green-black ink, one quiet brass accent, big
editorial type, real product photography treated like a magazine spread — and motion that behaves
like physics, not decoration.** Zenvora reads as "a considered Indian commerce house," not a
template: no cool grays, no purple gradients, no glass everywhere, no faked hype.

Principle stack (extracted from 2026 research — Apple-style restraint, Aesop-style editorial
composition, Linear/Stripe-style motion discipline; nothing copied):
1. Function over flash — every animation communicates state or depth.
2. Restraint is the luxury signal — one accent, two neutrals, layered ink surfaces.
3. Real data only — the design has nowhere to hide fakery, so none exists.
4. Performance is a design material — 0 kB added where CSS can do it; JS only where CSS cannot.
5. Mobile is the product — most visitors arrive from Instagram on mid-range Androids.

## 1. Color system
- **Canvas:** cream-50 `#FAF8F3` (page), cream-100/200 (recesses, placeholders), white (cards).
- **Ink:** ink-950 `#0A130F` → ink-300 `#8A978F` (8-step warm green-black ramp; text, dark
  surfaces: announcement, hero, footer). Metadata tone ink-400 = 4.9:1 on white (AA).
- **Brand green** (heritage, unchanged): primary actions, links, focus rings.
- **Brass** (signature accent, used sparingly): eyebrows on dark, hero numerals, active-nav dot,
  "how it works" numbers. Brass never carries body text on light surfaces.
- **Accent orange:** price/discount badges only (money moments).
- **Semantic:** red/emerald/amber/blue reserved for status; never decorative.

## 2. Typography
System stack (zero webfont cost; deliberate — see §14). Hierarchy:
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
One easing signature: `cubic-bezier(0.22, 1, 0.36, 1)` (fast start, long gentle settle) — the
`--ease-zenvora` custom property, used by reveals, hovers, zoom, fades. Vocabulary:
- **Entrance:** fade-up 14px, 450ms; grids **stagger** children 45ms/nth (CSS-only, capped at 8).
- **Scroll storytelling:** hero product panel drifts ≤14px + settles 0.985 scale on scroll
  (transform-only, rAF-throttled, fine-pointer + non-reduced-motion only; static without JS).
- **Feedback:** press physics on every control; toasts slide-in above the sticky-buy-bar zone.
- **State:** skeleton→content opacity 300ms; gallery image swap fade 200ms.
Rules: transform/opacity only (compositor-thread), one-shot IntersectionObserver reveals (no
scroll-jacking, no parallax on text), global `prefers-reduced-motion` kill-switch forces final
states, `noscript` fallback reveals everything. Motion budget: 0 libraries, ~1 tiny client island.

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
Budget: shared JS ≤105 kB (baseline 103 kB); zero new dependencies this round; zero webfonts;
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
