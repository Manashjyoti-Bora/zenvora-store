# Zenvora — Roadmap

Status legend: ✅ done & tested · 🔄 in progress · ⏳ planned · ⛔ blocked on owner input.
Readiness labels used across docs: DEVELOPMENT · DEMO MODE · BLOCKED — OWNER INPUT REQUIRED ·
READY FOR CONTROLLED TESTING · READY FOR OWNER LAUNCH APPROVAL · LIVE — VERIFIED WITH EVIDENCE.

**Current overall state (2026-10-25): DEMO MODE / BLOCKED — OWNER INPUT REQUIRED.**
The platform is deployed and healthy (`main@ac8041e`, `dpl_43tGG1T69VmnwyTEv6AjzEoXYq9z`) but has
0 published products, no real support mailbox, no legal identity, and no payment provider.

## Baseline (verified on `ac8041e`)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | 0 errors / 78 pre-existing `no-console` warnings in scripts |
| `npx vitest run` | 42 files / 405 tests pass (local embedded PostgreSQL 18; CI postgres:16) |
| `npm run test:e2e` | 5 files / 68 tests pass (CI run 40137989359) |
| Production build | shared First Load JS 103 kB (budget ≤105 kB) |
| `/api/health` (prod) | ok · database true · payments NONE · email smtp · environment production |
| Lighthouse / field CWV | **not measured yet** — Speed Insights `hasData:false` |

## Phase plan

### Phase 1 — Documentation & baseline ✅
`docs/ARCHITECTURE.md`, `docs/AUTONOMOUS_OPERATIONS.md`, this file.

### Phase 2 — Security & correctness regression tests ✅
Customer data isolation (orders/addresses/profile across users), price change and stock change
between cart and checkout, duplicate order submission, payment-webhook replay, oversized bodies,
unsafe image URLs (scheme/host/private-network). Success = each test fails if the guard is removed.

### Phase 3 — Search & discovery ✅
Debounced input, `AbortController` cancellation of stale requests, URL-synced filters/sort
(shareable), no-result suggestions built from **real** active categories/products, loading/error/
empty states. No invented suggestions.

### Phase 4 — Premium design tokens, Liquid-Glass surfaces, motion ✅ (code) / visual QA pending
Palette: Obsidian `#101114`, Pearl `#F7F6F2`, Champagne `#C6A56B`, Electric Violet `#7965F2`,
Sage `#DDEDE4`; semantic text/border/success/error. Glass restricted to header/search overlay,
drawers, dialogs, toasts, filter panel — never product media, prices, checkout forms, admin tables.
Motion tokens (120–240 ms micro, ≤320 ms overlays), `prefers-reduced-motion` honoured, transform/
opacity only. Measured: bundle delta, CLS on key pages, no `backdrop-filter` on scrolling lists.

### Phase 5 — Supplier intelligence (improve `auto-import.ts`, do not duplicate) ✅ (no migration)
- Lifecycle state (DISCOVERED … REJECTED) is **derived** from existing columns by
  `src/lib/catalog/lifecycle.ts` — no schema change was needed, so none was shipped. `SCHEDULED`
  stays reserved/unreachable until a `publishAt` column and job type exist.
- Explainable score already existed in `ranking.ts`; added owner-configurable safeguards
  (demand-evidence gate for auto-publish, verified sample size, min score, stale window).
- Contribution model (`contribution-margin.ts`): each line labelled SUPPLIED / CONFIGURED / ESTIMATE
  / UNKNOWN; realised margin deferred (needs supplier invoices + return outcomes).
- Dry-run endpoint with zero writes; freshness shown on every row; rejection reasons unchanged
  (already persisted in `raw.importState`).
- Auto-publish stays **off** (`autoPublishEligible=false`) until the policy in
  `AUTONOMOUS_OPERATIONS.md` §3 is satisfied by the owner.

### Phase 6 — Admin operations dashboard ✅
`/admin/operations`: environment and switch posture (auto-publish, live supplier ordering, payments,
AI), derived lifecycle counts, per-supplier last sync, job queue / webhook / rate-limit / 24 h order
counts, permission levels 0–4 (`src/lib/auth/permissions.ts`). Not yet: contact inbox and
notification-failure panels (System health already covers notifications).

### Phase 7 — AI ⛔ (deliberately disabled)
`src/lib/ai/provider.ts` reports `enabled:false`; only deterministic helpers exist. Enabling requires
an owner-chosen provider, budget, and the policy in `AUTONOMOUS_OPERATIONS.md` §4.

### Phase 8 — Controlled verification ⏳
Full test run, diff review, migration review, Production/Preview isolation check, PR, CI green on
the exact commit, deploy via the existing pipeline, post-deploy smoke, rollback target recorded.

## Owner inputs required (unchanged)

1. Real support mailbox (Admin → Settings → Store).
2. Legal name, address, GSTIN, grievance officer (Admin → Settings → Business).
3. Razorpay keys in Vercel → Production + explicit go-ahead for live payments.
4. Decision on catalogue: run CJ diagnostics in production, review dry-run, then enable auto-publish or publish manually.
5. Persistent storage provider (S3/Cloudinary) credentials.

## Deferred / not planned without evidence

- zod 4 migration (closes GHSA-mrhx-c7xc-m3w5 at the source) — own PR.
- Review system — only with verified-purchase gating and moderation; not before real orders exist.
- Nonce-based CSP (drop `'unsafe-inline'`).
- More frequent cron — requires plan change or external scheduler; document cost first.
