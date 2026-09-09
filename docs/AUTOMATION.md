# Automation map

Labels used (only these five): **AUTOMATED · PARTIALLY AUTOMATED · REQUIRES CONFIGURATION ·
MANUAL · NOT SUPPORTED**.

| Capability | Label | Notes |
| --- | --- | --- |
| Price computation from costs + rules | AUTOMATED | `src/lib/pricing/*`; breakdown on every price |
| Pricing rule hierarchy PRODUCT>CATEGORY>SUPPLIER>GLOBAL | AUTOMATED | `resolve.ts`, admin UI with live previews |
| Minimum-margin protection on coupons/discounts | AUTOMATED | cart preview + authoritative gate in order creation |
| Inventory reservation at order time (oversell-proof) | AUTOMATED | conditional `updateMany` inside transaction |
| Inventory history (`InventoryMovement`) | AUTOMATED | ORDER_PLACED / ORDER_CANCELLED / RETURN_RESTOCK / RTO_RESTOCK / ADJUSTMENT / SUPPLIER_SYNC |
| Restock on cancel / return-received / RTO-received | AUTOMATED | `restockOrderItems` — transactional + idempotent |
| Order lifecycle state machine + audit trail | AUTOMATED | `orders/state.ts`; every transition → `OrderEvent` |
| RTO lifecycle (SHIPPED/OFD → RTO → RTO_RECEIVED → refund) | AUTOMATED | endpoint `POST /api/admin/orders/:id/rto` |
| Coupon engine (scopes, caps, limits, windows, per-user, first-order-only) | AUTOMATED | server-side only; one coupon per cart (non-stacking by design) |
| Low-stock detection with per-product thresholds | AUTOMATED | `Product.lowStockThreshold`; dashboard card, inventory tab, storefront badges |
| Job queue + cron runner (webhook retries, syncs, cleanup) | AUTOMATED | `src/lib/jobs.ts`; Vercel cron hits `/api/cron/jobs` with `CRON_SECRET` |
| Email notifications | PARTIALLY AUTOMATED | provider abstraction; default `console` logs instead of sending — set `EMAIL_PROVIDER=smtp` + creds to really send. The system never pretends an email was sent. |
| Razorpay prepaid payments + webhook verification | REQUIRES CONFIGURATION | keys absent → `/api/health` reports `paymentsConfigured:false`; COD stays available |
| Refunds to gateway | PARTIALLY AUTOMATED | automated once Razorpay configured; COD refunds are MANUAL (bank/UPI transfer + admin record) |
| CJ Dropshipping order push + payment + tracking | PARTIALLY AUTOMATED | full adapter (`suppliers/cj.ts`); needs `CJ_API_KEY`, wallet balance, product SKU mapping, and a real test order before calling it live |
| CJ webhooks | PARTIALLY AUTOMATED | CJ webhooks are UNSIGNED → ingress only triggers an authenticated re-fetch (`{ok:true,ignored:true}` for unknown events); payloads are never trusted |
| Supplier stock sync | PARTIALLY AUTOMATED | CJ `stock/queryByVid` via adapter; MANUAL suppliers need manual counts |
| Persistent image storage | REQUIRES CONFIGURATION | `STORAGE_PROVIDER=local` is ephemeral on Vercel; configure `s3` or `cloudinary` (see ENVIRONMENT.md) |
| Analytics | AUTOMATED | computed from real orders/payments only; estimates labelled as estimates |
| Flipkart / Meesho supplier integration | NOT SUPPORTED | no legitimate public APIs exist for dropshipping; we will not build scrapers/workarounds |
| GST invoicing / legal compliance | MANUAL | invoice numbering exists; tax filing and compliance need your CA — not legal advice |

Nothing above claims more than what the code does today. Items marked REQUIRES CONFIGURATION
list their exact env vars in `docs/ENVIRONMENT.md` and `USER_INPUT_REQUIRED.md`.
