# ZENVORA — FINAL LAUNCH READINESS REPORT (v11 → v12 launch-ops)

**Date:** 2026-09-12 · **Local HEAD:** `15243ce` (branch `v9-real-world-qa`, tree clean) · **Production:** `e1a9d27` "Release v11" on `main` (tree-verified identical to local at that point)
**Classification (§36): READY FOR OWNER CONFIGURATION** — no known P0/P1 code defect; every remaining gate is an owner action listed in §15.

---

## 1. Executive summary

Since v10 went live, this pass: (a) externally re-verified the v11 deployment and the APP_URL/canonical fix; (b) ran a full repository reconnaissance (dependencies, types, hygiene, schema, chunks, dead-code); (c) found and fixed one real data-integrity defect (non-atomic guest→user cart merge) with two regression tests; (d) executed the §30 3D performance gate as a measured experiment and **rejected** customer-facing 3D with numbers; (e) diagnosed the owner's admin-login failure to root-cause candidates and shipped hardened bootstrap + two proven owner-recovery tools; (f) re-ran the entire verification battery green. Production is honest, secure, fast, and empty — it needs its owner: admin access repair, real catalogue, storage, SMTP, payments.

## 2. What was discovered (this pass)

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | Guest→user cart merge non-atomic: failed/concurrent merge left guest cart alive with lines already copied → next attach **double-counted quantities** (bounded ≤20/line; no money impact — pricing is server-authoritative at order time) | P2 data integrity | FIXED `fa30412` |
| 2 | `create-admin` used raw `ADMIN_PASSWORD` env value (no trim) while login compares **bytes exactly** → a pasted trailing space/newline in Vercel creates an admin whose password can never be typed. Passwords >72 bytes threw a cryptic build failure | P1 for owner onboarding | FIXED `b0bef0f` |
| 3 | Owner admin login failing on production (reported) — candidate causes fully mapped (§5 decision tree); deterministic repair tools shipped | P1 owner blocker | TOOLING SHIPPED `15243ce`, owner step pending |
| 4 | Recovery-tool input bug found by execution: `readline.question()` silently exits 0 on piped stdin EOF | P3 (tooling) | FIXED in same commit, proven by execution |
| 5 | No cron scheduler existed pre-v11 (POST-only route, no vercel.json) | P2 ops | FIXED in v11 (live-verified 401 on GET); **execution proof still pending** (§14) |
| 6 | APP_URL pointed at dead hyphenated host (402) — canonical/OG/sitemap/robots/email links broken | P1 SEO | Owner fixed in Vercel; externally re-verified (`zenvorastore.vercel.app` in canonical+sitemap) |
| 7 | 4 "orphan components" flagged by my own scan | false positive | All proven USED via relative imports (nothing deleted — verification-before-modification) |
| 8 | `admin/product-form.tsx` 1265 LOC / 427 kB route JS | P2 maintainability | Logged, deliberately not churned this pass (§5) |
| 9 | In-memory rate limiter is per-serverless-instance (not global) | RISK (documented) | Unchanged by design; revisit only on observed abuse |
| 10 | Sandbox-only artifacts during verification (zombie dev server, transient build OOM) | environment | Caught and re-verified clean; never shipped |

## 3. What was fixed (code deltas this pass, all committed)

- `fa30412` — cart merge wrapped in a single `$transaction`; 2 new integration tests (sequential replay = no-op; **concurrent attach ends qty 3, not 5** — the loser transaction rolls back atomically via the guest-cart delete / `@@unique([cartId,productId,variantId])`).
- `b0bef0f` — `create-admin`: trims `ADMIN_PASSWORD` env whitespace (logs when it does), actionable >72-byte guard, skips instead of failing builds (consistent with the unset-env philosophy; unrelated hotfix deploys never blocked by a bad password value).
- `15243ce` — `npm run db:reset-admin-password -- <email>` (ADMIN-only, interactive double-entry, policy-enforced, revokes sessions+reset tokens, EOF-robust piping) and `npm run db:promote-admin -- <email>` (guarded one-shot role elevation; manual-only by design — build-time auto-promotion would enable email pre-registration attacks). Both **proven by execution**: happy paths, mismatch/policy/EOF guards, idempotent re-run, and bcrypt verification of the resulting hash.

## 4. What was improved (verified state upgrades)

- v11 live-verified externally: `GET /api/cron/jobs` → 401 timing-safe (v10: 405); canonical + sitemap host corrected; tree-hash identity local↔`origin/main`.
- Baseline metrics re-locked for future comparison (local production build): home-mob **96**/100/100/100 (LCP 2.3s, TBT 170ms), home-desk **100×4** (LCP 0.5s), PDP-mob **98**/100/100/100 (LCP 2.4s), CLS 0 everywhere; shared JS **103 kB**.
- Governance docs kept truthful: `CURRENT_STATE_MATRIX.md` (24 evidence-cited rows), `ZENVORA_LAUNCH_CHECKLIST.md` (20 sections, evidence-gated `[x]`).

## 5. What was intentionally NOT changed

- **Login/auth/money/supplier/webhook logic** — verified-correct systems; the admin-login issue is bootstrap/config-side, and the fixes stay strictly in bootstrap tooling.
- **No build-time auto-promotion of admins** (pre-registration attack surface).
- **No demo/fake catalogue seeded into production** (mandate rule; empty states are honest).
- **`admin/product-form.tsx` (1265 LOC) not split this pass** — real P2 maintainability item, but refactoring the admin's most critical form without a dedicated admin-UI E2E net is a worse trade than deferring; logged in the ledger.
- **In-memory rate limiting kept** — Upstash/Redis adds a dependency + cost for a threat not yet observed; documented as RISK.
- **No R3F/Three adoption** (§8 below), no analytics scripts, no new runtime dependencies at all — the dependency graph remains 10 runtime packages, each imported and centralized.

## 6. New technologies introduced

**None.** Runtime dependency count is unchanged (10). `three` + `@types/three` were installed **temporarily for measurement only** and removed in the same pass (`2f03ef2`); `package.json` carries no residue.

## 7. Why no new technology

Every candidate was scored against the §1/§2 gates (problem solved, measurable benefit, bundle/runtime/maintenance cost, existing-stack coverage). The only serious candidate was 3D (§8). All other improvement candidates were served by the existing stack (transactions for cart merge; build-time scripts for admin recovery).

## 8. 3D implementation details — MEASURED, then REJECTED

Prototype: procedural brass signet ring (~4.6k triangles), plain `three` (R3F rejected pre-install: peer conflict with React resolution + ~40 kB extra deps), dynamic-imported behind five capability gates (reduced-motion, saveData/2g, deviceMemory<4, coarse pointer, WebGL probe), poster SVG fallback, IntersectionObserver + visibility pausing, DPR clamp ≤2, full disposal (geometry/material/renderer/context/observers).

| Measurement | Result |
|---|---|
| Shared bundle / customer routes | **UNCHANGED** (103 kB; 0 three-byte requests on /, /shop, PDP, /cart) |
| Lazy chunk cost | 541 kB raw / **132 kB gzip** (three doesn't tree-shake — no `sideEffects:false`) |
| FPS (SwiftShader software rasterizer = conservative floor) | 18–27 unthrottled; 15–17 @ CPU×4 |
| JS heap | 7 MB stable |
| Gates in real browser | mobile → poster, 0 bytes; reduced-motion → poster, 0 bytes; sandbox desktop (deviceMemory<4) → poster, 0 bytes |

**Verdict: REJECT.** The mechanism is safe, but the value fails §9/§31: 132 kB gzip buys decoration that communicates no product information; honest PDP 3D requires real GLB scans of real products (none exist — inventing product geometry is fake product display); and in a mobile-first market the gates exclude nearly the entire audience. Experiment + mechanism preserved in commit `8acc4d5` for revival **if** real 3D product assets ever exist. Removal verified: 0 residue chunks, battery green.

## 9. Performance before/after

No customer-facing performance change this pass by design (server-side fix + removed experiment). Locked baselines: see §4. Evidence: `/home/user/qa/lh-*-V11BASE.json`. The rejected 3D experiment's full before/after is §8 (after = identical to before on every customer route).

## 10. Accessibility before/after

Unchanged this pass (no UI deltas shipped): last verified state = axe 0 violations on home/PDP/sold-out-PDP/404, full keyboard/reduced-motion/no-JS gating proven (Round-7 §F, still valid — no accessibility-relevant code changed since).

## 11. Security findings (this pass)

- Production RBAC live-probed: non-staff → 403 JSON (no data); unauth `/admin` → login redirect; CSRF enforced (403 on tokenless POST); logout clears the session cookie (jar-level evidence); `me` semantics match the E2E contract ("intentionally non-throwing").
- Fake-payment simulator double-gated OFF in production (`PAYMENTS_TEST_MODE && !isProduction`; health confirms `environment:production`); demo supplier hard-disabled in production.
- Cron endpoint: timing-safe Bearer, live 401 on missing/wrong token.
- Schema-level protections re-verified: `Order.idempotencyKey @unique`, `WebhookEvent @@unique([provider,externalEventId])`, `Job.dedupeKey @unique`.
- New tools reviewed against privilege-escalation: reset tool is ADMIN-role-only and revokes sessions/tokens; promote tool is manual + typed-confirmation; neither prints secrets; create-admin never overwrites existing passwords.
- No secrets committed or printed anywhere in this pass (zip scan: 0 env files; `.env.example` template values only).

## 12. SEO findings

Live-verified post-fix: canonical `https://zenvorastore.vercel.app` ✓; sitemap `<loc>` host ✓; robots ✓; true 404 ✓; JSON-LD Organization/WebSite/SearchAction on home ✓; noindex on utility/PII routes ✓. Product/Offer/BreadcrumbList render with catalogue data — **currently untestable live (empty catalogue)**; spot-check scheduled for the first real product.

## 13. Test results (current HEAD, this pass)

| Gate | Result |
|---|---|
| `tsc --noEmit` (TS 5.9.3) | 0 errors |
| ESLint | 0 problems |
| Unit + integration (vitest) | **196/196** (22 files; +2 new cart-merge regressions) |
| E2E (fresh dev server per suite) | **62/62** — storefront 12, shopping-checkout 14, webhook-security 10, admin-authz 17, auth-flow 9 |
| Production build (full chain incl. `prisma migrate deploy` + `create-admin`) | ✓ exit 0, shared JS 103 kB |
| Recovery tools | Proven by execution (happy + 4 guard paths + bcrypt verification of stored hash) |

Honest note: one transient full-chain build failure occurred under memory pressure (zombie dev server holding 1 GB of the sandbox's 2 GB); after cleanup the identical chain built green twice. One self-inflicted local-dev credential mismatch during tool verification was caught **because E2E was re-run instead of assumed**, repaired via dotenv-parsed restore, and admin-authz returned to 17/17.

## 14. Remaining risks

1. **Cron execution unproven**: workflow `cron-jobs` active but 0 scheduled runs observed ~90 min post-push (GitHub scheduler delays new workflows; runs no-op until the `CRON_SECRET` repo secret exists). vercel.json daily 00:17 UTC backstop fires independently — both need a next-session re-check.
2. Production catalogue empty → full live checkout journey remains **BLOCKED** until ≥1 real product exists (line-2 fix itself is proven live at chunk level).
3. `STORAGE_PROVIDER=local` is ephemeral on Vercel — product image uploads will NOT persist until Cloudinary/S3 is configured (owner decision pending; brief ready).
4. SMTP unconfigured — transactional email currently lands in Vercel runtime logs only (this is also the admin password-reset repair channel, §15).
5. In-memory rate limiting is per-instance on serverless (documented; not global).
6. No field RUM / real-device mobile testing (lab-only evidence).
7. Live production DB contains two QA artifacts: user `v10.qa.smoke@example.com` (marked "safe to delete") — deletable via admin UI once admin access works.

## 15. Owner-only tasks (exact, small, in order)

**A. Repair admin login (do this first; pick the path matching your symptom):**
1. Vercel → Deployments → latest → **Build logs** → search `[create-admin]`:
   - `ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping` → env vars were added **after** the build: confirm both exist under Settings → Environment Variables (Production), then **Redeploy**. New builds also trim pasted whitespace automatically (v12+).
   - `created admin user <email>` → admin exists → if login shows **"Invalid email or password."** the stored password differs from what you type (pre-trim whitespace artifact or typo). Repair without exposing anything: on the live site use **Forgot password** with your admin email → then Vercel → **Logs (Runtime)** → find the `[EMAIL:console]` block → copy the `Reset your password: https://…` link → set a fresh password → log in. (If the log line doesn't appear within a minute, request again — limit 5/30min.)
   - `exists but its role is CUSTOMER` → you registered that email as a customer earlier: either set a **different** `ADMIN_EMAIL` + redeploy, or run the deterministic tool from your device with the repo + Neon URL in `.env`: `npm run db:promote-admin -- you@yourdomain.com` (type the email to confirm; password untouched).
   - `Too many login attempts…` → 15-minute lockout after 8 tries: wait, then **one** careful attempt.
2. Deterministic alternative to all of the above (Termux/local, production DATABASE_URL in `.env`, nothing shared with me): `npm run db:reset-admin-password -- you@yourdomain.com` → type the new password twice locally → log in.
3. Deploy v12 (`/home/user/zenvora-store-v12.zip`) with your usual unzip→commit→push flow so the bootstrap hardening + recovery tools are in the repo.

**B. After admin login works (each unblocks a phase):**
- Storage: create a **Cloudinary free account** (simplest supported provider) → Vercel env: `STORAGE_PROVIDER=cloudinary` + Cloudinary URL/upload credentials → redeploy. (S3/R2 also supported.)
- Catalogue: create your **first real product** in /admin (real photos, real name/price/supplier cost) — never placeholder claims. Bulk import (`POST /api/admin/products/import`) audit + CSV template: next technical increment.
- SMTP: choose a provider (e.g. Resend/Brevo free tiers) → set `EMAIL_PROVIDER=smtp`, `SMTP_*`, `EMAIL_FROM` → redeploy → test one real email.
- Payments: Razorpay account + KYC (your legal identity) → **test keys first** → I verify the test-mode journey → then live keys + webhook (dashboard steps provided when you're ready; keys never in chat).
- Optional: GitHub repo secret `CRON_SECRET` (activates the 5-minute job runner; the daily Vercel backstop already works without it).

## 16. Deployment requirements

- Next deploy = v12 zip contents (bootstrap hardening + recovery tools + ledger docs). Build chain unchanged (`prisma generate && prisma migrate deploy && tsx scripts/create-admin.ts && next build`); migrations are additive; create-admin is idempotent and now whitespace-safe.
- After deploy: re-check `[create-admin]` log line; re-check GitHub `cron-jobs` runs; re-verify canonical host stays `zenvorastore.vercel.app`.

## 17. Exact commit hashes (chronological, this program)

Round-7 QA (in v10): `973426f` checkout line-2 fix + UI fixes · `b24ac3f` home canonical · `003adea` round-7 report/status.
Owner releases: `21a81e3` (v10 squash) · `e1a9d27` (v11 squash, tree-identical to local `db6506a`).
Launch-ops (in v11): `6dd43a0` cron GET alias + vercel.json + GH workflow · `7f2ee60` APP_URL doc root-cause fix · `db6506a` governance docs.
This increment (→ v12): `fa30412` atomic cart merge + regression tests · `8acc4d5` 3D gate experiment (measurements) · `2f03ef2` 3D rejection/removal · `0f10b76` ledger update · `b0bef0f` admin-bootstrap hardening · `15243ce` owner recovery tools.

## 18. FINAL LAUNCH CLASSIFICATION

**READY FOR OWNER CONFIGURATION.**

- Not BLOCKED: every pending item has a concrete, safe owner path (§15) and nothing blocks my remaining technical work (catalogue-import audit, storage brief, failure-mode matrix, live checkout journey the moment a product exists).
- Not READY FOR CONTROLLED BETA: real customers cannot transact yet — no admin-operable catalogue, no persistent image storage, no SMTP, no payments; admin access itself is mid-repair.
- Not PRODUCTION READY: same reasons; plus cron execution proof and live PDP structured-data checks remain outstanding.
- Evidence base: §13 battery (196/196 + 62/62 + build ✓ + tsc/lint 0), §11 live security probes, §12 live SEO verification, §8 measured 3D rejection. No claim of "perfect" or "bug-free" is made; known risks are itemized in §14.

## §34 Final verification matrix

| Area | Status | Evidence | Remaining risk |
|---|---|---|---|
| Build | VERIFIED | full-chain exit 0 ×2, 103 kB shared | transient OOM under zombie-server pressure (environmental, caught) |
| TypeScript | VERIFIED | tsc 0 (5.9.3) | — |
| Lint | VERIFIED | eslint 0 | — |
| Unit | VERIFIED | 196/196 (22 files) | — |
| Integration | VERIFIED | incl. cart-merge atomicity + concurrency | — |
| E2E | VERIFIED | 62/62 fresh-server-per-suite | — |
| Security | VERIFIED (live probes + suites) | §11 | in-memory rate limiter per-instance |
| Accessibility | VERIFIED (no UI delta since Round-7 axe 0) | Round-7 §F | real-device SR testing not done |
| SEO | VERIFIED (host fixed; structure live-checked) | §12 | PDP schema needs first real product |
| Performance | VERIFIED (baselines locked) | §4/§9 | no field RUM |
| Mobile | VERIFIED (live smoke 18/18, 0 overflow) | launch-ops matrix | extended matrix after catalogue |
| Desktop | VERIFIED | LH desk 100×4 | — |
| Checkout | CODE VERIFIED / LIVE BLOCKED | E2E 14/14 + live chunk `line2…||void 0` | full live journey needs 1 product |
| Payments | NOT CONFIGURED (honest) | health `provider:NONE` | owner KYC + keys |
| Supplier | SAFE-BY-DEFAULT | demo hard-disabled in prod | CJ credentials pending |
| Cron | CONFIGURED, EXECUTION PENDING | live 401; GH 0 runs so far | re-check next session |
| Database | VERIFIED (structure + live read/write) | health + QA register/login | catalogue empty (by design) |
| Admin | DEFECT HARDENED, REPAIR PENDING OWNER | §5 tree + proven tools | owner step A |
| 3D | REJECTED WITH MEASUREMENTS | §8 | none (removed, 0 residue) |
| Deployment | VERIFIED v11 = intended release | tree-hash identity + live markers | v12 push pending owner |
