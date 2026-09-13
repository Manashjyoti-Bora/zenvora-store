# FRONTEND_AUDIT_REPORT.md — Zenvora Store v6 storefront

Date: 2026-09-09 · Method: full source inspection of every customer-facing page/component +
design-system files, before any modification. Backend contract frozen for this pass.

## 1. Current strengths (verified in code — preserve)
- **Honesty discipline is excellent**: homepage uses real counts (`activeCount`), real payment
  provider status (`describePaymentProvider` — shows "being configured" when keys absent), real
  settings (shipping/returns/COD), an explicit empty-catalog state, and a demo-mode explainer.
  No fake reviews/ratings/sales counts anywhere. This must survive the redesign.
- Server-rendered pages (`force-dynamic` where needed), `next/image` with `sizes` + lazy loading
  on cards, semantic landmarks (skip-link, `aria-labelledby` sections, nav labels), visible
  `:focus-visible` ring system, `prefers-reduced-motion`-safe today only because there is almost
  no motion at all.
- Product card already has: discount badge from real `compareAtPrice`, low-stock badge from the
  per-product `lowStockThreshold`, sold-out state, strikethrough original price.
- Component library exists (`ui/button|badge|form|modal|feedback|table|toaster`), CSS utility
  layer (`.card`, `.input-base`, `.container-store`), coherent Tailwind v3 config with a brand
  green palette + accent orange.
- E2E-verified flows (cart → checkout → COD/prepaid-test → track) — 26/26 passing; the redesign
  must keep these anchors (store name, product names, INR digit rendering, real 404 copy).

## 2. Visual weaknesses (the "template-like" complaint — confirmed)
| # | Weakness | Evidence | Priority |
| --- | --- | --- | --- |
| V1 | Emoji used as iconography (🚚 🔒 ↩️ on hero, 🛍️ image fallback) — instant template feel | `src/app/page.tsx` hero list; `product-card.tsx` fallback | **Critical** |
| V2 | Hero is a flat left-aligned text block on a faint gradient; no composition, no brand surface, no imagery | `page.tsx` lines ~35-80 | **Critical** |
| V3 | No visual identity: generic gray-50 canvas, default `rounded-xl` + `shadow-sm` everywhere, no depth system, no display typography, uniform section rhythm | `globals.css`, `tailwind.config.ts` | **Critical** |
| V4 | Footer is a plain white text grid — no brand presence | `layout/footer.tsx` | High |
| V5 | No deals/offers section even though real discount data exists (`compareAtPrice > sellingPrice`) | homepage sections | High |
| V6 | ~~Announcement setting never rendered~~ **CORRECTED during implementation**: the bar IS rendered in `src/app/layout.tsx` (initial grep was truncated — audit error, fixed here); it only received a visual refinement | ~~High~~ Done |
| V7 | Product card imagery: `aspect-square` (less premium than portrait), emoji placeholder, default-tone badges floating on image | `product-card.tsx` | High |

## 3. UX weaknesses
| # | Weakness | Priority |
| --- | --- | --- |
| U1 | **Zero skeleton/loading states in the entire app** (grep for skeleton/animate-pulse: 0 hits). Server rendering hides most of it, but client zones (cart mutations, gallery, search submit) show nothing or layout jumps | High |
| U2 | No micro-interaction system: buttons lack press feedback; cards only get `shadow-md` hover; no tap states for mobile | High |
| U3 | Mobile category browsing = 2-col boxes; no thumb-friendly rail/snap scrolling; mobile nav is a bare toggled list | High |
| U4 | Product detail: no sticky mobile buy area — on small screens the price/CTA scrolls away | High |
| U5 | No scroll-reveal/section transitions (fine for perf, but contributes to "flat" feel); no motion tokens at all | Medium |
| U6 | Breadcrumbs component exists (`store/breadcrumbs.tsx`) — verify usage on product/category pages | Medium |
| U7 | Homepage "How ordering works" numbered circles = generic; copy is honest, presentation dated | Medium |

## 4. Accessibility / performance / responsive notes
- A11y baseline good (skip link, focus-visible, labelled nav, semantic headings). Gaps: emoji
  icons are `aria-hidden` ✅ but decorative-only meaning is weak; announcement bar will need
  `role="status"`-free static rendering (it's not a live region); contrast of `text-gray-400`
  on white (used for compare-at prices and category counts) fails WCAG AA for small text →
  darken to gray-500.
- Perf: no animation libraries (keep it that way — CSS keyframes + one tiny IntersectionObserver
  client component only); `next/image` already used; avoid adding client components to the
  server-rendered homepage except the single `Reveal` wrapper (~30 lines, degrades to visible
  when JS off or reduced-motion).
- Responsive: container/px system fine; hero and category rail need mobile-first composition;
  sticky buy bar must respect iOS safe-area (`pb-[env(safe-area-inset-bottom)]`).
- Constraint honored: root-level `loading.tsx` must NOT be added (known soft-404 regression);
  skeletons go inside client components only.

## 5. Files to modify (exact) + proposed architecture
**Token layer (lifts every page without touching each one):**
1. `tailwind.config.ts` — add: `ink`/`cream`/`brass` palettes, layered `boxShadow` scale
   (soft/lift/card), display letter-spacing, keyframes+animations (`fade-up`, `shimmer`,
   `reveal`), keep brand green as the heritage primary. (Critical)
2. `src/app/globals.css` — typography hierarchy (display/eyebrow classes), `.btn-press`
   (active scale/translate), `.card-hover` lift, `.skeleton` shimmer, `.reveal` + global
   `prefers-reduced-motion` kill-switch, contrast fixes, selection color, safe-area utility.
   (Critical)

**Storefront surfaces:**
3. `src/lib/catalog/storefront.ts` — add `getSaleProducts(limit)` using existing
   `compareAtPrice > sellingPrice` data (no schema change). (High)
4. `src/app/page.tsx` — homepage recomposition: announcement bar (real setting), editorial hero
   (eyebrow with real counts, display headline, inline-SVG trust row, layered brand panel with
   the top featured product's real image), snap-scroll category rail on mobile, **Deals** section
   (only when real discounts exist), featured/new-arrivals with reveals, restyled how-it-works.
   All copy stays honest; empty states preserved. (Critical)
5. `src/components/store/product-card.tsx` — portrait `aspect-[4/5]`, SVG placeholder on cream,
   refined badge stack, price hierarchy, contrast fix, hover/tap polish. (High)
6. `src/components/store/reveal.tsx` — NEW ~30-line client component (IntersectionObserver,
   one-shot, reduced-motion/no-JS ⇒ visible). (Medium)
7. `src/components/layout/header.tsx` + `mobile-menu.tsx` — spacing/tracking polish, monogram
   mark, announcement-independent (bar lives in layout). (Medium)
8. `src/app/layout.tsx` — render the announcement bar when `settings.announcement?.enabled`
   (fixes V6 dead data). (High)
9. `src/components/layout/footer.tsx` — ink-dark premium footer, same honest content. (Medium)
10. `src/app/products/[slug]/page.tsx` — sticky mobile buy strip (price + jump-to-buy-box CTA;
    no duplicated cart logic ⇒ zero checkout risk). (High)

**Deliberately NOT touched:** checkout/cart internals, auth pages, account tables, admin UI —
they inherit the token-layer lift (buttons/inputs/cards/focus/motion) without risky per-file
rewrites; their flows are E2E-verified and business-critical. Any deeper checkout visual work is
flagged Medium for a follow-up pass, not rushed now.

## 6. Risk controls for this pass
- No API/route/schema changes except one additive read-only lib function (`getSaleProducts`).
- E2E anchors preserved: store name text, viewport meta, product names, `formatINR` digit
  rendering, 404 copy, sitemap URLs.
- No new dependencies; no root `loading.tsx`; no fabricated data; reduced-motion respected;
  full battery (typecheck/lint/194 tests/build/E2E spot) re-run before delivery.
