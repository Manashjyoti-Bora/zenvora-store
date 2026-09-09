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

## Observability
- `ErrorLog` (with safe error IDs surfaced to customers), `AuditLog` (admin actions),
  `ApiLog`, `OrderEvent` (every status transition), `InventoryMovement` (every stock change).
- Customer-facing errors are generic + reference an ID; stack traces never leave the server.

## Known open items (honest list)
- Real email delivery requires SMTP configuration (until then: console provider, marked as not sent).
- Persistent uploads require S3/Cloudinary configuration on serverless hosts.
- Payments require Razorpay keys; until configured the store honestly reports
  `paymentsConfigured:false` and COD remains the available method.
- Legal/tax compliance (GST registration, invoicing rules, consumer-protection disclosures) is
  flagged for professional verification — this document is not legal advice.
