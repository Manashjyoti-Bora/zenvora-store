# ZENVORA — ROUND 7: REAL-WORLD LAUNCH QA & FINAL POLISH REPORT

**Date:** 12 Sep 2026 · **Branch:** `v9-real-world-qa` (HEAD `b24ac3f`, tree clean) · **Built on:** Round 6 `v8-rare-experience` (`4865c9b`)
**Mandate:** prove whether Zenvora survives real-world usage — production output only, evidence for every claim, fix only provable defects, never touch verified money/security logic, classify launch readiness.
**Verdict (details §S): READY FOR OWNER CONFIGURATION** — with one urgent action: **deploy v10 immediately; the LIVE v5 site carries the round-7 critical checkout defect (§N/D1).**

---

## A. BASELINE (re-verified at round start, not assumed)

| Item | Verified state |
|---|---|
| Git | branch `v9-real-world-qa` cut from `4865c9b` (round-6 complete); rollback tag `v8-rare-baseline` exists |
| Production build | `next build` ✓ 11.2s; shared First Load JS **103 kB**; PDP 385/391 kB; home 116/118 kB; admin 181/204 kB; 404 page 5.4 kB |
| Type/lint | `tsc --noEmit` 0 errors; ESLint 0 problems |
| Tests at baseline | unit/integration **194/194** (22 files); E2E **62/62** across 2 fresh-server cycles (storefront 12, shopping-checkout 14, webhook-security 10, admin-authz 17, auth-flow 9) |
| Round-6 claims re-proven | 132-record viewport audit re-run (0 horizontal overflow, CLS ≤0.0001); reduced-motion (no transforms under `prefers-reduced-motion: reduce`); no-JS (reveal content `opacity:1`, 16 cards visible); 404 returns true HTTP 404 |
| Known caveats carried in | mobile TBT ≈160 ms (shell hydration), bf-cache disabled (Next dynamic headers/cookies), legacy-javascript Lighthouse insight, WCAG 2.5.8-exception small targets, seed placeholder imagery (data issue), admin visual polish (declared out of scope) |

## B. ENVIRONMENT

- **App serving:** production output only — `next build` + `next start` on :3000 for every browser/Lighthouse/axe claim. `next dev` (:3100) used **only** for the Playwright E2E suites (matches CI setup). Dev-mode results are never presented as production results.
- **Stack:** Next.js 15.5.25 (App Router, React Server Components), TypeScript strict, Tailwind v4, Prisma + local PostgreSQL (seeded), demo supplier adapter, console email provider, payments disabled. Node v20, Debian 13 sandbox.
- **Browsers:** system Chromium 152.0.7822.119 via CDP (viewport/axe/motion); Chrome 148.0.7778.96 via Puppeteer (real journeys incl. an actual order); Lighthouse 12.8.2 (bundled Chromium). Desktop-hover fidelity forced via `--blink-settings=primaryHoverType=2,…`; touch and reduced-motion emulated for fallback proofs.
- **Honest limits:** headless Chrome on Linux loopback — no physical iOS/Android devices, no field RUM, no real network latency/CDN effects. Where a claim would need those, it is labeled as lab-only or listed under Remaining Risks (§R).

## C. ROUTE COVERAGE (production build, real browser + HTTP)

| Route | Status | Notes |
|---|---|---|
| `/` | 200 | hero, grids, stagger, sections; LCP element = hero h1 |
| `/shop` | 200 | sort/filter, URL state, back/forward restore |
| `/categories/everyday-carry` | 200 | canonical + BreadcrumbList |
| `/categories/zzz-nope` | 200 | falls back to full catalog by design |
| `/products/[slug]` ×4 | 200 | incl. sold-out PDP and no-image PDP; sticky mobile buy bar |
| `/products/zzz-nope` | 404 | branded not-found page |
| `/cart` | 200 | stepper updates totals reactively (₹549→₹1,000); empty state |
| `/checkout` | 200 | empty cart redirects; validation matrix tested (§K) |
| `/order/RX-260912-4VFEFA/confirmation` | 200 | **order created through the real UI** |
| `/track` | 200 | lookup by order+email; mobile render verified |
| `/search?q=char` / `q=zzznothing` | 200 | 3 relevant results / honest empty state — no faked intelligence |
| `/about` `/contact` `/faq` `/policies/*` | 200 | canonicals present |
| `/auth/login` `/auth/register` | 200 | noindex ✓ |
| `/account` | 307 | unauthenticated redirect |
| `/admin` | 404 → 200 | unauthenticated 404; staff-gated UI after login |
| `/xyz-nope` | **404 true status** | no soft-404 |

## D. DEVICE / VIEWPORT COVERAGE

360×800, 375×812, 390×844, 412×915, 430×932, 768×1024, 1024×768, 1280×800, 1366×768, 1440×900, 1920×1080 × 12 customer routes = **132 records**: horizontal overflow **0**; CLS ≤0.0001 everywhere; sticky mobile buy bar correct at 400 & 390; toaster clears the sticky bar by 23 px; nav drawer, checkout form, /track, footer, empty states photographed (28 screenshots + 7 clips in `/home/user/qa/shots/`).
*Known artifact (not a defect):* `fullPage` screenshots stitch fixed/sticky elements mid-page — disproven as a real defect by per-scroll-step capture; do not "fix".

## E. LIGHTHOUSE RESULTS (real runs, mobile emulation unless noted)

| Page | BEFORE (round start) | AFTER (post-fix) |
|---|---|---|
| Home mobile | 95 / 100 / 100 / 92 | **98 / 100 / 100 / 100** |
| Home desktop | 100 / 100 / 100 / 92 | **100 / 100 / 100 / 100** |
| Shop mobile | 97 / 100 / 100 / 100 | 96 / 100 / 100 / 100 (±1 = lab run variance) |
| Shop desktop | 100 ×4 | not re-run (no shop-blocking change; mobile re-run represents it) |
| PDP mobile | 95 / 100 / 100 / 100 | 96 / 100 / 100 / 100 |
| PDP desktop | 100 ×4 | not re-run (same rationale) |

(Perf / A11y / Best Practices / SEO. JSONs: `/home/user/qa/lh-*-BEFORE.json`, `lh-*-FINAL.json`.)
The BEFORE SEO 92 = missing canonical on home → fixed (§O/D8) → 100. No score was manufactured; the ±1 shop/PDP perf wobble is ordinary run-to-run variance on identical code paths.

## F. ACCESSIBILITY RESULTS

- **axe-core scans (Chromium, mobile viewport):** 36 total. BEFORE state: 4 instances — home sr-only "See more" link with no accessible name; PDP hint text `amber-600` contrast 3.04:1 (<4.5) ×2; 404 page `brand-700`-on-light contrast + axe-flagged decorative watermark text. **AFTER: 0 violations** on home, PDP, sold-out PDP, 404, plus the 30 previously-clean scans unchanged (11 routes × mobile/desktop + admin login).
- **Manual/automated checks:** skip-link first target; visible focus rings on every interactive; single-h1 hierarchies; all form fields labeled (incl. stepper `Increase quantity for …`); field errors are `role="alert"` (11 announced on empty checkout submit); `aria-current` nav; variant radiogroup `aria-checked` moves with keyboard; reduced-motion removes every transform/transition; no-JS keeps all content readable; sticky-bar buttons carry state labels (incl. "Sold out" disabled state).
- **Touch targets:** several sub-24px inline targets rely on the WCAG 2.5.8 spacing/inline exceptions — compliant as documented; not silently "passed".
- No claim of "accessibility perfect" — the above is what tooling + keyboard/screen-reader-semantics checks actually proved in this environment.

## G. CORE WEB VITALS (lab)

| Metric | Home mob | Shop mob | PDP mob | Home desk |
|---|---|---|---|---|
| LCP | 2.5 s → **2.1 s** (fix D7) | 2.5 s | 2.4 s | 0.7 s |
| CLS | **0** | 0 | 0 | 0 |
| TBT (INP proxy) | 180 ms → **130 ms** | 130 ms | 150 ms | 0 ms |

- Images: `next/image` AVIF/WebP; hero 1600w/q70 ≈110 kB; 1038×1038 seed photos served at 828/644; SVG data-URI placeholders (no layout shift).
- Fonts: self-hosted Geist + Geist Mono via `next/font`, `font-display: swap`, preloaded.
- JS: 103 kB shared shell; **round-7 added zero bytes of new JS** (all fixes are string/prop-level); no unnecessary client components added; no third-party scripts in the storefront bundle.
- Field INP/LCP: unknown — no RUM in this environment (§R).

## H. VISUAL QA

Reviewed 9 customer routes at desktop + 360/390/412/430 against the Round-6 design system: radius scale, shadow tokens, brass accent (#D8C287 family), spacing rhythm, hover/focus states, type scale all consistent — the site reads as one product. No stray Tailwind defaults found. Defects found and fixed: duplicated "Sold out" CTA pair on sold-out PDPs (sticky bar + buy box both rendered), aria-hidden watermark text on 404, amber hint contrast (D2–D4). Seed imagery is visibly placeholder-grade — **data/owner issue, not code** (§Q).

## I. MOTION QA (each Round-6 signature re-proven)

| # | Effect | Desktop hover | Touch | Reduced motion | No-JS | Verdict |
|---|---|---|---|---|---|---|
| M1 | Hero scroll-depth | translate3d(0,8px,0) scale(0.9914) @400px scroll | none | none | static hero ✓ | KEEP — depth cue, transform-only |
| M2 | Card 2nd-image crossfade | opacity 0→1 on hover | hidden (single image) | instant swap | first image only ✓ | KEEP |
| M3 | Grid reveal stagger | 0/45/90/135 ms steps | disabled | disabled | content visible ✓ | KEEP |
| M4 | Nav underline | rgb(216,194,135) grows | n/a | n/a | n/a | KEEP |
| M5 | Shared easing token | verified in CSS vars | ✓ | ✓ | ✓ | KEEP |
| M6 | Gallery crossfade | ✓ | tap | instant | ✓ | KEEP |
| M7 | Variant press feedback | scale 1.05 gated by hover media | suppressed | suppressed | n/a | KEEP |

Every effect gates on `(hover:hover)`/`(pointer:fine)` and `prefers-reduced-motion`; none interfered with reading, scrolling, clicking or checkout in any test. No effect was kept "because it looks impressive"; none was added. **3D re-decision: still KEEP OUT** — no real 3D assets exist, WebGL would add >100 kB to a 103 kB shell, and nothing in this round's evidence (LCP already 2.1–2.5 s on mobile emulation) supports paying that cost. Documented, not implemented.

## J. SEO QA (served production output)

title ✓ description ✓ canonical ✓ (home fixed this round; about/contact/faq/policies/cart/shop/category/PDP/track already had them) OG ✓ twitter ✓ · JSON-LD: Organization + WebSite + SearchAction on home, **Product + Offer + BreadcrumbList on PDPs** — values sourced from the same server data as the visible page (prices/names/availability match what's on screen; no phantom review/aggregate markup) · `sitemap.xml` 200 · `robots.txt` 200 · unknown URL → true 404 status · cart/checkout/search/auth/account confirmed `robots: index:false` (pre-existing; re-verified).

## K. CHECKOUT QA (sacred path — no money logic touched)

Real-browser journey (Puppeteer, production build): PDP → add-to-cart → badge updates → cart stepper changes totals reactively → checkout → **empty submit = 11 field-level `[role=alert]` errors, no navigation** → filled form → **defect D1 discovered here** (§N) → after fix: order **RX-260912-4VFEFA** placed via COD ("Place order (COD)" button) → confirmation page rendered with **zero alerts** → `/track` shows order + line items + honest "shipping details appear when it ships" note → DB probe: COD, `PENDING_PAYMENT → ORDER_CONFIRMED → SENT_TO_SUPPLIER`, console-provider emails fired (order-confirmed + supplier notification). Mobile 400×800 checkout form re-photographed post-fix. Duplicate-submit guard and guest-vs-auth flows covered by E2E `shopping-checkout` **14/14**. Server-authoritative pricing, paise arithmetic, CAS order-state transitions: untouched and still proven by unit tests (194/194). The D1 fix changes **only the client payload** (`null` → `undefined` for an optional field); zero server/pricing code modified.

## L. SECURITY REGRESSION

E2E suites re-run against a fresh server after all fixes: **webhook-security 10/10** (HMAC signature reject/accept, no raw-body leak, replay/timestamp window), **admin-authz 17/17** (35 route guards, RBAC matrix, non-staff lockout, `/admin` 404 when unauthenticated), **auth-flow 9/9** (duplicate email 409, invalid creds 401, lockout after repeated failures, reset-token flow, logout invalidation, forgot-password no-enumeration 200). Rate limiting observed live (8th rapid login attempt → 403 lockout). No secrets in commits, logs, screenshots or this report; delivery zips exclude `.env` (scan re-run §O). Webhook rejection logs contain no raw payloads.

## M. PERFORMANCE BEFORE/AFTER (measured justification only)

- Bundle: shared First Load JS **103 kB before = 103 kB after**; PDP/home/admin route sizes unchanged; 0 new dependencies this round.
- Lighthouse deltas: home mobile perf 95→98 (LCP 2.5→2.1 s via D7; SEO 92→100 via D8), desktop SEO 92→100; shop/PDP within ±1 lab variance (code-path-equivalent changes).
- TBT mobile home 180→130 ms (D7 removed a competing render in the LCP window; no JS was added or reordered).
- Every optimization this round traces to a measured defect or metric; nothing was changed speculatively.

## N. DEFECTS FOUND

| ID | Sev | Defect | Evidence |
|---|---|---|---|
| **D1** | **CRITICAL** | Guest checkout sent optional `line2` as `null`; zod union (`optional().or(literal(''))`) rejects null → generic "Invalid input", `aria-invalid` on Address line 2 → **every guest checkout leaving line 2 blank failed**. E2E missed it because API-level tests build their own payloads. **LIVE v5 is affected** — `line2:A.line2.trim()\|\|null` found by static grep of the production checkout chunk on zenvorastore.vercel.app (read-only probe; no live order created). | errmap.mjs aria-invalid dump; fixed-state order RX-260912-4VFEFA; live chunk `/_next/static/chunks/app/checkout/page-bb5439403f3bc44a.js` |
| D2 | Medium | Sold-out PDP rendered two "Sold out" buttons (sticky mobile bar not gated on soldOut) and Buy-now remained pressable-looking; misleading disabled CTA pair. | buybox-soldout-after.png, DOM dump |
| D3 | Medium | PDP hint text `amber-600` on surface = 3.04:1 contrast (WCAG AA fail). | axe BEFORE scan |
| D4 | Medium | 404 page: eyebrow `brand-700`-on-light failed contrast; decorative watermark text was real text flagged by axe. | axe BEFORE scan |
| D5 | Low | Home "See more" section links had no accessible name (sr-only span missing). | axe BEFORE scan |
| D6 | Low | Header logo accessible name mismatched visible brand (decorative "Z" glyph counted). | axe BEFORE scan |
| D7 | Low | Mobile cookie-bar copy became LCP element on home, inflating LCP 2.5 s. | LH BEFORE trace |
| D8 | Low | Homepage had no `metadata` export at all → no self-referencing canonical (SEO 92). | served-HTML grep + LH BEFORE |
| — | non-defects | headless default `hover:none` correctly suppresses hover-gated motion (gate working as designed); fullPage screenshot stitching artifact (§D). | documented to prevent future chasing |

## O. DEFECTS FIXED (all 8)

Commit `973426f` — D1–D7 (7 files: `checkout-form.tsx` line2→undefined mirroring `address-manager.tsx`; `add-to-cart-button.tsx` disabledLabel prop; `product-buy-box.tsx` `{!soldOut && …}` Buy-now gate + `amber-700`; `SectionHeader` sr-only link title; header logo badge `aria-hidden`; cookie bar responsive copy; 404 `brand-700` fix + SVG `<text>` watermark). **Honesty note:** this commit bundled the six frontend fixes with the D1 checkout fix via `git add -A` — not the atomic granularity the mandate prefers; no functional consequence, recorded here rather than rewritten history.
Commit `b24ac3f` — D8 homepage canonical.
Proof: tsc 0 · lint 0 · unit 194/194 · build ✓ · E2E 62/62 (fresh server per suite) · axe 0 violations on re-scanned routes · Lighthouse table §E · real order RX-260912-4VFEFA end-to-end. Delivery zip re-scanned: `.env`, keys, tokens excluded.

## P. DEFECTS / GAPS INTENTIONALLY NOT FIXED

1. Mobile TBT ≈130–150 ms — inherent to the 103 kB RSC shell hydration; reducing it is an architectural change outside a QA round's zero-regression envelope.
2. bf-cache disabled — Next.js dynamic `headers()/cookies()` pages; platform-level, would require routing redesign.
3. `legacy-javascript` Lighthouse insight — build-target trade-off; no measurable CWV gain proven.
4. Shop/PDP mobile LCP 2.4–2.5 s — grid/product image payload already `next/image`-optimized; further gain needs real photography + owner art-direction (§Q), not code.
5. Sub-24px inline touch targets — compliant under WCAG 2.5.8 exceptions; enlarging would churn a verified visual system.
6. Seed placeholder imagery/prices — data, not code.
7. Admin visual polish — declared out of scope in Round 6; still out of scope.

## Q. OWNER CONFIGURATION REQUIREMENTS

1. **URGENT — deploy v10** (`/home/user/zenvora-store-v10.zip`): live v5 currently fails guest checkout when Address line 2 is blank (§N/D1).
2. Razorpay live key id/secret (owner enters; never in chat/repo) → then disable demo/COD-only mode.
3. Supplier credentials (CJ Dropshipping recommended per Round-6 analysis) → replace demo adapter; until then "SENT_TO_SUPPLIER" is demo-mode only and must not be called live fulfilment.
4. SMTP provider for real transactional email (currently console provider).
5. Image storage/CDN + **real product photography and copy** (never invent product info; placeholders are data debt).
6. Legal/tax pages review by a professional (GST, returns policy) — flagged for verification, no guarantees given here.
7. Confirm `APP_URL=https://zenvorastore.vercel.app` (canonical/metadataBase source) — already set.

## R. REMAINING RISKS

- Device QA was headless-Chrome lab only; real iOS Safari / Android WebView nuances (dynamic toolbars, safe-area insets on notched devices) untested on hardware.
- No field RUM — lab CWV may differ from real-user INP/LCP.
- Rate limiting is in-memory per instance — resets on restart, not shared across serverless instances.
- Live v5 remains broken for blank-line2 guest checkouts **until v10 is deployed** (highest-priority risk).
- Database still contains seed/demo data; must be cleaned/replaced before real launch.
- CJ integration is code-complete but not live-tested against a funded CJ account.

## S. FINAL LAUNCH RECOMMENDATION

**READY FOR OWNER CONFIGURATION.**

Reasoning: every customer journey (discover → PDP → cart → checkout → confirmation → track) now completes in a real browser against the production build; money/security logic untouched and re-proven (194 unit + 62 E2E green); performance/accessibility/SEO measured at 96–100 category scores with 0 axe violations; the one critical defect found (D1) is fixed, regression-proven, and fully documented. What stands between this codebase and launch is not code — it is owner-side configuration (payments, supplier, SMTP, storage, real product data) plus the **immediate deployment of v10 to replace the defective live v5**.

Not "READY FOR LIMITED BETA": real users transacting requires live payment credentials the owner must supply first. Not "NOT READY — DEFECTS REMAIN": no known defect remains in the v9 codebase; remaining items are configuration, data, and lab-only-verification limits honestly listed in §R.

*Banned-claim check: this report does not state the product is "100% perfect", "bug free", "world's best", or any conversion guarantee. Every important claim above cites a measurement, scan, test count, artifact path, or reproducible probe.*
