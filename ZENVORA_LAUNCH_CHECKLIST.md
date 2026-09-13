# ZENVORA_LAUNCH_CHECKLIST.md

Legend: `[ ]` NOT STARTED · `[~]` IN PROGRESS · `[x]` VERIFIED (evidence required — cited inline).
Nothing is marked `[x]` without evidence observed in this audit. Living document — updated as phases complete.

## 1. Code
- [x] Production content identical to audited release (tree hash `15e71b07…` = origin/main `21a81e3`; live v10 markers: canonical, `line2…||void 0` chunk, 404 SVG watermark)
- [x] Local battery green (current HEAD): tsc 0 · lint clean · **196/196** unit+integration (2 new cart-merge regression tests) · E2E **62/62** · build ✓ · **103 kB** shared JS
- [x] v11 baseline Lighthouse (local prod build): home mob 96 (LCP 2.3s, TBT 170ms) · home desk 100 (LCP 0.5s) · PDP mob 98 (LCP 2.4s) — a11y/BP/SEO 100, CLS 0 everywhere
- [x] Cron scheduler support DEPLOYED + live-verified (GET /api/cron/jobs → 401 timing-safe rejection; was 405 on v10)
- [~] Cron scheduler EXECUTION proof pending: 0 GitHub runs ~90 min post-push (scheduler delay common for new workflows; owner must add CRON_SECRET repo secret or runs no-op); vercel.json daily 00:17 UTC backstop fires tonight — re-check both next session
- [x] Full E2E re-run after cron+cart changes: **62/62** (storefront 12, shopping-checkout 14, webhook-security 10, admin-authz 17, auth-flow 9; fresh server per suite)
- [x] Cart merge atomicity fix (`fa30412`): guest→user merge wrapped in $transaction + 2 regression tests (concurrent attach qty-stable at 3, not 5)
- [x] §30 3D performance gate executed → **REJECTED with measurements** (`8acc4d5` experiment, `2f03ef2` removal): lazy 132kB gzip, 0 impact on customer routes/shared bundle, gates verified (mobile/RM/low-memory → poster, 0 bytes); decoration-only value, no real GLB assets exist

## 2. Deployment
- [x] Vercel serving production build (HTTP/2 200, `server: Vercel`, x-vercel-cache headers, HSTS)
- [x] Build chain runs `prisma generate && prisma migrate deploy && tsx scripts/create-admin.ts && next build` (migrations + admin bootstrap on every deploy)
- [ ] Redeploy after APP_URL fix + cron delta (owner)

## 3. Domain
- [x] `https://zenvorastore.vercel.app` live with valid TLS
- [ ] APP_URL corrected to that host (see §4 — currently DEFECT: dead hyphenated host in canonical/OG/sitemap/robots)
- [ ] Optional custom domain decision (owner). If purchased: Vercel → Domains, DNS records, update APP_URL, verify www/non-www consistency

## 4. Environment (values never printed; existence/behavior verified externally)
- [ ] **APP_URL = `https://zenvorastore.vercel.app`** — OWNER ACTION REQUIRED (Vercel → Settings → Environment Variables → edit → redeploy). Evidence of defect: live canonical/og:url/sitemap/robots → `zenvora-store.vercel.app` = HTTP 402
- [ ] ADMIN_EMAIL / ADMIN_PASSWORD present — OWNER VERIFY (Vercel build logs → search `[create-admin]`; if "not set" → add both → redeploy → expect "created admin user …")
- [x] DATABASE_URL/DIRECT_URL working (health `database:true`; QA register/login persisted across requests)
- [x] CRON_SECRET set (unauth probe → 401 "Invalid cron secret", not 503)
- [x] Payments intentionally unconfigured (health `paymentsConfigured:false, provider:NONE`) — honest COD-only state
- [ ] Razorpay keys (§10) · SMTP (§9) · STORAGE (§8) — later phases, owner accounts

## 5. Database
- [x] Migrations applied to Neon (build success ⇒ `prisma migrate deploy` exit 0; chain is `&&`-linked)
- [x] Read+write proven on production (register 201 → login 200 across separate serverless requests)
- [x] Catalogue empty and serving honest empty states ("No products found" — no fake data, per mandate)
- [ ] Real catalogue loaded (§7)

## 6. Supplier
- [x] Demo supplier hard-disabled in production (`isDemoSupplierAllowed() = SUPPLIER_DEMO_MODE && !isProduction`) — no fake fulfilment possible
- [x] Supplier webhook route exists with signature verification (code-level; E2E webhook-security 10/10 locally)
- [ ] CJ Dropshipping account + API key (OWNER; credentials entered by owner in Vercel only)
- [ ] Post-config safe verification (auth handshake, product lookup — no unnecessary orders)
- [ ] Map: order submission → tracking sync behaviour with real credentials

## 7. Catalogue
- [ ] Admin login working (§4 ADMIN env) — prerequisite
- [ ] Admin product-creation walkthrough verified on production (create → category → variant → price/cost/margin → stock → image → publish → storefront render)
- [ ] REAL product data entered by owner (names, images, descriptions, supplier cost, stock, shipping/return info) — never invented
- [ ] Bulk-import decision: `POST /api/admin/products/import` exists — audit its template/format and prepare owner workflow
- [ ] Out-of-stock + archive/unpublish behaviour verified with a real product

## 8. Images / Storage
- [x] Provider abstraction verified in code: `STORAGE_PROVIDER = local | s3 | cloudinary` (default local)
- [ ] **DECISION REQUIRED:** `local` is EPHEMERAL on Vercel — uploaded images would NOT persist. Choose Cloudinary (free tier, simplest) or S3-compatible (R2/Spaces). OWNER creates account; keys into Vercel env only
- [ ] After config: upload → persist across requests → persist across deploy → URL → PDP render → optimized delivery (AVIF/WebP via next/image)

## 9. Email
- [x] Provider abstraction + console fallback (dev); transactional templates exist (order confirmed, shipped, delivered, welcome — observed in dev logs)
- [ ] SMTP account (OWNER — e.g. Resend/Brevo/SES); env: SMTP_HOST/PORT/SECURE/USER/PASS, EMAIL_FROM, EMAIL_REPLY_TO, EMAIL_PROVIDER
- [ ] Sender domain verification (DNS records — OWNER)
- [ ] Safe test: one real email to owner's inbox; absolute links must use corrected APP_URL

## 10. Payments (HIGH RISK — verified implementation not to be modified without proven defect)
- [x] Server-side order creation + signature verification + webhook HMAC + duplicate-event handling + replay window (E2E webhook-security 10/10; unit 194/194 incl. money-path tests)
- [x] Test simulator double-gated off in production (code + health evidence)
- [ ] OWNER: Razorpay account + KYC (owner's legal identity — never fake, never bypass)
- [ ] Test-mode keys first → full test payment journey → then live keys (OWNER enters; never in chat)
- [ ] Webhook configured in Razorpay dashboard → verify signature acceptance on prod (one test event)

## 11. Legal
- [x] Policy pages render (privacy/shipping/returns + terms via settings) with no fabricated claims
- [ ] OWNER + qualified professional review: GST/tax registration, return-window legality, payment terms, contact entity details (no legal guarantees from this audit)

## 12. Shipping
- [ ] Shipping rates/zones configured in admin settings (OWNER business decision)
- [ ] Shipping policy page values match reality (OWNER)

## 13. Returns
- [ ] Return window + refund flow configured (admin); RTO endpoint exists (`/api/admin/orders/[id]/rto`)
- [ ] One dry-run return decision in admin after first controlled order

## 14. Customer support
- [x] `/api/contact` + admin messages inbox exist (code + API surface)
- [ ] Support email address configured (EMAIL_REPLY_TO / contact page value — OWNER)

## 15. Analytics
- [x] Zero third-party scripts on storefront (verified bundle/CSP) — privacy-positive baseline
- [ ] OWNER decision (optional): privacy-respecting analytics (e.g. Vercel Analytics or Plausible). Not required for launch

## 16. Security
- [x] Production RBAC probe: non-staff → 403 JSON, no data; unauth /admin → login redirect
- [x] CSRF enforced (live 403 CSRF_FAILED on unprotected POST probe); session cookie cleared on logout (jar evidence)
- [x] Security headers full set (CSP w/ Razorpay allowlist, HSTS, nosniff, XFO, referrer, permissions-policy)
- [x] Cron endpoint timing-safe Bearer auth (401 on wrong token, live)
- [ ] Full security re-audit pass (Sections 13–16 of mandate): IDOR matrix, webhook forgery, rate-limit behavior — scheduled, partially BLOCKED by empty catalogue
- [~] RISK documented: in-memory rate limiter is per-instance on serverless (not global)

## 17. SEO
- [ ] Canonical/OG/sitemap/robots host fix via APP_URL (blocked on §4 owner action) — then re-verify all four externally
- [x] Structure: title/desc/OG/twitter/JSON-LD (Organization, WebSite, SearchAction; Product+Offer+BreadcrumbList render with catalogue data), noindex on utility/PII routes, true 404
- [ ] After catalogue: PDP structured data spot-check against visible content (no fake reviews/availability)

## 18. Mobile QA
- [x] Production smoke: 9 routes × {360×800, 390×844} real browser — 0 overflow, 0 page errors, true statuses
- [ ] Extended matrix (412×915, 768×1024, 1024×768, 1280+, 1440+) on production once catalogue exists
- [ ] Sticky buy bar / gallery / variant UX with a real product

## 19. Order operations
- [ ] Flow map CUSTOMER→ORDER→PAYMENT/COD→CONFIRMATION→SUPPLIER→FULFILMENT→TRACKING→NOTIFICATION→DELIVERY→RETURN with AUTOMATED/MANUAL/OWNER/SUPPLIER/UNVERIFIED labels (Section 12 deliverable)
- [ ] One controlled COD order on production (zero-cost path; COD enabled, demo supplier disabled ⇒ supplier step will require real CJ config or documented manual handling) — after catalogue + admin exist
- [ ] Order state machine transitions + concurrency re-verified on prod data

## 20. Final launch approval
- [ ] Every section above `[x]` or explicitly accepted RISK with owner sign-off
- [ ] Final classification issued: NOT READY / OWNER CONFIGURATION IN PROGRESS / READY FOR CONTROLLED BETA / READY FOR PUBLIC LAUNCH

---
**Current overall classification: OWNER CONFIGURATION IN PROGRESS.**
Blocking owner actions (smallest set, one Vercel dashboard visit): (1) fix APP_URL + redeploy, (2) verify/set ADMIN_EMAIL+ADMIN_PASSWORD via build-log evidence, (3) push the launch-ops delta (zip) so cron scheduling + doc corrections ship.
