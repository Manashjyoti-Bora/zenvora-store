# Zenvora — owner action required

**Launch status: OWNER ACTION REQUIRED.** This is an evidence checklist, not legal, tax, medical, or regulatory advice. Do not place production orders until every applicable item is resolved and independently verified.

Do **not** paste passwords, API secrets, SMTP passwords, database URLs, or payment secrets into chat or Git. Enter secrets only in the appropriate provider dashboard and Vercel environment settings. Do not send customer data as evidence.

## 1. Genuine business identity and contact details

Supply the owner-verified details through the approved private business-information channel, then review the rendered storefront before launch:

- Legal entity/proprietor name and customer-facing trading name.
- Entity type and registered/business address actually used for notices and invoices.
- Monitored support email, customer-support phone, operating hours, and expected response process.
- Invoice legal name/address and GSTIN **only if actually registered and professionally confirmed**.
- Jurisdiction/governing-law details selected after professional policy review.

Do not infer these from GitHub, Vercel, a domain name, seeded settings, or this document. Placeholder contact/business values are not launch evidence.

## 2. Policy, jurisdiction, and grievance review

Have a qualified professional review the policy templates for the real entity, products, suppliers, fulfilment process, and applicable law. Confirm:

- Applicable consumer/e-commerce, privacy, tax, product, and sector-specific obligations.
- Return/refund/cancellation rights and timelines match the real operating process.
- Grievance officer/contact details and appointment where applicable, including monitored contact route and escalation process.
- Actual jurisdiction/governing-law wording and any required statutory disclosures.

The application warning that policies are templates must not be treated as legal review. No jurisdiction or grievance appointment has been invented here.

## 3. Verified products, claims, and suppliers

For every SKU intended for publication, provide or retain verifiable evidence of:

- Exact specifications, contents, dimensions/materials, usage instructions, warnings, warranty/return restrictions, and genuine product images/usage rights.
- Supplier identity and contact process, source/invoice authenticity, stock/lead-time process, and who handles fulfilment defects and returns.
- Safety, testing, certification, licence, labelling, and other compliance documents applicable to that exact product and claim set. A supplier statement alone is not independent certification.

### Fetal-heart-rate product — keep unpublished

Any fetal-heart-rate/fetal-Doppler product must remain **DRAFT/unpublished**. Do not publish it through admin, seed, supplier sync, or import until the owner has verified the exact product, every performance/health claim, instructions/warnings, supplier authenticity, and all applicable medical-device/safety/compliance obligations with qualified professionals. Do not guess its regulatory classification or imply diagnostic/medical benefits. If such a row exists in a live catalog, the owner must unpublish it through the approved admin process; this remediation has not changed any Production product.

## 4. Cloudinary — Preview configuration only

In Cloudinary, use the owner account’s **Dashboard / API Keys**. In Vercel → `zenvora-store` → **Settings → Environment Variables**, configure **Preview only**:

| Variable                | Source/value          | Handling                                     |
| ----------------------- | --------------------- | -------------------------------------------- |
| `STORAGE_PROVIDER`      | `cloudinary`          | Configuration, not a secret                  |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name | Configuration, not a browser variable        |
| `CLOUDINARY_API_KEY`    | Cloudinary API key    | Treat as sensitive; server-only              |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret | **Secret; encrypted/sensitive, server-only** |
| `CLOUDINARY_FOLDER`     | `zenvora-preview`     | Separate from any future Production folder   |

Do not use `NEXT_PUBLIC_*` for these values. Save and create an approved **Preview redeploy**; existing deployments do not pick up new values. Do not add Production variables as part of this verification.

Using a synthetic **draft Preview product**, verify and record deployment ID/date/evidence for: admin upload, public HTTPS loading, persistence across another Preview redeploy, responsive Next.js optimization at mobile/desktop sizes, attached-image delete returning 409, safe deletion only after detach using the exact managed key, and Android Chrome rendering. Never test deletion on a referenced or Production image. Full procedure: [`STORAGE_SETUP.md`](./STORAGE_SETUP.md).

**Current evidence status: BLOCKED — real provider credentials/configuration were unavailable in the inspected Preview.** Mocked tests are not proof of cloud-account or public-policy behavior.

## 5. SMTP and worker verification — Preview only

Use an owner-controlled transactional email provider and test inbox. Configure Preview-only values in Vercel:

| Variable         | Required value                                            |
| ---------------- | --------------------------------------------------------- |
| `EMAIL_PROVIDER` | `smtp`                                                    |
| `SMTP_HOST`      | Exact SMTP hostname                                       |
| `SMTP_PORT`      | Provider-approved port, commonly `587`                    |
| `SMTP_SECURE`    | Provider-approved TLS mode (`true`/`false`; do not guess) |
| `SMTP_USER`      | SMTP username; server-only                                |
| `SMTP_PASS`      | SMTP password/token; **secret, server-only**              |
| `EMAIL_FROM`     | Verified sender identity approved by the provider         |
| `EMAIL_REPLY_TO` | Monitored reply mailbox, if used                          |
| `SUPPORT_EMAIL`  | Monitored customer-support mailbox                        |

Redeploy Preview, use only an owner-controlled synthetic order/inbox, and record accepted delivery plus actual inbox receipt, sender, and timestamp. A `SENT` console-provider row is not inbox evidence. Verify the scheduled worker separately: an HTTP 200 cron response means the endpoint ran; `claimed:0` means no due work; `succeeded` means handlers completed; `retried`, `rescheduled`, and `failed` must be inspected by job/notification ID. Configure `CRON_SECRET` server-only and confirm the actual Preview scheduler through Vercel—never through a public unauthenticated trigger.

## 6. Real supplier fulfilment information

Document the real process before enabling customer orders:

- Which products use manual versus API fulfilment; supplier order acceptance and failure handling.
- Actual dispatch owner, courier/tracking process, lead times, serviceable regions, and customer-notification responsibility.
- COD cash collection/remittance reconciliation and evidence.
- Return eligibility inspection, pickup/return address, receipt confirmation, restocking, and refund approval responsibilities.
- Manual COD settlement method/reference and reconciliation; gateway refund reconciliation if a real gateway is ever approved.
- Failed delivery, RTO, lost/damaged parcel, supplier cancellation, and support escalation procedures.

API supplier credentials, if applicable, belong only in approved server-side environment settings. Manual supplier records are queues, not proof that an external supplier accepted an order.

## 7. GST and invoicing decisions requiring professional advice

Obtain advice from a qualified Indian tax professional for the real entity and products:

- Registration requirements and verified GSTIN/legal invoice identity.
- Applicable HSN codes, tax rates, tax-inclusive/exclusive pricing, place-of-supply treatment, and any marketplace/e-commerce obligations.
- Invoice contents, numbering, delivery timing, credit notes/refunds, retention, and accounting reconciliation.

Do not treat a settings toggle, tax estimate, or template invoice as compliance evidence.

## 8. Neon recoverability evidence

In the Neon console, record the actual Production branch backup/PITR availability and retention, then restore a chosen point to a **new isolated branch** and complete read-only schema/migration and non-sensitive aggregate checks. Never overwrite Production or attach a deployed store to the restore branch. Record project/branch IDs, recovery timestamp, duration, and result without connection strings or customer data. Exact evidence gate: [`OPERATIONAL_VERIFICATION.md`](./OPERATIONAL_VERIFICATION.md). Current restore success is **NOT VERIFIED**.

## Exact next owner action

1. Keep the fetal-heart-rate product unpublished and complete the identity/product/supplier/legal/tax evidence above through private owner channels.
2. In **Vercel Preview only**, configure Cloudinary and SMTP, ensure authorized Preview access and an appropriately frequent authenticated worker schedule are configured, then redeploy Preview. Do not paste secrets into chat or change Production.
3. In Neon, record actual PITR/retention and perform the isolated restore rehearsal without changing Production.
4. Ask for the Preview verification run with the new deployment URL/ID. Provide only non-secret evidence (deployment ID, test product identifier, owner-controlled test-inbox result, and Neon restore record); never provide secret values.
