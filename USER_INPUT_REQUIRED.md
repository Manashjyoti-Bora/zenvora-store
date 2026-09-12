# USER INPUT REQUIRED — consolidated (2026-09-05, post-audit)

Legend: 🔴 launch blocker · 🟠 required for automated reselling · 🟡 required before public
marketing/traffic · ⚪ optional. "Where" = exactly where to enter it. NEVER paste secrets
into chat; secrets go directly into Vercel → Project → Settings → Environment Variables.

## 🔴 B1 — Vercel deployment is DISABLED (HTTP 402 DEPLOYMENT_DISABLED)
- What: https://zenvora-store.vercel.app returns 402 "Payment required", header
  `x-vercel-error: DEPLOYMENT_DISABLED`. The build succeeded but Vercel is not serving it.
- Why: account/plan level (missing payment method, plan limit, or verification banner).
  Only visible/clearable in your Vercel dashboard.
- Where: Vercel dashboard → this project (and account billing page) → follow the banner
  (add payment method / upgrade / verify). Then redeploy or wait for auto-restore.
- Verify after: `GET https://zenvora-store.vercel.app/api/health` must return 200 JSON.

## 🔴 B2 — Push the v4 code (Razorpay key guard + audit fixes)
- What: zip `zenvora-store-v4.zip` (this workspace) supersedes v3.
- Where: Termux: unzip -o over your repo clone → `git add -A` → commit → push origin main.
- Verify: GitHub Actions "CI" green; then Vercel redeploy green.

## 🔴 B3 — APP_URL must equal the real production URL
- What/where: Vercel env `APP_URL=https://zenvorastore.vercel.app` (or your custom domain),
  then redeploy. Used for emails, sitemap, robots, OG URLs, canonical tags.
- ⚠️ CORRECTION (launch-ops audit, 2026-09-12): earlier revisions of this file said
  `zenvora-store.vercel.app` (hyphenated). That host is NOT the served project — it returns
  402 DEPLOYMENT_DISABLED (see B1). The real production host is `zenvorastore.vercel.app`
  (no hyphen). If your Vercel env still contains the hyphenated value, fix it and redeploy:
  canonical/OG/sitemap/robots currently point at the dead host.

## 🟠 B4 — Razorpay decision (prepaid payments)
- Choose: (a) launch COD-only first (nothing to enter), or (b) enable prepaid.
- If (b): create keys in Razorpay dashboard; enter in Vercel env:
  `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`,
  `RAZORPAY_WEBHOOK_SECRET`; add webhook URL `https://<prod>/api/payments/webhook`
  (events: payment.captured, payment.failed, refund.*) in Razorpay dashboard.
- Rule now enforced by code: production accepts ONLY `rzp_live_…` keys; test keys work only
  outside production. Set `PAYMENTS_TEST_MODE=false` in Vercel once live keys are in.

## 🟠 B5 — CJ Dropshipping account + key (required for AUTOMATED reselling)
- Code is implemented & mock-verified (supplier type `CJ`, API v2 adapter, trigger-only
  webhooks, admin UI, 18 dedicated tests). LIVE verification needs your account:
  1. Create free CJ account (cjdropshipping.com).
  2. CJ dashboard → My CJ → Authorization → API → copy API key.
  3. Vercel env: add `CJ_API_KEY` (paste THERE, never in chat) → redeploy.
  4. Admin → Suppliers → add type "CJ Dropshipping", env var name `CJ_API_KEY`,
     config JSON with `fxRateInrPerUsd` (your INR-per-USD rate).
  5. Map products (CJ vid/SKU), top up CJ wallet, register webhook URL
     `https://<prod>/api/suppliers/cj/webhook`.
  6. Place one real prepaid order to your own address; I verify ACCEPTED→SHIPPED+tracking.
- Honest limits: no COD on CJ India lines (COD needs admin confirm before forwarding);
  7–15 day CN→IN shipping; duty/GST is importer responsibility; cancels/returns manual.
- Without this: store still launches with COD + MANUAL fulfilment queue, honestly labelled.

## 🟠 B6 — Real email provider (console = logs only, not delivery)
- Choose one supported path: SMTP (Brevo free ~300/day, Resend, Amazon SES, Zoho, self-host).
- Enter in Vercel env: `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
  `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (verified sender/domain), optional `EMAIL_REPLY_TO`.

## 🔴/ B7 — Product image storage decision
- Uploads persist on server disk = ephemeral on Vercel (lost on redeploy). Admin UI now warns.
- Choose: (a) use external image URLs / re-upload after deploys (zero cost), or
  (b) object storage (Cloudflare R2 free 10 GB / any S3 / Cloudinary) — I then implement the
  storage adapter + tests. If you already uploaded images via Admin, this is launch-relevant.

## 🟡 B8 — External cron service (reliability of retries + housekeeping)
- Spec: `POST https://<prod>/api/cron/jobs`, header `Authorization: Bearer <CRON_SECRET>`
  (already in Vercel env), schedule every 5 minutes.
- Where: cron-job.org (free) or GitHub Actions schedule — create the job yourself; the secret
  stays in Vercel/your job config, never in chat. (In-process job kicking already covers the
  happy path; cron covers retries after crashes/scale-to-zero.)

## 🟡 B9 — Store facts for policies/emails (Admin → Settings)
- support email, contact address/phone, return-window days, cancellation window hours,
  shipping flat rate + free-shipping threshold, COD fee, store legal name.
- Policy pages render from these values; have the four policy pages reviewed for your
  jurisdiction (I do not give legal guarantees).

## ⚪ B10 — Custom domain (optional)
- zenvorastore.vercel.app with free TLS is sufficient to launch. If you own a domain:
  add it in Vercel → Domains, set DNS records, then update APP_URL + redeploy.

## 🟠 B7. Persistent image storage (new in v6) — REQUIRES CONFIGURATION
Product uploads currently default to `STORAGE_PROVIDER=local`, which is EPHEMERAL on Vercel
(images can disappear on redeploy; the admin UI warns while on local). To make uploads durable:
- Option A — Cloudinary (easiest): free account at cloudinary.com → set `STORAGE_PROVIDER=cloudinary`,
  `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (secret) in Vercel.
- Option B — S3-compatible (AWS S3 / Cloudflare R2 / MinIO): set `STORAGE_PROVIDER=s3`,
  `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (secrets); optional
  `S3_ENDPOINT` (R2/MinIO) and `S3_PUBLIC_BASE_URL` (CDN).
Where to enter: Vercel → zenvorastore → Settings → Environment Variables. Nothing breaks without
this — uploads keep working locally-ephemeral with a visible warning. Details: docs/ENVIRONMENT.md.

## ⚪ Hygiene (optional)
- Flip `PAYMENTS_TEST_MODE=false` and `SUPPLIER_DEMO_MODE=false` in Vercel once B4/B5 are done
  (production already force-disables both; this is clarity, not safety).
- Consider uptime monitoring + Neon backup/restore drill before marketing traffic.
