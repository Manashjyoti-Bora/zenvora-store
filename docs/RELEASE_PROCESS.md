# Release process — how Zenvora gets to Production safely

This is the operational contract between the code, CI, Vercel and Neon.
It replaces the previous bare build command
(`prisma generate && prisma migrate deploy && tsx scripts/create-admin.ts && next build`)
with a guarded pipeline, `scripts/release.ts`, that is what `npm run build` runs.

---

## 1. Environments and database mapping

| Environment    | Where it builds                    | Database it must use                       | Who sets the credentials                    |
| -------------- | ---------------------------------- | ------------------------------------------ | ------------------------------------------- |
| **Production** | Vercel, pushes to `main`           | Neon **production** branch                 | Owner, Vercel env scope **Production only** |
| **Preview**    | Vercel, every PR / non-main branch | Neon dedicated **preview** branch          | Owner, Vercel env scope **Preview only**    |
| **CI**         | GitHub Actions                     | Throw-away `postgres:16` service container | Workflow file (no secrets)                  |
| **Local**      | Developer machine                  | Local PostgreSQL                           | `.env` (gitignored)                         |

Required variables per Vercel environment:

| Variable       | Production                                                        | Preview                                   | Purpose                         |
| -------------- | ----------------------------------------------------------------- | ----------------------------------------- | ------------------------------- |
| `DATABASE_URL` | pooled URL of the **production** branch (host contains `-pooler`) | pooled URL of the **preview** branch      | Prisma Client at runtime        |
| `DIRECT_URL`   | direct URL of the **same production** branch                      | direct URL of the **same preview** branch | Prisma Migrate during the build |

Rules enforced by the pipeline (not just documented):

- Both variables must be present → otherwise the build fails in **preflight** with
  an actionable message naming the missing variable and the Vercel scope.
- `DATABASE_URL` and `DIRECT_URL` must point at the **same host** (pooler suffix
  ignored) → otherwise preflight fails. This prevents migrating one branch while
  the app runs against another.
- The database carries a single-row marker (`deployment_environment`) recording
  which environment claimed it. A build for a _different_ environment against
  the _same host_ is **refused before any migration runs** (see §3).

### Owner verification of the Neon mapping (dashboard, no secrets in chat)

1. Neon console → project **`soft-snow-22386582`** (as previously identified) → **Branches**.
   Note the branch names and, for each, the **endpoint host** (`ep-…​.<region>.aws.neon.tech`).
2. Vercel → `zenvora-store` → **Settings → Environment Variables**:
   - Open `DATABASE_URL` and `DIRECT_URL` with the **Production** environment ticked.
     The host inside must be the production branch endpoint (pooled / direct).
   - Open the pair with **Preview** ticked. The host must be the preview branch endpoint.
   - A row ticked for _both_ Production and Preview is a misconfiguration: split it.
3. After the first successful Production build, the build log shows
   `[release:claim] database claimed for "production" (host fingerprint …)`; subsequent
   builds show `database is already claimed by "production"`. A Preview build log
   must say `"preview"`. If either ever says the other environment, stop and fix the
   env scopes — the build will already have refused to migrate.

---

## 2. The pipeline (`npm run build` → `scripts/release.ts`)

| Stage       | Command / check                                                                                                                | Fails when                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| 1 preflight | env presence, URL shape, same-host check, Neon pooled/direct sanity warnings                                                   | a variable is missing or the two URLs disagree         |
| 2 generate  | `prisma generate`                                                                                                              | schema invalid                                         |
| 3 env-guard | read `deployment_environment` via `DIRECT_URL`                                                                                 | DB is claimed by another environment on the same host  |
| 4 migrate   | `prisma migrate deploy` — **or** `prisma migrate status` when `RELEASE_SKIP_MIGRATIONS=1`                                      | a migration fails / (skip mode) migrations are pending |
| 5 claim     | upsert the marker for this environment                                                                                         | —                                                      |
| 6 admin     | `tsx scripts/create-admin.ts` (idempotent; never overwrites an existing user; skips when `ADMIN_EMAIL`/`ADMIN_PASSWORD` unset) | DB unreachable                                         |
| 7 build     | `next build`                                                                                                                   | compile / type errors                                  |

Properties:

- **Deterministic install**: Vercel and CI use `npm ci` against the committed lockfile;
  `package.json#engines` is `>=22.12.0 <25` so a new Node major cannot be picked up silently.
- **Sequencing is enforced**: application code is compiled only after the schema it
  needs is confirmed present (either applied in stage 4 or verified by `migrate status`).
- **Concurrency**: `prisma migrate deploy` takes a PostgreSQL advisory lock for the whole
  run, so two overlapping builds serialise instead of double-applying. Vercel also queues
  production builds per project.
- **Preview cannot touch Production**: the env-guard marker is bound to the database,
  not to the env var hygiene. A Neon branch _forked_ from production has a different
  endpoint host and is recognised and re-claimed as preview, not refused.
- **Secrets never printed**: the script logs only a 10-character SHA-256 fingerprint of
  the database host.

### Decoupled mode (optional, recommended once the team grows)

Set `RELEASE_SKIP_MIGRATIONS=1` in the Vercel **Production** scope and apply migrations
from a controlled place (a GitHub Actions job with a `DIRECT_URL` secret, or a laptop
with `npm run db:deploy`). Builds then **verify** instead of **mutate**: a commit whose
migrations are not yet applied fails at stage 4 and is never promoted. This gives you
an explicit "migrate first, then deploy" gate without changing any application code.

---

## 3. Migration policy (backward compatible by default)

- Only additive, backward-compatible migrations go through the normal pipeline:
  new tables, new nullable columns, new columns with defaults, new indexes.
  The previous deployment keeps working against the new schema, which is what makes
  instant rollback (§4) possible.
- Destructive changes (drop/rename column, type narrowing) use **expand → migrate data →
  contract** across at least two releases, each reviewed in a PR and exercised by CI
  against a fresh database (`prisma migrate deploy` on `postgres:16`).
- Never run `prisma db push`, `prisma migrate reset` or hand-written SQL against
  Production. The `db:reset` script exists for local databases only.
- Every migration PR is also built as a Vercel **Preview** against the Neon preview
  branch before it reaches `main`. Reset the preview branch from production in the
  Neon console whenever you want a realistic rehearsal.

---

## 4. Rollback and recovery

**Application rollback (minutes):** Vercel → Deployments → previous READY production
deployment → **Instant Rollback**. Because migrations are backward compatible, the
older code runs against the newer schema.

**Failed build:** nothing was promoted. Production keeps serving the last READY
deployment (the alias is only moved after a successful build). Read the first
`[release:<stage>] FAILED` block in the build log — it names the stage and the fix.

**Failed migration mid-way:** Prisma records the failed migration in `_prisma_migrations`
and refuses to continue on the next run. Recovery, from a machine with `DIRECT_URL`:

1. Inspect: `npx prisma migrate status`.
2. If the SQL partially applied, fix the database by hand (or restore the Neon branch
   to a point-in-time **before** the build — Neon → Branches → Restore), then
   `npx prisma migrate resolve --rolled-back <name>` and redeploy; or, if it fully
   applied, `npx prisma migrate resolve --applied <name>`.
3. Redeploy from Vercel (**Redeploy** on the failed deployment).

**Data recovery:** Neon point-in-time restore on the production branch (retention per
plan). Always restore into a _new_ branch first and verify before switching
`DATABASE_URL`/`DIRECT_URL`; the env-guard will treat the new branch as a fork and
claim it on the next build.

**Wrong database claimed:** if a database must intentionally change environment
(e.g. you promote the preview branch to production), run ONE build with
`RELEASE_RECLAIM_DATABASE=1` set in that Vercel environment, then remove the variable.

---

## 5. Admin provisioning

`scripts/create-admin.ts` runs in every build:

- creates the `ADMIN` user from `ADMIN_EMAIL` / `ADMIN_PASSWORD` **only if that email does
  not exist yet**; existing users (and their passwords) are never touched;
- skips with a warning when the variables are unset — it never invents credentials;
- after first login, change the password in the admin UI and remove `ADMIN_PASSWORD`
  from Vercel (the variable is no longer needed and should not linger).

---

## 6. CI gates (GitHub Actions, `.github/workflows/ci.yml`)

Every PR and every push to `main`, on Node 24 (same as Vercel), with an isolated
PostgreSQL service:

1. `npm ci` (lockfile consistency) → `prisma validate` → `prisma generate`
2. `prisma migrate deploy` on a fresh database
3. typecheck → lint → unit + integration tests
4. **`npm run build`** — the exact release pipeline Vercel runs, including `next build`
5. seeded dev server → **E2E** HTTP journeys (auth, checkout COD + TEST payment,
   admin authz/IDOR, webhook signature checks, storefront pages, security headers)
6. production-dependency audit (reported, non-blocking)

Promotion rule: only merge to `main` when the CI run for the **exact head commit** is
green and the Vercel Preview for that commit is READY and has been clicked through.
