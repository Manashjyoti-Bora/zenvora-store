# Deployment runbook — Vercel + Neon (owner-chosen path)

Target: ZENVORA live on your domain, PostgreSQL on Neon, app on Vercel.
Follow in order. Nothing here buys anything automatically — every account step is yours.

## 0. Prerequisites
- Repo pushed to GitHub (`zenvora-store`). The v2 zip contains everything; push it (README has the Termux/git commands).
- Accounts: vercel.com (Hobby free tier is enough to start), neon.tech (free tier), dashboard.razorpay.com (later, for keys).

## 1. Neon PostgreSQL
1. Neon → Create project → **region `ap-south-1` (Mumbai)** → note the connection string.
2. You get TWO URLs: **pooled** (`-pooler` host) and **direct**. App runtime uses pooled; migrations use direct.
3. From your PC (repo unzipped, `.env` pointing `DATABASE_URL` at the **direct** URL):
   ```bash
   ./node_modules/.bin/prisma migrate deploy   # creates the schema on Neon
   ```
4. Do **NOT** run `npm run db:seed` against production (the seed also refuses when NODE_ENV=production). Import your real catalog later via Admin → Products → CSV import.

## 2. Vercel project
1. Vercel → Add New → Project → Import `zenvora-store`.
2. Framework: Next.js (auto). Build command stays `npm run build` (it runs `prisma generate` first).
3. Environment variables (Settings → Environment Variables → Production):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** URL + append `?pgbouncer=true&connect_timeout=15` |
| `APP_URL` | `https://your-domain.com` (set final value after step 4) |
| `APP_NAME` | `Zenvora` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | your admin login — strong, unique; NEVER the dev values |
| `SESSION_TTL_DAYS` | e.g. `30` |
| `PASSWORD_RESET_TTL_MINUTES` | e.g. `60` |
| `PAYMENTS_TEST_MODE` | `false` (TEST provider is hard-disabled in production anyway) |
| `SUPPLIER_DEMO_MODE` | `false` |
| `CRON_SECRET` | long random string you generate (e.g. `openssl rand -hex 32`) |
| `SUPPLIER_WEBHOOK_SECRET` | long random string (for inbound supplier webhooks) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | leave unset until you have real keys (payments then honestly report NOT_CONFIGURED; COD still works) |
| `EMAIL_PROVIDER` | `log` until real SMTP exists (then `smtp` + `SMTP_*`) |
| `EMAIL_FROM` | e.g. `Zenvora <noreply@your-domain.com>` (real delivery needs step 7) |

4. Deploy. Then Settings → Domains → add your domain → set the DNS record Vercel shows (A or CNAME) at your registrar → TLS is automatic. Update `APP_URL` to the final https URL and redeploy.

## 3. First verification (do this before anything else)
- `https://your-domain/api/health` → `{"status":"ok", checks.database:true, paymentsProvider:"NONE"|"RAZORPAY", environment:"production"}`
- `/admin` → login with your production admin credentials.
- Unknown product URL → **404**.
- If you rehearsed on this DB earlier and it holds test data: from your PC run
  `DATABASE_URL="<neon-direct-url>" npm run cleanup:demo` (dry run) then `-- --execute`.

## 4. Cron (job safety net)
Orders advance automatically on activity (`kickJobRunner`), but add an external timer:
- **Recommended (free):** cron-job.org → new cron → `POST https://your-domain/api/cron/jobs` every 5 minutes, header `Authorization: Bearer <CRON_SECRET>`.
- Vercel Cron alternative: Hobby plan is limited to daily runs — too sparse; use cron-job.org or Vercel Pro.

## 5. Webhooks (once real services exist)
- Razorpay Dashboard → Webhooks → `https://your-domain/api/payments/webhook`, secret = `RAZORPAY_WEBHOOK_SECRET`, events: `payment.captured`, `payment.failed`, `refund.created`.
- Supplier (if API supplier supports inbound updates): `https://your-domain/api/suppliers/webhook` with header `X-Supplier-Signature` = HMAC-SHA256 hex of the raw body using `SUPPLIER_WEBHOOK_SECRET` (contract: `docs/SUPPLIER_API.md`).

## 6. Vercel-specific honest caveats
- **Uploaded files are ephemeral:** `public/uploads` lives on serverless disk and does NOT survive redeploys. Until object storage is wired (Vercel Blob / S3 / Cloudinary — ask me to implement it), use **external image URLs** (supplier CDN / your Cloudinary) for product images. Seeded demo SVGs are removed by cleanup anyway.
- **Rate limits are in-memory per serverless instance:** protection still works per-instance but is weaker than a single server. For abuse-proof limits on Vercel, add Upstash Redis later (optional, F2).
- **Function timeouts (10s Hobby):** large CSV imports/reprices should be run in chunks; the jobs system is already resumable.

## 7. Before the first real order (launch gate)
Complete SETUP_CHECKLIST.md fully: real email provider verified (a real test email arrives), policies/legal facts entered (Admin → Settings + policy pages), real catalog imported, demo cleanup executed, one real ₹1–10 test order placed end-to-end (payment capture → supplier fulfilment → tracking → emails). Only then is the site **LIVE**; only with the automated supplier loop verified is it **FULLY LIVE AUTOMATED RESELLING** (see FINAL_STATUS.md §1).
