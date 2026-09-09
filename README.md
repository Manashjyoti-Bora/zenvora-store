# ZENVORA — automated reselling / dropshipping store (India, ₹ INR)

> Store brand: **Zenvora** (set via `APP_NAME` / Admin → Settings). Internal code identifiers (package name, `resellix_*` cookie names, `RX-` order prefix) remain `resellix` — cosmetic only; see USER_INPUT_REQUIRED.md §E.

A complete, production-oriented e-commerce platform for the reselling/dropshipping
business model: **supplier cost → your price/margin → customer pays via gateway →
order auto-sent to supplier → supplier ships → tracking to customer → real profit
accounting in the admin panel.**

Built for the Indian market: INR pricing (integer paise arithmetic), GST-inclusive
tax model, Razorpay payments, Indian PIN/address validation, Indian order-number
format, mobile-first UI.

> **Honesty rules this codebase follows**
>
> - No fake functionality: every button is wired to a real server implementation.
> - No invented credentials, orders, reviews or statistics anywhere.
> - Simulated flows (TEST payments, Demo supplier) exist **only** for development,
>   are hard-disabled in production builds, and are visibly labelled "DEMO/TEST".
> - **Gross margin is never presented as profit.** "Actual profit" is a per-order
>   ledger figure: net revenue − supplier cost − shipping paid − gateway fees −
>   other costs − refunds, finalised only on delivery/refund; until then it is
>   explicitly flagged _(est.)_.

---

## Implementation status (as shipped in this repo)

### A. Fully implemented & verified (typecheck, lint, 134 unit+integration tests, 62 HTTP-level E2E tests, production build)

- **Storefront (21+ pages)**: home, shop (filters/sort/pagination), product
  (variants, GST-inclusive pricing, stock states), category, search, cart,
  checkout (address validation, coupon, COD or prepaid), payment page, order
  confirmation, public order tracking, about, contact (stored + admin inbox),
  FAQ, 4 policy pages, cookie preferences, login/register/forgot/reset,
  customer account (dashboard, profile, addresses, orders, self-service
  cancel/return within policy windows), sitemap/robots/OG metadata, 404/500 pages.
- **Admin panel (~30 sections)**: dashboard with alerts; analytics (revenue,
  costs, gross margin vs **actual profit**, daily trends, top products/customers,
  coupon usage, refunds/returns, CSV exports); products CRUD + variants + images
  upload + CSV import + bulk reprice; categories; coupons; pricing rules
  (GLOBAL/SUPPLIER/CATEGORY/PRODUCT precedence); suppliers (MANUAL / HTTP_REST /
  DEMO) + catalog sync + product mapping; supplier orders (retry / mark shipped);
  orders (status actions, cost adjustments, COD collected, refunds, shipment
  updates); payments ledger (fees, estimated-vs-actual); refunds (gateway-auto +
  manual settle); returns workflow (approve/reject/receive/close → auto refund);
  shipments; customers; inventory (quick stock edits, publish/unpublish);
  messages; settings (store, business/GSTIN, shipping, tax, policies, social);
  users & roles (CUSTOMER/STAFF/ADMIN, self-demotion + last-admin lockout
  protection); logs (job queue, webhook log, append-only audit log); system
  health page (DB latency, gateway/email/queue/webhook/supplier status, launch
  blockers, env presence check — never values).
- **Pricing engine**: FIXED_PRICE / FIXED_MARGIN / PERCENT_MARKUP (markup on
  landed cost — deliberately distinct from margin%), min-profit floor, rounding
  rules (none / round-up-₹10 / nearest-₹9 / nearest-₹99), GST extraction from
  tax-inclusive prices, gateway-fee estimate, admin preview API + bulk reprice
  with dry-run.
- **Order pipeline & state machine**: PENDING_PAYMENT → PAYMENT_VERIFIED →
  ORDER_CONFIRMED → SENT_TO_SUPPLIER → SUPPLIER_ACCEPTED → PROCESSING → SHIPPED
  → OUT_FOR_DELIVERY → DELIVERED (+ PAYMENT_FAILED, CANCELLED,
  FULFILMENT_FAILED, REFUND_PENDING, REFUNDED, RETURN_REQUESTED, RETURNED),
  validated transitions, optimistic concurrency, full event audit trail,
  frozen price/cost snapshots per line, `RX-YYMMDD-XXXXXX` order numbers.
- **Automation**: PostgreSQL-backed job queue (SKIP LOCKED, dedupe keys,
  backoff retries, max attempts) driving supplier fulfilment, status sync,
  cancellations and notification emails; in-process kick + authenticated cron
  endpoint (`/api/cron/jobs`).
- **Payments**: Razorpay via official SDK (order creation → Checkout.js →
  server-side signature verification → webhook with HMAC verification and
  idempotent event processing); refunds full/partial via gateway API; COD with
  fee handling and admin "cash collected" settlement; TEST provider for dev
  (clearly labelled, production-disabled); every attempt/fee/refund persisted.
  No card data ever touches this server.
- **Supplier layer**: adapter abstraction (see `docs/SUPPLIER_API.md`), generic
  HTTP-REST adapter configurable per supplier via JSON (auth styles, endpoint
  paths, response field mapping, status mapping), signed supplier webhooks
  (HMAC over raw body, idempotent), manual fulfilment workflow, DEMO simulator
  for end-to-end development.
- **Notifications**: templated transactional emails (order confirmation,
  shipping, delivery, cancellation, refunds, returns, password reset, welcome),
  frozen-rendered at queue time, provider-pluggable (console / SMTP-nodemailer),
  delivered through the job queue with dedupe windows and failure visibility.
- **Security**: bcrypt password hashing; DB-backed sessions with rotation &
  revocation; double-submit CSRF on all mutations; per-route rate limiting
  (auth, checkout, contact, webhooks); zod validation on every input;
  server-side authz (role guards, IDOR-safe ownership checks, guest order access
  via order-number+email); price manipulation impossible (all totals recomputed
  server-side from DB); coupon abuse guards (usage/per-user limits, atomic
  redemption); webhook signature verification (payment + supplier); secure
  headers & CSP (next.config.mjs); sanitized logs (secrets redacted) + hashed
  IPs in audit log; npm audit clean (0 vulnerabilities) with pinned overrides.
- **Tests**: 134 unit + integration tests (vitest) covering money math, pricing
  engine (incl. markup≠margin, rounding, floors), validation, order state
  machine, auth (register/login/disable/password-reset single-use tokens),
  rate limiting, settings, cart (stock guards), checkout (idempotency, coupons,
  COD, guest), finance engine (actual profit incl. fees/costs/refunds,
  finalisation rules), job queue (dedupe, delivery, failure bookkeeping).

### B. Integration-ready (code complete, needs your accounts/config to go live)

- Razorpay live payments + webhooks (works today with test-mode keys).
- SMTP email delivery (works today with console provider for dev).
- Real HTTP-REST suppliers (config-driven; contract in `docs/SUPPLIER_API.md`).
- Cron-driven job runner safety net (`/api/cron/jobs`).

### C. Requires action from you (cannot be coded for you)

See **[SETUP_CHECKLIST.md](SETUP_CHECKLIST.md)** — database, admin account,
Razorpay account/KYC/keys/webhook, SMTP credentials, real supplier onboarding,
domain + deployment, GSTIN/legal review, replacing demo catalog, turning
demoMode off.

### D. Not possible from this environment

- Deploying to your domain (needs your host/accounts).
- Razorpay KYC, business GST registration, legal review of policy pages —
  these are between you, your CA/lawyer and the providers. **Nothing in this
  repo is legal or tax advice.**
- Anything requiring your third-party accounts: Razorpay KYC/keys, CJ wallet
  funding, SMTP credentials, S3/Cloudinary credentials — exact list in
  `USER_INPUT_REQUIRED.md` and `docs/ENVIRONMENT.md`.

---

## Tech stack

Next.js 15 (App Router, TypeScript strict) · React 19 · Tailwind CSS ·
Prisma 6 + PostgreSQL · zod · bcryptjs · Razorpay SDK · nodemailer · vitest ·
ESLint 9 (flat) + Prettier.

Money is handled as **integer paise** everywhere; `Decimal(14,2)` only at the DB
boundary. Prices are GST-inclusive (Indian B2C convention); the tax component is
computed and stored per order line.

## Getting started (local)

Requirements: Node 18.18+ (20 recommended), PostgreSQL 14+.

```bash
cp .env.example .env
# edit .env → DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD (minimum)
createdb resellix                       # or use a managed DB
npm install
npx prisma migrate deploy
npm run db:seed                         # admin user + clearly-marked demo catalog
npm run dev                             # http://localhost:3000 (admin at /admin)
```

Demo end-to-end flow with zero external accounts: browse → add to cart →
checkout (TEST provider / COD) → payment simulation → supplier order to the
Demo supplier → shipped/delivered → profit finalised — all visibly marked DEMO.

### Scripts

| Script                                         | Purpose                                                        |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `npm run dev` / `build` / `start`              | develop / production build / serve                             |
| `npm run db:migrate` / `db:deploy` / `db:seed` | Prisma migrations & demo seed                                  |
| `npm test` / `test:unit` / `test:integration`  | vitest suites (integration needs the test DB from `.env.test`) |
| `npm run test:e2e`                             | 62 E2E specs over real HTTP — start `npm run dev -- --turbopack -p 3100` first (`.env.test` points E2E at :3100); needs the seeded dev DB |
| `npm run cleanup:demo`                         | pre-launch demo-data cleanup — DRY RUN by default; add `-- --execute` to apply |
| `npm run typecheck` / `lint` / `format`        | quality gates                                                  |
| `npm run audit:deps`                           | dependency vulnerability audit                                 |
| `npm run verify`                               | typecheck + lint + test + build (CI gate)                      |

## Repository map

```
prisma/            schema + migrations + demo seed (guarded against production)
src/lib/           all business logic (framework-agnostic, unit-testable)
  pricing/         pricing engine + rule resolution
  checkout/        totals, shipping, coupon evaluation
  orders/          creation, state machine, finance (actual profit), returns
  payments/        Razorpay adapter, TEST adapter, verification, webhooks, refunds
  suppliers/       adapter abstraction, HTTP-REST adapter, DEMO simulator, webhooks
  jobs/            queue (dedupe/backoff) + runner
  notifications/   templates + providers (console/SMTP)
  auth/            password, sessions, guards
  admin/reports.ts analytics aggregations
src/app/           Next.js routes: storefront pages, /admin panel, /api endpoints
src/components/    UI (storefront, admin, shared primitives)
tests/unit|integration   vitest suites (191 tests)
tests/e2e/               62 HTTP-level E2E specs (real dev server + real DB)
scripts/production-cleanup.ts  pre-launch demo-data cleanup (dry-run default)
docs/PRICING_ENGINE.md   pricing engine + margin protection (start here for money logic)
docs/AUTOMATION.md       what is automated vs needs configuration (5-label map)
docs/ENVIRONMENT.md      every env var: required?, secret?, where to get it
docs/SECURITY.md         security posture + verified controls
docs/SUPPLIER_SETUP.md   CJ / manual / HTTP-REST supplier onboarding
docs/PAYMENT_SETUP.md    Razorpay + COD + refunds
docs/DEPLOYMENT.md       Vercel + Neon deploy + post-deploy checks
docs/TROUBLESHOOTING.md  symptom → cause → fix
docs/SUPPLIER_API.md     supplier integration contract
SETUP_CHECKLIST.md       everything you must provide before launch
PROJECT_STATUS.md        audit: what was run and verified (feature-by-feature)
USER_INPUT_REQUIRED.md   exactly what the owner must provide (blockers A–F)
FINAL_STATUS.md          final status in the required vocabulary (CODE/TEST/DEPLOYMENT READY, not LIVE)
```

## Compliance notes (not legal advice)

- GST: register if/when required, enter your real GSTIN in Admin → Settings,
  have a CA validate rates per product category and your invoice format.
- Policy pages (returns, shipping, terms, privacy) are starting-point templates —
  review and adapt them to your business and current Indian consumer-protection
  and e-commerce rules before accepting orders.
- KYC (Razorpay, supplier agreements, business registration) is between you and
  those providers.

## License / authorship

Private project scaffold — all code in this repository was written for this
project. Third-party dependencies remain under their own licenses.
