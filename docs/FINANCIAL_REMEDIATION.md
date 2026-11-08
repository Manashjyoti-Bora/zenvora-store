# Financial remediation status

Date: 2026-11-07 (Asia/Kolkata)

This document records code changes and local evidence for the financial/write-table integrity work. It is not a release sign-off. No production database, payment provider, supplier, customer notification, or deployment was exercised.

## Implemented in this checkout

### Refund lifecycle and accounting

- A refund is written as a durable `REQUESTED` reservation before provider submission. Refund balance checks run while holding the order row lock and in a serializable transaction. Existing non-failed reservations (including `REQUESTED` and `PROCESSING`) consume available refundable balance.
- A provider call is made only after that reservation commits. Its `REQUESTED → PROCESSING` claim commits before the network call. A timeout/exception keeps the reservation `PROCESSING`, records a generic “verify provider status before retry” note, and does not trigger a blind retry.
- Only `COMPLETED` refunds contribute to Payment/Order refunded totals, `actualProfit`, and settled cash deductions. `REQUESTED`/`PROCESSING` are separately reported as pending; `FAILED` is reported for review and remains an unresolved order obligation.
- Refund settlement, Payment/Order aggregates, order events, linked return completion, and recalculated profit execute in one database transaction. `COMPLETED` is terminal against a late `FAILED` event; repeated settlement is a no-op. A later verified completion may supersede `FAILED`.
- Refund webhook events that do not match a durable local reservation are left retryable rather than being recorded as successfully processed.

### Capture, cancellation, returns

- Paid payment capture now locks the order and writes the Payment row, Order payment/status fields, and events in one transaction. Capture arriving after cancellation/refund finalization moves the order back to `REFUND_PENDING` and creates a recovery reservation instead of silently ignoring the captured payment. Amount-mismatched positive captures are recorded with their actual amount and held for manual refund recovery; they are not sent to fulfilment or automatically refunded.
- COD collection locks the order and atomically writes `paymentStatus`, the collection event, and financial recalculation; cancelled/refund-recovery orders are rejected. The admin audit log follows commit.
- Cancellation state, refund reservation, and durable supplier-cancellation job rows are committed together under the order lock. The actual supplier API call, stock restock, and customer notification remain post-commit work; queued supplier cancellation is recoverable through the job runner/cron if the request process exits.
- Return requests are serialized against the order; approval and its linked refund reservation commit together. Approval retry uses the unique `returnRequestId` relation to avoid making another reservation for the same unresolved return. Rejection is limited to `REQUESTED` and cannot override a return with a refund record. Closing a return is blocked while its refund is unresolved.

### Reporting, reconciliation, and validation security

- Analytics and financial CSV now distinguish booked confirmed-order value from gateway cash collected, COD collected, uncollected COD, TEST payment volume, net real collections, completed refunds, pending reservations, and failed refunds. Historical booked-value/profit bases are not relabeled as cash collections.
- `inspectFinancialReconciliation()` is exposed through the admin-only `GET /api/admin/reconciliation/financials` endpoint as a bounded, read-only scan (maximum 1,000 orders), comparing stored Payment/Order aggregates to completed refund rows and surfacing stale reservations and failed refunds. It does not settle, retry, or mutate anything; it is not scheduled as a background job.
- The current Zod dependency was not upgraded. Existing shared JSON parsing is capped at 1 MB and every application `z.array` schema now has a finite maximum; the two previously unbounded configurable category arrays are capped at 500. Regression coverage checks those caps. This is a mitigation, not a dependency-audit pass.

## Write/consistency matrix

| Write path                        | Durable state and atomic boundary                                                                                    | Idempotency / audit evidence                                                               | Remaining limitation                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refund reservation                | Refund row + order state/event in serializable transaction, order row lock                                           | Linked return id; balance includes outstanding reservations                                | Admin-created refunds without a return id have no request idempotency key; repeated smaller admin actions can create separate valid reservations up to the remaining balance |
| Refund settlement                 | Refund status, Payment/Order aggregates, profit recalculation, order events, linked return status in one transaction | Status compare-and-swap; completion monotonic against failure; audit log after transaction | Provider status-fetch and scheduled reconciliation worker do not exist                                                                                                       |
| Payment capture                   | Order row lock; Payment, Order payment/status, capture and transition events in one transaction                      | Provider order/payment identity duplicate check                                            | Fulfilment queue/email are post-commit; failed queue recovery is outside this financial transaction                                                                          |
| COD collection                    | Order lock; payment state, collection event, and financial recalculation in one transaction                          | Duplicate PAID state is a no-op; cancelled/recovery order guard; audit log after commit    | Admin audit log is post-commit; no independent-connection race proof yet                                                                                                     |
| Cancellation                      | Cancellation fields/state, refund reservation, and supplier-cancel job rows in one serializable transaction          | Repeat cancellation blocked by `cancelledAt`/terminal state; audit log after commit        | Supplier API processing, stock restock and notification remain post-commit; concurrency proof pending                                                                        |
| Return request/approval/rejection | Request+order transition; or approval+refund reservation; or rejection+order restoration in a transaction            | Order row lock; linked refund key; reject/close guards                                     | Mark-received, restock, and notification are separate operations                                                                                                             |
| Financial reports                 | Read-only queries and pure classification                                                                            | Status-based separation; TEST excluded from real collections                               | Existing 10,000-row query caps remain; results can be truncated at larger volumes                                                                                            |
| Financial reconciliation          | Admin-only read endpoint; read-only scan, bounded to at most 1,000 oldest-updated orders per request                 | Pure snapshot findings and unit tests                                                      | Not scheduled, not provider-authoritative, and not a replacement for provider verification                                                                                   |

## Verification evidence

| Gate                                     | Result                     | Evidence                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Targeted financial/accounting unit tests | **PASS**                   | `npx vitest run tests/unit/refund-accounting.test.ts tests/unit/financial-classification.test.ts tests/unit/financial-reconciliation.test.ts tests/unit/order-state.test.ts tests/unit/zod-array-bounds.test.ts` — 5 files, 25 tests passed                                           |
| Transactional queue helper unit test     | **PASS**                   | `npx vitest run tests/unit/job-transaction.test.ts` — 1 file, 3 tests passed; verifies transaction-client calls, conflict-safe dedupe, and terminal-job retry semantics                                                                                                               |
| Targeted ESLint                          | **PASS**                   | ESLint on changed TS/TSX/test files — exit 0                                                                                                                                                                                                                                          |
| Repository ESLint                        | **PASS with warnings**     | `npm run lint` — exit 0; 0 errors, 78 `no-console` warnings in untouched `src/scripts/catalogue-diagnostic.ts`                                                                                                                                                                        |
| Formatting / whitespace                  | **PASS**                   | Targeted Prettier check and `git diff --check`                                                                                                                                                                                                                                        |
| Finance integration suite                | **BLOCKED**                | `npx vitest run tests/integration/finance.test.ts` — suite fails before collection because `DATABASE_URL` is not configured (0 tests run)                                                                                                                                             |
| Jobs integration suite                   | **BLOCKED**                | `npx vitest run tests/integration/jobs.test.ts` — fails before collection because the generated Prisma client is absent (`Cannot find module '.prisma/client/default'`); `npx prisma generate` also failed fetching `schema-engine.gz.sha256`; PostgreSQL behavior remains unverified |
| Full unit suite                          | **BLOCKED by environment** | `npm run test:unit` — 33 files passed, 9 suites failed during import/setup due missing `DATABASE_URL`; 333 tests passed and 1 settings test failed for the same env-loading issue (334 tests reported)                                                                                |
| TypeScript                               | **BLOCKED**                | Prior `npm run typecheck` exited 2 with 426 cascading errors from a missing/generated Prisma client (`OrderStatus`, `Prisma.OrderSelect`, etc.); `npx prisma generate` in this pass could not fetch the Prisma schema engine. This is not evidence of a clean typecheck.              |
| Independent PostgreSQL concurrency test  | **BLOCKED / NOT RUN**      | No isolated PostgreSQL 16 instance and independent DB clients are available. No mocks were treated as concurrency evidence.                                                                                                                                                           |
| Build/release                            | **NOT RUN**                | No release/build command was run; no migrations or production operations were attempted.                                                                                                                                                                                              |
| Dependency audit                         | **FAIL**                   | `npm audit --audit-level=high` reports 8 advisories: 1 high (Zod 3.25.76, GHSA-mrhx-c7xc-m3w5) and 7 moderate (`minimatch`). No dependency upgrade was forced. The Zod high finding remains open despite bounded arrays/body-size mitigation.                                         |

## Scope boundary

The write matrix is limited to the requested payment/refund/cancellation/return/reporting paths and the read-only scanner. This is not a complete repository-wide inventory of catalog, account, coupon, inventory, supplier, notification, and job writes. Those write paths were not exhaustively classified in this remediation pass and need a separate focused write-table audit; this document does not claim full A–Z closure.

## Required before release

1. Provision disposable isolated PostgreSQL 16 plus genuinely independent clients; run refund reservation, capture/cancel race, return retry, webhook replay, and aggregate consistency tests. Verify both orderings of each race.
2. Generate a Prisma client from the checked-in schema in an environment with the supported Prisma engine, then rerun `npm run typecheck`, full unit/integration suites, and the pinned build/release gates.
3. Implement and test provider refund-status lookup plus a durable, bounded reconciliation worker. The worker must verify provider status before any retry and persist verified results; no retry of ambiguous `PROCESSING` operations is safe today.
4. Resolve the Zod high advisory under the no-breaking-upgrade constraint (approved compatible patch path or verified runtime mitigation) and rerun the dependency audit.
5. Reconcile historical Payment/Order aggregates against refund rows with the read-only scanner before planning any separately approved data repair. This checkout performs no such repair.

## Repository and operations

- Changes are on `arena/05032067-zenvora-store`; no commit, push, merge, or deployment was performed.
- No Prisma schema/migration change was made.
- Pre-existing user artifacts were preserved: modified `package-lock.json`, `docs/HISTORICAL_PENDING_TASKS.md`, and `docs/LEGACY_DEFECT_REGISTER.md`.
- No production records, real payments/refunds, suppliers, notifications, or provider settings were touched.
