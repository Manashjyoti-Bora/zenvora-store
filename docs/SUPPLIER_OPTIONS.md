# Supplier options for ZENVORA (research summary, September 2026)

You chose "still deciding" — these are the realistic paths for an Indian reselling store, mapped onto this codebase's supplier adapters. **Nothing here is a partnership or endorsement; public information changes fast — do your own due diligence (sample orders, written terms, margin math) before committing.** No supplier has been integrated into the code except the dev-only Demo simulator.

## Path 1 — Print-on-demand APIs (best automation fit, apparel/merch niche)
**Printrove, Qikink** (both India-based, free signup, pay-per-order; documented REST APIs), plus similar (Vendorboat, Owlprints).
- Fit: their APIs (create order, tracking webhook/poll) map cleanly onto the built-in **HTTP_REST adapter** (`docs/SUPPLIER_API.md` contract). I can write the concrete adapter once you pick one and get API docs/credentials.
- Pros: real automation, India warehousing/shipping, no inventory, COD support (varies — verify), your brand on labels.
- Cons: only POD products (apparel, mugs, posters…); per-unit costs leave thinner margins on commodity designs; you must bring design/niche + traffic.

## Path 2 — Catalogue dropshipping platforms
**CJ Dropshipping** (global, widely used in India; product import + order auto-forwarding, wallet-funded; API/developer platform exists), **Wiio** and similar agents.
- Fit: an adapter is buildable against their open API; expect wallet top-up flow, 7–15 day India shipping on many lines, and **limited COD** — which matters, since COD is a large share of Indian e-commerce.
- Pros: huge catalogue, private-label/branding options.
- Cons: longer delivery, customs/returns complexity, COD weakness, quality variance → order samples first.

## Path 3 — Indian B2B wholesalers (IndiaMART / TradeIndia / local markets)
- Fit: **MANUAL adapter** (already fully working): you buy + ship per order from Admin → Supplier Orders; add tracking numbers there; customers get the same automated emails/tracking pages.
- Pros: best margin control, fast domestic shipping, negotiable terms, GST invoices from registered dealers, COD-friendly (you control fulfilment).
- Cons: manual work per order until volume justifies asking the wholesaler for an API/CSV feed (many will do email/WhatsApp order forms — the MANUAL adapter matches that reality).

## Path 4 — Reseller apps (Meesho, Roposo Clout, etc.)
- These are closed ecosystems for social reselling; **no public API for your own storefront**, and reselling their listings on your own site may violate their ToS. Treat as sourcing inspiration only, or buy wholesale-style via Path 3 contacts instead.

## Recommended decision path (cheapest to de-risk)
1. **Launch-ready now:** MANUAL fulfilment with 1–2 products you can source locally (Path 3) + COD — zero new dependencies, everything already verified end-to-end.
2. **In parallel:** if your niche is apparel/merch → create free Printrove/Qikink accounts, read their API docs, and send me the docs (credentials go in `.env`, never chat) → I implement the HTTP_REST adapter → you get true automation.
3. **Only after real orders exist:** evaluate CJ-style platforms for catalogue breadth (verify COD + delivery times with sample orders first).

## Due-diligence checklist for ANY supplier (before committing)
- [ ] Sample order placed and received (quality, packaging, delivery time).
- [ ] Written terms: prices, shipping cost & SLA, COD availability & remittance cycle, returns/RTO policy, restocking.
- [ ] GST treatment: invoice from supplier to you; your margin math uses **landed cost** (product + shipping + any fees) — the pricing engine already computes this; never price on product cost alone.
- [ ] If API: authentication method, rate limits, sandbox availability, webhook support (their side must sign or you poll), stock/price sync frequency.
- [ ] RTO (return-to-origin) cost for COD failures — the #1 profit killer in Indian COD commerce; the admin profit ledger already deducts refunds/returns when you record them.
