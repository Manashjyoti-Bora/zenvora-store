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
