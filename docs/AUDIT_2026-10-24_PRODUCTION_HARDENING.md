# Production hardening round — 2026-10-24

Scope: autonomous engineering pass over the real repository (`main@8f4dba2`, the commit that is
live at https://zenvorastore.vercel.app). Every item below was implemented on branch
`arena/eee13c9b-zenvora-store`, covered by tests that were **actually executed**, and verified
against a running server where the behaviour is observable over HTTP. Nothing here is a plan.

Legend — **Completed + tested** · **Verified on a live server (local)** · **Deployed** is reported
separately in the PR / release notes because deployment happens after CI on the merged commit.

## 1. What was audited (and the honest verdict)

| Area | Verdict before this round | Action |
|---|---|---|
| Design identity ("Ink & Cream Editorial Commerce", `ZENVORA_DESIGN_LANGUAGE.md`) | Already original and premium: cream canvas, ink green-black, brass accent, no fake scarcity/reviews/badges. | **Kept.** No redesign; a blind rewrite without browser verification would be a regression risk, not an improvement. |
| Typography | Doc says system stack / zero webfonts; code loaded Inter through `next/font/google` at **build time** (external build dependency, failed offline). | Self-hosted Inter (same approach as the owner's PR #10). |
| Rate limiting | In-memory fixed window → per serverless instance; useless against traffic spread across instances/regions. | Shared PostgreSQL store, atomic upsert, hashed keys, in-memory fallback. |
| Image optimizer | `remotePatterns: hostname '**'` → `/_next/image` was an open fetch proxy. | Explicit allow-list + safe `<RemoteImage>` fallback (never a runtime 500). |
| Publication guards | Cost/price/compare-at guards existed; a product could go ACTIVE with **no image** via the admin form, CSV import or supplier publish (the automated importer already refused that). | ACTIVE requires ≥1 image; supplier publish now carries supplier media. |
| Checkout API | COD orders were confirmed but the response echoed the pre-confirmation `PENDING_PAYMENT`. | Returns the real post-confirmation status. |
| Business readiness | `support@example.com` (shipped default) rendered as a mailto on contact/about/FAQ/privacy and used as the contact-form notification recipient. | Never shown or e-mailed; launch blocker in Admin → System health; no address invented. |
| Dependencies | `npm audit`: new **high** advisory on zod < 4.6.6 (GHSA-mrhx-c7xc-m3w5, no 3.x patch). | Request-body cap (413) before validation; zod 4 migration documented as a follow-up. |
| AI features | None exist; no credentials for any model provider. | **Nothing fabricated.** No "AI" UI was added. See roadmap. |

## 2. Changes (commit by commit)

1. `615ab89` **Shared rate limiter** — `src/lib/rate-limit.ts`, migration
   `20261024210000_rate_limit_buckets`, 20 call sites now `await`, cron purge, docs.
2. `64d899d` + `5302911` **Image host allow-list** — `src/lib/images/remote-hosts.mjs`,
   `<RemoteImage>`, `IMAGE_REMOTE_HOSTS`, `next.config.mjs`. (`5302911` fixes a webpack
   resolution bug found only by running the server: `.mjs` won over `.ts` for the same basename.)
3. `b62e6aa` **Publication guard: image required** — `productInputSchema`, `publish.ts`,
   `auto-import.ts` bulk promotion, admin form inline error, docs.
4. `51255f5` **COD checkout status** — `src/app/api/checkout/route.ts`, e2e assertion.
5. `885dfc6` **Self-hosted Inter** — `@fontsource-variable/inter` (OFL-1.1), `layout.tsx`,
   `globals.css`. Removes the Google Fonts build dependency.
6. `4615535` **Placeholder support e-mail** — `isPlaceholderEmail`, `<SupportContact>`, contact
   API fallback to `ADMIN_EMAIL`, admin health launch blocker.
7. `694ddd0` **Request body cap** — `readJson()` 413 at 1 MB, all `req.json()` call sites,
   `payloadTooLarge()`, SECURITY.md advisory notes.

## 3. Database migration — risk statement

`prisma/migrations/20261024210000_rate_limit_buckets/migration.sql`

- **Additive only**: `CREATE TABLE rate_limit_buckets` + one index. No existing table/column is
  touched; the previous application version keeps working while it is applied.
- **Rollback**: `DROP TABLE "rate_limit_buckets";` (no data of business value; counters rebuild
  within one window). Application code degrades to the in-memory limiter if the table is missing.
- Applied by the existing release pipeline (`scripts/release.ts` → `prisma migrate deploy`) on the
  Production database **only** after the environment-marker guard confirms the database is the
  production branch (flat-brook). Applied locally to an embedded PostgreSQL 18 for all test runs.

## 4. Automations — contract

**Shared rate limiter**
- Trigger: every protected request. Precondition: none (table may be absent).
- Idempotency/atomicity: single `INSERT … ON CONFLICT … RETURNING`; 25 concurrent hits with
  `limit 10` admit exactly 10 (integration test).
- Failure: DB error → in-memory count + one warning per minute; request proceeds. Never 500s.
- Observability: `store: 'database' | 'memory'` on every result; cron reports
  `housekeeping.rateLimitBucketsPurged`.
- Bounded: 64-char hashed keys; expired rows purged daily by `/api/cron/jobs`.

**Contact-form notification**
- Trigger: `POST /api/contact`. Message is always stored. E-mail goes to the configured support
  address, else `ADMIN_EMAIL`, else nothing is queued (warning logged) — no bounce loop.

## 5. Tests — executed, with results

Local environment: embedded PostgreSQL 18, Prisma client generated from the repo schema,
Node 22. CI runs the same suites on Node 24 + `postgres:16` (results in the PR checks).

| Suite | Command | Result (local, 2026-10-24) |
|---|---|---|
| Typecheck | `npm run typecheck` | pass |
| Lint | `npm run lint` | 0 errors (78 pre-existing `no-console` warnings in scripts, unchanged) |
| Unit + integration | `npx vitest run` | **42 files, 404 tests passed** (baseline before this round: 39 files, 382) |
| E2E over HTTP | `npm run test:e2e` against `next dev -p 3100` + seeded demo catalog | **5 files, 68 tests passed** |
| Production build | `next build` (offline sandbox) | pass; shared JS 103 kB (design budget ≤105 kB) |
| Production server smoke | `next start` | `/`, `/shop`, `/products/[slug]`, `/track`, `/faq`, `/policies/privacy`, `/sitemap.xml`, `/api/health` → 200; `/admin` → login redirect; CSP/HSTS/XFO/nosniff/Referrer/Permissions headers present |

New regression tests (22): `tests/unit/rate-limit.test.ts` (6), `tests/integration/rate-limit-shared.test.ts` (7),
`tests/unit/image-remote-hosts.test.ts` (7), `tests/unit/read-json-limit.test.ts` (4),
`tests/unit/validation.test.ts` (+1), `tests/integration/supplier-product-publication.test.ts` (+1),
`tests/unit/utils.test.ts` (+1), `tests/e2e/shopping-checkout.test.ts` (COD status assertion).

Live HTTP checks performed against the local server (not inferred):
- 19 hashed rate-limit buckets (64-char keys) created by the e2e traffic; max 17 hits on one key.
- `/_next/image?url=https://example.com/x.png` → **400 "url" parameter is not allowed**;
  allow-listed host passes the check; local upload passes.
- `POST /api/contact` with a 1.2 MB JSON array → **413 PAYLOAD_TOO_LARGE**; normal body → 400 validation.
- `/contact` HTML no longer contains `example.com`; privacy policy links to `/contact`.

## 6. Not implemented (deliberately) and why

- **AI features** (search, descriptions, support): no provider credentials exist; shipping a UI
  that cannot work, or fabricating model output, is excluded by the brief. Roadmap below.
- **Category required for ACTIVE**: a merchandising decision (the automated importer publishes
  into unmatched categories by design). Left as-is; flagged for the owner.
- **zod 4 upgrade**: breaking (`.default()` semantics, error params) across ~40 schemas; needs its
  own reviewed PR. The advisory is mitigated by the body cap + `.max()` on public arrays.
- **Tailwind 4**: dev-only moderate advisory; major migration; not shipped to browsers.
- **Visual redesign / new components**: no browser or screenshot capability in this environment;
  design changes were limited to ones verifiable in HTML/CSS output (font delivery).

## 7. Owner inputs still required (exact steps)

1. **Support e-mail** — Admin → Settings → Store → *Support e-mail*: a real mailbox. Until then
   public pages link to the contact form and Admin → System health shows a launch blocker.
2. **Legal identity** — Admin → Settings → Business: legal name, address, GSTIN (policies render
   "to be appointed by the store owner" until set). Not invented.
3. **Razorpay** (when ready for real payments) — Vercel → Settings → Environment Variables →
   Production: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
   `NEXT_PUBLIC_RAZORPAY_KEY_ID`; then set `PAYMENTS_TEST_MODE=false`. Requires explicit go-ahead;
   this round did not touch payment configuration.
4. **Image hosts** — if product media is served from a CDN other than CJ / Cloudinary / S3, set
   `IMAGE_REMOTE_HOSTS` (comma-separated) in Vercel → Production and redeploy (build-time value).
5. **Persistent uploads** — set `STORAGE_PROVIDER=s3|cloudinary` + credentials (Vercel disk is
   ephemeral). Unchanged from previous reports.
6. **Catalogue** — production has 0 ACTIVE products; publishing is an owner decision (demo
   fixtures stay in dev/test only). New rule: each published product needs ≥1 image.

## 8. Roadmap (next rounds, in value order)

1. zod 4 migration PR (closes the high advisory at the source).
2. Nonce-based CSP (drop `'unsafe-inline'` for scripts) via middleware.
3. Measured accessibility pass with a real browser (axe + keyboard walk) — the design doc targets
   WCAG 2.2 AA but no measurement exists in-repo; do not claim it until measured.
4. AI assist **behind credentials and a feature flag**: supplier-description rewriting with
   mandatory human approval (never auto-publish), and search synonym expansion. Disabled state is
   the default; no UI until a provider key exists.
5. Owner-side: resolve PR #10 (merge `origin/main` into it; the font hunk is now identical).
