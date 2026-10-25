# Zenvora — Autonomous operations policy

This is the **operating contract** for any automation in Zenvora: cron jobs, the job queue, the
supplier auto-import pipeline, the admin operations dashboard, and any future AI assistance.
It is deliberately conservative. Automation earns wider permissions by evidence, never by default.

## 1. Permission levels (who) and action risk classes (what)

### 1.1 Permission levels 0–4 — `src/lib/auth/permissions.ts`

| Level | Who | May do |
|---|---|---|
| **0** | Anonymous | Browse, track an order with number + e-mail |
| **1** | Customer (`CUSTOMER`) | Own cart / orders / addresses |
| **2** | Observer (`STAFF`, read) | Operations dashboard, logs, reports |
| **3** | Operator (`STAFF`) | Supplier sync, dry run, bulk import **as DRAFT**, returns / cancellations |
| **4** | Owner (`ADMIN`) | Publish, settings, payments, users, secrets, deploys |

`ACTION_MIN_LEVEL` pins `catalog.publish`, `settings.write`, `payments.manage`, `users.manage` and
`ai.configure` to level 4. `AUTOMATION_MAX_LEVEL = 3`: cron, the job runner and any future AI helper
act as an operator at most and cannot reach the owner level. Note the admin area itself is still
ADMIN-only (`src/app/admin/layout.tsx`); the levels are enforced in code for API guards and shown on
Admin → Operations so the policy is visible, not implied.

### 1.2 Action risk classes R0–R4 (what automation may touch)

| Class | Allowed | Examples in this codebase |
|---|---|---|
| **R0 — Observe** | Read approved metrics, produce reports | Admin → Operations dashboard, `/api/health`, sync reports, dry-run reports |
| **R1 — Safe maintenance** | Non-destructive, idempotent, bounded housekeeping | Cron: process ≤25 due jobs, purge expired sessions / carts / rate-limit buckets; supplier **dry-run** evaluation |
| **R2 — Reversible, policy-gated** | Changes with a documented rule *and* an audit row *and* a one-step undo | Flagging a supplier product STALE; creating DRAFT products from a sync; pausing a product whose supplier reports it unavailable |
| **R3 — Approval required** | Anything customer- or money-visible | Publishing products (bulk or auto), price-policy changes, refunds, consequential customer e-mails, payment configuration, production releases |
| **R4 — Prohibited** | Irreversible / security-weakening | Destructive migrations, `RELEASE_RECLAIM_DATABASE=1` to force a build, secret rotation by automation, disabling guards, mass deletion, real supplier orders without an order |

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

### 2.2 Supplier sync — `POST /api/admin/suppliers/[id]/sync` (R2 for drafts, R3 for publish)
- **Trigger:** admin only. Not scheduled.
- **Preconditions:** supplier active; adapter capability `catalogSync`; for CJ, a valid access token (diagnostics probe).
- **Idempotency:** `SupplierProduct` upsert on `(supplierId, supplierSku)`; per-supplier checkpoint; daily import limit (`settings.autoImport.dailyImportLimit`, default 100).
- **Publish gate:** `settings.autoImport.autoPublishEligible` — **default false**. Until the owner enables it, eligible items become DRAFT products (Level 2) and are listed for approval.
- **Dry run:** `GET /api/admin/suppliers/[id]/dry-run?mode=IMPORT_ELIGIBLE_DRAFT|SAFE_PUBLISH_ELIGIBLE&limit=≤500`
  (`src/lib/catalog/dry-run.ts`, ADMIN). Runs the same evaluator, pricing rules, duplicate check and
  thresholds as the real pipeline but performs **zero writes** (integration-tested by snapshotting the
  database before/after). It returns would-publish / would-import-draft / would-hold / would-reject /
  would-skip counts, lifecycle and demand-evidence counts, contribution-margin economics and the top
  rejection reasons. The older `EVALUATE_ONLY` bulk mode is *not* a dry run — it persists
  `raw.importState` on every row.
- **Audit:** every state change writes `AuditLog`; rejection reasons are persisted on the supplier product.

### 2.4 Supplier product lifecycle (derived, not stored) — `src/lib/catalog/lifecycle.ts`

`deriveLifecycleState()` maps the facts already in the database (supplier active flag, supplier
product active/stock/`lastSyncedAt`, linked `Product.status`, the raw `importState`, and the live
evaluation) onto one vocabulary:

| State | Meaning |
|---|---|
| `DISCOVERED` | Seen in a sync, not yet evaluated or imported |
| `IMPORTING` | Draft import in progress / mapped product not yet created |
| `VALIDATION_FAILED` | Missing SKU / cost / image / description — cannot be priced or listed |
| `NEEDS_REVIEW` | Evaluated; a human decision is required (held item or draft without approval) |
| `APPROVED` | Draft a staff member marked ready; still unpublished |
| `SCHEDULED` | **Reserved** — no `publishAt` column or scheduled-publish job type exists, so this state is currently unreachable |
| `ACTIVE` | Linked product is ACTIVE and the supplier row is fresh and in stock |
| `STALE` | ACTIVE but no supplier sync inside `autoImport.staleAfterHours` (default 48 h) |
| `SUPPLIER_UNAVAILABLE` | ACTIVE but supplier reports out of stock / zero quantity |
| `PAUSED` | Supplier inactive, supplier product deactivated or product archived |
| `REJECTED` | Evaluator or staff rejected it (reason recorded) |

Precedence: PAUSED → ACTIVE-health (STALE / SUPPLIER_UNAVAILABLE / ACTIVE) → REJECTED →
VALIDATION_FAILED → draft states → IMPORTING → NEEDS_REVIEW → DISCOVERED. Freshness is reported as
`freshnessHours` wherever the state is shown (Admin → Product mapping, Admin → Operations).

### 2.5 Scoring safeguards (owner-configurable, Admin → Product mapping → Quality Gate Rules)

| Setting (`settings.autoImport`) | Default | Effect |
|---|---|---|
| `minDemandConfidenceForAutoPublish` | `UNKNOWN` | Demand evidence required before an item is *auto-publish eligible*. `UNKNOWN` keeps today's behaviour (unit economics only). Recommended: set to `LOW_EVIDENCE` or `VERIFIED` **before** enabling auto-publish. Never affects import. |
| `verifiedDemandMinListedNum` | 20 | Sample size (CJ `listedNum`) below which demand is `LOW_EVIDENCE`, not `VERIFIED` |
| `minScoreForAutoPublish` | 55 | Score (0–100) at or above which the tier is HIGH_POTENTIAL / PROMISING; below it NEEDS_REVIEW |
| `staleAfterHours` | 48 | Freshness window for `STALE` |

Demand confidence is `UNKNOWN` whenever neither CJ metrics nor store order history exist; scores
never use random or fabricated demand data.

### 2.6 Contribution margin (estimate vs realised) — `src/lib/catalog/contribution-margin.ts`

`computeContributionMargin()` returns a line-by-line breakdown, each line labelled by its **basis**:

selling price − GST (so revenue is ex-tax) − supplier cost (`SUPPLIED`) − supplier shipping
(`SUPPLIED`, or `UNKNOWN` → result flagged `isUpperBound`) − payment fee (`ESTIMATE`, configured %) −
packaging / operational cost (`CONFIGURED`) − return-loss provision (`ESTIMATE`, configured %, *not*
measured) − other known costs = contribution margin.

Only lines whose basis is `SUPPLIED` or `CONFIGURED` are facts; the rest are estimates and are shown
as such. Realised margin per order is not computed yet — it requires actual supplier invoices and
return outcomes, which are not in the schema today.

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
  `src/lib/ai/provider.ts#getAiStatus()` returns `enabled: false` with the reason, and the only helper
  shipped (`deterministicTitleCleanup`) is a pure, rule-based function — no network, no model output.
  Admin → Operations shows "AI assist: DISABLED".
- If a provider is added: server-side only, per-feature budget cap, timeouts, schema-validated output,
  supplier text treated as untrusted data (prompt-injection boundary), no customer PII in prompts,
  deterministic fallback when the provider fails. AI never publishes, prices, or refunds.

## 5. Observability

- `ApiLog` (outbound supplier/provider calls, sanitised), `ErrorLog` (persisted exceptions), `AuditLog` (admin/automation actions),
  `WebhookEvent`, `Job` history, `Notification` delivery status, supplier sync reports.
- Admin → Health: launch blockers (placeholder support e-mail, missing Razorpay, demo mode in prod, missing `CRON_SECRET`).
- Admin → Operations (`/admin/operations`): environment, auto-publish / live-ordering / payments / AI
  switches, lifecycle counts derived from real supplier rows, per-supplier last sync, job queue and
  webhook counts (24 h), rate-limit bucket count, 24 h order counts, and the permission-level table.
  Every figure is read at request time; nothing is sampled or estimated.

## 6. Rollback

- Code: Vercel → Deployments → previous READY production deployment → *Promote to Production* (rollback candidates are listed in each release report).
- Data: migrations are additive; each new table documents its `DROP` rollback. Neon point-in-time restore exists for the project but is an owner action.
- Automation: set `autoImport.enabled=false` (stops drafts), `autoPublishEligible=false` (stops publishes), remove cron (stops jobs). Products created from a supplier are linked 1:1 via `SupplierProduct.productId`, so automation-created products are identifiable and can be unpublished in bulk from Admin → Supplier products.
