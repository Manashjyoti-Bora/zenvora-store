# Deployment runbook — Vercel + Neon (owner-chosen path)

Target: ZENVORA live on your domain, PostgreSQL on Neon, app on Vercel.
**Designed so you never need to run database commands from your phone:** the
Vercel build itself runs `prisma migrate deploy` (schema) and
`scripts/create-admin.ts` (admin login) — both idempotent.

Nothing is "done" until its verification gate passes. Do the steps in order.

---

## Step 1 — Neon PostgreSQL

1. neon.tech → Sign up (GitHub login is fastest) → **Create a project**.
2. Project name: `zenvora` · Database name: `zenvora` (or `neondb`) ·
   **Region: Asia Pacific (Mumbai) `ap-south-1`** · keep the default role
   (e.g. `neondb_owner`) and let Neon generate the password (or set a strong one).
3. On the project dashboard, open **Connect** (or Connection Details). You will
   copy TWO strings — never paste them into any chat:
   - **Pooled connection string** (host contains `-pooler`) → becomes Vercel's `DATABASE_URL` **with `?pgbouncer=true&connect_timeout=15` appended** (replace/extend the existing query part; keep `schema=public` if present).
   - **Direct connection string** (same, without `-pooler`) → becomes Vercel's `DIRECT_URL`.
4. Leave the Neon project otherwise untouched (no tables needed — the build creates them).

**Verification gate 1:** you can see both connection strings in the Neon console, region shows Mumbai. ✅ only then continue.

## Step 2 — Vercel project

1. vercel.com → Sign up (GitHub) → **Add New… → Project** → import `Manashjyoti-Bora/zenvora-store` (main branch).
2. Framework Preset: **Next.js** (auto-detected). Do NOT override the build command —
   package.json already runs: `prisma generate && prisma migrate deploy && tsx scripts/create-admin.ts && next build`.
3. Before clicking Deploy, open **Environment Variables** and add (Production
   column; values from Step 1 and your own choices — secrets stay on Vercel, never in chat):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** string + `?pgbouncer=true&connect_timeout=15` |
| `DIRECT_URL` | Neon **direct** string (used by migrations at build time) |
| `APP_URL` | `https://<your-vercel-url>` for now; change to your real domain at Step 4 |
| `APP_NAME` | `Zenvora` |
| `ADMIN_EMAIL` | your admin login email (real one you control) |
| `ADMIN_PASSWORD` | strong unique password you keep in a password manager — NOT the dev one |
| `SESSION_TTL_DAYS` | `30` |
| `PASSWORD_RESET_TTL_MINUTES` | `60` |
| `PAYMENTS_TEST_MODE` | `false` (TEST provider is hard-disabled in production anyway) |
| `SUPPLIER_DEMO_MODE` | `false` (production refuses the demo supplier by design) |
| `CRON_SECRET` | long random string — generate in Termux: `openssl rand -hex 32` |
| `SUPPLIER_WEBHOOK_SECRET` | another long random string (`openssl rand -hex 32`) |
| `EMAIL_PROVIDER` | `console` (emails are logged, not sent, until real SMTP exists — honest default) |
| `EMAIL_FROM` | `Zenvora <no-reply@your-domain>` (cosmetic until SMTP) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `NEXT_PUBLIC_RAZORPAY_KEY_ID` | leave UNSET until you have real keys — the store then honestly reports `PAYMENTS_NOT_CONFIGURED` for prepaid; COD works |

4. **Deploy.**

**Verification gate 2 (build log — check each line):**
- `prisma migrate deploy` prints the applied migrations (first deploy: `2 migrations found`… `applied`), no errors.
- `[create-admin] created admin user <your email>` (first deploy) — or `already exists` on redeploys.
- `✓ Compiled successfully` and the route list, ending with your deployment URL.

## Step 3 — First verification on the live URL (before domain, before data)

1. `https://<project>.vercel.app/api/health` →
   `{"status":"ok", checks:{ database:true, paymentsProvider:"NONE", paymentsTestMode:false, environment:"production" }}`
   (`database:true` proves the Vercel↔Neon connection; `NONE` is honest — no Razorpay keys yet.)
2. `https://<project>.vercel.app/admin` → redirects to login → log in with your `ADMIN_EMAIL`/`ADMIN_PASSWORD`. You should see the admin dashboard with an EMPTY catalog (no demo data is seeded in production — by design).
3. Unknown product URL (e.g. `/products/xyz`) → **404**.
4. Storefront pages render (empty catalog states, no demo banner since `demoMode` is off by default in a fresh settings row — verify in Admin → Settings).

**Verification gate 3:** all four observations match. If health shows `database:false`, recheck `DATABASE_URL`/`DIRECT_URL` (pooled vs direct, `pgbouncer=true` suffix) and redeploy.

## Step 4 — Domain + HTTPS

1. Vercel → Project → **Settings → Domains** → add your domain → Vercel shows the exact DNS record (A `76.76.21.21` or CNAME `cname.vercel-dns.com`) → add it at your registrar → wait for propagation.
2. TLS certificate is issued automatically (Let's Encrypt).
3. Update `APP_URL` env var to `https://your-domain.com` and redeploy (emails, sitemap, canonical URLs, webhook base use it).

**Verification gate 4:** `https://your-domain/api/health` returns the same ok payload; padlock icon valid.

## Step 5 — Cron (job safety net)

Orders advance automatically on activity, but add an external timer so retries/notifications never stall:
- cron-job.org (free) → new job → `POST https://your-domain/api/cron/jobs`, every 5 minutes, header `Authorization: Bearer <CRON_SECRET>`.
- Vercel Cron on the Hobby plan only allows daily runs — too sparse; use cron-job.org (or upgrade later).

**Verification gate 5:** cron-job.org run history shows HTTP **200** responses. (Anonymous calls must return 401 — that is already E2E-tested.)

## Step 6 — Real services (each unlocks one honest capability)

- **Razorpay** (when your account + keys exist): add the four `RAZORPAY_*` vars (test keys first, KYC → live keys), then Razorpay Dashboard → Webhooks → `https://your-domain/api/payments/webhook`, secret = `RAZORPAY_WEBHOOK_SECRET`, events `payment.captured`, `payment.failed`, `refund.created`. Verify: health shows `paymentsProvider:"RAZORPAY"`; place a ₹1–10 real test order.
- **Supplier** (per `docs/SUPPLIER_OPTIONS.md` decision): MANUAL works immediately (Admin → Supplier Orders). For an API supplier, its webhook (if any) goes to `https://your-domain/api/suppliers/webhook` with `X-Supplier-Signature` HMAC (contract: `docs/SUPPLIER_API.md`); credentials via the supplier record's `apiKeyEnvVar` names in Vercel env.
- **Email**: switch `EMAIL_PROVIDER=smtp` + `SMTP_HOST/PORT/USER/PASS` (Resend/Brevo/SES/Zoho). Verify a real password-reset email arrives before taking orders.

## Step 7 — Catalog + launch gate

1. Import your real products: Admin → Products → CSV import (template documented on that page). Use **external image URLs** (supplier CDN/your image host) — see caveats below.
2. Set business facts: Admin → Settings (support email/phone, shipping fees, COD toggle/fee, policies pages content; legal name/GSTIN per your accountant — no tax guarantees from this tool).
3. If you ever rehearsed with test data on the production DB: from a PC run
   `DATABASE_URL="<neon-direct-url>" DIRECT_URL="<same>" npm run cleanup:demo` (dry run) → `-- --execute`.
4. Place one real end-to-end order (payment capture → supplier fulfilment → tracking → emails). Only then is the site **LIVE**; with the automated supplier loop verified it becomes **FULLY LIVE AUTOMATED RESELLING** (vocabulary: FINAL_STATUS.md §1).

## Vercel-specific honest caveats

- **Uploaded files are ephemeral:** `public/uploads` does NOT survive redeploys on serverless. Use external image URLs for products until object storage (Vercel Blob/S3/Cloudinary) is wired — ask and I'll implement the adapter.
- **Rate limits are in-memory per serverless instance:** still effective per instance, weaker globally. For abuse-proof limits add Upstash Redis later (optional).
- **Function timeout (10s Hobby):** run bulk CSV imports in chunks; the job system is resumable.
- **Scale-to-zero (Neon free tier):** the first request after idle can take a few seconds while the DB wakes — normal.
