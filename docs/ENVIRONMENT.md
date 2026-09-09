# Environment variables

Canonical source: `.env.example` (safe template — contains **no real secrets**). Production values
live ONLY in **Vercel → Project → Settings → Environment Variables** (never in chat, never in git).

| Variable | Required | Secret | Purpose / where to get it |
| --- | --- | --- | --- |
| `APP_URL` | ✅ | no | Canonical `https://zenvorastore.vercel.app` — used in emails, webhooks, sitemap |
| `DATABASE_URL` | ✅ | ✅ | Neon **pooled** connection string + `?sslmode=require&pgbouncer=true&connect_timeout=15` (Neon dashboard → Connection Details; drop `channel_binding` for Vercel) |
| `DIRECT_URL` | ✅ | ✅ | Same Neon string **without** `-pooler` (used by Prisma migrate) |
| `SESSION_TTL_DAYS`, `PASSWORD_RESET_TTL_MINUTES` | optional | no | Auth tuning (defaults 30 / 60) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | optional | ✅ | One-time bootstrap. **Never overwrites an existing admin** — the seeder skips if a user with that email exists. Generate: `openssl rand -base64 24` |
| `CRON_SECRET` | ✅ (prod) | ✅ | Protects `POST /api/cron/jobs` (Bearer). Generate: `openssl rand -hex 32`; set the same value in vercel.json cron config/Vercel UI |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | for prepaid | ✅/no | Razorpay Dashboard → Settings → API Keys |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | for prepaid | no | Client-safe key id only (never the secret) |
| `RAZORPAY_WEBHOOK_SECRET` | for prepaid | ✅ | You choose it; put the same value in Razorpay webhook settings |
| `PAYMENTS_TEST_MODE` | optional | no | `true` keeps gateway in test mode — clearly labelled, never mixed with live status |
| `SUPPLIER_WEBHOOK_SECRET` | ✅ | ✅ | HMAC secret for the generic supplier webhook (`X-Supplier-Signature`) |
| `SUPPLIER_DEMO_MODE` | never in prod | no | Demo supplier must stay off in production |
| `CJ_API_KEY` (name per supplier row `apiKeyEnvVar`) | for CJ | ✅ | cjdropshipping.com → API. Adapter also needs wallet balance + SKU mapping |
| `EMAIL_PROVIDER` | optional | no | `console` (default — logs, does NOT send) or `smtp` |
| `SMTP_HOST/PORT/SECURE/USER/PASS`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | for real email | some | Any SMTP provider (Resend/Brevo/SES…). Until set, emails are honestly recorded as not sent |
| `STORAGE_PROVIDER` | optional | no | `local` (default; EPHEMERAL on Vercel) · `s3` · `cloudinary` |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | for s3 | ✅ | AWS S3 / Cloudflare R2 / MinIO. Optional `S3_ENDPOINT` (R2/MinIO), `S3_PUBLIC_BASE_URL` (CDN) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | for cloudinary | ✅ | Cloudinary console. Optional `CLOUDINARY_FOLDER` (default `zenvora`) |
| `TEST_DATABASE_URL` | dev/test | no | Separate Postgres DB for integration tests |

Rules enforced in code (`src/lib/env.ts`): validated at boot with zod; missing critical values fail
fast with a clear message; storage providers fall back to `local` **loudly** (logged error) when
misconfigured instead of silently failing uploads.

Local dev: copy `.env.example` → `.env.local`, point DATABASE_URL/DIRECT_URL at local Postgres,
generate your own secrets. See `SETUP_CHECKLIST.md`.
