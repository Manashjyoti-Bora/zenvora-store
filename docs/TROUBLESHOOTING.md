# Troubleshooting

Symptom → cause → fix. Everything here was hit and solved during development/deployment.

## Payments
- **`/api/health` shows `paymentsConfigured:false`** — Razorpay env vars missing/misnamed on
  Vercel. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`,
  `RAZORPAY_WEBHOOK_SECRET`, redeploy. Not a bug; COD remains available meanwhile.
- **Webhook returns 400** — signature mismatch: the secret in Razorpay webhook settings must equal
  `RAZORPAY_WEBHOOK_SECRET` exactly. 400 on tampered signatures is correct behaviour.

## Database / Vercel
- **"Too many connections" / cold-start timeouts** — you are using the direct Neon URL at runtime.
  `DATABASE_URL` must be the **pooled** host (`-pooler`) with `?sslmode=require&pgbouncer=true&connect_timeout=15`;
  remove `channel_binding=require` (Vercel's driver doesn't support it). `DIRECT_URL` = non-pooler
  host, used by migrations only.
- **Old project shows 402 DEPLOYMENT_DISABLED** — that is the abandoned `zenvora-store.vercel.app`
  project. Production is `zenvorastore.vercel.app`; ignore/remove the old one.
- **Soft 404s (missing pages return 200)** — a `loading.tsx` at the route level makes `notFound()`
  render 200. Root `loading.tsx` was removed for this reason; don't re-add it.

## Migrations
- **Deploy fails on migration** — run `prisma migrate status` against `DIRECT_URL`. If drift is
  reported, resolve with a NEW corrective migration. Never `migrate reset`/`db push` against
  production (destructive ops are banned by policy).
- **`migrate dev` asks for a shadow database (local)** — grant `CREATEDB` to the local role:
  `ALTER ROLE app CREATEDB;`.

## Uploads / images
- **Uploaded images vanish after a deploy** — `STORAGE_PROVIDER=local` writes to the ephemeral
  serverless disk. Configure `s3` or `cloudinary` (docs/ENVIRONMENT.md). The admin upload UI shows
  a warning while on local.
- **Upload rejected** — file must be a genuine JPEG/PNG/WEBP/GIF/AVIF (magic bytes checked) ≤ 5 MB.
  Renamed extensions of other files are rejected on purpose.

## Orders / suppliers
- **Order stuck at `SENT_TO_SUPPLIER`** — CJ push failed (wallet empty, SKU unmapped, key missing).
  Check Admin → Logs (ErrorLog/ApiLog) for the CJ envelope message; fix mapping/balance; the retry
  job re-attempts automatically. Mark `FULFILMENT_FAILED` + refund if unrecoverable.
- **CJ webhook seems ignored (`{"ok":true,"ignored":true}`)** — correct: CJ webhooks are unsigned,
  so they only trigger authenticated re-fetch syncs; unknown orders are ignored safely.
- **Courier couldn't deliver (RTO)** — Admin → Orders → RTO action: `RTO` when the parcel turns
  back, `RTO_RECEIVED` when it's physically back (LOCAL stock auto-restocks, movement history
  written). Then refund/close as applicable.

## Email
- **No emails arriving** — default `EMAIL_PROVIDER=console` only logs (Admin → Logs / server logs).
  Configure SMTP vars to really send. The system never claims an email was sent when it wasn't.

## Local development
- **`next dev` OOM** — use `npm run dev` (turbopack) on small machines; run one dev server at a time.
- **`next start` errors `dataRoutes is not iterable`** — run `npm run build` first after dev sessions.
- **Tests hit the wrong DB** — integration tests use `TEST_DATABASE_URL`/`.env.test`; point it at
  `resellix_test`, never your dev or prod database.
- **`npx prisma` installs the wrong major** — use `./node_modules/.bin/prisma` (pinned v6).
