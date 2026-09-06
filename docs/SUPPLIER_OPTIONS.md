# Supplier options for Zenvora — general-product reselling (decision of 2026-09-05)

Owner's model (binding): general-product reselling/dropshipping — source products from
legitimate suppliers at low cost, list them on Zenvora with own margin, customer pays Zenvora,
paid orders auto-forward to the supplier, supplier ships direct with tracking, Zenvora records
cost/price/fees/margin. **POD suppliers (Printrove/Qikink) are excluded by owner decision.**
Lowest-cost legitimate route required. No workarounds that violate marketplace terms.

## Explicit negative findings (verified 2026-09-05)

- **Flipkart: NOT a legitimate route for this model.** Sellers must hold stock and GST; no
  public API to place fulfilment orders on behalf of third-party storefronts; dropshipping
  integrations are not supported. We will not build scraping/order-proxy workarounds.
- **Meesho: NOT a legitimate route for this model.** Reselling exists only inside Meesho's own
  app/social flow; catalogue is locked to Meesho; no public reseller order API for external
  storefronts; no branding. Same conclusion for GlowRoad/Roposo (closed reseller ecosystems).
- **Amazon/Shopsy/IndiaMART/Udaan:** no public automated-fulfilment API for resellers
  (IndiaMART/Udaan = manual/B2B lead flows). Not suitable for hands-off forwarding.

## Recommended route: CJ Dropshipping (implemented: supplier type `CJ`)

Why (against the owner's checklist):
- Broad general catalogue (not POD) + sourcing requests for products not listed.
- Official public REST API v2 (developers.cjdropshipping.com): auth token exchange/refresh,
  category/product/variant/stock queries, createOrder(V2/V3), order list/detail, wallet
  balance + balance payment, freight calculation, logistics trackInfo, webhook registration.
- Automated order placement: Zenvora forwards paid orders via `createOrderV2` + wallet payment;
  retries are idempotent (same platform order number; duplicate-create path reuses the
  existing CJ order instead of duplicating).
- Customer-direct shipping + tracking: trackInfo + ORDER/LOGISTICS webhooks; Zenvora treats
  webhooks as TRIGGERS ONLY and re-verifies status through the authenticated API.
- Inventory/price sync: stock queries per vid/sku; catalogue import via Admin → supplier sync;
  USD costs convert with an explicit `fxRateInrPerUsd` config (never a hidden rate).
- Cost: free to join, pay-per-order from CJ wallet — no upfront platform fee.
- Contractually designed for third-party storefront dropshipping (Shopify/Magento/WooCommerce
  integrations exist), i.e. permitted reseller use.

Honest gaps (documented, not hidden):
- **COD: CJ does not support cash-on-delivery on India lines.** Zenvora therefore auto-forwards
  prepaid orders; COD orders for CJ-mapped products must be confirmed/forwarded by the admin
  (wallet is debited when forwarded) — the admin UI says exactly this.
- India delivery 7–15 days from CN warehouses; import duty/GST on cross-border parcels is the
  importer's responsibility — verify compliance before scaling (not legal advice).
- Cancellations/returns/refunds are NOT in CJ's public API v2 → adapter reports those
  capabilities false and routes them to manual CJ-dashboard steps.
- Wallet must keep balance; unpaid CJ orders surface in Admin → Supplier orders as PENDING with
  the exact reason (never silently "fulfilled").

## Fallback / secondary routes (kept in code)

- `HTTP_REST` generic adapter: any future Indian wholesaler/3PL that gives you API credentials
  can be connected by configuration only (docs/SUPPLIER_API.md).
- `MANUAL`: honest default queue — admin fulfils and records tracking; nothing is faked.
- `DEMO`: development simulator only, hard-blocked in production.

## Re-evaluation triggers

Re-audit when: CJ changes India lines/COD policy, or an Indian general supplier publishes a
real public fulfilment API (watch: DropHippo, Baapstore, Deodap — automation claims exist but
no verifiable public API docs as of 2026-09-05), or ONDC buyer-app reselling becomes practical.
