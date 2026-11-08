# Launch evidence — storage, payments, operations, and journeys

**Overall verdict: NOT READY — OWNER ACTION REQUIRED.** Draft PR [#23](https://github.com/Manashjyoti-Bora/zenvora-store/pull/23) is the integration vehicle. Do not merge or promote it on the basis of CI alone. No Production deployment, real payment/refund, real customer email, real supplier order, or real storage mutation was performed.

This report distinguishes tested application code from external service operation. A documentation-only evidence commit may follow the application SHA below; it does not change the tested application behavior.

## 1. Commit and deployment identity

| Item                             | Commit / deployment                                                             | Evidence/status                                                                                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable-storage implementation   | `8e47ae6342354d253b9988a78a69bd2d200a0c68`                                      | [CI 42482148477](https://github.com/Manashjyoti-Bora/zenvora-store/actions/runs/42482148477) passed; focused storage tests were 31/31. Implementation was preserved, not rewritten.                                                     |
| Initial payment/operations batch | `adde3f869c0c4240c754876853b71dfeb533e422`                                      | [CI 42488566603](https://github.com/Manashjyoti-Bora/zenvora-store/actions/runs/42488566603) caught a test assumption: service-level COD creation precedes route-level confirmation. Fixed in the next commit; not a release candidate. |
| Tested application code          | `4b76228e1945ba5864f81cb8c2c325a7bdff7868`                                      | [CI 42488875510](https://github.com/Manashjyoti-Bora/zenvora-store/actions/runs/42488875510) **SUCCESS**; PR Vercel and Preview Comments **SUCCESS**.                                                                                   |
| Matching Preview                 | `dpl_45TJEkZaXrLipPPv8Gpn9j6c978m`                                              | READY/STAGED at `4b76228e1945ba5864f81cb8c2c325a7bdff7868`; URL `https://zenvora-store-qvpgxszlh-manashjyoti-bora.vercel.app`. Metadata/build evidence only.                                                                            |
| Preserved Production + rollback  | `149f3408da0dd140a66208777127a3af45440808` / `dpl_HYvTGhsQyyE2DU9vGNETh5Yq2NBq` | Rechecked after the application Preview: latest Production remains READY/PROMOTED at this deployment and `isRollbackCandidate:true`. **Untouched.**                                                                                     |

PR #23 was open, draft, MERGEABLE/CLEAN at `4b76228…` when this report was prepared. It was not merged.

## 2. Test evidence

### Local, pinned project tools

- **50/50 focused tests passed** with the repository’s Vitest 5.0.5:
  - `tests/unit/razorpay-key-guard.test.ts`
  - `tests/unit/order-payment-messaging.test.ts`
  - `tests/unit/admin-order-filters.test.ts`
  - `tests/unit/public-payment-messaging.test.ts`
- Full ESLint completed with **0 errors** and the pre-existing diagnostic-script console warnings.
- A full local unit attempt passed 441 tests but could not initialize seven Prisma-dependent suites because the sandbox has an uninitialized Prisma client. No local integration/E2E result is claimed. Hosted CI below is authoritative.
- Exact hosted aggregate test counts are not asserted: the successful-run log download ended in a GitHub `EOF`. The green job conclusion covers the configured suites; no count was invented.

### Hosted CI at `4b76228…` — COMPLETE for isolated code verification

[CI 42488875510](https://github.com/Manashjyoti-Bora/zenvora-store/actions/runs/42488875510) passed every configured stage:

1. Prisma schema validation/client generation and fresh isolated-database migrations, including the legacy worker/cancellation check.
2. Typecheck and lint.
3. Complete configured unit + integration suite.
4. Release build (`npm run build`, the Vercel-equivalent build).
5. Seeded development server and complete configured HTTP E2E suite.
6. Production dependency audit (high+).

Newly covered behaviors include:

- **Fail-closed payments:** NONE rejects a direct new prepaid creation with HTTP-equivalent `503 / PAYMENTS_NOT_CONFIGURED`, leaves the cart unconverted, permits the normal COD creation/confirmation path, and preserves existing-order idempotent recovery. Razorpay availability requires complete matching server/browser key IDs, webhook configuration, and environment-correct key prefixes; TEST cannot be selected in Production.
- **Truthful public/history wording:** shared NONE/TEST/RAZORPAY + COD copy feeds homepage, product, checkout, About, FAQ visible answers and JSON-LD, and policy pages. Recorded TEST history remains a simulation after configuration changes; no provider is inferred for legacy orders without an attempt. COD collection remains truthful after partial refunds; manual COD settlement is not described as a gateway/bank credit.
- **Emails:** TEST subjects/templates say simulation/no real money; COD and Razorpay refund wording remains provider-specific. SMTP with missing configuration leaves the notification FAILED and throws so the durable job cannot become DONE.
- **Worker outcomes:** a no-op reports zero claimed/succeeded/failed/retried/rescheduled; console `SENT` is only a console handoff; terminal missing-SMTP processing leaves both notification and job FAILED.
- **Admin filters:** recorded provider filtering uses `Payment.provider`; TEST is not cast into the order payment-method enum; combined filters and pagination remain valid.
- **Admin/customer isolated HTTP journey:** authorization and cross-customer isolation; TEST/Razorpay filters; admin order detail; supplier-shipped, out-for-delivery and delivered transitions; idempotent COD collection with one collection event; rejected return without refund; approval without automatic refund when amount is zero; receipt; collected-COD ₹50/5,000-paise partial refund; replay with the **exact original `Idempotency-Key`** yielding the same refund and one row; idempotent manual settlement; `PARTIALLY_REFUNDED`, operational `REFUND_PENDING`, linked return `REFUNDED`, and manual-settlement notification wording.
- **Public/payment HTTP journeys:** provider-aware public pages and structured data, TEST checkout confirmation/account history, and the existing regression suite passed.

All database journeys ran against CI’s isolated PostgreSQL database with synthetic records. No external supplier, inbox, gateway, or cloud-storage action was used.

## 3. Phase status

| Phase / gate                                               | Status                                                                | Evidence and remaining gap                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — durable storage implementation**                     | **COMPLETE** for code, mocks, admin/reference/delete HTTP regressions | Implementation at `8e47ae6…` plus subsequent green regression suites. Referenced images fail deletion with 409 before remote deletion; local/invalid remote storage fails closed.                                                                                                                   |
| **A — real Cloudinary/S3 provider verification**           | **BLOCKED**                                                           | Current Preview env-name list has no `STORAGE_PROVIDER`, Cloudinary, or S3 names. No real upload, public-policy access, redeploy persistence, managed deletion, or account behavior was tested. Existing images were not migrated.                                                                  |
| **B — Preview build/deployment**                           | **COMPLETE** for metadata                                             | `dpl_45TJEkZaXrLipPPv8Gpn9j6c978m` is READY/STAGED at the tested app SHA; PR Vercel checks passed.                                                                                                                                                                                                  |
| **B — Preview application health**                         | **NOT VERIFIED**                                                      | A fresh commit-specific `/api/health` request redirected to Vercel SSO; no application JSON was available. Authorized Preview access is required.                                                                                                                                                   |
| **B — scheduler/worker/email operation**                   | **PARTIAL / NOT VERIFIED**                                            | Isolated worker outcomes pass. Vercel declares only daily `17 0 * * *`; actual scheduled execution and timely queue operation are unverified. SMTP names do not prove valid configuration, provider acceptance, or inbox receipt.                                                                   |
| **C — provider-aware payment availability and messaging**  | **COMPLETE** for implementation and isolated tests                    | NONE/TEST/RAZORPAY guards, COD-only messaging, historical selection, notifications, policies, and structured data are covered. No real gateway was enabled or verified.                                                                                                                             |
| **C — admin order management and COD returns/refunds**     | **COMPLETE** for isolated HTTP/database journeys                      | Shipment, collection, rejection/approval/receipt, partial manual settlement, exact-key replay, and customer isolation passed in hosted E2E. Real cash settlement remains manual and unverified.                                                                                                     |
| **D — product/business claims and publication compliance** | **OWNER ACTION REQUIRED**                                             | Unsupported supplier-vetting language was removed. Owner identity, policies/jurisdiction/grievance details, exact specifications, claims, supplier evidence, tax/invoice decisions, and applicable compliance remain external gates.                                                                |
| **D — fetal-heart-rate product**                           | **OWNER ACTION REQUIRED / NOT VERIFIED**                              | No matching product source or fixture was found in the checkout. Actual Preview/Production database publication state was not visible. Any such product must remain DRAFT/unpublished; the owner must unpublish any live row through the approved admin process. No Production product was changed. |
| **E — Neon backup/PITR and restore**                       | **BLOCKED / NOT VERIFIED**                                            | No Neon console evidence, actual retention window, or restore result was available. No Production database action occurred. The isolated restore evidence procedure is documented.                                                                                                                  |
| **F — responsive rendering and mobile/Android UX**         | **PARTIAL / NOT VERIFIED**                                            | Responsive storage/optimization code and regression coverage remain intact; real optimized Cloudinary output, Android Chrome, device-specific performance, and touch/layout checks were not executed.                                                                                               |
| **G — visual polish, AI CEO, marketing, growth**           | **NOT STARTED**                                                       | Deliberately deferred behind launch blockers. No AI provider, campaign, spend, or Production visual release was enabled.                                                                                                                                                                            |

## 4. External blockers and exact next action

Owner-only requirements and Preview variable names are in [`OWNER_ACTION_REQUIRED.md`](./OWNER_ACTION_REQUIRED.md). Detailed real-provider, scheduler, inbox, Android, and Neon evidence gates are in [`OPERATIONAL_VERIFICATION.md`](./OPERATIONAL_VERIFICATION.md); Cloudinary’s exact owner-safe procedure is in [`STORAGE_SETUP.md`](./STORAGE_SETUP.md).

**Exact next owner action:** keep the fetal-heart-rate item unpublished; complete the private business/product/legal/tax evidence; configure Cloudinary and SMTP in **Preview only** with authorized Preview access and an appropriately frequent authenticated worker schedule; redeploy Preview; record a Neon restore-to-new-isolated-branch rehearsal; then request verification using only non-secret deployment/test identifiers and inbox/restore evidence. Never paste credentials into chat or Git and do not change Production as part of that test.

Until those external checks pass, real durable storage, Preview health, scheduled queue processing, inbox delivery, recoverability, product compliance/publication, and Android rendering are **NOT VERIFIED**. The release recommendation remains **DO NOT MERGE / DO NOT PROMOTE**.
