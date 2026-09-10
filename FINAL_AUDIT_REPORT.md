# FINAL AUDIT REPORT — Zenvora Store v6 (independent verification pass)

Date: 2026-09-08 · Scope: full repository, live deployment, all phases of the audit brief.
Method: inspect → verify against source (no trust in prior claims) → fix → test → re-audit.
Companion docs: `docs/AUDIT_2026-09-08.md` (sweep evidence), `docs/AUTOMATION.md` (labels),
`docs/SECURITY.md`, `USER_INPUT_REQUIRED.md` (owner actions).

## 1. What was already good (verified in source, not assumed)
- 61 API routes; **every** `/api/admin/**` route enforces server-side RBAC (`requireAdmin`) —
  re-swept, 0 exceptions. Storefront APIs recompute all money server-side; clients never send prices.
- Pricing engine: single math kernel (`computePricing`) + deterministic rule hierarchy
  PRODUCT > CATEGORY > SUPPLIER > GLOBAL > product defaults (`resolvePricing`), full breakdown
  (cost, fees, margin %, markup %, net-profit estimate, tax, warnings), psychological rounding,
  min-profit floors. Auto-pricing already applied on product create/update (`upsertProduct`) and
  bulk repricing with preview (`repriceProducts`, `apply` flag).
- Margin protection: coupons capped at `ceil(cost/(1−minMargin%))` floor in cart preview AND
  authoritatively at order creation; explicit `bypassMarginProtection` flag only; never silent.
- Inventory: transactional conditional decrements (oversell-proof), restock on cancel/return/RTO
  (idempotent per reason), `InventoryMovement` history on every change, per-product
  `lowStockThreshold`.
- Orders: state machine with allowed-transition map incl. RTO/RTO_RECEIVED; every transition
  audited (`OrderEvent`); refunds/returns flows wired to it.
- Payments: Razorpay adapter behind provider seam; server-side signature + webhook HMAC
  verification; idempotent webhook processing; test/live key separation enforced in `env.ts`
  (production refuses `rzp_test_*`, non-production refuses `rzp_live_*`).
- Suppliers: adapter registry (CJ/HTTP_REST/MANUAL/DEMO); CJ webhooks unsigned-by-provider →
  trigger-only authenticated re-fetch (payloads never trusted); job queue with exponential
  backoff + jitter, dedupe keys, dead state, admin manual re-run.
- Security: zod validation on every body; 3 static parameterized raw-SQL statements only;
  magic-byte upload validation + 5 MB cap + random names; CSRF double-submit; rate limits;
  CSP/HSTS/nosniff headers (live-verified); secrets only via env; audit + error + API logs.
- Honesty: console email provider never pretends delivery; analytics label gross margin ≠ profit
  and estimates as estimates; health endpoint reports `paymentsConfigured:false` truthfully.

## 2. What was actually broken / missing (found in this pass)
**F1 (integrity, fixed): supplier-product mapping bypassed the pricing engine.**
`POST /api/admin/supplier-products/:id/map` synced the new supplier cost onto the catalog product
with a raw `product.update` but left `sellingPrice` stale → margin silently drifted whenever a
mapped cost changed. This violated the core pricing mandate ("never silently reduce margin",
"auto-determine selling price from configured rules").

## 3. What was changed (this pass)
- `src/lib/catalog/products.ts`: new `applyEnginePricingToProduct(productId)` — re-runs
  `resolvePricing` for one product, applies the new price only if different, and returns a full
  explanation: old/new price, `applied`, `minSafePricePaise` (margin floor), `maxSafeDiscountPaise`
  (discount allowance), margin %, net-profit estimate, rule name/scope, warnings. Admin
  `FIXED_PRICE` overrides are preserved **by construction** (the engine returns them unchanged) —
  nothing is silently altered.
- Map route: after cost sync → calls the helper; response now `{ mapping, pricing }`; audit log
  records the pricing explanation.
- `src/components/admin/supplier-product-mapper.tsx`: after mapping, an accessible
  (`role="status"`, dismissible) panel shows previous/new price, gross margin % (labelled
  "not net profit"), min safe price, max safe discount, rule applied, engine warnings + toast
  feedback ("price updated to ₹X by the pricing engine" vs "re-verified, unchanged").
- New tests: `tests/integration/supplier-map-autopricing.test.ts` (3 cases: markup repricing
  500→600 cost ⇒ ₹650→₹780; idempotent no-op; FIXED_PRICE preserved at ₹799 with honest
  12.39% margin reported).

## 4. Deliberately NOT changed (and why)
- No UI redesign: existing design system (cards/badges/skeletons/toasts/modals, reduced-motion
  support, mobile-first) is coherent and tested; a redesign would risk regressions for no
  measured user benefit. Animations remain purposeful, not decorative.
- No new dependencies; no major-version upgrades (only outstanding warning: Prisma 7
  `package.json#prisma` config deprecation — informational, migration deferred deliberately).
- Rate limits remain in-memory (correct for the single-instance Vercel + cron architecture;
  Redis-class shared state would only be needed for multi-instance scaling — documented).
- Per-product COD/return/prepaid flags remain global-level settings (documented limitation;
  adding per-product overrides touches checkout money paths — not justified without a business
  requirement).
- Flipkart/Meesho: NOT SUPPORTED (no legitimate APIs) — no workarounds built, as instructed.
- No "best-seller prediction" anywhere — pricing is deterministic and explainable, as instructed.

## 5. Evidence (all commands actually run after the fixes)
| Check | Command | Result |
| --- | --- | --- |
| Types | `npm run typecheck` | ✅ 0 errors |
| Lint | `npm run lint` | ✅ 0 problems |
| Unit + integration | `npm run test` | ✅ **194/194** (was 191; +3 auto-pricing) |
| E2E (touched paths) | vitest e2e: storefront + shopping-checkout | ✅ **26/26** |
| E2E (full suite, earlier same day, unchanged paths) | per-file method | ✅ 62/62 |
| Build | `npm run build` | ✅ exit 0 |
| Migrations | `prisma migrate deploy` on fresh PG17 (dev + test DBs) | ✅ all applied, additive only |
| Live production (v5→v6 pending owner deploy) | `curl /api/health` | ✅ 200, `database:true` |

E2E method note: sandbox memory cannot host dev-server + full suite in one window; files are run
against a freshly restarted warmed `next dev --turbopack -p 3100` (documented in README).
Rate-limit carryover between repeated runs is expected behaviour, not a defect.

## 6. Security re-sweep after modifications
New/changed surface: one admin-only route response extension + one admin UI panel. Guard
unchanged (`requireAdmin`), audit logging extended (pricing explanation stored), no new inputs
accepted (helper takes only the mapped product id), no secrets involved, no client-trusted data.
Repo-wide sweeps re-run: no hardcoded secrets, no TODO/FIXME, no destructive SQL in migrations.

## 7. Production-readiness assessment (honest, no absolutes)
**Code/test/deploy-ready: YES** for the platform itself. **Live-commerce-ready: NOT YET** — it is
blocked only on owner configuration, exactly as before:
1. Deploy v6 (owner): unzip over clone → `git push` (Vercel auto-deploys; build runs the additive
   migration safely) or Vercel zip deploy. Then run the post-deploy checks in `docs/DEPLOYMENT.md`.
2. Razorpay keys (B4/B5) → prepaid payments go live; until then COD-only, honestly reported.
3. CJ API key + wallet + SKU mapping + one real test order (B6) → supplier automation goes live.
4. SMTP (B3) → real email; console provider logs until then.
5. `STORAGE_PROVIDER=s3|cloudinary` (B7) → durable uploads; local disk is ephemeral on Vercel.
What could still fail in production (known, bounded): provider outages (handled with retries +
dead-state + honest statuses), Neon connection exhaustion if the pooled URL is misconfigured
(documented), single-instance rate limits under horizontal scaling (documented), and any bug not
covered by the 194+62 tests — no software is provably bug-free and this report does not claim so.
