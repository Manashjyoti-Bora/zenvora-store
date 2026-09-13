# ZENVORA — Frontend Redesign Report (Round 4)

**Date:** 2026-09-11 · **Scope:** customer-facing storefront UI/UX · **Companion doc:** `FRONTEND_AUDIT_REPORT.md` (written before any code change, per brief)

**Verdict summary:** Redesign implemented and verified on the final code with real command output — typecheck ✅ · lint ✅ · unit tests **194/194** ✅ · production build ✅ (103 kB shared First Load JS) · E2E spot **26/26** ✅ (storefront 12/12 ×2, shopping-checkout 14/14). Not claiming perfection — limitations are listed honestly in §8.

---

## 1. Method

1. **Audit before code** — every customer-facing page and the design system were inspected first; findings (V1–V7 visual, U1–U7 UX, priorities, exact files) are in `FRONTEND_AUDIT_REPORT.md`. One audit claim (V6, "announcement bar missing") was **self-corrected mid-audit**: it already existed in `layout.tsx`; only its styling was upgraded.
2. **Token layer first** — palette/typography/shadow/motion tokens were added to Tailwind + globals.css so every page lifts coherently instead of page-by-page patching.
3. **Real data or honest empty state** — no element was added that the backend cannot truthfully support (§5).
4. **Verify by running** — full battery re-run after the *final* edit, not before (§7).

## 2. The Zenvora design language (original — not copied from any brand)

| Layer | Decision | Why |
|---|---|---|
| **Palette** | Heritage brand green (kept untouched) + accent orange (kept) + new **ink** (#0A130F→#3D5148, deep green-blacks), **cream** (#FAF8F3→#D9D1BC, warm paper canvas), **brass** (#8A7038→#E7D9AE, muted gold accents) | Premium "ink on cream with brass" identity that harmonizes with the existing green instead of fighting it; zero brand-collision with generic Tailwind blue stores |
| **Surfaces** | `ink-950` for announcement bar, hero, footer; `cream-50` page canvas; white cards with `border-ink-900/10` + `shadow-soft` | Strong figure/ground contrast; avoids the "wall of rounded gray cards" template look |
| **Typography** | System font stack (no external font downloads), identity carried by **display treatment** (extrabold + tight tracking), **eyebrow** style (11px semibold uppercase `tracking-eyebrow`), tabular-nums on all prices | Deliberate perf trade-off for Indian mobile networks: no LCP-blocking webfonts; still a distinct hierarchy |
| **Elevation** | Named shadows `hair / soft / lift / glow` instead of default gray blurs | Consistent, subtle depth — no excessive-shadow anti-pattern |
| **Motion** | CSS keyframes `fade-up` + `shimmer`; one ~55-line `IntersectionObserver` client component (`Reveal`, one-shot, disconnects after fire); **no animation libraries added** | "No excessive JS/animation libs" mandate; bundle stayed at 103 kB shared |
| **Touch** | Hover lift gated behind `@media (hover:hover)` (no sticky hover on Android); `.btn-press` active states (`translate-y + scale`) for tap feedback | Mobile-first mandate; Android browsers are a stated target |
| **Reduced motion** | Global `prefers-reduced-motion` kill-switch: animations off, `.reveal` forced visible | A11y mandate |
| **No-JS** | `<noscript>` style in `layout.tsx` forces `.reveal` visible | Reveal content can never be permanently hidden without script |

## 3. Files changed (what + why)

**Design system core**
- `tailwind.config.ts` — ink/cream/brass palettes, `tracking.display/.eyebrow`, `shadow.hair/soft/lift/glow`, keyframes/animations (existing `fade-in` preserved). Brand green + accent orange untouched.
- `src/app/globals.css` — body cream/ink defaults, brand `::selection`, `.card`/`.card-hover` (hover-gated lift), `.btn-press`, `.eyebrow`, `.display`, `.skeleton` (shimmer), `.reveal/.is-visible`, `.safe-bottom` (`env(safe-area-inset-bottom)` for iOS), `.snap-rail` (mobile snap-scroll rails, hidden scrollbar), reduced-motion block.
- `src/components/store/reveal.tsx` **(new)** — client IntersectionObserver one-shot reveal; immediate-visible when reduced-motion or no IO support.

**Data (additive only — no contract changes)**
- `src/lib/catalog/storefront.ts` — added `getSaleProducts(limit)`: ACTIVE products with `compareAtPrice > sellingPrice` (app-layer comparison; Prisma cannot compare columns in `where`), sorted by discount depth. **Never fabricates deals.**

**Pages / components**
- `src/app/layout.tsx` — announcement bar restyled (ink-950 + brass dot); `<noscript>` reveal fallback added.
- `src/app/page.tsx` — full homepage redesign: layered ink hero (pure CSS radial washes — no image weight), eyebrow with **real** `storeName · N products live` count, display h1, inline-SVG trust icons (no emoji), trust row sourced from **real settings + payment-provider state**, right panel = real top-featured product image (or honest brand fallback panel), snap-rail categories on mobile / grid ≥sm, **Deals section rendered only when `getSaleProducts()` returns real rows**, Reveal-wrapped Featured/New-arrivals grids, ink/brass "how it works" numerals, demo + empty-catalog states preserved.
- `src/components/store/product-card.tsx` — rewrite: 4:5 portrait imagery with fixed aspect-ratio (no CLS), SVG bag-glyph placeholder (no emoji), real sale badge (`−N%` only when compare-at exists), real low-stock chip (only when `stock ≤ lowStockThreshold` and threshold configured), sold-out overlay, stretched-link title (whole card tappable, `Add to cart` kept clickable above it via z-index), `card-hover` lift, focus-visible ring on the card.
- `src/components/layout/header.tsx` — cream/ink tokens, wordmark with tracked-uppercase identity + monogram hover-rotate, `btn-press` cart button. All links, aria labels, cart badge logic, search forms unchanged.
- `src/components/layout/mobile-menu.tsx` — cream drawer, ink tokens, press states, login/signup button styling. Structure, aria-expanded/controls, links unchanged.
- `src/components/layout/footer.tsx` — dark ink-950 footer: brass eyebrow headings, monogram wordmark, support-email pill button, real categories via existing `listActiveCategories()` with honest empty state. All links/aria labels preserved; **no collections section** (no Collection model exists in the schema — none invented).
- `src/app/products/[slug]/page.tsx` — **sticky mobile buy bar** (`lg:hidden`, safe-area padded): real thumbnail, real price + real strike-through compare-at, real Add-to-cart for single-variant products / "Select options" jump to `#buybox` for variant products; emoji icons replaced with inline SVG; `scroll-mt` anchor; **removed a fabricated promise** ("we usually reply within 1 business day") from the contact line.
- `src/components/store/product-gallery.tsx` — per-image **shimmer skeletons** until `onLoad` (client-only; no root `loading.tsx`, protecting the soft-404 fix), SVG empty state (was emoji), arrow-key navigation on thumbs, cream tokens.
- `src/components/store/cart-manager.tsx` — image placeholder token alignment (cream). Cart is server-rendered with real `initialCart` data — no skeleton needed (documented honestly rather than adding theater).
- `src/components/ui/form.tsx` — **real a11y bug fixed**: `Field`'s render-prop passed `describedBy` which consumers spread onto DOM elements → React warning *and* `aria-describedby` was never actually set (hints/errors not programmatically associated). `Input`, `Textarea`, `Select` now map `describedBy → aria-describedby`. This silently upgrades every form in the app (track, auth, checkout, contact, admin).

**Ops**
- `scripts/recover-sandbox.sh` **(new)** — idempotent sandbox-reset recovery (npm install, PostgreSQL 17 install/start, role/DBs, migrations for dev+test via the `.env` swap that Prisma CLI requires, seeds via `tsx` directly because `prisma db seed` cannot find `tsx` on PATH).

## 4. Preserved without modification (hard mandates)

Pricing engine + margin protection · discount/coupon validation · inventory logic · order state machine (incl. RTO) · auth/authz/RBAC · all API routes/contracts · security middleware/headers · supplier adapters · migrations (still 11, additive) · no root/section `loading.tsx` added (soft-404 fix intact — verified: unknown URLs still return real 404) · supplier cost/margin never rendered on any customer surface.

## 5. Anti-fabrication evidence (not claims — checks)

| Element | Source of truth | Verification |
|---|---|---|
| Deals section | `compareAtPrice > sellingPrice` on ACTIVE products | `SELECT count(*) FILTER (WHERE "compareAtPrice" > "sellingPrice") … FROM products WHERE status='ACTIVE'` → **0 of 8** ⇒ section **hidden** on the live preview right now; appears automatically when a real markdown exists |
| "N products live" hero eyebrow | `countStorefrontProducts()` | DB-backed count |
| Trust row (COD/prepaid, delivery window, returns) | `getSettings()` + `describePaymentProvider()` | Renders provider state truthfully (test provider labeled as such) |
| Low-stock chip | real `stock` vs configured `lowStockThreshold` | Only renders when both exist |
| Removed | "we usually reply within 1 business day" | Fabricated service promise — deleted from PDP |
| Never added | reviews, ratings, sales counters, "X people viewing", fake urgency timers, customer statistics | None exist in the codebase; none invented |

## 6. Accessibility & performance notes

- `aria-describedby` now genuinely wired (was broken — §3).
- Gallery thumbs: `role=tablist/tab`, arrow-key support, `aria-selected`.
- Cards: focus-visible ring via `focus-within`; single tappable surface doesn't trap the Add-to-cart control.
- Semantic headings kept (h1 per page, section h2s with `aria-labelledby`).
- Contrast: cream-100/300 text on ink-950 surfaces; ink-800 on cream-50.
- Images: `fill` + `sizes` + lazy by default, `priority` only for hero/LCP image; fixed aspect-ratios ⇒ no layout shift.
- JS budget: one new tiny client component (`Reveal`); shared First Load JS **103 kB** (no new dependencies added).

## 7. Verification — real command output (final code, after last edit)

| Check | Command | Result |
|---|---|---|
| Types | `tsc --noEmit` | **exit 0**, no errors |
| Lint | `npm run lint` (eslint .) | **exit 0**, no warnings |
| Unit + integration | `npm run test` | **194 passed (194)** · 22/22 files · 0 skipped |
| Build | `npm run build` | **exit 0** · ✓ Compiled successfully · First Load JS shared 103 kB (only pre-existing Prisma-7 deprecation notice, non-blocking) |
| E2E storefront | vitest e2e, fresh dev server :3100 | **12/12** — run twice: pre-header/gallery edits and again on final code |
| E2E shopping-checkout | vitest e2e, fresh dev server :3100 | **14/14** on final code (full money path: cart → coupon edge cases → checkout → payment simulate → order transitions → track) |
| Console hygiene | dev-server logs, /track rendered | **no React warnings** after the form.tsx fix (warning was present before it) |
| Routing sanity | curl warm-up | `/ /shop /cart /track /checkout /faq /contact /search /auth/* /sitemap.xml /robots.txt → 200`; unknown product/category/page → **404** (soft-404 fix intact) |

Mid-round incident (transparency): the sandbox reset twice, wiping `node_modules` and the apt-installed PostgreSQL. Recovered fully via the now-committed `scripts/recover-sandbox.sh`. The local dev DB password was rotated to a URL-safe hex value (the previous generated password broke Prisma connection-string parsing); `.env` + `.env.test` were synced. **Local-dev only — no production secret was touched.**

## 8. Limitations (honest — this is NOT a 100% claim)

1. **No automated visual-regression screenshots** in this environment; visual evidence is the live production-build preview served from this workspace (port 3000) instead.
2. **E2E spot, not full suite**: 26/26 on the two customer-journey files per the established per-file recipe. The other three suites (webhook-security, admin-authz, auth-flow) exercise API/admin surfaces untouched by this round and were **not re-run** now (last full 62/62: round 2, method unchanged).
3. **Admin panel was not redesigned** — round scope is customer-facing; admin remains functional-but-plain.
4. **Typography identity is treatment-based** (weight/tracking/color), not a bespoke typeface — a deliberate no-webfont performance trade-off; a licensed display font can be layered in later without structural change.
5. **Production site (zenvorastore.vercel.app) still serves the previous UI** until the new build is deployed — deployment requires the owner's GitHub/Vercel action (see `UPDATED_PROJECT_STATUS.md`).
6. Reveal animations run on Featured/New-arrivals sections only; on extremely old browsers without IntersectionObserver the component falls back to immediately visible (no hidden content), but the fallback itself is untested against real legacy devices here.

## 9. Files changed this round (complete list)

```
tailwind.config.ts                                  (modified — tokens)
src/app/globals.css                                 (modified — token layer)
src/app/layout.tsx                                  (modified — announcement + noscript)
src/app/page.tsx                                    (rewritten — homepage)
src/app/products/[slug]/page.tsx                    (modified — sticky buy bar, SVG, honesty fix)
src/components/store/reveal.tsx                     (NEW)
src/components/store/product-card.tsx               (rewritten)
src/components/store/product-gallery.tsx            (rewritten — skeletons, a11y)
src/components/store/cart-manager.tsx               (modified — tokens)
src/components/layout/header.tsx                    (modified — tokens)
src/components/layout/mobile-menu.tsx               (modified — tokens)
src/components/layout/footer.tsx                    (rewritten — dark footer)
src/components/ui/form.tsx                          (modified — aria-describedby bug fix)
src/lib/catalog/storefront.ts                       (modified — +getSaleProducts, additive)
scripts/recover-sandbox.sh                          (NEW — ops)
FRONTEND_AUDIT_REPORT.md                            (pre-code audit, V6 self-corrected)
FRONTEND_REDESIGN_REPORT.md                         (this file)
UPDATED_PROJECT_STATUS.md                           (companion status)
```

Backend untouched: pricing engine, order state machine, auth, API routes, migrations (11, additive), security middleware — all verified by the 194-test suite + 26/26 E2E on final code.
