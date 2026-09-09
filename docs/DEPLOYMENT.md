# Deployment (Vercel + Neon)

Canonical production URL: **https://zenvorastore.vercel.app** (set as `APP_URL` everywhere —
emails, webhooks, sitemap). The older `zenvora-store.vercel.app` project is disabled (402) and
must be ignored. Full click-by-click history: `docs/DEPLOY_VERCEL_NEON.md`.

## Pipeline
1. Push to `main` on GitHub (`Manashjyoti-Bora/zenvora-store`) → Vercel auto-builds & deploys
   (Next.js standalone output, region `sin1`).
2. **Migrations are production-safe by policy**: only `prisma migrate deploy` runs against
   production (via `DIRECT_URL`). There are NO `prisma db push`, `migrate reset`, DROP or data-
   destructive statements in any migration or deploy hook. New schema changes ship as reviewed,
   additive migration folders under `prisma/migrations/`.
3. Admin bootstrap runs from env only if no admin exists — an existing secure admin password is
   never overwritten.

## Required production env (see docs/ENVIRONMENT.md for the full table)
`APP_URL`, `DATABASE_URL` (Neon **pooled** + `pgbouncer=true`, drop `channel_binding`),
`DIRECT_URL` (Neon **direct**), `CRON_SECRET`, `SUPPLIER_WEBHOOK_SECRET`,
`SESSION_TTL_DAYS`/`PASSWORD_RESET_TTL_MINUTES` (optional). Payments/storage/email vars only when
those features are switched on.

## Cron
`vercel.json` schedules `POST /api/cron/jobs` with `Authorization: Bearer $CRON_SECRET`
(Hobby plan: daily; Pro: per-minute recommended). Unauthenticated calls get 401 (live-verified).
The job runner is idempotent, so frequent runs are safe.

## Post-deploy verification checklist (run every deploy)
```
curl -s https://zenvorastore.vercel.app/api/health        # {"status":"ok","database":true,...}
curl -sI https://zenvorastore.vercel.app | grep -iE "content-security|strict-transport"
curl -s -o /dev/null -w "%{http_code}" https://zenvorastore.vercel.app/products/definitely-not-real  # 404
curl -s -o /dev/null -w "%{http_code}" -X POST https://zenvorastore.vercel.app/api/cron/jobs       # 401
curl -s -o /dev/null -w "%{http_code}" https://zenvorastore.vercel.app/robots.txt                  # 200
curl -s -o /dev/null -w "%{http_code}" https://zenvorastore.vercel.app/admin                       # 307
```
All of the above passed on 2026-09-08 against the live deployment.

## Storage on serverless
The Vercel filesystem is ephemeral. For product uploads that survive deploys set
`STORAGE_PROVIDER=s3` (S3/R2/MinIO) or `cloudinary` with credentials; the app falls back to local
disk with a loud error log (and the admin UI warns) if left unconfigured.

## Rollback
Vercel keeps every deployment immutable — promote the previous deployment in the Vercel UI.
Migrations are additive, so older code versions remain compatible with the newer schema.
