# Zenvora — Post-Launch Production Health & Security Verification

**Final status: HEALTHY**

Branch: `arena/baa765f6-zenvora-store` | Commit: `2375ab9` (main HEAD, PR #21 merged)
Production deployment: `7633218497` (success, 2026-11-08T07:59:38Z)
Production URL: https://zenvorastore.vercel.app
Preview deployment: `7633151778` (success)

**Constraint honored:** No deployment performed, no production configuration modified, no fake orders/payments created. Direct browsing of the live URL is not possible from this sandbox (outbound network restricted to github.com/api.github.com/registry.npmjs.org/pypi.org/files.pythonhosted.org; the Vercel host is not reachable). All live claims below are verified via the GitHub API (deployment statuses, CI runs) and code inspection, not via direct HTTP to the production host.

---

## 1. Live application health

| Check | Result | Evidence |
|---|---|---|
| Production deployment state | **Success** | GitHub deployment `7633218497`, environment=Production, status success, sha `2375ab9` |
| CI on main | **Success** | CI run on push to main at `2375ab9`, conclusion success |
| Homepage / routes | Code-verified | 27 app routes present including `/`, `/shop`, `/products/[slug]`, `/cart`, `/checkout`, `/auth/*`, `/account/*`, policy pages, `/admin/*` |
| `/api/health` readiness probe | Implemented, not directly probed | Route returns DB connectivity, payments provider kind, email provider name, environment — no secrets exposed |
| Critical JS/server errors | No new errors introduced | CI release build + E2E passed on the deployed commit |
| Direct live browsing | **Not verifiable from sandbox** | Production host outside allowed outbound network; verified via deployment API + CI instead |

---

## 2. Database and migration health

| Check | Result | Evidence |
|---|---|---|
| Migration state | 9 additive migrations | `prisma/migrations/` lists 8 dated migrations + `20261107113000_job_worker_fencing` |
| Worker-fencing migration | Present | `20261107113000_job_worker_fencing/migration.sql` adds `claimToken TEXT` to `jobs` and `SupplierCancellationStatus` enum + columns to `supplier_orders` |
| Schema fencing fields | Present | `Job.claimToken`, `attempts`, `maxAttempts`, `nextRunAt`, `lockedAt`, `dedupeKey` all in `prisma/schema.prisma` |
| Database connectivity | Deployment-proven | Release pipeline runs `prisma migrate deploy`; production deployment succeeded ⇒ migrations applied and DB reachable |
| Queue health | Running | `cron-jobs` workflow: 5 recent runs all **success** (latest 2026-11-08T08:04:09Z), POSTing to production `/api/cron/jobs` |
| Failed/stuck jobs | Not directly queryable | No production DB access in sandbox; job queue has bounded retries (maxAttempts=6), dedupe keys, PermanentJobError stop-retry |

Note: Production DB cannot be queried directly (no credentials/access in sandbox, Neon host outside allowed network). Migration health is inferred from successful deployment (migrations run in build) and migration files being present and consistent with schema.

---

## 3. Order/checkout readiness

| Check | Result | Evidence |
|---|---|---|
| Active payment mode | **COD-only** | `src/lib/checkout/calc.ts` reads `settings.shipping.codEnabled`/`codFeePaise`; Razorpay `paymentsConfigured: false` |
| Razorpay not enabled | Confirmed | `isRazorpayConfigured()` false unless both keys present with matching prefix; test keys refused in prod, live keys refused outside prod |
| Test payments disabled in prod | Confirmed | `isTestPaymentsAllowed() = PAYMENTS_TEST_MODE && !isProduction` — hard gate |
| Test/demo supplier disabled in prod | Confirmed | `isDemoSupplierAllowed() = SUPPLIER_DEMO_MODE && !isProduction` |
| Order state machine | Implemented | PENDING_PAYMENT → … → DELIVERED + failure states, idempotency keys, optimistic concurrency, frozen price/cost snapshots |
| Inventory guards | Implemented | Atomic stock decrement at order time, `MAX_QTY_PER_LINE=20`, `quantitySchema.max(20)` |
| Fake orders created | **No** | Per instructions, no test transactions on production |

---

## 4. Security advisory assessment — Zod (GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404)

| Item | Detail |
|---|---|
| Advisory | "Zod can exhaust memory while validating oversized constrained collections" — High severity, CVSS 8.2, CWE-770 |
| Vulnerable code path | `$ZodArray.handleArrayResult` — accumulates a validation issue object for every failing array element with no cap or early termination → OOM |
| Affected versions | zod < 4.6.6 |
| Patched versions | 4.6.6+ |
| Our version | zod `^3.25.0` (installed 3.x) |
| npm fix available | zod@4.6.7, `isSemVerMajor: true` — a **breaking change** from 3.x, not a minimal fix |
| Production exposure | **Mitigated in code** |
| Evidence | All 5 `z.array()` usages have `.max()` length constraints — exactly the advisory's mitigation: |
| | - `supplierProductIds: z.array(z.string()).max(200)` |
| | - `allowedCategories/excludedCategories: z.array(z.string()).max(500)` |
| | - `images: z.array(productImageSchema).max(12)` |
| | - `variants: z.array(variantInputSchema).max(60)` |
| | - All string schemas also bounded (`.max()`) |
| Residual risk | Two `z.record(z.unknown())` usages on `ai-ceo/action` and `ai-ceo/tool` admin routes — both auth-protected (admin-only), not publicly exposed |
| Recommended remediation | **Do not upgrade to zod 4.x** (breaking change). The codebase already applies the advisory's mitigation (bounded arrays). Optional defense-in-depth: add `.max()` to admin `z.record()` schemas. Regression coverage exists in `tests/unit/validation.test.ts`. |

---

## 5. Repository hygiene

| Check | Result | Evidence |
|---|---|---|
| Nested `resellix/` snapshot | **Removed** | 350 files / ~53k lines deleted; unreferenced by any source, excluded from tsconfig, not part of build/deploy |
| Required functionality intact | Confirmed | src/ intact: 27 app routes, 32 lib modules, 46 unit tests, 29 integration tests |
| Tests present | Confirmed | `tests/unit/` (46), `tests/integration/` (29) |
| Deployment workflows | Present | `.github/workflows/ci.yml` (typecheck→lint→tests→build→E2E), `.github/workflows/cron-jobs.yml` (every 5 min) |
| CI status | **Pass** | CI green on release branch and on main at `2375ab9` |
| No secrets in code | Confirmed | env centralized in `src/lib/env.ts` (zod-validated); `.env`/`.env.test` gitignored |
| No functionality lost | Confirmed | PR #19 merge added only additive improvements (financial atomicity, worker fencing); resellix was a dead duplicate |

---

## 6. Owner readiness (items requiring owner input — never expose secrets)

| Item | Current state | Required action |
|---|---|---|
| APP_URL | Defaults to `http://localhost:3000`; must equal production URL | Set in Vercel env to `https://zenvorastore.vercel.app`, redeploy if not already |
| SMTP / email | Default `console` (logs only, no real delivery) | Configure `EMAIL_PROVIDER=smtp` + SMTP credentials for order emails |
| Durable image storage | Default `local` (ephemeral on Vercel — lost on redeploy) | Configure `STORAGE_PROVIDER=s3\|cloudinary` + credentials |
| Product catalogue | Empty by design in production | Add real products via Admin → Products (never demo seed in production) |
| Legal / seller info | Policy pages exist as templates (privacy, returns, shipping, terms) | Review with qualified professional; set GSTIN, seller of record, grievance officer in Admin → Settings |
| Payments | COD-only active; Razorpay not configured | Configure Razorpay live keys + webhook + `PAYMENTS_TEST_MODE=false` when ready for prepaid |

---

## Summary

Production is live at commit `2375ab9` (deployment `7633218497`, success) with P0 financial atomicity and worker fencing from PR #21. COD-only payments are active; Razorpay and test/demo modes are hard-disabled in production. The zod high-severity advisory is mitigated in code (all array schemas length-bounded) and does not require a breaking zod 4.x upgrade. Repository hygiene is clean (stale `resellix/` snapshot removed, CI green). Outstanding owner actions are configuration/legal items listed above — none require code changes to operate safely.

**Final status: HEALTHY** (with the caveat that direct live browsing could not be performed from this sandbox; verification was via GitHub deployment/CI API and code inspection).