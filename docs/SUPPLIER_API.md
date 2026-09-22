# Supplier API contract (HTTP_REST adapter)

Resellix is **not hard-wired to any supplier**. Fulfilment goes through a
`SupplierAdapter` abstraction with three implementations:

| Type        | What it does                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `MANUAL`    | No API. Supplier orders are queued; you fulfil them yourself and record shipment/tracking in Admin → Supplier orders.                         |
| `HTTP_REST` | Generic JSON REST adapter described in this document — connects any supplier with an HTTP API, configured per supplier (no code changes).     |
| `DEMO`      | Clearly-labelled simulator for development (accepts orders, "ships" on a schedule, reports tracking). **Hard-disabled in production builds.** |

This document specifies exactly what an `HTTP_REST` supplier API must provide,
how Resellix authenticates, what it sends, what it expects back, and how
webhooks/status polling keep tracking in sync.

---

## 1. Configuring a supplier

Admin → Suppliers → _New supplier_ (type **HTTP REST**):

- **Base URL** — e.g. `https://api.supplier.example.com/v1`
- **API key env var / API secret env var** — the **names** of environment
  variables holding the credentials (e.g. `ACME_API_KEY`). The secret values
  live only in your server environment — they are never stored in the database,
  never sent to the browser, and never written to logs.
- **Config (JSON)** — endpoint mapping, auth style, status mapping:

```jsonc
{
  // How Resellix authenticates every outbound call.
  //   bearer   → Authorization: Bearer <value of apiKeyEnvVar>
  //   x-api-key→ <header>: <value of apiKeyEnvVar>   (header name configurable)
  //   basic    → Authorization: Basic base64(apiKeyEnvVar:apiSecretEnvVar)
  "auth": { "type": "bearer", "header": "X-Api-Key" },

  "timeoutMs": 10000,

  // Endpoint paths are appended to the supplier baseUrl.
  // {sku} / {supplierOrderId} / {externalId} placeholders are substituted.
  // "response" maps OUR canonical field names to dot-paths in the supplier's
  // JSON responses (so any response shape works without code changes).
  "endpoints": {
    "products": { "path": "/catalog", "method": "GET" },
    "product": { "path": "/catalog/{sku}" },
    "stock": { "path": "/stock/{sku}", "response": { "inStock": "available", "qty": "quantity" } },
    "createOrder": {
      "path": "/orders",
      "method": "POST",
      "response": { "supplierOrderId": "id", "status": "state" },
    },
    "orderStatus": {
      "path": "/orders/{supplierOrderId}",
      "response": {
        "status": "state",
        "trackingNumber": "tracking.no",
        "carrier": "tracking.carrier",
        "trackingUrl": "tracking.url",
      },
    },
    "cancelOrder": { "path": "/orders/{supplierOrderId}/cancel", "method": "POST" },
    "requestReturn": { "path": "/orders/{supplierOrderId}/returns", "method": "POST" },
    "requestRefund": { "path": "/orders/{supplierOrderId}/refunds", "method": "POST" },
  },

  // Supplier status strings → Resellix SupplierOrderStatus enum.
  "statusMap": {
    "confirmed": "ACCEPTED",
    "rejected": "REJECTED",
    "processing": "PROCESSING",
    "in_transit": "SHIPPED",
    "delivered": "DELIVERED",
    "cancelled": "CANCELLED",
  },
}
```

Capabilities are derived from which endpoints you configure: a supplier with no
`products` endpoint simply doesn't offer catalog sync (Admin shows "sync n/a"
instead of failing).

## 2. Catalog sync (`products` endpoint)

`GET {baseUrl}{endpoints.products.path}` — Resellix expects a JSON array (or an
object with an `items`/`products` array) of:

```json
{
  "sku": "SUP-123", // required → supplierSku (unique per supplier)
  "externalId": "9981", // optional stable id
  "name": "Product name", // optional (used when auto-creating mappings)
  "cost": 412.5, // required → supplier cost in ₹ (number or string)
  "shippingCost": 30, // optional
  "stock": 17, // optional
  "inStock": true // optional (derived from stock when absent)
}
```

Sync upserts `SupplierProduct` rows keyed by `(supplierId, supplierSku)` and
records `lastSyncedAt`. Mapping rows to catalog products happens in Admin →
Supplier product mapping (costs sync onto the product when mapped).

## 3. Order placement (`createOrder` endpoint)

Triggered automatically when payment is verified (or immediately for COD), via
the job queue.

`POST {baseUrl}{endpoints.createOrder.path}`

Headers:

```
Content-Type: application/json
Authorization: per auth config
Idempotency-Key: <stable unique key per supplier order>
```

**The supplier MUST honour `Idempotency-Key`**: if a request is retried with a
key it has already processed, it must return the original result, not create a
second order. Resellix retries failed calls with exponential backoff; without
idempotency support, retries could duplicate orders.

Request body (canonical):

```json
{
  "orderNumber": "RX-260905-AB23CD", // YOUR store's order number (reference)
  "supplierOrderId": "so_cuid...", // Resellix supplier-order id
  "currency": "INR",
  "items": [
    { "sku": "SUP-123", "externalId": "9981", "quantity": 2, "unitCost": 412.5, "lineTotal": 825.0 }
  ],
  "shipping": {
    "name": "Ashok Sharma",
    "phone": "+919876543210",
    "line1": "12 MG Road",
    "line2": null,
    "city": "Guwahati",
    "state": "Assam",
    "postalCode": "781001",
    "country": "IN"
  },
  "paymentMethod": "PREPAID_GATEWAY"
}
```

Expected response (2xx) — fields are read through your `response` mapping:

```json
{ "id": "SUPORD-778", "state": "confirmed" }
```

`id` → stored as `supplierOrderId`; `state` → mapped through `statusMap` →
`SupplierOrderStatus`. On 4xx/5xx the adapter records a sanitised error; the job
is retried up to `maxAttempts` with backoff, then marked FAILED and surfaced in
Admin → Supplier orders (with a Retry button) and Admin → System health.

## 4. Status / tracking

Two mechanisms (use either or both):

### 4a. Polling (`orderStatus` / `tracking` endpoint)

`GET {baseUrl}{endpoints.orderStatus.path}` (with `{supplierOrderId}` substituted)
→ mapped through `response` (`status`, `trackingNumber`, `carrier`, `trackingUrl`).
Resellix polls while orders are in-flight via the job queue (`SYNC_SUPPLIER_ORDER`).

### 4b. Push webhooks (preferred)

`POST https://YOUR-DOMAIN/api/suppliers/webhook`

Security: every delivery carries

```
X-Supplier-Signature: <hex HMAC-SHA256 of the RAW request body, keyed with SUPPLIER_WEBHOOK_SECRET>
```

Signature is verified constant-time over the raw body before anything is
processed; failures are recorded as REJECTED in Admin → Logs → Webhook log.
Deliveries are idempotent via `eventId` (duplicate event ids are marked
DUPLICATE and skipped).

Body:

```json
{
  "supplierSlug": "acme", // identifies the supplier record
  "eventId": "evt_9911", // optional but strongly recommended
  "supplierOrderId": "SUPORD-778", // the id YOUR API returned at createOrder
  "status": "in_transit", // mapped through the supplier's statusMap
  "trackingNumber": "DLV123456789", // optional
  "carrier": "Delhivery", // optional
  "trackingUrl": "https://...", // optional
  "message": "Picked up from hub", // optional
  "events": [
    // optional tracking event list (max 50 used)
    {
      "status": "SHIPPED",
      "message": "...",
      "location": "Guwahati",
      "eventAt": "2026-09-05T10:00:00.000Z"
    }
  ]
}
```

When a webhook reports SHIPPED (with tracking), the customer's order advances
to SHIPPED, a Shipment + TrackingEvents are recorded, and the shipping
notification email is queued automatically.

## 5. Cancellation / returns / refunds

`cancelOrder`, `requestReturn`, `requestRefund` endpoints (all `POST` with
`{supplierOrderId}` substituted, JSON body `{ "reason": "..." }`). Optional —
when absent, the adapter reports the operation as unsupported and the admin UI
falls back to manual handling (contacting the supplier out-of-band and recording
the outcome in the panel).

## 6. What is logged

Every outbound call writes an `ApiLog` row: method, URL (secrets stripped),
status code, duration and a **sanitised** payload (auth headers, tokens and any
key matching secret/token/password/card/cvv patterns are redacted). Nothing in
logs or the database contains your supplier credentials — only the _names_ of
the env vars that hold them.

## 7. Implementing a compatible supplier API (checklist)

1. JSON REST over HTTPS; stable ids for products and orders.
2. Honour `Idempotency-Key` on order creation.
3. Return machine-readable status strings (you map them via `statusMap`).
4. Ideally push signed webhooks (`X-Supplier-Signature`, HMAC-SHA256 hex of the
   raw body) for status/tracking changes; include an `eventId` per event.
5. Provide catalog + stock endpoints so Admin can sync and map products.
6. Keep customer PII in responses minimal — Resellix only consumes status and
   tracking fields.

---

## CJ Dropshipping (supplier type `CJ`) — implemented contract

Base URL (fixed): `https://developers.cjdropshipping.com/api2.0/v1`
Auth: `POST /authentication/getAccessToken` with `{"apiKey": "<CJ API key>"}` →
`data.accessToken` (+ expiry, refreshToken). Authenticated calls send header
`CJ-Access-Token: <accessToken>`; refresh via `POST /authentication/refreshAccessToken`.
The API key lives ONLY in an env var; the supplier record stores just its NAME
(`apiKeyEnvVar`, default suggestion `CJ_API_KEY`). Key location: CJ dashboard →
My CJ → Authorization → API.

Supplier record `config` JSON:
```json
{
  "fxRateInrPerUsd": 88.5,          // REQUIRED - CJ costs are USD; conversion is explicit
  "logisticName": "CJPacket Ordinary", // optional shipping line
  "fromCountryCode": "CN",          // optional source warehouse country
  "platformToken": "…"              // optional, sent as platformToken header if CJ requires it
}
```

Endpoints used:
- Catalogue: `GET /product/myProduct/query` (connected products), `GET /product/variant/queryByVid`
- Stock: `GET /product/stock/queryBySku`, `GET /product/stock/queryByVid`
- Orders: `POST /shopping/order/createOrderV2` (body per CJ docs: orderNumber, shipping*,
  logisticName, fromCountryCode, platform="api", orderFlow=1, products[{vid, quantity,
  storeLineItemId}]), then `POST /shopping/pay/payBalanceV2 {orderNumber}` (wallet debit)
- Status: `GET /shopping/order/getOrderDetail`, `GET /logistic/trackInfo`
- Webhook registration: `POST /webhook/set` (order + logistics → our callback)

Product mapping: Zenvora product's supplier SKU must hold the CJ **vid** (GUID/snowflake) or a
CJ SKU (resolved via stock/queryBySku). Idempotency: `storeLineItemId` = `<job idempotency
key>:<line>`; duplicate createOrder responses fall back to `shopping/order/list` lookup so a
retry can never create a second CJ order.

Catalog sync semantics (intentional):
- Sync pulls **My Products only** (`GET /product/myProduct/query`). CJ's general catalogue
  (`/product/listV2`) is deliberately NOT auto-imported: nothing becomes publicly sellable in
  Zenvora without the owner explicitly adding it to CJ My Products, syncing, and mapping it to
  a Zenvora product with a reviewed price.
- Pagination is bounded: at most 5 pages of ≤100 items (≤500 products) per sync; a short page
  ends the loop (a small catalogue costs exactly one request).
- Items with an unknown CJ cost are **skipped** (reported as `skippedNoCost` in the sync
  response) instead of being stored with a fabricated 0.00 cost, which would corrupt
  auto-pricing and margin floors.
- A supplier whose configuration cannot construct (e.g. missing API-key env var) fails the
  sync request with the precise, secret-free reason via `diagnoseSupplierAdapter` — it never
  silently degrades to the manual adapter on this endpoint.

Diagnostics (safe, no secret values):
- `GET /api/admin/suppliers/<id>/diagnostics` → `{ configured, apiKeyEnvVar, valuePresent, adapterError }`.
  `valuePresent` only says whether the named env var exists in the current runtime — the value
  is never returned.
- The admin supplier detail page shows the same status: green when the variable is present,
  a red "Automation blocked" alert with the exact missing configuration otherwise.
- Vercel note: environment variables are read at **request time** by the Node runtime but are
  only **baked into a deployment at deploy time**. If you add `CJ_API_KEY` in the Vercel
  dashboard, you must **redeploy Production** before the running server can see it; otherwise
  diagnostics correctly report `valuePresent: false`.

Token lifecycle & self-healing (verified against CJ's current docs):
- Access/refresh tokens live **180 days**, but CJ **server-side caches the same token per
  account for 24 hours**: repeated `getAccessToken` calls inside the window return the SAME
  token, and only after 24h **or an explicit logout** (`POST /authentication/logout`) will a
  new token be generated.
- When an authenticated call is rejected with a token-class code (1600001 "Invalid API key or
  access token", 1600002 "access token cannot be empty"), CJ's official remedy is "Get new
  access token". The adapter therefore: logs out with the rejected token (best-effort, breaks
  CJ's 24h server-side cache) → clears its local token cache → exchanges a fresh token →
  retries the original call **exactly once**. Business errors (e.g. 1602001 "Product not
  found") and repeated failures are never retried or hidden.
- `1600300 "email must be not empty"` from `getAccessToken` is the **empty-key artifact**:
  1600300 is CJ's generic "Param error", and the auth validator falls back to the legacy
  email+password grant when `apiKey` arrives empty. CJ's current auth contract requires ONLY
  `apiKey` — no email parameter exists. If you ever see this, the env var value did not reach
  the request intact; check the named variable's presence via Admin → Suppliers → diagnostics.
- Rate limits: CJ documents **QPS = 1** for authentication and "consistent with other API
  endpoints" — multi-page catalog syncs pace page requests accordingly.

Inbound webhooks: `POST /api/suppliers/cj/webhook` is **trigger-only** — CJ cannot sign
payloads with our secret, so the endpoint only enqueues `SYNC_SUPPLIER_ORDER`, which re-fetches
authoritative status with our token. A forged webhook causes at most one authenticated read.

Not supported by CJ API v2 (adapter reports honestly, admin routes to manual):
cancellation, returns, refunds.
