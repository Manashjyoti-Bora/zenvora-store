# Supplier setup

Zenvora talks to suppliers through an **adapter abstraction** (`src/lib/suppliers/registry.ts`):
`CJ`, `HTTP_REST`, `MANUAL`, `DEMO` (never in production). No supplier is hardcoded into business
logic, and none is invented — every integration below either exists or is labelled honestly.

## CJ Dropshipping — PARTIALLY AUTOMATED (recommended route)

Why: free tier, broad catalogue, documented REST API v2 + webhooks, wallet-debit payments.
Honest limitations (disclosed, not hidden): **no India COD**, ~7–15 day CN→IN shipping,
import duty/GST is the importer's responsibility, cancellations/returns need manual coordination
with CJ support.

Setup (all secrets via Vercel env, never chat):
1. Create account at cjdropshipping.com → get your API key (Dashboard → API).
2. Set `CJ_API_KEY` in Vercel → Environment Variables.
3. Admin → Suppliers → create supplier with `type: CJ` and `apiKeyEnvVar: CJ_API_KEY`.
4. Import products (Admin → Supplier products): map each product/variant to its CJ SKU
   (`supplierSku`). The adapter resolves SKUs → vids via the stock endpoint.
5. Top up the CJ wallet (adapter can query balance and pay orders via the wallet).
6. Place ONE real test order end-to-end before trusting automation.

What the adapter automates: order push (`createOrderV2/V3` shape), wallet payment, status +
tracking re-fetch, stock queries. Retries are idempotent (dedupe keys) — supplier orders/payments
are never duplicated. Webhooks (ORDER/LOGISTICS) are treated as **triggers only**: CJ does not
sign them, so the server re-fetches authenticated state instead of trusting payloads.

## Manual suppliers — MANUAL
Admin → Suppliers (`type: MANUAL`). Orders route to Admin → Supplier orders for a human to place
with the supplier (WhatsApp/portal/phone), then mark SENT/ACCEPTED/SHIPPED with tracking. The
system tracks, reminds and audits; it does not pretend to automate what it cannot.

## Generic HTTP REST — PARTIALLY AUTOMATED
For any supplier exposing a REST API: configure base URL, auth header, endpoints and field
mappings on the supplier row; outbound calls are signed with `SUPPLIER_WEBHOOK_SECRET` (HMAC)
and inbound webhooks verified against it. Requires per-supplier configuration + testing.

## Not supported — NOT SUPPORTED
- **Flipkart / Meesho / GlowRoad / Roposo**: no legitimate public dropshipping APIs. We will not
  build scrapers or ToS-violating workarounds. (Details: `docs/SUPPLIER_OPTIONS.md`.)
- Print-on-demand (Printrove/Qikink): out of scope by your business-model decision.

## Rules the code enforces
- Supplier orders/payments/webhooks are idempotent (dedupe keys, unique constraints).
- Failures enqueue retry jobs with backoff; status stays honest (`FULFILMENT_FAILED` + audit) —
  never "shipped" without supplier confirmation.
- `SUPPLIER_DEMO_MODE`/DEMO suppliers are blocked from production use by design.
