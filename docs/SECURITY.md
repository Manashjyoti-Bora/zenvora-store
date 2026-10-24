# Security posture

Last verified against code + live deployment: 2026-09-08 (see `docs/AUDIT_2026-09-05.md` for the
route-by-route audit; this file is the summary that must stay true).

## Authentication & authorization
- Session cookies: httpOnly, sameSite, secure in production (`resellix_*` internal names kept
  deliberately; brand-facing name is Zenvora).
- RBAC roles `USER / ADMIN / SUPER_ADMIN`. **Every** admin API and admin page runs
  `requireAdmin()`/RBAC guards (`src/lib/auth/guards.ts`) — verified 401/307 on live probes
  (`/admin` → 307 login, cron without secret → 401).
- Admin bootstrap (`ADMIN_EMAIL/ADMIN_PASSWORD` + seeder) creates an admin only if none exists —
  it never overwrites an existing admin password.

## Input & injection
- All API bodies validated with zod schemas (`src/lib/validation/schemas.ts`); unknown/extra
  fields rejected.
- Prisma parameterised queries everywhere. The only raw SQL (atomic coupon-usage increment) is a
  static statement with bound parameters — no string interpolation.
- XSS: React escaping; no `dangerouslySetInnerHTML` with user content; CSP header restricts
  script sources (Razorpay allowlisted). Live-verified headers: CSP, HSTS, X-Content-Type-Options
  nosniff, X-Frame-Options SAMEORIGIN.
- Uploads: magic-byte sniffing (JPEG/PNG/WEBP/GIF/AVIF only), 5 MB cap, random filenames, served
  with nosniff; extension never trusted.

## Money paths
- Prices, discounts, shipping, COD fees and totals are computed **server-side only** from DB data;
  the client never sends prices. Coupons re-validated at cart AND order creation.
- Minimum-margin floor cannot be bypassed except via an explicit admin-flagged coupon
  (`bypassMarginProtection`) — never silently.
- Razorpay: signature verification of checkout payloads AND webhook HMAC before any state change;
  webhook processing idempotent (no double-capture of payments/orders). Bad signature → 400
  (live-verified).
- No card data, CVV, UPI PINs or payment credentials are ever stored; gateway secrets live only in
  env vars.

## Webhooks & cron
- Generic supplier webhook: `X-Supplier-Signature` HMAC-SHA256 required.
- CJ webhooks are **unsigned by CJ** — the endpoint therefore never trusts payloads: it only
  triggers an authenticated re-fetch (SYNC job). Unknown/unverifiable events return
  `{ok:true, ignored:true}` (live-verified).
- `POST /api/cron/jobs` requires `Authorization: Bearer CRON_SECRET`; job runner is idempotent via
  dedupe keys; retries with backoff.

## Rate limiting & abuse
- Per-IP/per-user limits on register (5/15min), login, password reset, coupon apply, uploads
  (60/15min), contact forms (`src/lib/rate-limit.ts`).
- Counters are **shared across serverless instances** through PostgreSQL
  (`rate_limit_buckets`, migration `20261024210000_rate_limit_buckets`): one atomic
  `INSERT … ON CONFLICT … RETURNING` per hit, so a burst spread over many instances/regions is
  still counted as one client. Keys are stored as SHA-256 digests (no raw IPs/e-mails at rest).
  If the database call fails the hit is counted in process memory instead and a throttled
  warning is logged (abuse brake degrades; checkout never fails because of the counter table).
  Expired rows are purged by the cron housekeeping task. `RATE_LIMIT_STORE=memory` forces the
  process-local store (tests only).

## Image optimizer
- `images.remotePatterns` is an explicit allow-list (`IMAGE_REMOTE_HOSTS`, defaults in
  `src/lib/images/remote-hosts.mjs`) instead of `**`, so `/_next/image` cannot be used as an
  open fetch proxy. Catalogue media from non-listed https hosts is rendered through
  `<RemoteImage>` with `unoptimized` (plain `<img>`), never a runtime error.

## Observability
- `ErrorLog` (with safe error IDs surfaced to customers), `AuditLog` (admin actions),
  `ApiLog`, `OrderEvent` (every status transition), `InventoryMovement` (every stock change).
- Customer-facing errors are generic + reference an ID; stack traces never leave the server.

## Request body limits
- Every JSON route reads its body through `readJson()` (`src/lib/http.ts`), which rejects
  bodies above 1 MB with `413 PAYLOAD_TOO_LARGE` (checked on `Content-Length` and again on the
  actual UTF-8 byte length). This bounds validation work: zod 3.x accumulates one issue per
  failing array element even when the array has `.max()` (GHSA-mrhx-c7xc-m3w5), so body size,
  not schema shape, is what limits memory per request.

## Dependency advisories (2026-10-24)
- `zod <4.6.6` — GHSA-mrhx-c7xc-m3w5 (high, memory exhaustion on oversized arrays). No 3.x
  patch exists; the fix is the zod 4 major. Mitigated here by the request-body cap above plus
  `.max()` on every public array schema. Migrating to zod 4 is tracked as a follow-up: it changes
  `.default()` semantics and error-param names across ~40 schemas and needs its own reviewed PR.
- `tailwindcss 3.x` dev chain (`postcss-selector-parser`, moderate, build-time only; fix is
  Tailwind 4 major) — accepted, not shipped to the browser.

## Known open items (honest list)
- Real email delivery requires SMTP configuration (until then: console provider, marked as not sent).
- Persistent uploads require S3/Cloudinary configuration on serverless hosts.
- Payments require Razorpay keys; until configured the store honestly reports
  `paymentsConfigured:false` and COD remains the available method.
- Legal/tax compliance (GST registration, invoicing rules, consumer-protection disclosures) is
  flagged for professional verification — this document is not legal advice.
