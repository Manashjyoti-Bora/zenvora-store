# Pricing Engine

Status: **AUTOMATED** (runs on every product, cart, coupon and order — no external services required).

This is the commercial core of Zenvora. It is a **configurable, deterministic pricing engine** —
not a prediction system. It never claims to know "what will sell best"; it only computes prices
from costs and admin-configured rules, and shows its working.

## Code map

| File | Role |
| --- | --- |
| `src/lib/pricing/engine.ts` | `computePricing()` — the single math kernel (cost → price → breakdown), `prorateDiscount()` |
| `src/lib/pricing/resolve.ts` | Rule resolution: **PRODUCT > CATEGORY > SUPPLIER > GLOBAL > product defaults** |
| `src/lib/pricing/calculations.ts` | Named facade required by the spec (below) — delegates to the kernel, no duplicated math |
| `src/lib/settings.ts` | Store-wide pricing defaults (`settings.pricing`) |
| `src/app/admin/pricing-rules/*` | Admin UI to create rules with **live price previews** |
| `src/lib/checkout/coupons.ts` | Coupon evaluation incl. the minimum-margin gate |
| `src/lib/orders/create.ts` | Authoritative enforcement at order creation |

## Named functions (spec)

- `calculateCost` — supplier cost + supplier shipping + packaging + operational + return/RTO reserve
- `calculateMarkup(totalCost, price)` vs `calculateMargin(totalCost, price)` — deliberately distinct:
  markup = profit ÷ **cost**, margin = profit ÷ **price**. Never confuse the two.
- `calculateProfit` — price − cost − estimated gateway fee (net-style estimate, not a guarantee)
- `calculateSellingPrice` — from fixed price, fixed profit, percent markup, target margin, or
  min-profit floor; applies rounding rules (NONE / NEAREST_9 / NEAREST_99 / PSYCHOLOGICAL)
- `calculateDiscount` — PERCENT/FIXED, capped by coupon `maxDiscountAmount` **and** the global
  `maxDiscountPercent` setting
- Coupon eligibility covers scheduled windows (`startsAt`/`endsAt` = limited-time offers and
  scheduled campaigns), min-cart, per-coupon and per-user usage limits, category scoping, and
  `firstOrderOnly` (signed-in customers with no previous non-cancelled orders). One coupon per
  cart by design — coupons never stack.
- `calculateFinalPrice` — applies discount but never below the margin floor unless bypassed
- `calculateCODImpact`, `calculatePaymentFee`, `calculateReturnReserve`
- `minSafePricePaise`, `validateMinimumMargin` — the floor: `ceil(totalCost / (1 − minMargin%/100))`
- `resolvePricingRule`, `explainPricing` — deterministic rule hierarchy + full audit breakdown

## Automatic pricing on import / mapping (deterministic, explainable)

- **Product create/update** (`upsertProduct`) always runs the engine: selling price is computed
  from costs + the resolved rule, and the breakdown + rule id are written to the audit log.
- **Bulk repricing** (`POST /api/admin/products/reprice`, `apply` flag) previews or applies the
  engine across ALL / CATEGORY / SUPPLIER scopes.
- **Supplier-product mapping** (`POST /api/admin/supplier-products/:id/map`) syncs the supplier
  cost onto the catalog product and then re-runs the engine via
  `applyEnginePricingToProduct()` — the selling price follows the new cost automatically.
  Admin `FIXED_PRICE` overrides are preserved by construction (the engine returns them unchanged),
  so nothing is ever silently altered. The response (and the mapping UI panel) shows the full
  explanation: previous/new price, gross margin % (labelled — never "net profit"), minimum safe
  price, maximum safe discount, rule name/scope and engine warnings.
- No prediction of "what will sell" exists anywhere in this system, by design.

## Minimum-margin protection (never silently reduced)

1. Admin sets `minMarginPercent` (default 10) in **Admin → Settings → Pricing & margin protection**.
2. Every coupon evaluation receives the cart's real landed cost and caps the discount at
   `subtotal − floor`. A 50% coupon on a thin-margin cart yields the **smaller** discount, and the
   customer sees the actual applied amount — the coupon is never "applied in full" below the floor.
3. If the floor exceeds the subtotal entirely, the coupon is **rejected** with a clear reason.
4. Bypass exists only as an explicit, admin-flagged override per coupon
   (`bypassMarginProtection`, shown with a red "Margin bypass" badge). It is never implied.
5. The gate runs twice: as a fast preview in the cart (`src/lib/cart/service.ts`) and
   **authoritatively** inside order creation (`src/lib/orders/create.ts`). Client input can never
   widen a discount.

## Auditability

Every computed price carries a `PricingBreakdown` (all cost components, mode, rule id, rounding,
final price). `explainPricing()` powers admin previews; order items persist price/cost snapshots
so historical orders always show the numbers they were sold with, even if rules change later.

## Honesty rules baked in

- Estimated profit = revenue − supplier cost − shipping − gateway fee estimate − discounts.
  Actual gateway fees from Razorpay payloads override estimates when captured.
- Returns/RTO reserve (`returnReservePercent`) is included in cost models so margin is not
  overstated on COD-heavy catalogues.
- No sales predictions, no "best seller AI" — analytics report **actual** orders only
  (`src/app/admin/analytics`), and anything modelled is labelled an estimate.
