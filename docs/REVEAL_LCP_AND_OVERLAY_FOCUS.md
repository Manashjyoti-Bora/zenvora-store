# Reveal LCP safety + overlay focus management

Change set: `1888a4b` — `perf(a11y): make scroll reveal LCP-safe and give the mobile menu real focus management`

Two defects found while auditing the storefront layer. Both were confirmed by
reading the shipped output, not by assumption.

## 1. Scroll reveal shipped its hidden state in the server HTML

`globals.css` declared the reveal hidden state on a bare `.reveal` selector, so
it was present in the server-rendered document. `<Reveal>` only adds
`is-visible` from a client effect after hydration.

The homepage product grids (`deals`, `featured`, `newest`) are wrapped in
`<Reveal>`, so:

- Browsers exclude `opacity: 0` content from **LCP candidacy**. The grids could
  never be the LCP element regardless of how fast they painted, which caps the
  reported LCP of the most important commercial surface on the site.
- On a slow connection the grids stayed **blank until React hydrated**. The
  existing `<noscript>` fallback covered "JS disabled", not "JS present but not
  yet executed".

### Fix

The hidden state is scoped to `.js .reveal`. `.js` is added by a blocking
inline `<script>` that is the **first child of `<body>`** in `layout.tsx`, so
the browser executes it while parsing — before any reveal content is parsed or
painted.

- Server-rendered HTML is fully visible (proved: SSR `<html>` carries no `js`
  class, verified against the running dev server).
- The animation still plays from the very first paint (proved: the emitted
  production CSS contains `.js .reveal{opacity:0;…}`).
- No-JS and the rare CSP-blocked-inline-script case degrade to plain visible
  content with no animation — the intended progressive enhancement.

Also removed the permanent `will-change: opacity, transform` hint on `.reveal`.
`will-change` is only useful _during_ a transition; leaving it on every card for
the whole session pins compositor memory for no benefit.

## 2. `<MobileMenu>` had no keyboard or scroll behaviour beyond Escape

`<Modal>` already moved focus in, trapped `Tab`, restored focus on close and
locked body scroll. The mobile disclosure did none of that, so keyboard users
could tab straight out of the open panel into the page behind it, and the page
scrolled underneath the overlay.

### Fix

The logic is extracted into `src/lib/a11y/focus.ts`:

- `nextFocusTarget(focusables, active, shift)` — pure focus-trap arithmetic
  (wraps at both ends, pulls focus back in when it lands outside the trap).
  Unit-tested without a DOM.
- `focusablesIn(root)` / `lockBodyScroll()` — thin DOM wrappers.

Both `<Modal>` and `<MobileMenu>` now use the same helpers, so every overlay
behaves identically and the rule lives in exactly one place. The mobile panel
additionally closes on route change (`usePathname`), which covers link clicks,
back/forward and programmatic navigation.

## Tests

- `tests/unit/focus-trap.test.ts` (8) — trap arithmetic, wrapping, escape,
  single-element and empty cases.
- `tests/unit/reveal-gating.test.ts` (5) — structural regression guards: the
  hidden state must be `.js`-scoped, the reduced-motion override must stay
  unconditional, and the gating script must be the first child of `<body>`.

## Verified

| Check            | Result                                                             |
| ---------------- | ------------------------------------------------------------------ |
| `tsc --noEmit`   | pass                                                               |
| `eslint .`       | pass                                                               |
| unit             | 183/183 pass (13 new)                                              |
| integration      | 141/141 pass, real PostgreSQL 18.4                                 |
| e2e              | 63/63 pass, real dev server + seeded catalog                       |
| `next build`     | success                                                            |
| emitted CSS      | `.js .reveal{opacity:0}` present, no unscoped `.reveal{opacity:0}` |
| runtime SSR HTML | `<html>` has no `js` class; gating script present                  |
| production CSS   | `.js .reveal{opacity:0;…}` live on `zenvorastore.vercel.app`       |

The 3 unhandled `PrismaClientInitializationError` rejections in the unit run are
pre-existing: they reproduce identically at the parent commit (`8fd45b1`,
170 tests, same 3 errors) and come from this sandbox having no native Prisma
query engine. See the "Prisma native engine" note below.

## Prisma native engine (sandbox limitation)

`binaries.prisma.sh` is unreachable from this sandbox, so `prisma migrate
deploy` and the native query engine cannot be obtained. To run the integration
and e2e suites for real, the client was generated in a scratch directory with
`engineType = "client"` + `@prisma/adapter-pg`, and `src/lib/db.ts` was
temporarily shimmed to pass the adapter. **`src/lib/db.ts` was restored to its
committed content before the commit** — the diff contains no adapter changes.
Native-engine verification belongs to CI, which has network access.
