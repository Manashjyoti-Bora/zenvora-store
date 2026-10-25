# Zenvora — AI CEO & autonomous store brain

Status: **implemented, deterministic mode verified by unit tests**; the optional model
provider is **disabled** (no provider configured, no key present) and live
business actions are **off by default**. Nothing in this document claims the AI
CEO is fully autonomous or production-ready.

---

## 1. What it is (and is not)

The AI CEO is a **business-intelligence and operations layer** on top of records the
store already holds: orders and their profit ledger, refunds, returns, support
messages, the job queue, webhook outcomes, error logs, supplier products and sync
reports, product statuses and store settings.

| It is | It is not |
|---|---|
| A deterministic report engine: same snapshot → same report | A chatbot answering from memory |
| A typed tool registry with server-enforced permissions | An agent with a database handle or shell |
| An evidence-labelled dashboard with a human approval queue | A source of invented demand, conversion or profit |
| A bounded, idempotent, audited Mode-2 action console | Permission to publish products, price, refund or move money |

No figure is produced by a language model. A model may only *narrate* a finished
report, inside a block labelled **“AI narrative — unverified”**.

## 2. Architecture

```
                         ┌──────────────────────────────────────────────┐
  Prisma (one adapter)   │  src/lib/ai-ceo/snapshot.ts                  │
  bounded SELECTs only ─▶│  AiCeoSnapshot (aggregates, money in paise)  │
                         └───────────────┬──────────────────────────────┘
                                         │  pure functions (no I/O)
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                ▼               ▼                ▼               ▼
  metrics.ts       operations.ts     catalog.ts      readiness.ts    engine.ts
  sales/margin     jobs, webhooks,   supplier &      launch gates    risks +
  + caveats        errors, orders    catalogue       + owner tasks   recommendations
                                         │
                                         ▼
                                  tools.ts (typed, read-only, level-gated)
                                         │
                    ┌────────────────────┴─────────────────────┐
                    ▼                                          ▼
        /api/admin/ai-ceo/tool                   /admin/ai-ceo (dashboard)
        /api/admin/ai-ceo/report                 + action console, controls
                    │                                          │
                    └──────────▶ actions.ts (pure policy) ◀────┘
                                 action-executor.ts (server, audited)
                                 provider.ts (optional narrative, off)
```

**Why pure functions matter here**

* The reasoning layer cannot read the database, call a supplier or spend money: it
  only receives a snapshot.
* Every number is reproducible in tests without a database or network (see
  `tests/unit/ai-ceo-*.test.ts`, 72 assertions).
* One adapter (`snapshot.ts`) is the only place where bounds (`take`), field
  selection and PII avoidance are enforced.

## 3. The data contract — `contracts.ts`

Every reported figure is a `Metric` carrying a **basis**:

| Basis | Meaning | Example |
|---|---|---|
| `VERIFIED` | Read directly from a persisted record | refund row count |
| `DERIVED` | Arithmetic over verified records, no assumptions | net revenue = gross − refunds |
| `ESTIMATE` | Uses a configured assumption, not a measured outcome | contribution when only part of the cost ledger is booked |
| `UNKNOWN` | Inputs are missing — shown as `null`, never as `0` | contribution before any cost is recorded |

The snapshot contains **no customer identifiers**: no names, e-mails, phones or
addresses. Support is represented by counts; orders by their money ledger and
status.

### Honesty rules encoded in the code

1. Revenue is money collected (`paymentStatus ∈ PAID…`), not orders placed.
2. COD orders (`COD_PENDING`) are reported separately as committed-but-uncollected
   and excluded from revenue until paid.
3. Contribution is `null` unless cost data covers the revenue it subtracts from;
   partial coverage is labelled `ESTIMATE` with an explicit “upper bound” caveat.
4. Net profit is never reported: fixed overheads are not in the database, so it is
   listed under **what this report cannot measure**.
5. Fewer than 5 realised orders → “sample too small to establish a trend”.
6. Unknown supplier stock (`inStock = null`) is counted as *unknown*, never as
   available.
7. Missing data is stated, not filled: for example “no realised order in the window:
   revenue, margin and demand are not measurable”.

## 4. Permissions

Levels are the existing ones (`src/lib/auth/permissions.ts`).

| Surface | Who | Level |
|---|---|---|
| `/admin/ai-ceo` page | ADMIN (admin layout guard) | 4 |
| `GET /api/admin/ai-ceo/report`, `POST …/tool` | STAFF or ADMIN, per-tool minimum | 2–3 |
| `POST …/action` | ADMIN at the route, plus per-action minimum in policy | 3–4 |
| `PATCH …/config`, `POST …/narrative` | ADMIN | 4 |

The page is under `src/app/admin/layout.tsx`, which redirects non-admins to
`/account`; the API routes additionally call `requireStaff()`/`requireAdmin()`.
Hiding a button is never the security boundary.

Mode ceiling: `AUTOMATION_MAX_LEVEL = 3`. Publishing, pricing, refunds, settings,
payments and user management remain level 4 and are **not executable** through the
AI CEO endpoints at all (see §6).

## 5. Typed tools (`tools.ts`)

| Tool | Min level | Input | Returns |
|---|---|---|---|
| `getStoreHealth` | 2 | `{}` | domain levels, summaries, metrics |
| `getVerifiedSalesMetrics` | 2 | `{}` | revenue/refund/order metrics + caveats |
| `getContributionMarginReport` | 3 | `{}` | contribution, cost coverage, components |
| `getProductQualityReport` | 2 | `{}` | catalogue completeness/freshness counts |
| `getSupplierHealth` | 2 | `{}` | sync failures, staleness |
| `getOrderOperationsSummary` | 2 | `{}` | pipeline aggregates only |
| `getLaunchReadiness` | 2 | `{}` | readiness items + launch blockers |
| `getRecommendations` | 2 | `{category?, maxPriority?, limit ≤ 25}` | filtered recommendations |
| `getDataGaps` | 2 | `{}` | what cannot be measured, provider status |

Inputs are **strict** zod schemas (unknown keys rejected). Permission is checked
*before* input validation so a low-privilege caller cannot probe a restricted
tool’s shape. Every tool declares `sideEffects: 'NONE'`.

## 6. Actions — what may run automatically

`actions.ts` is the catalogue; `action-executor.ts` is the only place that runs it.

| Key | Mode | Min level | Side effects | Cap / 24 h |
|---|---|---|---|---|
| `RUN_JOB_QUEUE` | 2 | 4 | existing `processDueJobs({limit:25})`, dedupe-keyed | 12 |
| `RUN_SUPPLIER_DRY_RUN` | 2 | 3 | **zero writes** (existing dry-run module) | 20 |
| `REFRESH_DERIVED_CACHE` | 2 | 3 | in-process settings cache + `revalidatePath` | 100 |
| `CREATE_INTERNAL_TASK` | 2 | 2 | audit-log task record only | 50 |
| `RECORD_REPORT_SNAPSHOT` | 2 | 2 | audit-log digest only | 24 |
| `PUBLISH_PRODUCT`, `CHANGE_PRICE`, `ISSUE_REFUND`, `CHANGE_SETTINGS`, `ENABLE_AUTO_PUBLISH` | 3 | 4 | listed for transparency, **never executable here** | 0 |

Policy order (all evaluated before anything is touched):

1. unknown action → `UNKNOWN_ACTION`;
2. `execution !== 'ALLOWED'` → `APPROVAL_REQUIRED` (even for an ADMIN);
3. module kill switch off → `KILL_SWITCH`;
4. actions disabled → `ACTIONS_DISABLED`;
5. level below the action minimum → `FORBIDDEN`;
6. args fail strict validation → `INVALID_ARGS`;
7. missing/malformed idempotency key → `IDEMPOTENCY_KEY_REQUIRED`;
8. same key already executed → `DUPLICATE`;
9. per-action or global daily cap → `DAILY_LIMIT`;
10. run → audit `ai_ceo.action` (or `ai_ceo.action.failed`); refusals are audited as
    `ai_ceo.action.denied` so probing is visible.

**Kill switches** (Settings → `aiCeo`, editable on the dashboard):
`enabled` (module), `actionsEnabled` (execution, **false by default**),
`dailyActionLimit` (**0 disables execution**), `providerNarrativeEnabled` (off),
`monthlyTokenBudget`.

## 7. Optional narrative provider

Configuration (all optional; absent = disabled):

```
AI_PROVIDER=openai | anthropic | openai-compatible
AI_API_KEY=…            # server-side only, never exposed to the client
AI_MODEL=…
AI_BASE_URL=…           # defaults to the provider's public API
AI_TIMEOUT_MS=15000
AI_MAX_OUTPUT_TOKENS=500
```

Safeguards: three gates must all be open (module enabled, narrative opted in,
complete config); token estimate is checked against the 30-day budget **before**
the request; hard `AbortController` timeout; bounded output tokens; output is
sanitised (control characters stripped, whitespace collapsed, ≤ 1200 chars) and
rendered as text; provider error bodies are never surfaced; every attempt is
audited (`ai_ceo.narrative` / `ai_ceo.narrative.blocked`) with token counts but
**not** the generated text.

Prompt-injection containment: the digest is serialised inside `<data>…</data>` with
`<`/`>` escaped, and the system prompt states that everything inside is untrusted
data whose instructions must never be followed. Tests assert that hostile supplier
text cannot close the fence and that model output cannot alter a computed figure.

## 8. Scheduled, bounded operation

The AI CEO does **not** add a scheduler. It reuses the existing daily cron
(`/api/cron/jobs`, 17:00 UTC) and the 5-minute GitHub workflow, and the report is
recomputed per request. Bounded behaviours available to the owner:

* `RECORD_REPORT_SNAPSHOT` — persist a digest for day-to-day comparison (≤ 24/day).
* `RUN_JOB_QUEUE` — drain at most 25 due jobs, deduplicated by `dedupeKey`.
* Supplier **dry run** — evaluate without writing; a real sync stays a manual,
  audited admin action.

Nothing here polls indefinitely, spends money, publishes products or sends customer
messages.

## 9. Tests

```
npx vitest run tests/unit/ai-ceo        # 6 files, 72 tests
npm run typecheck:ai-ceo                 # pure layer, no Prisma engines needed
```

Covered: revenue/refund/COD handling, unknown-cost honesty, partial coverage,
sample-size caveats, health thresholds, stale supplier risk, readiness blockers,
recommendation completeness (objective/evidence/confidence/verification), priority
ordering, determinism, tool permission and input validation, PII absence, action
catalogue separation, kill switch, approval refusal, idempotency, daily caps,
provider gating, budget enforcement, timeout/provider failure, output sanitisation
and prompt-injection containment.

Not covered in this environment: database integration for the snapshot adapter and
the dashboard render (Prisma engines are unreachable in the build sandbox; CI runs
`prisma migrate deploy` + `next build` on GitHub Actions).

## 10. Known limitations / owner actions

| Item | Status |
|---|---|
| Model provider | Not configured — deterministic mode only. Provide keys only if you want narration. |
| Live payments | Not configured/test only; the AI CEO can never enable them. |
| Business identity, GSTIN, address | Missing — blocks launch; needs owner input and professional advice. |
| Policies (returns/refunds/shipping) | Owner decision; wording needs professional review. |
| Net profit | Not measurable — fixed overheads are not recorded. |
| Action records | Stored as audit-log rows (`ai_ceo.*`), not a dedicated task table (no migration required). |
| Scheduled AI reports | Not enabled; no cron entry was added on purpose. |
