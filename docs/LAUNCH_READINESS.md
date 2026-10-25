# Zenvora — Launch Readiness (business, legal, operational)

Status as of 2026-10-25: **DEMO MODE — NOT LAUNCH-READY. Owner inputs and professional advice
required.** This document is not legal or tax advice; it lists obligations found in official
Indian sources so the owner and a professional can resolve them deliberately.

Facts supplied by the owner (the only business facts used anywhere in the product):

| Item | Value |
|---|---|
| Support e-mail | `manashjyotibora122@gmail.com` (now configured via `SUPPORT_EMAIL` on Vercel Production + Preview; Admin → Settings still wins once saved) |
| Business type | Individual (no company yet) |
| GST registration | Unknown / not yet |
| Registered address, phone | Not configured |
| Returns / refund policy | Not configured (code default: 7-day return window, 24 h cancellation — placeholders until the owner confirms) |
| Payments | Test / disabled (`provider: NONE` in production health) |

Nothing else (legal name, GSTIN, grievance officer, phone, address) has been invented; the
policy pages print "to be appointed by the store owner before launch" in those slots.

---

## 1. First decision: seller of record or marketplace?

Everything below depends on this. The code and supplier integration (CJ dropshipping, see
`docs/SUPPLIER_SETUP.md`) make Zenvora the **party that takes the customer's order, sets the
price, collects payment and arranges fulfilment**. Customers see no third-party seller. That is
the *inventory / own-storefront* model: **Zenvora (the owner, as an individual) is the seller of
record**, not a marketplace facilitating sales between others. The Consumer Protection
(E-Commerce) Rules, 2020 distinguish "marketplace e-commerce entity" from "inventory e-commerce
entity"; both must comply with the general duties in Rule 4, and inventory entities carry the
seller duties themselves (Rule 7).

**Owner question Q1 (precise):** Do you confirm Zenvora sells goods in its own name (you are the
seller; the supplier is your vendor), rather than hosting third-party sellers? If yes, the
remaining items are all yours to satisfy; if you intend a marketplace model, the product would
need seller onboarding, seller disclosures and contracts that do not exist today.

## 2. Obligations found in official / primary sources

### 2.1 Consumer Protection (E-Commerce) Rules, 2020 (Department of Consumer Affairs)

Applies to all goods/services bought or sold over a digital network in India. Key duties for an
inventory e-commerce entity, each mapped to the product:

| Duty (Rule) | Product status | Who closes it |
|---|---|---|
| Display legal name, principal geographic address, name of website, contact details (e-mail, customer-care number) — Rule 4(2) / 5(3) / 7 | Fields exist in Admin → Settings → Business and on policy pages; **values empty** | Owner enters; address/phone are owner-dependent |
| Appoint a **grievance officer**, display name, designation, contact; acknowledge within **48 hours**, redress within **one month**, provide a ticket number (Rule 4(4)–(5)) [1](https://www.taxtmi.com/tmi_blog_details?id=621660) [2](https://www.livelaw.in/columns/consumer-protection-in-the-online-marketplace-an-analysis-of-consumer-protection-e-commerce-rules-2020-161516) | Privacy page prints a grievance slot using the support e-mail + legal name; contact form stores a ticket (`ContactMessage`) but **no SLA tracking or designation field** | Owner names the officer (can be the owner); engineering can add designation + 48 h/30 d SLA view on request |
| Country of origin, total price breakup (incl. compulsory/voluntary charges), delivery/shipment, return/refund/exchange/warranty terms, payment methods (Rule 6(5), 7) | Price breakup, shipping and payment method are shown at checkout; **country of origin is not stored** for CJ products; returns policy text is a placeholder | Engineering (origin field from supplier data when available) + owner (policy text) |
| No manipulation of price, no false reviews, no misleading advertisements (Rule 4(3), 4(11)) | No review system exists; no fake scarcity/discount UI by design | Keep as is |
| A 2026 amendment adds that the grievance officer must give the complainant a copy of the complaint as recorded [3](https://lexcomply.com/blog/consumer-protection-ecommerce-amendment-rules-2026-6ab1fea397f24) | Contact form does not e-mail the complainant a copy | Engineering, once SMTP is confirmed working (it is configured in production) |

### 2.2 GST (Central Goods and Services Tax Act, 2017)

- Selling goods through one's own website is still "electronic commerce"; the normal registration
  thresholds apply to intra-state supply of goods, but **inter-state supply of goods requires
  compulsory registration under Section 24(i) regardless of turnover** (the relaxations in
  Notifications 34/2023 and 37/2023 cover only *intra-state* supplies through an operator that
  collects TCS, with PAN enrolment) [4](https://taxguru.in/goods-and-service-tax/notification-exemption-gst-registration-eco-suppliers.html) [5](https://gstindiaonline.com/pages/gstlegislation/GSTN%20Guides/GSTN_Guides_Pdf/2023/Facility%20of%20enrolment%20for%20supply%20of%20goods%20through%20e-commerce%20operators.pdf).
  An India-wide storefront shipping outside Assam is inter-state supply.
- Cross-border dropshipping (CJ ships from abroad to the customer) raises the separate question
  of who is the **importer on record** and who pays customs duty/IGST at import
  (`docs/SUPPLIER_SETUP.md` already flags this). Mis-declaring the customer as importer without
  telling them is a consumer-protection risk as well.
- Product status: `gstin` field exists; invoices/receipts show the GSTIN only when set; prices
  are stored tax-inclusive with no tax lines. If registration is obtained, invoice format
  (GSTIN, HSN, tax split, place of supply) becomes a required engineering item.

**Owner question Q2:** Will you ship outside Assam (inter-state)? **Q3:** For CJ-fulfilled
orders, who is the importer of record (you, or the customer)? Both need a GST practitioner's
answer before the first real paid order.

### 2.3 Digital Personal Data Protection Act, 2023 and DPDP Rules, 2025

- Rules notified 13 November 2025 (G.S.R. 846(E)). Board/definitions in force immediately;
  Consent Manager registration from 13 November 2026; the substantive data-fiduciary duties
  (notice, security safeguards, 72-hour breach report, retention/erasure, grievance mechanism,
  children's data) commence **13 May 2027** [6](https://www.ilflaw.com/publications/digital-personal-data-protection-rules-2025-notified/) [7](https://veritect.ai/digital-data-ai-law/dpdp-rules-2025-phased-rollout) [8](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf).
- Product status: essential cookies only (no trackers); privacy policy page exists with a
  grievance slot; account deletion/erasure flow and data-retention schedule are **not**
  implemented; breach-notification runbook does not exist.
- Not a day-one blocker by statute, but a privacy notice that is true today (what is collected,
  why, how to contact) **is** required by the e-commerce rules and should be reviewed now.

### 2.4 Payments

- Razorpay (or any gateway) requires KYC in the seller's legal name; as an individual the owner
  can onboard as a sole proprietor, but the settlement account and the name on invoices must
  match. Keys stay out of production until the owner explicitly authorises go-live
  (`docs/PAYMENT_SETUP.md`). Production currently reports `payments: NONE`.

## 3. Checklist

### Required before the first real paid order
- [ ] Q1 answered (seller of record) — owner.
- [ ] Legal/trading name, principal address, customer-care e-mail **and phone** entered in Admin →
      Settings → Business — owner.
- [ ] Grievance officer named (name, designation, contact) and published — owner; engineering adds
      designation field + SLA view if requested.
- [ ] Returns/refund/cancellation policy text written by the owner (current numbers are defaults).
- [ ] GST position determined with a practitioner (Q2/Q3); GSTIN entered if registered — owner +
      professional.
- [ ] Payment gateway KYC completed; keys set in Vercel **Production** only; explicit go-live
      approval — owner.
- [ ] Verified e-mail delivery of order confirmations from the real sender domain — owner confirms
      receipt of a test message (SMTP is configured; delivery to external inboxes not yet verified).
- [ ] Persistent media storage (S3/Cloudinary) credentials — owner (local storage is ephemeral on
      Vercel).

### Conditional
- [ ] Country-of-origin display per product (when supplier data provides it) — engineering.
- [ ] GST-compliant invoice format (only if registered) — engineering.
- [ ] Importer-of-record disclosure in checkout/policies (only if the customer is the importer) —
      engineering after Q3.
- [ ] Complaint-copy e-mail to complainant (2026 amendment) — engineering, after SMTP verification.

### Optional / good practice
- [ ] Custom domain and matching sender domain (SPF/DKIM).
- [ ] Data-retention and account-deletion flow ahead of the 13 May 2027 DPDP commencement.
- [ ] Trademark search for "Zenvora".

### Owner decisions (cannot be made by engineering)
- Business form (individual vs. registering a firm/LLP) and bank account for settlements.
- Which supplier terms are acceptable (lead times, returns coordination, customs).
- Whether to enable automatic publishing of supplier products (currently **OFF**; stays off until
  explicitly enabled).

## 4. What engineering has already done this round for business info

- `SUPPORT_EMAIL` environment variable (`src/lib/env.ts`) applied by
  `applySupportEmailFallback()` in `src/lib/settings.ts`: used only while the stored setting is
  the shipped `support@example.com` placeholder; a value saved in Admin → Settings always wins.
  Unit test: `tests/unit/support-email-fallback.test.ts`. Set on Vercel (Production + Preview)
  with the owner-supplied address; takes effect on the next deployment.
- No other business field was populated.

## 5. Professional advice

Engage a GST practitioner/CA (registration, inter-state supply, import model, invoicing) and,
before scaling, a lawyer for the consumer-protection disclosures and the DPDP notice. The
timelines and thresholds above are quoted from secondary summaries of official notifications;
verify the primary text (CBIC notifications, Gazette G.S.R. 846(E), the E-Commerce Rules and
their 2026 amendment) before relying on them.
