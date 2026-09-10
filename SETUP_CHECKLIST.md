# SETUP_CHECKLIST — what YOU must provide before going live

Everything in this file is **impossible for the codebase to supply for you**:
real accounts, real credentials, legal/business details, and deployment
decisions. Nothing here is optional decoration — items marked 🔴 **block real
money / real orders**; items marked 🟡 block a professional launch but allow
continued development; items marked 🟢 are post-launch improvements.

For every credential the pattern is the same and non-negotiable:

> **Secrets go ONLY into environment variables** (`.env` locally, your host's
> env config in production). Never commit `.env` (it is git-ignored), never
> paste secrets into chat/tickets, never put them in the database or code.
> Where the admin panel asks for a "key env var name" (suppliers), it stores
> only the NAME (e.g. `ACME_API_KEY`) — the value stays in the environment.

---

## 1. Database (🔴 required to run at all)

- **What**: a PostgreSQL 14+ database.
- **Why**: the entire store (products, orders, payments ledger, audit logs)
  lives there.
- **Where to get it**: local install (Devuan/Ubuntu: `apt install postgresql`),
  or managed: Neon, Supabase, Railway, Render, AWS RDS.
- **Where to enter**: `DATABASE_URL` in `.env` —
  `postgresql://USER:PASSWORD@HOST:5432/DBNAME?schema=public`.
  Also set `DIRECT_URL` (non-pooled). Locally it equals `DATABASE_URL`; on
  Neon/Vercel, `DATABASE_URL` = pooled (`-pooler` host, `?pgbouncer=true&connect_timeout=15`)
  and `DIRECT_URL` = direct — the Prisma CLI migrates via `DIRECT_URL`.
- **Secret?** The connection string contains a password → treat as secret.
- **Then run**: `npx prisma migrate deploy` (creates all tables). On Vercel this
  runs automatically during the build — see `docs/DEPLOY_VERCEL_NEON.md`.
- **Without it**: nothing runs.

## 2. Admin account (🔴)

- **What**: your admin login for `/_ → /admin` panel.
- **Where to enter**: `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`
  (password min 8 chars; bcrypt-hashed on seed — never stored in plaintext).
- **Then run**: `npm run db:seed` (creates admin + clearly-marked demo catalog).
- **Secret?** Yes. Change the seeded password immediately after first login
  (login → the password can be rotated via forgot-password flow, or re-run seed
  with a new env value on a fresh database).
- **Without it**: you cannot access the admin panel.

## 3. Razorpay payment gateway (🔴 for real payments)

Until configured, the app runs with the clearly-marked **TEST provider**
(development only — it is _hard-disabled in production builds_, so a
misconfigured production site can never fake a payment success).

| Env var                       | What / where                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RAZORPAY_KEY_ID`             | Razorpay Dashboard → Settings → API Keys → Key Id. Secret? Semi (public-ish id, still keep out of git).                                                                                                                                                                                    |
| `RAZORPAY_KEY_SECRET`         | Same screen → Key Secret. **Secret — server only.**                                                                                                                                                                                                                                        |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Same Key Id, exposed to the browser for Checkout.js (this one is _designed_ to be public).                                                                                                                                                                                                 |
| `RAZORPAY_WEBHOOK_SECRET`     | You generate it: Dashboard → Settings → Webhooks → Add webhook → URL `https://YOUR-DOMAIN/api/payments/webhook`, events: `payment.captured`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`. Set the secret there AND in `.env` (must match exactly). **Secret.** |
| `PAYMENTS_TEST_MODE`          | Keep `true` while using Razorpay **test-mode** keys; set `false` with live keys.                                                                                                                                                                                                           |

- **Where to get the account**: https://dashboard.razorpay.com — requires KYC
  (business proof, PAN, bank account). KYC approval is between you and
  Razorpay; the app cannot proceed through that for you. Test-mode keys are
  available immediately without KYC.
- **Verification flow**: payment signature (HMAC-SHA256) is verified
  server-side on both the return POST and the webhook; card/UPI credentials
  never touch this server (Razorpay Checkout.js handles them).
- **Without it**: you can develop and demo end-to-end with the TEST provider;
  you cannot accept real money.

## 4. Email (SMTP) (🔴 for real orders — customers must receive confirmations)

- **What**: a transactional email sender.
- **Where to get it**: any SMTP provider — Resend, Brevo, Sendgrid, Amazon SES,
  Zoho, your cPanel mail. You need host/port/username/password (or API SMTP
  bridge) and a verified sending domain (DKIM/SPF set at your DNS provider).
- **Where to enter**:

  | Env var                                   | Value                                                                  |
  | ----------------------------------------- | ---------------------------------------------------------------------- |
  | `EMAIL_PROVIDER`                          | `smtp` (default `console` only logs emails server-side — fine for dev) |
  | `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | from your provider (587 + secure=false is typical STARTTLS)            |
  | `SMTP_USER` / `SMTP_PASS`                 | credentials — **secret**                                               |
  | `EMAIL_FROM`                              | e.g. `YourStore <no-reply@yourdomain.in>` (must be a verified address) |
  | `EMAIL_REPLY_TO`                          | optional support inbox                                                 |

- **Without it**: order emails queue as FAILED jobs (visible in Admin → Logs →
  Job queue and System health) — orders still work, customers stay uninformed.

## 5. Real suppliers (🔴 for real fulfilment)

The seeded **Demo Supplier** simulates fulfilment for development only.

- **Manual supplier**: you buy/ship yourself. Add supplier type MANUAL; each
  order creates a supplier-order record; you ship it and record carrier +
  tracking in Admin → Supplier orders → _Mark shipped_.
- **API supplier**: any JSON REST API can be connected **without code changes**
  via supplier type HTTP REST + the endpoint/auth/statusMap JSON config. The
  full contract (what their API must accept/return, idempotency, webhook
  signature) is documented in [`docs/SUPPLIER_API.md`](docs/SUPPLIER_API.md).
  Their API key goes in an env var; Admin stores only the env var NAME.
- **Where to enter**: Admin → Suppliers (+ env vars for credentials).
- **Also set**: `SUPPLIER_WEBHOOK_SECRET` (you generate a random 64-hex string,
  e.g. `openssl rand -hex 32`) and give it to your supplier for signing
  webhooks to `https://YOUR-DOMAIN/api/suppliers/webhook`. **Secret.**
- **Without it**: you can still sell and fulfil everything manually.

## 6. Domain + deployment (🔴 for public launch)

- **What**: a domain and a host that runs Node 18.18+ (Next.js 15).
- **Where**: Vercel (easiest for Next.js), Railway, Render, a VPS
  (`npm run build && npm start` behind nginx/Caddy with HTTPS).
- **Where to enter**: `APP_URL=https://yourdomain.in` in the host's env config
  (used for payment redirects, email links, sitemap/robots).
- **Migrations on deploy**: run `npx prisma migrate deploy` as a release step.
- **Secret?** No (the domain isn't), but the host env holds all secrets above.
- **This repo has NOT been deployed anywhere** — deployment requires your
  accounts/domain, so it is listed here rather than done.

## 7. Job runner cron (🟡 strongly recommended)

Background automation (supplier calls, emails, status polling) runs from a job
queue. Jobs are kicked in-process after enqueue, but a periodic safety net
catches anything missed (restarts, failures):

- Schedule `GET/POST https://YOUR-DOMAIN/api/cron/jobs` every 5 minutes
  (Vercel Cron / cron-job.org / system cron / host scheduler) with header
  `Authorization: Bearer <CRON_SECRET>`.
- `CRON_SECRET`: generate yourself (`openssl rand -hex 32`). **Secret.**
- **Without it**: jobs still run in-process most of the time; retries after
  crashes may stall until the next request kicks the runner.

## 8. Store settings & business details (🟡 before launch)

Admin → Settings:

- Store name/tagline/support email & phone.
- **Business block**: legal name, **GSTIN**, address — printed on invoices.
  These are compliance facts about YOUR business: obtain your GSTIN from the
  GST portal after registering (https://www.gst.gov.in); have a CA/accountant
  verify tax handling (GST rates per product category, tax-inclusive pricing,
  invoice format). The software computes GST-inclusive prices and records
  per-order tax components, but **tax compliance responsibility is yours** —
  nothing here is legal/tax advice.
- Shipping rates, COD toggle + fee, estimated delivery days.
- Policy windows (returns days / cancellation hours) — the policy PAGES
  (`/policies/*`) contain starting-point text that **you must review and adapt**
  to your actual business and Indian consumer-protection law before launch.
- Turn **demoMode OFF** only after: real gateway live, real supplier configured,
  demo catalog replaced, real policies in place.

## 9. Replace demo catalog (🟡 before launch)

`npm run db:seed` creates clearly-marked demo products with generated
placeholder images (labelled "DEMO IMAGE") and a demo supplier. Before launch:

- **Automated:** run `npm run cleanup:demo` (DRY RUN — prints exactly what
  would be deleted), then `npm run cleanup:demo -- --execute`. It removes ALL
  transactional test data, test-domain users, `DEMO-` products, the DEMO
  supplier, the seeded example coupons and demo seed images, and flips
  `demoMode` off — while keeping the admin account, settings, categories and
  any real (non-DEMO) catalog you added. Flags: `--include-real-catalog`,
  `--delete-all-users`, `--keep-demo-files`.
- Or manually: Delete/replace them (Admin → Products, or CSV import in bulk:
  Admin → Products → CSV import — the template columns are documented on that
  page).
- Upload real photos (Admin product editor → upload; files go to
  `public/uploads`).
- Remove seeded example coupons (`WELCOME10`, `DEMOFLAT50`) or adapt them.

## 10. Post-launch hardening (🟢)

- **Backups**: enable automated PostgreSQL backups (host-level or
  `pg_dump` cron). Order/finance/audit data is irreplaceable.
- **Monitoring**: poll `/api/health` (liveness) and watch Admin → System health
  (launch blockers, failed jobs, rejected webhooks, stale queue).
- **Rate limiting** is in-memory per instance; if you scale to multiple
  instances, move it to Redis before relying on it for brute-force protection
  across the fleet.
- **Dependency audits**: `npm run audit:deps` in CI (currently 0 known
  vulnerabilities).
- Rotate `CRON_SECRET`, webhook secrets and SMTP credentials periodically.

---

## Quick local start (everything except live money works out of the box)

```bash
cp .env.example .env        # fill DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD
# createdb resellix (Postgres running locally)
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev                 # http://localhost:3000  (admin: /admin)
```

Default local flow: TEST payment provider + Demo supplier simulate the full
pipeline (payment → supplier order → shipped → delivered → profit finalised),
with DEMO banners everywhere so simulated state is never mistaken for real.

---

## CJ Dropshipping (automated general-product fulfilment) — owner steps

1. Create a free CJ account at cjdropshipping.com (no upfront fee; orders debit a wallet).
2. CJ dashboard → My CJ → Authorization → API → copy the API key.
3. Vercel → Project → Settings → Environment Variables → add `CJ_API_KEY` = (paste here, NEVER
   in chat). Redeploy.
4. Admin → Suppliers → Add supplier → type "CJ Dropshipping" → API key env var name
   `CJ_API_KEY` → Config JSON with your `fxRateInrPerUsd` (e.g. 88.5) and optional
   `logisticName`/`fromCountryCode`.
5. Connect/import products in CJ, then map each Zenvora product's supplier SKU to the CJ vid/SKU
   (Admin → Supplier products).
6. Top up the CJ wallet (CJ dashboard) — orders are debited per forwarded order; unpaid CJ
   orders appear as PENDING in Admin → Supplier orders with the exact reason.
7. Register webhooks (optional but recommended): Admin → supplier → sync, or CJ dashboard
   webhook setting → `https://<your-prod-domain>/api/suppliers/cj/webhook`.
8. Place ONE real prepaid test order to your own address and watch Admin → Supplier orders go
   ACCEPTED → SHIPPED with tracking. Only after that is automated fulfilment "verified live".
Note: CJ has no COD on India lines — COD orders for CJ products require admin confirmation
before forwarding (the UI states this).

---

## Addendum 2026-09-08 (v6)

- New optional configuration: STORAGE_PROVIDER (local|s3|cloudinary) for durable product images —
  see USER_INPUT_REQUIRED.md item B7 and docs/ENVIRONMENT.md. Without it uploads work but are
  ephemeral on Vercel (the admin UI warns).
- New admin capabilities requiring no setup: pricing settings (Admin → Settings → Pricing &
  margin protection), first-order coupons, per-product low-stock thresholds (Admin → Inventory),
  RTO marking (Admin → Orders), auto-pricing on supplier-product mapping (Admin → Supplier
  products — explanation panel appears after mapping).
- Deploying v6: push to GitHub (Vercel auto-deploys; the build applies the additive migrations
  safely) or upload the v6 zip as a deployment. Post-deploy checks: docs/DEPLOYMENT.md.
