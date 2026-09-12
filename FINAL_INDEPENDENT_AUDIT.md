# ZENVORA — FINAL INDEPENDENT PRINCIPAL-ENGINEER AUDIT

**Date:** 2026-09-11/12 · **Mandate:** treat every previous claim as unverified evidence; re-prove or fix; no blind trust in prior reports.
**Method:** full repository discovery (61 API routes, 55 pages, 59 components, 64 lib modules, 33 Prisma models, 5 migrations, 27 test files), adversarial code tracing of every money/security path, fresh full verification battery, live production probing, and fixes for every real defect found — each fix re-verified by the complete suite.

---

## 1. Verdict on previous claims (independently re-verified TODAY on this machine)

| Prior claim | Verdict | Evidence |
|---|---|---|
| "194/194 tests pass" | **TRUE** | Fresh run: `Tests 194 passed (194)` · 22/22 files · 0 skipped — run twice (pre-fix and post-fix) |
| "Clean TypeScript" | **TRUE** | `tsc --noEmit` exit 0, twice (pre-fix, post-fix) |
| "Clean ESLint" | **TRUE** | `eslint .` exit 0, twice |
| "Production build succeeds" | **TRUE** | `next build` exit 0 post-fix · 103 kB shared First Load JS |
| "62/62 E2E" | **TRUE (re-proven post-fix)** | All 5 suites re-run per-file with fresh servers after fixes: storefront 12/12 · shopping-checkout 14/14 · webhook-security 10/10 · admin-authz 17/17 · auth-flow 9/9 = **62/62** |
| "All admin routes protected" | **TRUE** | Static sweep: 35/35 `/api/admin/**` routes call `requireAdmin()`/`requireStaff()` server-side. Live proof: anonymous → 401; STAFF on ADMIN-only routes → 403; ADMIN → 200; cross-user address PATCH/DELETE → 403 (IDOR blocked) |
| "Additive migrations" | **TRUE** | `grep DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM` across all migration SQL → 0 hits |
| "Pricing protection / margin floor" | **TRUE** | Traced: `validateMinimumMargin`, floor = ceil(cost/(1−minMargin%)), coupons rejected-or-capped at floor, explicit `bypassMarginProtection` flag only; never silently reduced |
| "CJ integration code-complete, not live" | **TRUE (honest)** | Trigger-only unsigned webhook → authenticated re-fetch design; live activation pending owner credentials |
| "Frontend redesign verified" | **TRUE with exceptions found** | Battery green, but this audit found 3 real defects the redesign round missed (§2 F1–F3) — now fixed and re-verified |
| **"11 migrations"** | **FALSE** | Actual: **5** migration directories (identical in repo, v6 zip, v7 zip). Corrected in `docs/AUDIT_2026-09-08.md` + `UPDATED_PROJECT_STATUS.md` |
| **"34 Prisma models"** | **FALSE** | Actual: **33** (`grep -c '^model '`). Corrected |

## 2. Defects found by this audit → fixed → re-verified

| # | Severity | Defect (independently found) | Fix | Proof |
|---|---|---|---|---|
| F1 | **High (mobile UX)** | `.input-base` used `text-sm` (14px) → **iOS Safari auto-zooms on every input focus** (checkout, login, search, address forms) — a direct violation of the mobile-quality mandate | `.input-base` → `text-base` (16px) at all breakpoints, with comment forbidding regression | Build ✓, storefront+checkout E2E ✓ |
| F2 | **High (mobile UX)** | PDP sticky buy-bar CTA used classes `btn btn-primary` that **do not exist** in the stylesheet (button system is a component, not CSS classes) → unstyled "Select options" button for every variant product on mobile | Replaced with the real primary-button classes incl. `focus-visible` ring | Storefront E2E ✓, visual check in served HTML ✓ |
| F3 | **Medium (money path race)** | `transitionOrder` read-then-updated unconditionally inside a transaction → two concurrent writers (e.g. customer cancel racing a payment webhook) could both "succeed", producing contradictory state/events | Converted to **compare-and-swap**: `updateMany({where:{id, status: readStatus}})`; loser logs and returns `null` — exactly one writer wins | 194/194 incl. state-machine + RTO suites; checkout/webhook E2E ✓ |
| F4 | **Low (checkout race UX)** | Concurrent double-submit with same `idempotencyKey`: DB unique constraint correctly prevented a duplicate order, but the losing request surfaced an error instead of the existing order | Catch P2002 on `idempotencyKey` → return the winner's order (200, `alreadyExisted`) | 194/194 + checkout E2E ✓ |
| F5 | **Low (hardening)** | Razorpay + generic supplier webhook endpoints had no rate limit (unsigned floods could insert `webhook_events` rows before rejection; CJ webhook was already limited) | `assertRateLimit` 120/min/IP on both, inside existing error-handling wrappers | webhook-security E2E 10/10 ✓ |
| F6 | **Docs integrity** | "11 migrations" / "34 models" false counts (see §1) | Corrected to 5 / 33 in both documents | grep verified |

**Post-fix full battery (final code):** typecheck exit 0 · lint exit 0 · **194/194** · build exit 0 · **E2E 62/62** (all five suites, fresh server per file).

## 3. Deep-verified areas (traced UI → API → validation → authz → service → DB → provider → state → notification → audit)

**Money path (checkout).** Client sends **no money fields** (zod `checkoutSchema`: address/method/coupon/note/idempotencyKey only). Prices re-read from DB at order time (`unitPricePaiseOf` → current `sellingPrice`; stale-cart-price and price-tampering impossible). Integer paise throughout; `Decimal` persisted via exact strings (no floats). Stock decrement = conditional atomic `updateMany` (`stock >= qty`) inside the order transaction — oversell-proof for LOCAL mode; failure rolls back everything. Coupon usage = atomic conditional SQL increment; per-user via redemption rows; first-order requires auth; discount capped at eligible subtotal ⇒ **negative totals impossible**; margin floor re-checked at authoritative order creation, not just preview. Idempotency: unique `idempotencyKey` + `convertedOrderId` guard + (now) concurrent-duplicate graceful return. `estimatedProfit` = subtotal − discount + shipping + COD fee − landed cost − estimated gateway fee, stored server-side only; **never rendered on customer surfaces** (checkout response returns grand total only; track/order APIs contain no cost fields).

**Payments.** Single confirmation funnel (`confirmPaymentResult`) for webhook/verify/simulator — idempotent, with **amount-mismatch rejection** (gateway amount ≠ order total → `REJECTED_AMOUNT_MISMATCH` + forensic event), not-payable status guard, duplicate detection, `feeIsEstimate` honesty flag. Browser result never trusted: `/api/payments/verify` re-verifies via provider (HMAC `safeEqual` = real `crypto.timingSafeEqual` with uniform-timing length guard) and passes `expectedAmountPaise`. Webhooks: HMAC over raw body, unique `(provider, externalEventId)` dedupe with content-hash fallback, invalid signature → 400 + REJECTED row, processing failure → 500 (provider retries), now rate-limited. TEST simulator double-gated (`PAYMENTS_TEST_MODE` && non-production) — **live prod probe: blocked (403 at CSRF layer before the 404 gate)**. Key separation enforced in env layer: production refuses `rzp_test_*`, non-production refuses `rzp_live_*`.

**Auth/RBAC/sessions.** bcrypt cost 12 (72-byte cap); session token raw only in `httpOnly, SameSite=Lax, Secure(prod)` cookie, sha256 hash in DB, expiry/revocation checked, lazy cookie clearing; password-reset tokens sha256-hashed, TTL-bounded, single-use, uniform errors; forgot-password non-enumerating + rate-limited (5/30min); login rate limiting proven live (repeated 401s → 403). Guards server-side in every layout/route; STAFF vs ADMIN hierarchy enforced (live 403 proof); IDOR blocked for addresses/orders (`assertOwnerOrAdmin`, guest = orderNumber+exact email, uniform 404, no PII beyond status/items/shipments in track responses).

**CSRF/headers.** Double-submit CSRF cookie enforced by `apiRoute` on all unsafe methods; opt-out only for signature/secret-authenticated endpoints (webhooks, cron — which are raw handlers, consistent). Live prod headers: CSP (self + Razorpay checkout), HSTS 2y includeSubDomains, nosniff, X-Frame SAMEORIGIN, strict Referrer-Policy.

**Order state machine.** Legal-transition table + `expectedFrom` concurrency guard + (now) CAS update; every transition writes an `OrderEvent` (from/to/actor/message); illegal transitions rejected server-side (live log: "Skipping fulfilment advance (illegal transition)"). RTO chain verified by tests (SHIPPED→RTO→RTO_RECEIVED→REFUND*, idempotent restock). Customer cancel: state-checked, restocks, auto-refunds remaining balance for paid prepaid orders (`grandTotal − refundedTotal` ⇒ no double refund); COD cancel needs no refund; supplier cancel request queued best-effort (capability-gated — honest).

**Pricing engine.** Deterministic pure functions: cost = supplier cost + supplier shipping + other costs; modes FIXED_PRICE / percent-markup / target-margin (margin: `ceil(cost/(1−m/100))` paise — verified by tests, markup≠margin distinction preserved); rounding rules incl. ceil-to-rupee; rule precedence product > supplier > category > global with schedule windows; tax-inclusive GST extraction; largest-remainder discount proration; every automated decision produces a full explanation breakdown (round-3 fix, re-verified in `resolve.ts`/mapper response); margin protection never silently lowers the configured minimum.

**Jobs/notifications/observability.** Job runner: raw-SQL due-claim, exponential backoff with jitter (30s·2ⁿ capped 30 min), `maxAttempts` → DEAD state, dedupe window (tested), cron endpoint Bearer-secret via `safeEqual` (live prod: 401 without secret). Notifications: persisted QUEUED→SENT/FAILED with provider name + error (max 500 chars), console provider clearly labeled, **no fake "sent"**; admin-visible. Audit trail: `auditLog` (actor/action/entity/IP) + OrderEvents + WebhookEvents + Job rows ⇒ "what happened to order X" is answerable end-to-end. Log sanitizer redacts `password|secret|token|apikey|authorization|signature|cvv|card|pin|otp|session|cookie|private` keys, truncates strings/depth.

**Uploads/storage.** Admin-only; magic-byte content sniffing (JPEG/PNG/WEBP/GIF/AVIF — extension never trusted), size cap, random generated filenames; docs + admin UI honestly state Vercel filesystem is ephemeral and S3 configuration is required for persistence (B7).

**Suppliers.** Adapter abstraction (no single-vendor coupling); CJ adapter matches documented API v2 contract; CJ webhook trigger-only (unsigned ⇒ authenticated re-fetch; forged webhook costs at most one authenticated read); generic supplier webhook HMAC-signed with dedupe; Flipkart/Meesho: **no automation built, none claimed** (no legitimate public APIs; scraping/ToS-violating workarounds deliberately absent — NOT SUPPORTED documented).

**SEO/perf/DB.** metadataBase + per-page titles/descriptions, PDP canonical + OG, honest JSON-LD (prices mirror displayed values; availability from real stock; **no aggregateRating/reviews fabricated**), sitemap.ts/robots.ts live (E2E-anchored), real 404s (no soft-404: no root `loading.tsx`). Perf: 103 kB shared JS, no animation/UI libraries added, system font stack (no LCP-blocking webfonts), fixed image aspect ratios (no CLS), lazy images + single priority hero, server components by default (client components limited to interactive islands). DB: 33 models, 54 indexes, money as `Decimal`, unique constraints on orderNumber/idempotencyKey/providerOrderId/(provider,externalEventId), transactions on money paths, seeds idempotent, no destructive SQL.

**Frontend/mobile (this audit's spot pass).** Viewport meta + `overflow-x: clip` guard; 16px inputs (F1 fix); touch targets ≥40px on primary controls; sticky PDP buy bar with `env(safe-area-inset-bottom)` + `pb-28` content clearance; checkout double-submit guarded client-side (busy state) **and** server-side (idempotency); skeletons only where a real client loading state exists (gallery) — no fake loading theater; reduced-motion kill-switch; `aria-describedby` genuinely wired (prior round's fix re-verified); empty/hidden states honest (Deals section renders only when DB contains real markdowns — verified 0/8 ⇒ hidden).

## 4. Residual risks & honest limitations (no 100% claim is made)

1. **Rate limiting is in-memory, per-instance.** Correct for the current single-instance/low-cost stage and documented as such in code; on Vercel serverless it is best-effort per lambda. When traffic justifies it, swap storage for Upstash Redis behind the identical interface. Not fixed now — adding infra for theoretical perfection was explicitly out of mandate.
2. **Guest coupon per-user limits** can be evaded by rotating email addresses (inherent to guest checkout; first-order coupons require sign-in; global usage limits and margin floor still hold).
3. **SUPPLIER_SYNC stock** is not decremented locally at checkout (supplier is authoritative; CJ sync jobs reconcile). Oversell on supplier stockouts resolves via the cancellation/RTO path — a documented boundary of dropshipping, not a code defect.
4. **Cosmetic:** expected P2002 dedupe path logs `prisma:error` noise on duplicate webhooks (behavior correct: 200 ack, no reprocessing).
5. **`notFound()` from API route handlers surfaces as 403 behind the CSRF layer** in production (blocked either way; status-code cosmetics only).
6. **Admin panel UI remains functional-not-redesigned** (round-4 scope was customer-facing); admin API security is fully verified regardless.
7. **Not runtime-tested here:** real Razorpay live keys, real CJ live calls, real SMTP, S3 — all REQUIRES CONFIGURATION (owner credentials); the code paths are test-provider-verified and clearly labeled. No live automation is claimed for them.
8. **Visual regression is not automated**; verification is battery + served-HTML inspection + live preview.
9. Production (zenvorastore.vercel.app) runs the **previous build** until the owner deploys the delivered zip; all findings/fixes above ship with it.

## 5. Bottom line

The codebase is **genuinely production-grade for its stage** on everything an engineering team can control: the server is authoritative for all money, the state machine is race-safe (now CAS-backed), webhooks/payments are signature-verified + idempotent + amount-checked, RBAC/IDOR/CSRF/upload/session controls are real and proven live, the pricing engine is deterministic and explainable with margin protection that never silently yields, notifications and analytics are honest (no fake "sent", gross margin never labeled net profit), and no fabricated social proof exists anywhere. Previous "complete/verified" claims were re-proven true **except two document count errors and three real defects (two mobile-UX, one money-path race) — all found by this audit, fixed, and re-verified with the complete battery (194/194 + 62/62 E2E + build + lint + typecheck).**

What remains between this repository and a live commercial launch is **owner configuration only** (deploy push, Razorpay live keys + webhook, CJ account, SMTP, storage) — enumerated step-by-step in `UPDATED_PROJECT_STATUS.md` §4 — plus normal post-launch hardening as scale arrives (distributed rate limiting first). This audit does not claim perfection; it claims evidence.
