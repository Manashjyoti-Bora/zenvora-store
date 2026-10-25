# Zenvora — Architecture (verified 2026-10-25, `main@ac8041e`)

This document describes what is **actually in the repository**, not an aspiration. Every
statement below was checked against the code on the date above; when something is a
limitation it is called a limitation.

## 1. Stack

| Layer | What | Notes |
|---|---|---|
| Framework | Next.js 15.5 (App Router), React 19, TypeScript strict | Server components by default; client islands only where interaction needs them |
| Styling | Tailwind CSS 3.4 + `src/app/globals.css` tokens | Inter Variable self-hosted (`@fontsource-variable/inter`), no third-party font request |
| Data | Prisma 6 → PostgreSQL (Neon in Preview/Production) | 35 models, 7 migrations, all additive so far |
| Validation | zod 3 (`src/lib/validation/schemas.ts` + per-route schemas) | Body size capped at 1 MB before parsing (`readJson`) |
| Hosting | Vercel (Hobby plan, `iad1`, Node 24) | One cron: `17 0 * * *` → `/api/cron/jobs` |
| CI | GitHub Actions (`.github/workflows/ci.yml`) | Isolated `postgres:16` service; typecheck → lint → unit/integration → release build → seed → e2e |

## 2. Request path

```
browser ──▶ middleware.ts (security headers, CSP, CSRF cookie issue)
        ──▶ app router page / API route
              ├─ apiRoute() wrapper (src/lib/errors.ts): CSRF verify, error → JSON envelope
              ├─ readJson() (src/lib/http.ts): 1 MB cap, 413 on overflow
              ├─ rateLimit() (src/lib/rate-limit.ts): PostgreSQL-backed, atomic upsert, memory fallback
              ├─ auth guards (src/lib/auth/guards.ts): requireUser / requireAdmin, session cookie
              └─ domain service (src/lib/<domain>/…) ──▶ prisma (src/lib/db.ts)
```

Security headers (from `middleware.ts`): CSP (`default-src 'self'`, Razorpay hosts allow-listed,
`font-src 'self' data:`), HSTS 2y + includeSubDomains, X-Frame-Options SAMEORIGIN, nosniff,
Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy.

## 3. Domain modules (`src/lib`)

| Module | Responsibility | Key invariants |
|---|---|---|
| `auth/` | bcrypt passwords, DB sessions (httpOnly cookie), reset tokens | Sessions purged by cron; guards fail closed |
| `catalog/` | storefront queries, publication rules (`publish.ts`), ranking, supplier auto-import | ACTIVE requires image + cost/price guards; see §5 |
| `cart/`, `checkout/` | cart persistence, server-side totals, coupons | Prices always recomputed server-side |
| `orders/` | `create.ts` (idempotent), state machine (`state.ts`), cancel/returns/inventory/fulfilment | Idempotency key or already-converted cart ⇒ same order; illegal transitions refused |
| `payments/` | Razorpay + clearly-labelled test provider, webhook verify, refunds | Paid only after server-side signature/API verification; webhook events deduped by `(provider, externalEventId)` |
| `suppliers/` | adapters: `cj.ts` (CJ API v2), `http-rest.ts`, `manual.ts`, `demo.ts`; `registry.ts` | `SUPPLIER_DEMO_MODE` is ignored in production (`env.ts`) |
| `pricing/` | margin maths (`calculations.ts`), rule engine | `minSafePrice = ceil(cost / (1 − minMargin%))` |
| `jobs/` | DB-backed queue (`Job` model, dedupe key), runner, handlers | Types: `FULFIL_SUPPLIER_ORDER`, `SYNC_SUPPLIER_ORDER`, `CANCEL_SUPPLIER_ORDER`, `SEND_NOTIFICATION` |
| `notifications/` | templates, providers (SMTP / console), queue | Never sends to the placeholder `support@example.com` |
| `images/` | `remote-hosts.mjs` allow-list shared by `next.config.mjs` and `<RemoteImage>` | Non-listed hosts render unoptimised, never 500 |
| `storage/` | local / S3 / Cloudinary | Local is ephemeral on Vercel |
| `rate-limit.ts` | shared counters in `rate_limit_buckets` | Keys hashed (SHA-256), purged daily |
| `settings.ts` | single JSON `Setting` row, zod-validated, 30 s cache | `autoImport.autoPublishEligible` defaults to **false** |

## 4. Background work

- **Only scheduler:** Vercel cron, once a day at 00:17 UTC (05:47 IST). Hobby plan allows daily
  granularity only; more frequent execution needs a plan change or an external scheduler calling
  `/api/cron/jobs` with `CRON_SECRET`.
- `/api/cron/jobs` does: `processDueJobs({ limit: 25 })` → purge expired sessions → purge stale
  carts → purge expired rate-limit buckets. It returns the counts.
- **Supplier catalogue sync is not scheduled.** It runs only when an admin calls
  `POST /api/admin/suppliers/[id]/sync` (`syncAndAutoProcessSupplier`). Checkpoints are stored per
  supplier so a rerun continues rather than restarts.
- Jobs are idempotent via `dedupeKey`; retries are bounded; `PermanentJobError` stops retrying.
- Concurrency: the runner claims jobs with an atomic status transition; there is no distributed
  lock beyond that (acceptable for a single daily invocation; revisit if invocations overlap).

## 5. Supplier product pipeline (as implemented)

```
adapter.getProducts() ─▶ upsert SupplierProduct (provenance, cost, stock, lastSyncedAt)
                      ─▶ evaluateSupplierProductCandidate()   (auto-import.ts)
                            rules: stock verified, images valid, description length,
                                   landed-cost ≤ max, selling price in [min,max],
                                   margin ≥ minMarginPercent, profit ≥ minProfitPaise,
                                   category allow/exclude, daily import limit
                      ─▶ importOrPublishSupplierProduct()
                            draft Product (+ images) ─▶ ACTIVE only if
                            settings.autoImport.autoPublishEligible === true  (default false)
```

What it does **not** have yet (see `ROADMAP.md` → Phase 5): a lifecycle status on
`SupplierProduct`, an explainable score with confidence/sample size, freshness classes,
persisted rejection reasons, a contribution model that separates estimates from realised costs,
and a dry-run report.

## 6. Data model highlights

- Money: `Decimal(14,2)` INR in the DB; paise integers in settings/calculations.
- `Product.status` ∈ DRAFT / ACTIVE / ARCHIVED; `ProductImage`, `ProductVariant`, `InventoryMovement`.
- `Order` → `OrderItem`, `OrderEvent` (audit), `Payment`, `Refund`, `ReturnRequest`, `Shipment` → `TrackingEvent`.
- `SupplierProduct` (provenance + cost + stock), `SupplierOrder` (QUEUED … DELIVERED / FAILED).
- Operational: `AuditLog`, `ApiLog`, `ErrorLog`, `WebhookEvent`, `Job`, `RateLimitBucket`,
  `DeploymentEnvironment` (release guard marker), `ContactMessage`, `Notification`.
- **No `Review` model exists.** Nothing on the storefront claims ratings or review counts.

## 7. Release pipeline (`npm run build` = `tsx scripts/release.ts`)

1. preflight — `VERCEL_ENV` → environment; refuses missing/malformed DB URLs or URLs on different hosts.
2. `prisma generate`
3. env-guard — reads `deployment_environment` marker; refuses to migrate a database claimed by
   another environment. `RELEASE_RECLAIM_DATABASE=1` exists for a deliberate owner reclaim **and
   must never be used to make a build pass**.
4. `prisma migrate deploy`
5. `create-admin` (idempotent; existing admin left untouched)
6. `next build`

Neon mapping (owner-confirmed 2026-10-24): `flat-brook` = Production, `soft-hall` = Preview.
Vercel env vars `DATABASE_URL`/`DIRECT_URL` exist separately per environment.

## 8. Testing

- `npx vitest run` — unit + integration (42 files / 405 tests at `ac8041e`), real PostgreSQL.
- `npm run test:e2e` — HTTP-level tests against `next dev` + seeded demo catalogue (5 files / 68 tests).
- Payment and supplier tests use the test provider / demo adapter; no live calls.

## 9. Known limitations (honest list)

- Search is Prisma `contains` on name/slug/brand/sku — no ranking, no typo tolerance.
- No review system; no AI provider configured (no `OPENAI_*`/`ANTHROPIC_*`/`GEMINI_*` env names exist).
- Production has 0 ACTIVE products, demo mode on, payments `NONE` (all honest states).
- zod 3 high advisory (GHSA-mrhx-c7xc-m3w5) mitigated by the body cap; zod 4 migration pending.
- No field Core Web Vitals yet (Vercel Speed Insights has `hasData: false`).
