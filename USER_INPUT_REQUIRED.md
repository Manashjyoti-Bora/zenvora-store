# USER_INPUT_REQUIRED.md — ZENVORA

## ✅ Decisions recorded (2026-09-05)

| Question | Your answer | What happens next |
|---|---|---|
| C1 Supplier path | **Still deciding** | See `docs/SUPPLIER_OPTIONS.md` (4 realistic India paths + due-diligence checklist). MANUAL fulfilment works from day one; POD APIs (Printrove/Qikink) are the fastest automation route — reply with a choice when ready. |
| B1 Razorpay | **Will create account** | Signup (free) → Settings → API Keys → generate TEST keys → enter `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` (+ `RAZORPAY_WEBHOOK_SECRET` once domain exists) in `.env` / Vercel env. Keys go ONLY there, never chat. |
| D1 Hosting | **Vercel + Neon** | Full step-by-step runbook: `docs/DEPLOY_VERCEL_NEON.md` (incl. honest Vercel caveats: ephemeral uploads, in-memory rate limits). |
| E1 Brand | **Zenvora is final** | Already applied (APP_NAME, settings, emails). Internal `resellix_*` identifiers stay as-is. Remaining E-items (legal name, GSTIN, policy details, support contact) still open — answer via the template below when ready. |

Everything the codebase needs from YOU, grouped by what it unlocks. **Never paste secrets/passwords/API keys into this chat** — every sensitive value goes directly into `.env` on the machine that runs the app (or your host's secret manager). Each blocker below says exactly what is needed, why, where to get it, where to enter it, and what keeps working without it.

Quick answer format (copy, fill, reply — no secrets):

```
A1: done / not yet
B1: have Razorpay account? yes/no; keys entered in .env? yes/no
C1: supplier choice = API supplier / manual fulfilment / still deciding
D1: hosting choice = Vercel / Render / Railway / VPS / undecided
E1: brand name final = Zenvora? yes/no
E2: legal business name = ___ ; GSTIN (or "unregistered") = ___
```

---

## Category A — Needed to RUN the project locally (nothing blocking today)

| # | Item | Status |
|---|---|---|
| A1 | Node 20+, PostgreSQL, `npm install`, `prisma migrate deploy`, `npm run db:seed`, copy `.env.example` → `.env` | ✅ Already working in this workspace; steps in README.md for your phone/PC. **No action needed** unless you move machines. |

## Category B — Needed for REAL PAYMENTS (test mode until then)

### 🔒 BLOCKER #1 — Razorpay account credentials
- **What:** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (plus test-mode keys first, live keys later).
- **Why:** Real payment capture cannot exist without a gateway account. Until then the app runs the built-in **TEST provider (dev only, clearly marked)** and production builds answer `PAYMENTS_NOT_CONFIGURED` honestly — verified.
- **Where to get:** dashboard.razorpay.com → Sign up (free) → Settings → API Keys → Generate; Webhook secret: Webhooks → Add webhook (URL = `https://YOUR-DOMAIN/api/payments/webhook`, events: `payment.captured`, `payment.failed`, `refund.created`). Razorpay KYC is required before accepting LIVE money.
- **Sensitive?** YES — **do not send keys in chat.** Enter them only in `.env` (locally) / host environment variables (production).
- **What continues meanwhile:** everything else — catalog, cart, checkout (COD path works end-to-end without a gateway), admin, supplier work, deployment prep, TEST-mode payment rehearsals.

## Category C — Needed for REAL SUPPLIER FULFILMENT (the business goal)

### 🔒 BLOCKER #2 — A real supplier (or a manual-fulfilment decision)
- **What:** ONE of:
  1. **API supplier** — base URL + credentials + their API docs (the adapter contract is in `docs/SUPPLIER_API.md`; any supplier matching it, or tell me the supplier and I'll write the adapter); or
  2. **Manual supplier workflow** — you (or staff) buy/ship orders yourselves: admin marks supplier orders SENT → adds tracking → customer emails fire automatically. No credentials needed, just the decision.
- **Why:** Automated reselling requires a real fulfilment source. **No supplier has been invented**, and the Demo supplier is disabled in production by design (verified: prod falls back to the manual queue).
- **Where to get:** e.g. Indian dropshipping/marketplace supplier programs, local wholesalers with an API, or your own sourcing. KYC/agreement happens between you and the supplier.
- **Sensitive?** Supplier credentials: YES (env only: `SUPPLIER_*` variables named per supplier record). The *decision* (1 or 2) is not sensitive — just tell me which.
- **What continues meanwhile:** the whole order pipeline is verified with the Demo adapter in dev; manual mode is fully usable from day one of launch.

## Category D — Needed for DEPLOYMENT (nothing is deployed yet)

### 🔒 BLOCKER #3 — Hosting + domain + HTTPS
- **What:** a hosting choice (Vercel / Render / Railway / VPS), a domain you own, and DNS access.
- **Why:** "LIVE" requires a real server on a real domain with TLS; webhooks (Razorpay/supplier) need a public HTTPS URL. **No purchases will be made without your authorization.**
- **Where to get:** Vercel/Railway/Render free tiers can host this app; domains from any registrar (~₹800–1200/yr for `.in`/`.com`). Step-by-step in SETUP_CHECKLIST.md §Hosting.
- **Sensitive?** Host account passwords: YES (never in chat). Domain name choice: not sensitive.
- **What continues meanwhile:** the production build is verified (`next start` smoke-tested locally); all deployment artifacts (health check, cron endpoint, env template) are ready.

### 🔒 BLOCKER #5 — Production PostgreSQL
- **What:** a managed Postgres connection string (Neon / Supabase / Railway / Render / RDS) + `DATABASE_URL` on the host.
- **Why:** the sandbox DB is local-only and dies with the sandbox. Schema + migrations are verified and apply cleanly (`prisma migrate deploy`).
- **Sensitive?** YES — connection string contains a password; host env only.
- **What continues meanwhile:** everything local.

Also in D (non-blocking decisions): cron scheduler for `/api/cron/jobs` every 5 min with `Authorization: Bearer <CRON_SECRET>` (Vercel Cron / cron-job.org — free); production values for `APP_URL`, `SESSION_TTL_DAYS`, `CRON_SECRET`, `SUPPLIER_WEBHOOK_SECRET`.

## Category E — Business / compliance / brand (asked, never invented)

### 🔒 BLOCKER #6 — Legal & brand facts
- **What (checklist — answer in plain text, nothing secret):**
  1. **E1 Brand:** confirm the store name is **Zenvora** (already set via `APP_NAME` + settings; internal cookie names stay `resellix_*` unless you want a cosmetic rename — say so).
  2. **E2 Legal name + GSTIN:** the registered business name for invoices/policies, and GSTIN if registered (if unregistered, say "unregistered" — invoicing then follows unregistered-dealer rules; **get accountant verification, this tool gives no tax guarantees**).
  3. **E3 Policies:** the four policy pages (terms/privacy/shipping/returns) contain honest generic drafts — they need YOUR real return window, shipping promise, and contact details before launch. Provide: return window days, shipping timelines, support email + phone.
  4. **E4 Support contact:** a real support email (also used as `EMAIL_FROM` once BLOCKER #4 is resolved).
- **Why:** compliance content must be factually yours; fabricating legal/tax details is prohibited (and illegal).
- **Sensitive?** GSTIN is business data — put it in Settings/policies pages, not chat, if you prefer.
- **What continues meanwhile:** everything; these only block the final launch checklist.

## Category F — Optional (nice-to-have, not blocking)

- **F1 Real email provider (BLOCKER #4 until launch):** SMTP/Resend/Brevo credentials → real order emails. **Sensitive: YES** (`SMTP_*` env). Until then: console/log provider only — the app never claims emails were delivered. *(Listed optional for local dev, REQUIRED before taking real orders — customers must receive order/tracking emails.)*
- F2 Redis (only if you scale to multiple server instances — in-memory rate limits are per-process).
- F3 Product analytics (Plausible/Umami), image CDN, real product photography to replace `DEMO-` seed images.

---

## Priority order (fastest path to FULLY LIVE AUTOMATED RESELLING)

1. **C1 decision** (supplier API vs manual) — unblocks fulfilment design immediately, no money needed.
2. **B1 Razorpay** (start with TEST keys — free) — unblocks real payment rehearsal.
3. **D1 hosting + D2 domain + D5 Postgres** — unblocks deployment (LIVE).
4. **F1 email + E1–E4 compliance facts** — unblocks taking real orders responsibly.
5. Run `npm run cleanup:demo -- --execute` on the production DB, flip demoMode off, then launch.
