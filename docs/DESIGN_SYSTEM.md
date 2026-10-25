# Zenvora Design System (implementation reference)

Last aligned with code: 2026-10-25 (branch `arena/2e76e908-zenvora-store`).
Source of truth for values: `tailwind.config.ts` (Tailwind tokens) and `src/app/globals.css`
(`:root` CSS variables, material/role classes, motion). This document explains *why* the values
are what they are and how to use them. Concept narrative lives in `ZENVORA_DESIGN_LANGUAGE.md`.

## 1. Principles

1. One accent for action, one for highlight, two neutrals. Nothing else competes with product
   photography.
2. Contrast is measured, not assumed. Every text/background pairing below was computed with WCAG
   2.2 relative luminance (script run 2026-10-25; numbers are repeatable from the hex values).
3. Tokens are centralised. Components use Tailwind role names (`brand-600`, `ink-400`,
   `cream-200`, `success-600`, `danger-600`) or CSS variables; raw hex values appear only in the
   two token files.
4. Glass is a privilege of overlays. Content surfaces (images, prices, forms, tables) are crisp.
5. Motion is transform/opacity only, short, and fully removable with `prefers-reduced-motion`.

## 2. Palette — how the decision was made

The owner brief proposed a palette as a *hypothesis*. Two internally generated directions were
compared against the real pages (home, shop, product, checkout, admin) before choosing.

| | Direction A — "Violet Editorial" (previous, PR #15) | Direction B — "Petrol & Porcelain" (**chosen**) |
|---|---|---|
| Canvas / ink | Pearl `#F7F6F2` / Obsidian `#101114` | Porcelain `#F6F5F0` / Midnight `#111820` |
| Action colour | Electric Violet `#7965F2`, fill `#6350D9` | Deep Petrol `#174A50`, ring `#1F5A60` |
| Highlight | Champagne `#C6A56B` | Champagne `#C6AD7A` + Iridescent Teal `#77C9C1` (dark surfaces only) |
| Primary button text contrast (white on fill) | **5.71:1** (`#6350D9`); `#7965F2` alone 4.24:1 | **9.85:1** (`#174A50`) |
| Links on canvas | `#5140B8` ≈ 7.0:1 | `#113C41` ≈ 11:1; `#174A50` on Porcelain 9.02:1 |
| Muted text on canvas | `#62636A` 5.5:1 | `#59636B` **5.62:1** |
| Success text on white | `#47765C` 5.2:1 | `#347455` **5.56:1** |
| Error text on white | `#B93838` 6.2:1 | `#B33A42` **5.83:1** |
| Highlight on dark (Midnight) | Champagne 8.0:1 | Champagne **8.22:1**, Teal **9.28:1** |
| Highlight on light | Champagne 2.3:1 — never text | Champagne 2.17:1, Teal 1.92:1 — never text |
| Brand continuity | Violet has no precedent in Zenvora assets | Existing app icon (`public/icon-192x192.png`) is a petrol-green field with a champagne "Z"; old `themeColor` was `#174B3A` |
| Distinctiveness in Indian e-commerce | Violet is common in fintech/SaaS | Petrol + porcelain + champagne is rare in retail; reads "considered house", not "template" |

Decision: **Direction B.** Higher measured contrast on every essential pairing, continuity with
the shipped icon, and a quieter, more distinctive identity. Violet was retired after one release;
no component referenced its hex directly, so the swap was a token-only change (plus
`themeColor`).

### 2.1 Token map (Tailwind name → hex → role)

| Token | Hex | Role / rule |
|---|---|---|
| `brand-50/100/200/300` | `#F0F8F7` `#E1F2F0` `#C9EAE6` `#A6DCD6` | tints for selected chips, info surfaces |
| `brand-400` | `#77C9C1` | Iridescent Teal — **dark surfaces only** (focus ring on dark, accents on Midnight) |
| `brand-500` | `#1F5A60` | focus ring on light surfaces (`--color-focus`), ≈7.9:1 on white |
| `brand-600` | `#174A50` | **primary fill**, active nav, `themeColor` |
| `brand-700` | `#113C41` | links, eyebrows on light, hover fill |
| `brand-800/900/950` | `#0F363B` `#0B282C` `#071A1D` | pressed states, dark petrol surfaces |
| `ink-900` | `#111820` | Midnight — primary text, dark surfaces |
| `ink-700/500` | derived steps | secondary text |
| `ink-400` | `#59636B` | muted text (5.62:1 on Porcelain) — smallest allowed text colour |
| `cream-50` | `#F6F5F0` | Porcelain — page canvas |
| `cream-100` | `#F0EFE9` | subtle surface (skeletons, image placeholders) |
| `cream-200` | `#DCE1DE` | borders, dividers |
| `accent-400` / `brass-400` | `#C6AD7A` | Champagne — eyebrows/rules **on dark only** |
| `sage-100` | `#E2ECE5` | success/calm *surfaces* |
| `sage-600` / `success-600` / `emerald-600` | `#347455` | success text/icons (5.56:1) |
| `danger-600` / `red-600` | `#B33A42` | error text/fill (5.83:1 with white) |
| amber scale | Tailwind default | "pending" states only |

Hard rules:
- Champagne and Teal are **never** used for essential text on light surfaces.
- `ink-400` is the lightest text colour permitted on Porcelain/white.
- Dark surfaces (`.on-dark`, `.glass-dark`, `.glass-toast`) switch the focus ring to Teal via
  `--color-focus-on-dark`.

## 3. Typography, spacing, radius, shadow

Unchanged from `ZENVORA_DESIGN_LANGUAGE.md` §2–§3: Inter Variable self-hosted; 4 px base rhythm;
radius tokens `--radius-sm/md/lg/xl`; shadows re-based on Midnight (`rgba(17,24,32,…)`) so
elevation reads warm-neutral on Porcelain. Prices always `tabular-nums`.

## 4. Layering (z-index ladder) and Liquid-Glass roles

Z-index values are CSS variables in `:root`; role classes apply them so components do not carry
`z-*` utilities for these surfaces.

| Layer | Token | Value | Used by |
|---|---|---|---|
| floating controls | `--z-floating` | 30 | `.glass-floating-control` (product sticky CTA), mobile-menu scrim |
| sticky bars | `--z-sticky` | 40 | `.glass-header`, `.glass-nav`, mobile-menu drawer |
| popovers | `--z-popover` | 50 | `.glass-popover` (search suggestions, account menu) |
| dialogs | `--z-dialog` | 50 | `.glass-dialog` (modal), `.glass-drawer` |
| banners | `--z-banner` | 60 | cookie consent |
| toasts | `--z-toast` | 70 | `.glass-toast` |
| skip link | `--z-skip` | 80 | layout skip link |

Glass roles (all in `globals.css`):

| Class | Material | Where |
|---|---|---|
| `.glass-header` `.glass-nav` `.glass-floating-control` | light bar (blur 10 px) | site header, mobile bottom nav, sticky product CTA |
| `.glass-popover` `.glass-drawer` `.glass-dialog` `.glass-filter-panel` | light panel (blur 14 px) | search dropdown, mobile menu, modals, mobile filter sheet |
| `.glass-toast` | dark panel | toaster |
| `.glass-scrim` | translucent Midnight | behind drawers/dialogs |
| `.crisp` | forces opaque | opt-out for any content inside a glass parent |

Behaviour guarantees:
- Opaque fallback is declared first; translucency + `backdrop-filter` are added only inside
  `@supports (backdrop-filter) or (-webkit-backdrop-filter)` **and**
  `@media not (prefers-reduced-transparency: reduce)`.
- Blur is a static token, never transitioned.
- A glass surface nested in another glass surface becomes a solid card (no blur stacking).
- Glass is never applied to product media, prices, checkout/payment forms or admin tables.

## 5. Motion

Tokens: `--duration-fast 120ms`, `--duration-base 160ms`, `--duration-slow 220ms`,
`--duration-overlay 240ms`, `--ease-zenvora`. Classes: `.motion-reveal`, `.motion-pop`,
`.motion-fade`, `.btn-press` (transform-only pressed feedback — works for touch, mouse and
keyboard activation), `.skeleton` (transform-only shimmer on a pseudo-element).

Rules:
- Transform/opacity only; no animated layout properties, blur, or box-shadow on scroll.
- `@media (prefers-reduced-motion: reduce)` disables reveals, shimmer and the success stroke.
- The order-confirmation success mark animates **only** after the order row was read from the
  database in a confirmed state (`src/app/order/[orderNumber]/confirmation/page.tsx`); it never
  plays on an optimistic client result.

## 6. Loading, empty and error states

- Route-level skeletons: `src/app/{shop,search,categories/[slug],products/[slug]}/loading.tsx`
  built from `src/components/ui/skeleton.tsx` (`Skeleton`, `ProductGridSkeleton`,
  `PageHeaderSkeleton`). Skeletons mirror the real grid (`grid-cols-2 … xl:grid-cols-4`,
  `aspect-[4/5]`) to avoid layout shift when content arrives.
- Empty states are honest copy with a single next action; no invented suggestions.
- Error boundaries: `src/app/error.tsx`, `src/app/global-error.tsx`, admin layout boundary.

## 7. Accessibility checklist for new UI

- Text ≥ 4.5:1 (`ink-400` minimum), UI boundaries ≥ 3:1.
- Visible focus (`focus-visible` ring from `--color-focus` / `--color-focus-on-dark`).
- Overlays trap focus and restore it on close (`focus-trap` util, tested).
- Hit targets ≥ 44 px on touch; inputs 16 px font (iOS zoom guard in `.input-base`).
- Motion/transparency preferences honoured as above.

## 8. What is *not* verified

- No screenshot or Lighthouse run was possible in the build sandbox this round; visual QA of the
  palette on real pages is **unverified** until the preview/production deployment is viewed.
- `prefers-reduced-transparency` support varies by browser; the fallback path is the tested one.
