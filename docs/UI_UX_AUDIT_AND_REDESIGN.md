# Zenvora Store — Comprehensive UI/UX Audit, CSS Architecture & Redesign Specification

**Repository:** `Manashjyoti-Bora/zenvora-store`  
**Stack:** Next.js 15.5.25 (App Router) · React 19.1 · TypeScript 5.9 · Tailwind CSS 3.4 · Prisma 6.19 · PostgreSQL 16  
**Design Identity:** *"Ink & Cream Editorial Commerce"* (Storefront) & *"Zenvora Executive Operations"* (Admin)

---

## 1. Executive Summary & Baseline Verification

### 1.1 Baseline Health (Phase 0)
- **Typecheck (`npm run typecheck`):** PASS (`0` errors)
- **Lint (`npm run lint`):** PASS (`0` errors, `0` warnings after adding `resellix/**` to ESLint `ignores`)
- **Unit & Integration Suite (`npm test`):** PASS (`26` test files, `229` tests — `125` unit + `104` integration)
- **End-to-End Suite (`npm run test:e2e`):** PASS (`5` test files, `62` E2E tests against live server)
- **Production Build (`npm run build`):** PASS (`59` app/API routes compiled cleanly)

### 1.2 Key Audit Findings
1. **Storefront vs. Admin Split-Brain Palette & Styling:**
   - Customer-facing routes use the Zenvora `ink-*` (`#0A130F`–`#8A978F`), `cream-*` (`#FAF8F3`–`#D9D1BC`), `brand-*` (`#0b2016`–`#eef7f2`), and `brass-*` (`#8A7038`–`#E7D9AE`) palette.
   - All **19 Admin routes** (`src/app/admin/**`) and **14 Admin components** (`src/components/admin/**`) still use legacy Tailwind cool-gray classes (`bg-gray-50`, `border-gray-200`, `text-gray-900`, `text-gray-500`, `bg-gray-900`) and emoji glyphs (`☰`, `🧾`, `📦`, `🛍️`, `⬇`, `📁`).
   - `src/components/ui/charts.tsx` uses hardcoded cool-gray hex codes (`#e5e7eb`, `#9ca3af`), `src/app/order/[orderNumber]/confirmation/page.tsx` uses a raw `⏳` emoji for pending payment, and `src/app/global-error.tsx` uses cool-gray inline styles (`#f9fafb`, `#111827`, `#6b7280`).
2. **CSS Token & Architecture Gaps:**
   - `src/app/globals.css` only declares `--ease-zenvora` in `:root`. Surface, border, elevation, focus-ring, and motion-duration custom properties are not tokenized as CSS variables.
   - `Button` (`src/components/ui/button.tsx`) omits `.btn-press` in its base class, leaving most `<Button>` and `<LinkButton>` instances without physical press feedback unless manually decorated.
   - Reusable commerce & operational layout primitives (`PageHeader`, `SectionHeading`, `CheckoutSteps`, `SurfaceCard`, `FilterPills`) are duplicated or ad-hoc across routes.
3. **Storefront Conversion & UX Opportunities:**
   - **Header & Navigation:** Footer logo hardcodes `Z` while Header derives `{settings.storeName.slice(0, 1)}`; MobileMenu lacks account shortcuts when signed in; SearchForm lacks a clear button and subtle focus elevation.
   - **Homepage (`/`):** Category cards are minimal single-letter tiles; "How ordering works" lacks connecting editorial structure and surface cards; value-proposition storytelling can be sharper.
   - **Catalog (`/shop`, `/categories/[slug]`, `/search`):** On mobile, `FilterSidebar` is pushed below the entire product grid (`order-2 lg:order-1`), forcing mobile shoppers to scroll past all products to filter. Active filters (`category`, `min`, `max`, `stock`, `q`) lack removable filter chips above the product grid.
   - **Product Detail (`/products/[slug]`):** `ProductBuyBox` sits directly on `bg-cream-50` without an elevated card container; specifications and description lack structured editorial card framing; related products lack `<Reveal>` and an editorial section header.
   - **Cart & Checkout (`/cart`, `/checkout`, `/checkout/payment/[orderNumber]`, `/order/[orderNumber]/confirmation`):**
     - Cart lacks a visual **Free Shipping Progress Bar** (despite `cart.freeShippingThresholdPaise` and `cart.subtotalPaise` being available).
     - Cart, Checkout, Payment, and Confirmation lack a unified **Checkout Step Indicator** (`1. Bag` → `2. Address & Payment` → `3. Confirmation`).
     - Checkout order summary omits item thumbnails (even though `cart.lines` includes `line.image`).
   - **Auth & Customer Account (`/auth/*`, `/account/*`):**
     - Auth forms float on `cream-50` without a brand medallion or security reassurance footer.
     - Account layout hides user identity on mobile (`hidden lg:block`), and `/account/orders` list items omit product thumbnail previews (despite `items[0].productSnapshot` already being queried).

---

## 2. Route-by-Route Inventory & Audit

| Route | File | Purpose | Audit Findings | Redesign Actions |
| :--- | :--- | :--- | :--- | :--- |
| **Root Layout** | `src/app/layout.tsx` | HTML shell, metadata, JSON-LD, announcement bar, Header/Footer | Solid structure; announcement bar can have refined typography & subtle border. | Preserve all JSON-LD, skip link, and admin area switch; refine announcement bar. |
| **Homepage** | `src/app/page.tsx` | Brand hero, categories, deals, featured, new arrivals, how it works | Hero is strong; category cards & "How ordering works" are visually basic. | Upgrade category cards with hover arrow & count pill; redesign 4-step editorial process cards; refine section headers. |
| **Shop Catalog** | `src/app/shop/page.tsx` | Full catalog listing with sort, price/category/stock filters | Mobile filters buried below grid; no active filter chips. | Add mobile collapsible filter drawer + desktop sticky card sidebar + active filter chip bar. |
| **Category Page** | `src/app/categories/[slug]/page.tsx` | Category-scoped catalog + JSON-LD | Plain header; mobile filter below grid. | Editorial category banner, active filter chips, mobile filter toggle. |
| **Search Page** | `src/app/search/page.tsx` | Search results listing | Basic search header. | Enhanced search header with query highlight, active filter chips, mobile filter toggle. |
| **Product Detail (PDP)** | `src/app/products/[slug]/page.tsx` | Gallery, buy box, trust specs, description, related products, sticky mobile bar | Buy box unframed on canvas; specs/description unframed; related section plain. | Frame BuyBox in elevated card; upgrade trust matrix & spec table; wrap related products in `<Reveal>` with editorial header. |
| **Cart** | `src/app/cart/page.tsx` + `cart-manager.tsx` | Line items, quantity stepper, coupon box, order summary | No free-shipping progress bar; no checkout step indicator; basic empty state. | Add CheckoutSteps (`Step 1 of 3`), truthful free-shipping progress bar, refined line cards, trust badges under CTA. |
| **Checkout** | `src/app/checkout/page.tsx` + `checkout-form.tsx` | Guest/user details, saved addresses, shipping address, payment method, summary | No step indicator; order summary lacks item thumbnails; plain radio cards. | Add CheckoutSteps (`Step 2 of 3`), item thumbnails in summary, rich radio cards with icons for Online/COD & saved addresses. |
| **Payment** | `src/app/checkout/payment/[orderNumber]/page.tsx` + `payment-flow.tsx` | Razorpay Checkout.js or TEST payment simulator | Plain centered container; simulator panel can be clearer. | Add CheckoutSteps, order summary badge, lock icon reassurance, refined simulator & retry states. |
| **Order Confirmation** | `src/app/order/[orderNumber]/confirmation/page.tsx` | Post-checkout confirmation, timeline, actions | Uses raw `⏳` emoji on pending payment; header unframed. | Replace emoji with SVG clock icon; add celebratory confirmation banner card & CheckoutSteps (`Step 3 of 3`). |
| **Order Tracking** | `src/app/track/page.tsx` + `track-order-form.tsx` | Public guest/customer order lookup by order # + email | Good form; result view can show item thumbnails & clearer shipment timeline. | Editorial header, card elevation, item thumbnails in tracked order, refined shipment event timeline. |
| **Login** | `src/app/auth/login/page.tsx` + `login-form.tsx` | Customer/admin sign-in | Bare header + form card. | Brand medallion header, editorial card framing, security reassurance note. |
| **Register** | `src/app/auth/register/page.tsx` + `register-form.tsx` | New customer registration | Bare header + form card. | Brand medallion header, clear password hint & consent styling, cohesive card elevation. |
| **Forgot Password** | `src/app/auth/forgot-password/page.tsx` | Password reset request | Bare header + form card. | Brand medallion header, refined form & inbox-check state. |
| **Reset Password** | `src/app/auth/reset-password/page.tsx` | Token-based new password submission | Bare header + form card. | Brand medallion header, refined form & completion state. |
| **Account Layout** | `src/app/account/layout.tsx` + `account-nav.tsx` | Customer account shell & sidebar navigation | User identity hidden on mobile (`hidden lg:block`). | Visible user identity header with avatar initial on all breakpoints; refined sidebar nav with active indicator. |
| **Account Dashboard** | `src/app/account/page.tsx` | KPIs, default address, recent orders | Good structure; recent orders list can be richer. | Refined greeting banner, upgraded StatCards, richer recent order rows with status & arrow. |
| **Account Orders** | `src/app/account/orders/page.tsx` | Paginated customer order history with status tabs | Fetches `items[0].productSnapshot` but does not render product thumbnail. | Render product thumbnail preview, order metadata chips, and "View order →" affordance. |
| **Account Order Detail** | `src/app/account/orders/[orderNumber]/page.tsx` | Customer order detail, timeline, cancel/return modals | Good structure; breadcrumb & header can be sharper. | Refined back navigation, payment-pending banner, and cohesive timeline/cards. |
| **Account Addresses** | `src/app/account/addresses/page.tsx` + `address-manager.tsx` | Saved shipping addresses CRUD | Address cards are plain. | Elevated address cards with default badge, icon details, and clean action footer. |
| **Account Profile** | `src/app/account/profile/page.tsx` + `profile-manager.tsx` | Personal details & password change | Clean 2-col forms; can add clearer section framing. | Refined profile & security cards with member-since badge. |
| **About Us** | `src/app/about/page.tsx` | Brand story, sourcing model, commitments, business info | Plain prose stack. | Editorial layout with eyebrow header, value pillar cards, and business registration card. |
| **Contact Us** | `src/app/contact/page.tsx` + `contact-form.tsx` | Support ticket submission & direct channels | Functional 2-col layout. | Editorial header, refined contact form card, and structured support channel cards. |
| **FAQ** | `src/app/faq/page.tsx` | Dynamic store-settings-driven FAQ + JSON-LD | Good content; `<details>` summary icon is raw `＋` text. | Editorial header, SVG chevron/plus icon with smooth rotation, quick-help CTA footer. |
| **Policies (4 routes)** | `src/app/policies/{privacy,terms,shipping,returns}/page.tsx` + `policy-view.tsx` | Legal & operational policies | Unframed prose sections; plain bottom nav. | Editorial policy header, top & bottom policy tab pills, card-framed numbered sections. |
| **Not Found / Errors** | `src/app/not-found.tsx`, `error.tsx`, `global-error.tsx` | 404 and runtime error boundaries | `global-error.tsx` uses cool-gray `#f9fafb`. | Align `global-error.tsx` to Zenvora warm cream/ink palette; preserve `'not found'` contract in `not-found.tsx`. |
| **Admin Layout & Nav** | `src/app/admin/layout.tsx` + `admin-nav.tsx` | Admin shell, sidebar, mobile menu | Uses `bg-gray-50`, `border-gray-200`, `text-gray-900`, `☰` emoji. | Redesign with dark `bg-ink-950` executive sidebar, brass eyebrows, SVG icons, and warm `bg-cream-50` workspace canvas. |
| **Admin Dashboard** | `src/app/admin/page.tsx` | Financial KPIs, charts, alerts, recent orders | Uses `gray-*` classes and `🧾` emoji. | Zenvora `ink-*`/`cream-*` tokens, SVG icons, refined KPI cards, warm chart & table surfaces. |
| **Admin Operational Routes (18 routes)** | `src/app/admin/{orders,products,categories,inventory,pricing-rules,coupons,suppliers,supplier-products,supplier-orders,payments,refunds,returns,shipments,customers,messages,analytics,health,settings,users,logs/*}` | Full store operations, CJ/HTTP/Demo suppliers, pricing engine, finance, logs | Uses `gray-*` classes and emoji icons (`🧾`, `📦`, `🛍️`, `⬇`, `📁`). | Unify 100% of admin pages & components onto Zenvora `ink-*`/`cream-*`/`brand-*`/`brass-*` tokens and SVG icons. |

---

## 3. Design System & CSS Architecture Specification

### 3.1 Color & Surface Tokens
- **Canvas & Surfaces:**
  - `--surface-canvas`: `#FAF8F3` (`cream-50`)
  - `--surface-subtle`: `#F5F1E7` (`cream-100`)
  - `--surface-muted`: `#EAE4D4` (`cream-200`)
  - `--surface-card`: `#FFFFFF` (`white`)
  - `--surface-ink`: `#0A130F` (`ink-950`)
- **Typography & Ink Ramp:**
  - `ink-950` (`#0A130F`), `ink-900` (`#101B16`), `ink-800` (`#182620`), `ink-700` (`#24352D`), `ink-600` (`#31443B`), `ink-500` (`#3D5148`), `ink-400` (`#5F7268` — AA 4.9:1 on white), `ink-300` (`#8A978F`)
- **Brand & Accents:**
  - `brand-600` (`#266d49`) / `brand-700` (`#20573c`) — Primary interactive green
  - `brass-300` (`#D8C287`) / `brass-400` (`#C6A75C`) — Editorial highlight & active indicators
  - `accent-600` (`#ea580c`) — Savings / deal badges

### 3.2 Motion System & Reduced Motion
- **Signature Curve:** `--ease-zenvora: cubic-bezier(0.22, 1, 0.36, 1)`
- **Duration Scale:** `--duration-fast: 150ms`, `--duration-normal: 240ms`, `--duration-slow: 450ms`
- **Compositor-Only Rule:** All animations and transitions operate strictly on `transform` and `opacity` (plus color/shadow transitions on interactive controls).
- **Accessibility Kill-Switch:** `@media (prefers-reduced-motion: reduce)` disables all animations, transitions, scroll-behavior, and reveals immediately; `<noscript>` fallback ensures `.reveal` and `.stagger` children are 100% visible without JS.
