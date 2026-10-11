# Zenvora — Publication & Availability Hardening (new work, not a recovery)

**Status:** implementation plan + change log for review.
**Basis:** audit of `main` @ `99b6444`. This is **new work**. It is *not* the lost
implementation from commits `1877b32` / `7ed85e2` (those commits were never pushed and are
unrecoverable — see the recovery report). Nothing here claims to reproduce them.

## Why these changes

The audit found five genuine gaps in the current code. Each is a correctness risk, not a style
preference:

| # | Gap | Risk today |
|---|---|---|
| 1 | `StockMode.SUPPLIER_SYNC` is the **default**, and `lineAvailable()` returns `available: true` unconditionally for it | An out-of-stock supplier product can be ordered and paid for; the failure only surfaces at fulfilment (`checkStock`) **after** the customer has paid |
| 2 | Storefront/PDP/Sitemap advertise `Product.stock` (a LOCAL merchant counter) for supplier-synced products | The storefront can claim "In stock" from a number that no supplier feed ever wrote |
| 3 | `supplierCost` accepts `0` (validation is `nonnegative`), and the sync route only skips `null`/non-finite costs | A `0` supplier cost flows into the pricing engine → a ₹0.00 selling price → a live, free product |
| 4 | No supplier catalog product can be published from a synced `SupplierProduct` | The only path from "synced" to "on sale" is hand-creating a product; the mapping screen is a dead end |
| 5 | No `revalidatePath` anywhere; sitemap includes any `ACTIVE` product | Sitemap can include products with no valid price; if any route ever becomes cached, product changes would not propagate |

## Change set

### 1. Availability model — one source of truth (`src/lib/catalog/availability.ts`, new)
Pure, tested function used by storefront, PDP, cart and checkout:

- `LOCAL` → stock counts (unchanged behaviour): `OUT_OF_STOCK` at 0, `LOW_STOCK` at/below threshold.
- `SUPPLIER_SYNC` + **fresh** supplier row (`lastSyncedAt` within `SUPPLIER_SYNC_FRESHNESS_HOURS`) →
  `OUT_OF_STOCK` when `inStock === false` or `stockQty <= 0`; `IN_STOCK`/`LOW_STOCK` when the supplier
  positively reports stock (quantity caps the line).
- `SUPPLIER_SYNC` without a mapping, or with stale/unknown supplier data → `UNVERIFIED`.
  **Not advertised as in stock, and not fabricated as out of stock** — the label says availability is
  confirmed by the supplier at checkout.
- `OUT_OF_STOCK` is the only state that blocks purchase (`purchasable === false`), so unverified
  products are never silently un-purchasable — but they are never falsely advertised either.

### 2. Wire it through (`src/lib/catalog/storefront.ts`, `storefront/product-card.tsx`, PDP, `src/lib/cart/service.ts`, `src/lib/orders/create.ts`)
Card/detail queries join `supplierProduct`; `ProductCardData` carries `availability`. Cart and order
creation already call `lineAvailable()` — that function now delegates to the model above, so
storefront, PDP, cart and checkout share one implementation. `inStockOnly` filtering stops using the
LOCAL column for supplier products.

### 3. Price/cost validation (`src/lib/validation/schemas.ts`, `src/lib/catalog/products.ts`, sync + map routes)
- ACTIVE + `SUPPLIER_SYNC` requires `supplierCost > 0`.
- ACTIVE requires a computed `sellingPrice > 0` (checked after the pricing engine runs).
- `compareAtPrice`, when set, must be **above** the selling price (a "discount" that is not one is a
  fabricated deal).
- `applyEnginePricingToProduct` refuses to write a non-positive price (leaves the previous price and
  reports a warning).
- Sync treats `costPaise <= 0` as an unknown cost and skips it (counted, surfaced to the admin).
- Map route refuses to map with a non-positive supplier cost.

### 4. Supplier-product publication (`src/lib/catalog/publish.ts` + API + mapper UI, new)
`POST /api/admin/supplier-products/[id]/publish` (admin-only) creates a catalog product from a synced
supplier entry: valid cost required, description is an honest placeholder (no invented marketing
copy), pricing runs through the engine, mapping is linked, audit-logged. Defaults to **DRAFT**;
`ACTIVE` additionally requires explicit `name`/`description` overrides *and* a positive computed
price. Already-mapped entries are refused (conflict) to protect existing prices.

### 5. Public response sanitization (`src/lib/catalog/public-dto.ts`, new)
A whitelist `toPublicProductDto()` — costs, margins, supplier skus and pricing-rule internals cannot
cross the boundary even if a future page spreads the raw record. Regression test asserts the DTO and
the PDP JSON-LD contain no private keys.

### 6. Cache revalidation + sitemap eligibility (`src/lib/catalog/revalidate.ts`, `src/lib/catalog/eligibility.ts`, `src/app/sitemap.ts`)
`revalidateCatalog()` invalidates home/shop/product/category/sitemap paths after publish, update,
archive, map and sync. It is dependency-injectable and failure-tolerant (a mutation never fails
because invalidation did). Note: every storefront route currently opts into `force-dynamic`, so this
is defensive/future-proof, not a caching change. Sitemap now requires `ACTIVE` **and** a positive
price via the shared `isSitemapEligible()` predicate.

## Tests added
| File | Covers |
|---|---|
| `tests/unit/availability.test.ts` | every state/transition of the availability model, incl. staleness + unknown supplier data |
| `tests/unit/public-dto.test.ts` | no private field can leak (cost/margin/rule internals) |
| `tests/unit/sitemap-eligibility.test.ts` | unpriced/unpublished products excluded |
| `tests/unit/catalog-revalidate.test.ts` | invalidation paths + failure tolerance (injected spy) |
| `tests/unit/validation.test.ts` (extended) | publication guards in `productInputSchema` |
| `tests/integration/supplier-product-publication.test.ts` | publish happy path, DRAFT default, ACTIVE gate, duplicate mapping, audit + admin-only |
| `tests/integration/supplier-availability-consistency.test.ts` | storefront ↔ cart ↔ checkout agree on supplier out-of-stock |
| `tests/integration/supplier-map-autopricing.test.ts` (extended) | zero-cost mapping refused; zero price never written |

## Explicitly out of scope
- No changes to Demo Mode or payment safeguards; production keeps `SUPPLIER_DEMO_MODE`/test payments
  exactly as configured.
- No production CJ sync, publication, or migration is executed by this work. **No schema change** —
  every field used (`SupplierProduct.inStock/stockQty/lastSyncedAt`, `Product.stockMode`) already
  exists, so there is no migration in this diff.
- No changes under `resellix/`.

---

## Verification (run in the reviewing workspace)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npx vitest run` (unit + integration) | **311/311 pass** (32 files) |
| `npx vitest run --config vitest.e2e.config.ts` (real dev server + seeded demo catalog) | **63/63 pass** (5 files) |
| `npx next build` | success (compiled; all routes built) |

Notes for the reviewer — how the environment was made faithful, and what it does **not** prove:

- This sandbox cannot reach `binaries.prisma.sh`, so Prisma's native engine could not be
  downloaded. The client was generated from the repository's own `prisma/schema.prisma` with the
  WASM engine (`engineType = "client"`, a **local-only** change that is *not* in this diff) and the
  suites were run against a real PostgreSQL 18 instance with the five real migration SQL files
  applied. `src/lib/db.ts` was routed through `@prisma/adapter-pg` via a temporary local shim for
  the duration of the runs; **that shim is not part of this change set** and `src/lib/db.ts` is
  byte-identical to `main`.
- The e2e suite is the strongest signal for the storefront changes: it renders the real home,
  `/shop`, product detail, cart, `/sitemap.xml` and `/robots.txt` pages over HTTP against a seeded
  catalog, and includes the new authorization test for the publish endpoint.
- One flake was observed once in two full unit+integration runs: 
  `tests/integration/notification-dedupe-recovery.test.ts` asserted job state `PENDING` while the
  background job runner had already claimed the job (`RUNNING`). It passes in isolation and on the
  repeat run, is unrelated to this change set (no jobs/notifications code was touched), and the new
  tests were additionally reworked to stop queuing welcome-notification jobs so they cannot add
  timing pressure to that suite.
- CI (`typecheck + lint + unit/integration on PostgreSQL 16`) remains the authoritative gate and
  runs on the real engine; it is expected to pass on this branch unchanged.

## Reviewer checklist
1. `src/lib/catalog/availability.ts` — the rules (this is the whole change in one file).
2. `src/lib/cart/service.ts` `lineAvailable()` — cart/checkout now share those rules.
3. `src/lib/validation/schemas.ts` + `src/lib/catalog/products.ts` — publication guards.
4. `src/lib/catalog/publish.ts` + its route — new write path (DRAFT by default).
5. `src/app/sitemap.ts` + `src/lib/catalog/eligibility.ts` — crawl eligibility.
6. Confirm no production action is taken by this branch (it only adds code + tests).
