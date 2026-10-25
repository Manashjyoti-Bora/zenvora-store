# Zenvora — Autonomous operations policy

This is the **operating contract** for any automation in Zenvora: cron jobs, the job queue, the
supplier auto-import pipeline, the admin operations dashboard, and any future AI assistance.
It is deliberately conservative. Automation earns wider permissions by evidence, never by default.

## 1. Permission levels

| Level | Allowed | Examples in this codebase |
|---|---|---|
| **0 — Observe** | Read approved metrics, produce reports | Admin → Operations dashboard, `/api/health`, sync reports, dry-run reports |
| **1 — Safe maintenance** | Non-destructive, idempotent, bounded housekeeping | Cron: process ≤25 due jobs, purge expired sessions / carts / rate-limit buckets; supplier **dry-run** evaluation |
| **2 — Reversible, policy-gated** | Changes with a documented rule *and* an audit row *and* a one-step undo | Flagging a supplier product STALE; creating DRAFT products from a sync; pausing a product whose supplier reports it unavailable |
| **3 — Approval required** | Anything customer- or money-visible | Publishing products (bulk or auto), price-policy changes, refunds, consequential customer e-mails, payment configuration, production releases |
| **4 — Prohibited** | Irreversible / security-weakening | Destructive migrations, `RELEASE_RECLAIM_DATABASE=1` to force a build, secret rotation by automation, disabling guards, mass deletion, real supplier orders without an order |

Automation may never raise its own level. Changing a threshold or enabling auto-publish is an
admin action recorded in `AuditLog`.

## 2. Current automations and their contracts

### 2.1 Daily cron — `/api/cron/jobs` (`17 0 * * *` UTC)
- **Trigger:** Vercel cron with `CRON_SECRET` bearer; unauthenticated calls → 401.
- **Preconditions:** none; each step is independent.
- **Work:** `processDueJobs({ limit: 25 })`, purge sessions, purge stale carts, purge rate-limit buckets.
- **Idempotency:** jobs carry `dedupeKey`; purges are set-based deletes.
- **Retry:** per-job attempts bounded in the runner; `PermanentJobError` stops retries.
- **Failure:** step errors are logged to `ErrorLog`; the response reports counts so a failed day is visible.
- **Budget:** 25 jobs/run; Hobby plan = 1 run/day. More frequent work needs a plan change (documented option, not assumed).
- **Kill switch:** remove the cron entry or rotate `CRON_SECRET` (owner action).

### 2.2 Supplier sync — `POST /api/admin/suppliers/[id]/sync` (Level 2 for drafts, Level 3 for publish)
- **Trigger:** admin only. Not scheduled.
- **Preconditions:** supplier active; adapter capability `catalogSync`; for CJ, a valid access token (diagnostics probe).
- **Idempotency:** `SupplierProduct` upsert on `(supplierId, supplierSku)`; per-supplier checkpoint; daily import limit (`settings.autoImport.dailyImportLimit`, default 100).
- **Publish gate:** `settings.autoImport.autoPublishEligible` — **default false**. Until the owner enables it, eligible items become DRAFT products (Level 2) and are listed for approval.
- **Dry run:** the evaluator can run without writing products and emit a report of would-publish / needs-review / rejected with reasons (added in Phase 5).
- **Audit:** every state change writes `AuditLog`; rejection reasons are persisted on the supplier product.

### 2.3 Fulfilment jobs
- `FULFIL_SUPPLIER_ORDER` is enqueued only for a confirmed, paid-or-COD order; supplier adapter errors classified as transient (retry with backoff) or `SupplierRejectedError` (permanent, admin alert).
- Webhooks are trigger-only: status is re-verified via the supplier API; events deduped by external id.

## 3. Supplier auto-publish policy (what must be true before enabling)

1. CJ diagnostics probe passes in **production** (token obtained, authenticated call ok, product query ok) — recorded with timestamp in the admin UI, token never shown.
2. Dry-run report reviewed for at least one full sync: would-publish set inspected by the owner.
3. Thresholds set deliberately in Admin → Settings → Auto-import (margin %, min profit, price bounds, categories).
4. Return/complaint feedback loop exists (per-product cancellation/return counts with sample-size guard).
5. Owner flips `autoPublishEligible` (Level 3, audited). Even then: daily limit applies, every publish is audited, and any supplier-side invalidation pauses the product (Level 2, reversible).

Demo mode and payment provider are **separate** switches with their own prerequisites (see
`ZENVORA_LAUNCH_CHECKLIST.md`); a credential existing is never a reason to flip either.

## 4. AI usage policy

- No model provider is configured today. **No AI feature is active**; nothing in the UI claims otherwise.
- If a provider is added: server-side only, per-feature budget cap, timeouts, schema-validated output,
  supplier text treated as untrusted data (prompt-injection boundary), no customer PII in prompts,
  deterministic fallback when the provider fails. AI never publishes, prices, or refunds.

## 5. Observability

- `ApiLog` (outbound supplier/provider calls, sanitised), `ErrorLog` (persisted exceptions), `AuditLog` (admin/automation actions),
  `WebhookEvent`, `Job` history, `Notification` delivery status, supplier sync reports.
- Admin → Health: launch blockers (placeholder support e-mail, missing Razorpay, demo mode in prod, missing `CRON_SECRET`).
- Admin → Operations (Phase 6): one page that reads the above and ranks what needs attention — Level 0 only.

## 6. Rollback

- Code: Vercel → Deployments → previous READY production deployment → *Promote to Production* (rollback candidates are listed in each release report).
- Data: migrations are additive; each new table documents its `DROP` rollback. Neon point-in-time restore exists for the project but is an owner action.
- Automation: set `autoImport.enabled=false` (stops drafts), `autoPublishEligible=false` (stops publishes), remove cron (stops jobs). Products created from a supplier are linked 1:1 via `SupplierProduct.productId`, so automation-created products are identifiable and can be unpublished in bulk from Admin → Supplier products.
