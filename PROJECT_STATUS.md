# PROJECT_STATUS.md — ZENVORA (zenvora-store)

**Audit date:** 2026-09-05 · **Method:** everything below was verified by RUNNING it (builds, test suites, live HTTP requests against dev and production servers, direct database inspection). Nothing is marked working merely because code exists.

**Stack:** Next.js 15.5 (App Router) · TypeScript · Prisma + PostgreSQL 17 · Tailwind · Vitest · Razorpay SDK (unconfigured) · nodemailer (logging provider)

---

## Status vocabulary used in this document

| Label | Meaning |
|---|---|
| ✅ VERIFIED WORKING | Ran it in this environment; observed correct behavior |
| 🟡 NEEDS EXTERNAL CONFIG | Code complete; requires credentials/accounts only the owner can create |
| 🔴 NOT IMPLEMENTED | Feature does not exist |
| ⚠️ BROKEN | Exists but failed verification |
| ❌ NOT POSSIBLE WITHOUT EXTERNAL ACCESS | Cannot be verified or completed inside this sandbox |

Overall release vocabulary (CODE COMPLETE / TEST COMPLETE / DEPLOYMENT READY / LIVE / FULLY LIVE AUTOMATED RESELLING) is defined in `FINAL_STATUS.md`.

---

## 1. Verification evidence (all run on 2026-09-05)

| Gate | Command | Result |
|---|---|---|
| TypeScript | `tsc --noEmit` | ✅ clean (0 errors) |
| Lint | `npm run lint` | ✅ clean (0 errors/warnings) |
| Unit + integration tests | `npm test` | ✅ **134/134 passed** (13 files) |
| **End-to-end tests (NEW)** | `npm run test:e2e` (dev server on :3100) | ✅ **62/62 passed** (5 files) |
| Production build | `npm run build` | ✅ compiled successfully |
| Dependency audit | `npm audit` | ✅ **0 vulnerabilities** |
| Prisma | `prisma validate` + `migrate deploy` (dev + test DBs) | ✅ schema valid, migrations applied |
| Seed | `npm run db:seed` | ✅ 8 products / 4 variants / 8 supplier-catalog entries / 2 coupons, idempotent |
| Prod smoke test | `npm run start` + HTTP probes | ✅ all checks (below) |

### E2E suite (new this audit) — what the 62 tests actually prove

Runs over **real HTTP** against a real dev server + real PostgreSQL (no mocks):

- **storefront (12):** home/shop/product/category/cart/checkout/track pages render seeded catalog data; real 404 status for unknown product & category slugs; `/api/health` reports DB truthfully; `sitemap.xml` contains product URLs; `robots.txt` disallows `/admin`; security headers present; mobile viewport meta present.
- **auth-flow (9):** registration + auto-login + `/me`; duplicate email rejected; weak password rejected at API; wrong password → generic 401 (no enumeration); logout revokes the DB session row (not just the cookie); account-level login throttle engages within 9 attempts and then blocks even the CORRECT password; password-reset for unknown email → identical 200 (no enumeration); unsafe request without `x-csrf-token` → 403 `CSRF_FAILED`; anonymous `/admin` → 307 to login.
- **shopping-checkout (14):** add-to-cart priced from the SERVER catalog (client cannot inject prices); negative & over-stock quantities rejected; quantity update; coupon `WELCOME10` discount = min(10%, ₹150 cap) computed server-side; invalid coupon rejected; checkout totals exactly `subtotal − discount + shipping (+COD fee)` from DB settings; **idempotency-key replay returns the SAME order (HTTP 200)**; invalid postal code rejected; TEST payment order amount always taken from the stored order; simulated TEST payment success → order PAID → **supplier order auto-created by the job runner**; COD guest order confirmed immediately with COD fee; guest tracking requires order number + email (wrong email → uniform 404).
- **admin-authz (17):** anonymous → 401 and logged-in CUSTOMER → 403 on every sampled admin API (settings GET/PATCH, users POST, products GET/POST, jobs/run POST, reports/export GET); admin (creds from `.env`) → 200 on all; `/admin` page turns customers away without rendering admin layout content; **IDOR:** user B cannot PATCH/DELETE user A's address (403), owner's data unchanged.
- **webhook-security (10):** forged Razorpay signature → rejected (and when `RAZORPAY_WEBHOOK_SECRET` is unset the endpoint refuses honestly instead of pretending to verify); forged payment never recorded as captured; forged/missing supplier signature → 400 + `REJECTED` WebhookEvent row; VALID signature + unknown order → 422 + `FAILED` row with `signatureValid=true` (signature and business checks are separate); exact replay → `duplicate:true` with exactly ONE stored event (unique provider+eventId); garbage body → 400, never 500; cron endpoint: anonymous 401, wrong secret 401 (timing-safe), correct `CRON_SECRET` 200.

### Production smoke test (production build, NODE_ENV=production)

- `/` 200 with **Zenvora** branding (settings-driven) · `/shop`, product page 200 · unknown product/category slug → **404** (real status, not soft-404) · guest `/cart` & `/checkout` → 200 (bug fixed, see §3) · `/api/health` → `{status:"ok", database:true, paymentsProvider:"NONE", paymentsTestMode:false, environment:"production"}` · anonymous `/admin` → 307 login · `POST /api/payments/test/simulate` → **404 (TEST payments hard-disabled in production, even with a valid CSRF token)** · forged supplier webhook → 400 · security headers: CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy all present.

---

## 2. Feature-by-feature audit

| Area | Status | Notes (evidence) |
|---|---|---|
| Storefront (home, shop, search, product, category, cart, checkout, track, policies, about, contact, FAQ) | ✅ VERIFIED WORKING | Pages render real DB data in dev + prod builds; mobile-first Tailwind; 404s correct |
| Authentication (register/login/logout/sessions/reset) | ✅ VERIFIED WORKING | E2E auth-flow 9/9; bcrypt hashing; DB session rows revoked on logout; throttles observed |
| CSRF (double-submit cookie) | ✅ VERIFIED WORKING | Missing header → 403 `CSRF_FAILED` (E2E); webhook/cron routes correctly exempt (own HMAC/bearer auth) |
| Authorization (customer/staff/admin, IDOR) | ✅ VERIFIED WORKING | 401/403/200 matrix + address IDOR blocked (E2E admin-authz 17/17) |
| Cart & server-side pricing | ✅ VERIFIED WORKING | Prices always re-read from DB; quantity/stock guards; no client price input accepted |
| Coupons | ✅ VERIFIED WORKING | WELCOME10 percent+cap math verified server-side; invalid codes rejected; redemption rows written |
| Checkout (prepaid + COD, guests + accounts, idempotency) | ✅ VERIFIED WORKING | Totals recomputed server-side; idempotent replay → same order; COD fee & free-shipping threshold applied from settings |
| Payments — TEST provider (dev only) | ✅ VERIFIED WORKING | create → simulate(success/failure) → confirm pipeline; hard-disabled in production builds (verified 404) |
| Payments — Razorpay (real money) | 🟡 NEEDS EXTERNAL CONFIG | SDK integrated, webhook HMAC verification implemented & tested with forgeries; requires YOUR Razorpay account keys — see BLOCKER #1 |
| Supplier adapters (Manual / HTTP-REST / Demo) | ✅ VERIFIED WORKING (Demo, dev only) | Paid TEST order auto-created a supplier order; Demo adapter advanced it to shipped/delivered with tracking + notification emails (observed in dev logs). Production refuses the Demo supplier (falls back to manual queue — observed in prod logs) |
| Real supplier fulfilment (the business goal) | ❌ NOT POSSIBLE WITHOUT EXTERNAL ACCESS | Requires a real supplier account/API or a manual-fulfilment decision — see BLOCKER #2. No supplier was invented. |
| Order tracking (account + guest) | ✅ VERIFIED WORKING | Guest track needs orderNumber+email; uniform 404 prevents enumeration (E2E) |
| Shipping/tracking ingestion (supplier webhook) | ✅ VERIFIED WORKING | HMAC-SHA256 verified; status updates + tracking numbers stored; forged/duplicate deliveries rejected/deduped (E2E) |
| Admin panel (dashboard, orders, products, inventory, suppliers, coupons, pricing rules, customers, refunds/returns, shipments, analytics, reports, logs, settings, health) | ✅ VERIFIED WORKING (local) | Pages render; sampled APIs authz-tested; CSV report export fixed this audit (§3) |
| Actual-profit accounting (never gross margin) | ✅ VERIFIED WORKING | Unit+integration tests: profit = revenue − supplier cost − shipping cost − gateway fees − COD fee − other costs − refunds; gross margin exported separately and labelled "NOT profit"; finalized only at terminal order states |
| Background jobs (fulfilment, notifications, retries, cron endpoint) | ✅ VERIFIED WORKING | SKIP LOCKED queue, dedupe keys, retry/backoff; `/api/cron/jobs` bearer-protected (E2E); demo fulfilment advanced automatically |
| Notifications/email | ✅ VERIFIED WORKING as **logging provider** 🟡 real delivery NEEDS EXTERNAL CONFIG | Emails are composed and queued correctly (observed full lifecycle emails in dev logs) but are only LOGGED — no SMTP credentials exist. Never claimed as delivered. See BLOCKER #4 |
| Database & migrations | ✅ VERIFIED WORKING | `prisma validate` + `migrate deploy` on dev & test DBs; transactions used for order creation, carts, addresses |
| Security headers & hardening | ✅ VERIFIED WORKING | CSP/HSTS/XFO/nosniff/Referrer/Permissions-Policy in prod; rate limits on login/register/checkout/pay-create/track/forgot; secrets env-only; no raw card data anywhere (gateway-hosted checkout) |
| SEO | ✅ VERIFIED WORKING | sitemap.xml (real product URLs), robots.txt (admin disallowed), canonical/OG metadata, real 404 statuses (fixed §3) |
| Demo-data hygiene | ✅ VERIFIED WORKING | All demo content SKU-prefixed `DEMO-` + visible demo banner (`demoMode`); `npm run cleanup:demo` dry-run/execute procedure added this audit (verified dry-run against dev DB: correctly counts 10 test orders, 51 test users, 8 demo products; keeps admin & real data) |
| Deployment (hosting, domain, HTTPS, prod DB) | ❌ NOT POSSIBLE WITHOUT EXTERNAL ACCESS | Deployment artifacts & step-by-step docs ready (SETUP_CHECKLIST.md, health endpoint, cron endpoint, build verified) but no hosting/domain/DB credentials exist. Nothing is deployed. See BLOCKER #3/#5 |
| Browser-level UI automation (Playwright) | 🔴 NOT IMPLEMENTED (environment limit) | Browser binaries cannot be installed in this sandbox. E2E is HTTP-level (real requests/responses, SSR HTML assertions). UI correctness additionally evidenced by production build + manual smoke. Recommend a device pass before launch. |

---

## 3. Bugs FOUND BY THIS AUDIT and FIXED + RE-VERIFIED (audit-then-verify, no rebuild)

1. **`GET /api/admin/reports/export` always returned 500** — the route passed an async function to `handleApiError(err, req)`, which expects an error object, so every call (even anonymous) 500'd. Fixed to try/catch; re-verified: 401 anonymous / 403 customer / 200 admin CSV.
2. **Soft-404 (HTTP 200) on unknown product & category pages** — the root `loading.tsx` Suspense boundary let Next flush a 200 shell before `notFound()` could set the status (long-standing Next.js streaming behavior), and `generateMetadata` returned fallback metadata instead of throwing. Fixed: removed root `loading.tsx`, throw `notFound()` from `generateMetadata` too. Re-verified: real **404** in dev AND production; known pages still 200.
3. **Guest `GET /cart` crashed with HTTP 500** — `getOrCreateCart` created a guest cart and wrote a cookie during Server-Component render, which Next 15 forbids ("Cookies can only be modified in a Server Action or Route Handler"). Previously masked as a 200 error-UI by the same `loading.tsx`. Fixed: new read-only cart view (`getCartViewReadOnly`) for all render-time callers (cart page, checkout page, header count); cart creation now happens only in route handlers where cookie writes are legal. Re-verified: guest `/cart` 200 in prod, add-to-cart still creates cart + cookie, page shows items.
4. **Orphaned cart rows leaked on every guest page view** — same root cause: the header's swallowed error left an empty guest cart in the DB on each render. 69 orphan rows found in the dev DB and purged; after the fix, zero new orphans across a full E2E run (verified by SQL count).
5. **Guest tracking with wrong email returned 400** — code comment promised a uniform 404 (anti-enumeration). Aligned: now 404 (E2E-verified both correct-email 200 and wrong-email 404).

Also this audit: store branding switched to **Zenvora** (`APP_NAME` in `.env`/`.env.example` + re-seeded settings; verified rendered on home page). Internal identifiers (cookie names `resellix_*`, order prefix `RX-`) intentionally unchanged — cosmetic-only, flag in USER_INPUT_REQUIRED.md §E if a rename is wanted.

---

## 4. Known limitations (honest list)

- **In-memory rate limiting** — correct per process; a multi-instance deployment needs Redis-backed limiting (documented in SETUP_CHECKLIST.md).
- **E2E is HTTP-level, not browser-automation** — sandbox cannot install Playwright browsers. Visual/mobile-browser pass on a real Android device is a recommended pre-launch manual step.
- **Emails are logged, not delivered** (no SMTP creds) — every email is composed and queued for real; delivery starts when BLOCKER #4 is resolved.
- **Demo supplier works in dev only** — production refuses it by design; real fulfilment needs BLOCKER #2 resolved.
- **Payments cannot be exercised with real money here** — TEST provider only, and only in non-production builds (verified disabled in prod).
- Sandbox environment resets occasionally; recovery steps are documented in README.md (install → Postgres → migrate → seed).

---

## 5. What is NOT in this project (no fake functionality)

- No invented supplier, no fake supplier API calls presented as real.
- No fake orders, payments, reviews, statistics, or testimonials anywhere in seed data (seed creates catalog only; the seed script explicitly refuses to fabricate orders/customers).
- No hardcoded secrets; `.env` never committed; zip exports exclude `.env*` (only `.env.example` ships).
- No "live" claims: nothing is deployed; see FINAL_STATUS.md for exact status labels.
