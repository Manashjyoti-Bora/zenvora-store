# Payments

Provider-agnostic by design: the checkout talks to a payment adapter interface; **Razorpay is the
first adapter** (`src/lib/payments/`). Prepaid status is **REQUIRES CONFIGURATION** until the
complete integration is set — `/api/health` reports `paymentsConfigured:false` and the storefront
honestly offers COD when COD is enabled. A direct API request cannot create a new prepaid order
while provider selection is `NONE`.

All four Razorpay values below are required for availability. The browser key ID must exactly match
the server key ID, and key prefixes must match the runtime (`rzp_live_` in Production; `rzp_test_`
elsewhere). Missing, mismatched, unrecognised, or wrong-environment values fail closed; they never
make Razorpay appear available. This remediation does not enable a real gateway.

## Razorpay (prepaid) — setup steps

1. Create account at razorpay.com, complete KYC (needs your business/GST details — we never invent
   these).
2. Dashboard → Settings → API Keys → generate **Key Id + Key Secret**.
3. In **Vercel → zenvorastore → Settings → Environment Variables** set:
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (secret — server only)
   - `NEXT_PUBLIC_RAZORPAY_KEY_ID` (client-safe id only)
   - `RAZORPAY_WEBHOOK_SECRET` — you invent this (`openssl rand -hex 32`)
   - `PAYMENTS_TEST_MODE=false` once KYC is live (test mode is clearly labelled while true)
4. Razorpay Dashboard → Webhooks → add `https://zenvorastore.vercel.app/api/payments/razorpay/webhook`
   with events `payment.captured`, `payment.failed`, `refund.created`, `refund.failed` and the
   same secret.
5. Verify `/api/health` → `paymentsConfigured:true` only after the complete owner-approved setup.
   Use isolated TEST-provider journeys for development evidence. Any real Razorpay verification
   requires separate owner approval, an approved environment, and non-customer test procedures;
   do not use a customer order as a test.

Security invariants (already in code): server-side signature verification of checkout results and
webhook HMAC before any state change; idempotent webhook handling (no duplicate captures);
refunds only via admin action with audit; **no card/UPI credentials ever stored**.

## COD — AUTOMATED (architecture), reconciliation MANUAL

- COD fee + availability come from Admin → Settings → Shipping & COD; COD orders skip gateway and
  confirm immediately (`ORDER_CONFIRMED`, `paymentStatus: COD_PENDING`).
- RTO flow is first-class: courier failure → `RTO` → parcel back → `RTO_RECEIVED` (LOCAL stock
  auto-restocks with movement history) → refund/close.
- Reconciliation: when the courier remits cash, mark the order paid from Admin → Orders/Payments;
  the Payments ledger records method, amount and actor. Automated bank-statement matching is not
  claimed — that is MANUAL until a courier settlement API is configured.

## Refunds

- Prepaid: admin refund action calls the gateway refund API (once configured) and tracks
  `Refund` rows through webhook confirmation.
- COD: record the owner-verified manual settlement method/reference against the order — the ledger
  keeps the audit trail, but the application itself does not transfer cash or prove a bank deposit.

## What we do NOT do

- No fake payment success states; demo/test mode is visibly labelled and never reported as live.
- No second gateway is wired yet — the adapter seam exists (PhonePe/PayU/Stripe can be added
  without touching checkout logic).
