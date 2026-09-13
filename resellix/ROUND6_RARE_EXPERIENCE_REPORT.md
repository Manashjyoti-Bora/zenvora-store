# ROUND 6 — ZENVORA "RARE / SIGNATURE EXPERIENCE" REPORT

**Date:** 2026-09-12 · **Branch:** `v8-rare-experience` (baseline tag `v8-rare-baseline` = `70e95b1`)
**Scope:** customer-facing experience only. Backend frozen — verified untouched (§L).
**Companion doc:** `ZENVORA_DESIGN_LANGUAGE.md` (written concept, committed BEFORE implementation).

---

## §A — BEFORE-state critique (critic first; prior reports treated as claims, not truth)

Battery at start (ran BEFORE any edit): tsc ✅ · lint ✅ · **194/194** ✅ · build ✅ · shared
First Load JS **103 kB**. The v8 state was healthy — but healthily *generic* in motion and
discovery. Honest findings from full route/component inspection:

| # | Finding | Severity |
|---|---------|----------|
| A1 | Hero was completely static after entrance animation — no depth, no scroll story; the most premium real estate on the site behaved like a template banner | High (identity) |
| A2 | Product cards ignored `imageUrls[1]` — real second images in the data model were never surfaced; hover was lift+scale only | High (discovery) |
| A3 | Grids revealed uniformly — no choreography; `Reveal` wrapped whole sections so children appeared as one block | Medium |
| A4 | Nav had no active-section state — no wayfinding once inside the catalog | Medium |
| A5 | PDP gallery snapped instantly between cached images (fade existed only on network load) | Medium |
| A6 | Structured data incomplete: no `BreadcrumbList`, no `Organization`/`WebSite` | Medium (SEO) |
| A7 | Variant selector: flat chips, ~34px targets, no press feedback — the second most important control on the money path | Medium |
| A8 | **The prior round's "0 emoji" claim was false at storefront scope.** A wider Unicode-range grep found ~20 pictographs across 10 customer files (account nav 🏠📦📍👤🛠️🚪, contact 📧📞, confirmation 📦✅, PDP 💳🧾, order timeline ✕🛍️📞, cart 🛒🛍️🎉, demo banner ⚠️, global-error ⚠️, greeting 👋). The earlier sweep only covered store components. | High (a11y + identity) |
| A9 | Signature ease `cubic-bezier(0.22,1,0.36,1)` was hardcoded in 2 rules while siblings used generic `ease-out` — motion had no single identity | Low |
| A10 | Three hover-only visuals were ungated (hero product lift/zoom, card image scale, logo tilt) — transient sticky states possible on touch | Low (mobile) |

Already strong and deliberately left alone: ink/cream/brass token system, grain texture,
editorial 404/error pages, truthful trust row, skeletons, safe-area handling, global
reduced-motion kill-switch, money-path UI, honest empty states.

## §B — Research findings (principles extracted; nothing copied)

Sources: 2026 web-design-trend surveys (line25, design.pinal/Medium, acodez) + principle study of
Apple/Aesop/Linear/Stripe/Vercel patterns. Extracted principles that shaped this round:

1. **Micro-interactions are a baseline quality signal** — "function over flash"; every animation
   must communicate state or depth; reduced-motion support is a floor, not a feature.
2. **Light skeuomorphism, selectively** — tactile press cues belong on decision-critical controls
   (buy buttons, variant chips), not everywhere.
3. **Editorial kinetic moments need static fallbacks** — scroll-linked depth is legitimate only
   when the no-JS/reduced-motion experience is complete and identical in content.
4. **Glassmorphism is at saturation peak (60% adoption)** — using more of it now reads as
   template, not premium. Zenvora keeps only 4 functional backdrop-blurs (sticky header, mobile
   buy bar, hero fallback panel, stock chip over imagery).
5. **Bento/organic anti-grids harm product scannability** — rejected for commerce listings.
6. **Performance-first creativity** — motion budgets in kB, not vibes; one signature easing beats
   many trendy ones.
7. **Single-accent restraint** (Aesop/Apple principle) — one brass accent + two neutral families
   reads more "considered house" than any effect stack.

No layout, color scheme, typography, imagery, or trade dress was copied from any studied brand.

## §C — Design philosophy

Written in full **before implementation** as `ZENVORA_DESIGN_LANGUAGE.md` (committed first):
"Ink & Cream Editorial Commerce" — warm paper canvas, deep green-black ink, one quiet brass
accent, magazine-spread product photography, physics-not-decoration motion. Covers all 16
required areas: philosophy, color, typography, spacing/grid, border/radius/shadow, texture,
icons, buttons, images, motion vocabulary ("Zenvora ease"), interaction language, component
states, trust design, responsive law, performance law, anti-template commitments, a11y floor.

## §D — Signature features (the "rare" layer)

1. **HeroPanel scroll depth** (`hero-panel.tsx`, ~60 lines, the round's ONLY new JS): the hero
   product panel drifts ≤14px and settles to 0.985 scale as the hero scrolls away. Gates:
   `(hover:hover) and (pointer:fine)` only · `prefers-reduced-motion` no-op · passive rAF-throttled
   listener that **detaches entirely** (IntersectionObserver) once the hero leaves the viewport ·
   transform-only (compositor; zero CLS; LCP image paints untransformed first) · static without JS.
2. **Second-image crossfade** on product cards: when — and only when — a product really has
   `imageUrls[1]`, hovering/keyboard-focusing the card breathes the second photo in (500ms,
   signature ease, matched 1.05 scale). `alt=""` decorative duplicate; `[@media(hover:hover)]`
   gated so touch never sticks; zero markup/cost for single-image products. Proven on served HTML
   with a temporary second image (then DB restored — §J).
3. **Stagger choreography**: CSS-only `.stagger` inside any `Reveal` fires children in 45ms steps
   (capped at 8; all later children share the final delay). Grids now arrive like editorial
   layouts, not photocopiers. No JS, no observers, no per-element classes.
4. **Brass active-nav underline**: server-rendered from the middleware's `x-pathname` header —
   Shop / category / Track links carry a 2px brass rule + `aria-current="page"` on their section.
   Zero client JS; wayfinding the site never had.
5. **One easing signature**: `--ease-zenvora: cubic-bezier(0.22,1,0.36,1)` (+ Tailwind
   `ease-zenvora`) now drives every reveal, hover, zoom, crossfade and stagger — motion finally
   has a single voice.
6. **Gallery switch crossfade**: keyed main image + `animate-fade-in` — cached-image switches
   (previously instant snaps) now breathe.
7. **Tactile variant selector**: `btn-press` physics + ~40px targets + selected-state shadow on
   the money path's second control.

## §E — Implemented changes (7 commits, all on `v8-rare-experience`)

| Commit | Change | Files |
|---|---|---|
| `039c3c2` | Design language doc (concept-first) | ZENVORA_DESIGN_LANGUAGE.md |
| `e561a2a` | Ease token + stagger CSS + guards | tailwind.config.ts, globals.css, layout.tsx (noscript), product-grid.tsx |
| `84ddd7b` | HeroPanel island + hero wiring | hero-panel.tsx (new), page.tsx |
| `1095c49` | Card second-image crossfade | product-card.tsx |
| (nav/gallery/buybox) | Active nav, gallery crossfade, variant tactility | header.tsx, product-gallery.tsx, product-buy-box.tsx |
| (seo) | BreadcrumbList (PDP) + Organization/WebSite (layout) | products/[slug]/page.tsx, layout.tsx |
| `9835f97` | Gate all hover-only visuals (A10) | page.tsx, product-card.tsx, header.tsx |
| `72776e6` | Emoji eradication (A8): 8 new SVG icons, 10 files fixed | icons.tsx + contact, global-error, confirmation, PDP, account-nav, address-manager, demo-banner, order-detail, cart-manager, account/page |

Backend files touched: **none** (proven in §L).

## §F — Deliberately rejected (with reasons)

| Rejected | Why |
|---|---|
| **3D / WebGL / Three.js** | Brief §6 test: would Zenvora be *better*? No. (1) ~150 kB+ library vs 103 kB shared baseline — larger than the entire app shell; (2) **no real 3D assets exist** — catalog is 2D supplier photography, so any "3D" would be fake geometry or a spinning photo card (meaningless-3D cliché the brief bans); (3) audience skews mid-range Android on cellular — GPU/battery cost is regressive; (4) measurable LCP/INP risk on the money path's entry page. Documented rejection per brief §6. |
| Count-up hero statistics | Hydration-flash risk; decorative value; the honest numbers (live product count) are already static text. |
| Sticky-header shrink-on-scroll | Continuous scroll-handler cost for a cosmetic effect; header is already compact (56px). |
| Lightbox / pan-zoom gallery | Existing desktop zoom-hover covers inspection need; dialog focus-management + gesture code costs more than it gives at this catalog's image quality. |
| Cart drawer / mini-cart | Rewrites money-path UX for fashion; cart page is truthful and tested. |
| Filter bottom-sheet drawer | Prior-round decision stands (products-first stacking accepted). |
| Bento / organic anti-grid listings | Harms scannability (§B5). |
| More glassmorphism | Saturation-peak template smell (§B4). |
| Magnetic / cursor-following buttons | Gimmick; pointer-tracking handlers; poor a11y. |
| Infinite scroll | Breaks crawlable pagination; listing contracts frozen. |
| Search autocomplete / "AI" suggestions | No backend endpoint exists — shipping a fake-looking suggester would violate the no-fabrication rule. Search remains honest full-page query. |
| Wishlist | No data model; backend frozen. |
| Kinetic/variable-font typography | System-font stack is a deliberate perf trade (zero webfont cost); motion belongs to layout, not letterforms, for this voice. |

## §G — Performance before/after (measured, same machine, production builds)

| Metric | BEFORE (v8-rare-baseline worktree build) | AFTER | Δ |
|---|---|---|---|
| Shared First Load JS | **103 kB** | **103 kB** | **0** |
| `/` page JS / First Load | 2.98 kB / 121 kB | 3.30 kB / 121 kB | +0.32 kB (HeroPanel) |
| `/shop` | 3.55 / 121 | 3.52 / 121 | −0.03 (noise) |
| `/search` | 3.85 / 122 | 3.83 / 122 | −0.02 |
| `/cart` | 6.55 / 124 | 6.54 / 124 | −0.01 |
| `/checkout` | 7.42 / 120 | 7.47 / 120 | +0.05 |
| `/products/[slug]` | 5.79 / 124 | 5.80 / 124 | +0.01 |
| `/categories/[slug]` | 3.55 / 121 | 3.52 / 121 | −0.03 |
| New dependencies | — | **0** | 0 |
| New webfonts / requests | — | **0** (grain + 16 icons inline) | 0 |

Runtime cost profile: one passive rAF-throttled scroll handler **only while the hero is on
screen, only on fine-pointer non-reduced-motion desktops** (IO-detached otherwise); everything
else is CSS on the compositor thread (transform/opacity only). No layout-property animation ⇒
no added CLS. LCP image renders before any transform is applied. Honest caveat: no Lighthouse /
field-RUM numbers — the sandbox has no browser (§M).

## §H — Accessibility results

- **Emoji → SVG** (~20 pictographs, 10 files): screen readers no longer announce decorative
  emoji; all new icons `aria-hidden` with adjacent text labels; cross-platform rendering now
  consistent (emoji fonts vary wildly on Android).
- `aria-current="page"` on active nav (new wayfinding is announced, not just visual).
- Crossfade second image `alt=""` (decorative duplicate — no double announcement).
- Keyboard parity: card crossfade/scale also fires on `focus-within`; gallery thumb arrow-key
  navigation preserved; global focus-visible rings untouched.
- Variant selector: 34px → ~40px targets; selected state conveyed by border+background+shadow
  (not color alone); disabled state keeps `cursor-not-allowed + opacity`.
- Reduced motion: global kill-switch + **explicit `.stagger` override** + HeroPanel no-op ⇒
  reduced-motion users get the complete, static, identical-content experience.
- No-JS: noscript overrides extended to stagger children (nothing can stay hidden).
- Contrast: no text-token changes; brass underline is decorative (non-text). ink-400 floor
  (4.9:1) unchanged.
- Honest caveat: verified by markup/CSS audit + WCAG 2.2 checklist; **no axe/Lighthouse run**
  (no browser in sandbox) and no screen-reader session — §M.

## §I — SEO results

- **Added:** `BreadcrumbList` on every PDP — generated from the *same array* that renders the
  visible breadcrumbs (one source of truth; last item omits `item` per schema.org).
- **Added:** `Organization` + `WebSite` (with `SearchAction` targeting the genuine
  `/search?q={search_term_string}` endpoint) in the root layout, storefront branch only, using
  the real store name and canonical `APP_URL`.
- **Kept:** Product + Offer/AggregateOffer with real prices/availability; no `aggregateRating`
  (no review system exists — adding one would be fraudulent structured data).
- Verified: true 404 status on unknown routes; sitemap.xml/robots.txt 200 (E2E logs); twitter
  cards from prior round intact.

## §J — Test results (nothing weakened, nothing deleted)

| Gate | BEFORE | AFTER (final) |
|---|---|---|
| `tsc --noEmit` | ✅ 0 | ✅ 0 (run ×4 mid-round) |
| `next lint` | ✅ 0 | ✅ 0 |
| Unit + integration | ✅ **194/194** (22 files) | ✅ **194/194** (22 files) |
| Production build | ✅ 103 kB shared | ✅ 103 kB shared (×4 builds) |
| E2E storefront | ✅ 12/12 | ✅ 12/12 (×2 cycles) |
| E2E shopping-checkout | ✅ 14/14 | ✅ 14/14 (×2) — full order→payment→confirm→email→track lifecycle in logs |
| E2E webhook-security | ✅ 10/10 | ✅ 10/10 (×2) — bad-signature 400s, dedupe 200, unknown-order 422s |
| E2E admin-authz | ✅ 17/17 | ✅ 17/17 (×2) — 401/403/200 RBAC matrix |
| E2E auth-flow | ✅ 9/9 | ✅ 9/9 (×2) — register/dup-409/login-throttle-403/reset-no-enumeration |
| **E2E total** | **62/62** | **62/62 ×2 cycles** (fresh server per suite, warmed routes) |

Served-production-HTML smoke (final build, `next start` :3000): HeroPanel wrapper ✓ ·
Organization/WebSite/BreadcrumbList JSON-LD ✓ · stagger class + 8 compiled delay rules ✓ ·
active-nav `aria-current` + brass underline ✓ · gallery `animate-fade-in` ✓ · variant
`btn-press` ✓ · 5 `@media (hover:hover)` gated rules in compiled CSS ✓ · `var(--ease-zenvora)`
×4 ✓ · contact page 0 emoji + SVG icons ✓ · 404 status ✓ · /cart /checkout /track 200 ✓.

**Crossfade data-proof:** seed catalog has 0 products with ≥2 images ⇒ the feature renders
nothing (correct, zero-cost). Proven by temporarily attaching a real second image to one dev-DB
product: crossfade layer appeared in served /shop and / HTML; then the row was deleted and the
DB verified restored to seeded state (0 layers again). No fabricated data was left anywhere.

## §K — Mobile QA (360–430px + iOS Safari constraints)

- **Every hover-only visual is now `(hover:hover)`-gated** (fixed A10 this round): card lift,
  card image scale, second-image crossfade, hero product lift/zoom, logo tilt, PDP zoom-hover.
  Verified in compiled served CSS — touch devices get no sticky hover states.
- Touch targets: variant chips ~40px (up from ~34px); stepper ≥24px (prior audit); cart icon
  40px; nav/buy-bar thumb-reachable.
- iOS Safari: 16px inputs preserved (`.input-base` law); `env(safe-area-inset-bottom)` on every
  fixed bar; toasts offset above the sticky buy bar (prior fix, verified still present).
- Layout guards: `overflow-x: clip` body guard; fixed-aspect imagery everywhere ⇒ no CLS from
  the new crossfade layer (absolute-positioned inside the same 4:5 box).
- HeroPanel deliberately **disabled on touch** — mobile gets the static hero (design decision,
  not a gap: parallax on mid-range Android scroll = jank risk).
- Honest caveat: sandbox has no real-device or emulated mobile browser; verification is
  served-HTML/CSS audit at markup level. Pixel-level device QA remains an owner step (§M).

## §L — Backend integrity verification

- `git diff v8-rare-baseline..HEAD --stat` touches **only**: 2 new files
  (hero-panel.tsx, ZENVORA_DESIGN_LANGUAGE.md + this report), customer components
  (store/, layout/, account/, orders/, ui/icons), app pages (home, contact, account, PDP,
  confirmation, global-error), globals.css, tailwind.config.ts. **Zero changes** to:
  `src/lib/**` (pricing, checkout, auth, payments, suppliers, cart service), `src/app/api/**`
  (61 routes), `prisma/**` (schema + 5 migrations), `middleware.ts`, tests, env handling.
- Behavioral proof: all 62 E2E tests — including webhook HMAC/dedupe/rate-limit, RBAC matrix,
  idempotent checkout, coupon margin floor, CAS status transitions — pass ×2 full cycles against
  the changed tree. Money path is bit-for-bit the same code and verified green.

## §M — Remaining limitations (honest)

1. **Crossfade invisible on current seed data** (0 multi-image products). Feature is proven and
   dormant; it activates the moment the owner imports real multi-image products.
2. **No browser in sandbox** ⇒ no Lighthouse scores, no axe scans, no real-device pixel QA, no
   measured INP/LCP lab values. All perf claims here are bundle/CSS/markup measurements +
   architectural analysis. Recommend one Lighthouse + one device pass before launch.
3. Parallax is desktop-fine-pointer only by design (mobile = static hero).
4. Stagger caps at 8 distinct delays (later children share 360ms) — intentional anti-crawl.
5. System font stack (no variable fonts / kinetic type) — deliberate zero-webfont trade.
6. Admin UI remains functional-not-signature (intentional scope discipline).
7. `global-error.tsx` keeps inline styles + neutral colors by design (Tailwind cannot be assumed
   in a root error shell).
8. Prior-round residuals unchanged and documented: in-memory per-instance rate limiting, guest
   coupon email-rotation, SUPPLIER_SYNC reconciliation via cancel/RTO.

## §N — Owner configuration required (unchanged by this round)

Nothing new. Existing checklist stands (UPDATED_PROJECT_STATUS.md §4): Razorpay keys + webhook
secret, CJ Dropshipping credentials (when going live), Backblaze B7 storage, SMTP credentials,
production env vars on Vercel (Neon pooled/direct URLs, `APP_URL=https://zenvorastore.vercel.app`,
`openssl rand -hex 32` secrets). This round requires **no credentials and no schema work** — it
deploys with the same env as v8.

## §O — Final critical assessment ("rare test", answered honestly)

1. **Would a visitor recognize Zenvora in 5 seconds?** Yes — warm paper + green-black ink + one
   brass accent + grain-dark editorial hero + extrabold display type. No cool grays, no purple,
   no glass walls. (Verified by grep: 0 cool-gray classes, 0 emoji, 4 functional blurs.)
2. **What is genuinely distinctive?** The motion identity: one easing signature across seven
   purposeful behaviors — hero panel that *settles* as you leave, real second-photo crossfades,
   45ms editorial staggers, brass wayfinding underline, tactile variant chips, breathing gallery
   switches. Small vocabulary, used consistently — that is the rarity, not any single effect.
3. **Does every motion have a reason?** Yes — each maps to a job (depth, discovery, hierarchy,
   wayfinding, feedback, state) in DESIGN_LANGUAGE §9; anything without a job was rejected (§F).
4. **Mobile-first?** Yes — every hover gated, targets raised, safe areas kept, parallax denied
   to touch, static fallbacks complete (no-JS + reduced-motion).
5. **Fast?** Yes — **+0.32 kB total JS cost** for the entire round, 0 dependencies, 0 requests
   added, shared bundle untouched at 103 kB.
6. **Honest?** Yes — every visible datum comes from the DB/settings; the crossfade refuses to
   render without a real second image; structured data mirrors visible content; no ratings,
   counters, timers or badges were fabricated.
7. **Accessible?** Improved and markup-verified (emoji→SVG+labels, aria-current, focus parity,
   reduced-motion completeness, 40px money-path targets) — with scanner/device verification
   honestly flagged as pending (§M2).

**What this is NOT:** not "the world's best", not bug-free (no software is), not field-measured.
The admin panel is still utilitarian; the seed catalog still can't show off the crossfade; a
Lighthouse pass on real infrastructure is still owed.

**Verdict:** the round's goal — make Zenvora *more itself* — is met with evidence: distinctive
motion identity at ~zero performance cost, zero backend risk (62/62 E2E ×2), zero new
dependencies, zero fabricated data, and the prior round's false "0 emoji" claim corrected with
receipts. Ship-worthy for the owner's next Vercel deploy (v9 zip), with §M items scheduled.
