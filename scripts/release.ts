/**
 * Zenvora release pipeline — what `npm run build` actually runs.
 *
 *   npm run build            (Vercel Production / Preview builds, local builds)
 *   RELEASE_SKIP_MIGRATIONS=1 npm run build
 *                            (migrations applied by a separate, controlled step;
 *                             the build then only VERIFIES the database is up to
 *                             date and refuses to ship code that is ahead of it)
 *
 * Stages, in order — every stage must pass before the next one starts:
 *
 *   1. preflight      Required environment present (DATABASE_URL, DIRECT_URL),
 *                     URLs well-formed, Neon pooled/direct usage sane.
 *                     Fails FAST with an actionable message instead of a Prisma
 *                     stack trace deep inside the build.
 *   2. generate       `prisma generate` — deterministic client from the schema.
 *   3. env-guard      Reads the single-row `deployment_environment` marker in
 *                     the TARGET database and refuses to continue when that
 *                     database already belongs to a different environment on
 *                     the SAME host (e.g. a Preview build whose DATABASE_URL was
 *                     mis-scoped to the Production database). A Neon branch
 *                     forked from production has a different endpoint host, so
 *                     it is recognised as a fork and re-claimed, not refused.
 *   4. migrate        `prisma migrate deploy` (Prisma serialises concurrent
 *                     runs with a PostgreSQL advisory lock, so two overlapping
 *                     builds cannot apply the same migration twice), or with
 *                     RELEASE_SKIP_MIGRATIONS=1 → `prisma migrate status`, which
 *                     exits non-zero while migrations are pending. Either way
 *                     the application code that follows is never promoted
 *                     ahead of the schema it requires.
 *   5. claim          Writes/refreshes the environment marker (after migrate,
 *                     because the table is created by a migration).
 *   6. admin          `scripts/create-admin.ts` — idempotent, never overwrites
 *                     an existing user, never invents credentials.
 *   7. build          `next build`.
 *
 * Secrets are never printed. Hostnames are reduced to a short fingerprint.
 * See docs/RELEASE_PROCESS.md for the rollback / recovery runbook.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

type ReleaseEnv = 'production' | 'preview' | 'development' | 'ci' | 'local';

const VALID_VERCEL_ENVS = new Set(['production', 'preview', 'development']);

function detectReleaseEnv(): ReleaseEnv {
  const v = process.env.VERCEL_ENV;
  if (v && VALID_VERCEL_ENVS.has(v)) return v as ReleaseEnv;
  if (process.env.CI) return 'ci';
  return 'local';
}

const releaseEnv = detectReleaseEnv();
const skipMigrations = process.env.RELEASE_SKIP_MIGRATIONS === '1';

function log(stage: string, message: string): void {
  console.log(`[release:${stage}] ${message}`);
}

function fail(stage: string, lines: string[]): never {
  console.error(`\n[release:${stage}] FAILED`);
  for (const line of lines) console.error(`  ${line}`);
  console.error('');
  process.exit(1);
}

function run(stage: string, cmd: string, args: string[]): void {
  log(stage, `$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
  if (res.error) fail(stage, [`could not start "${cmd}": ${res.error.message}`]);
  if (res.status !== 0) {
    fail(stage, [`"${cmd} ${args.join(' ')}" exited with code ${res.status ?? 'unknown'}`]);
  }
}

/** Short, non-reversible fingerprint so logs can show "which host" without the host. */
function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 10);
}

/**
 * Hostname of a connection URL with Neon's pooler suffix removed, so the pooled
 * (DATABASE_URL) and direct (DIRECT_URL) URLs of the same branch normalise to
 * the same value. Returns null when the URL cannot be parsed.
 */
export function normaliseDbHost(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/-pooler(?=\.|$)/, '');
  } catch {
    return null;
  }
}

/** Decide whether a build for `current` may touch a DB already claimed by `marker`. */
export function evaluateMarker(
  marker: { environment: string; databaseHost: string } | null,
  current: { environment: string; databaseHost: string }
): { action: 'claim' | 'ok' | 'reclaim-fork' | 'refuse'; reason: string } {
  if (!marker) return { action: 'claim', reason: 'database has no environment marker yet' };
  if (marker.environment === current.environment) {
    return { action: 'ok', reason: `database is already claimed by "${current.environment}"` };
  }
  if (marker.databaseHost !== current.databaseHost) {
    return {
      action: 'reclaim-fork',
      reason:
        `database marker says "${marker.environment}" but lives on a different host ` +
        `(fork/branch copy detected) — re-claiming it for "${current.environment}"`,
    };
  }
  return {
    action: 'refuse',
    reason:
      `this database (same host) is already claimed by the "${marker.environment}" environment, ` +
      `but this build runs as "${current.environment}"`,
  };
}

// ---------------------------------------------------------------------------
// 1. preflight
// ---------------------------------------------------------------------------
function preflight(): { directUrl: string } {
  const stage = 'preflight';
  log(stage, `environment: ${releaseEnv}${skipMigrations ? ' (RELEASE_SKIP_MIGRATIONS=1)' : ''}`);

  const dbUrl = process.env.DATABASE_URL?.trim();
  const directUrl = process.env.DIRECT_URL?.trim();
  const missing = [!dbUrl && 'DATABASE_URL', !directUrl && 'DIRECT_URL'].filter(Boolean);

  if (missing.length > 0) {
    const scope =
      releaseEnv === 'production' || releaseEnv === 'preview'
        ? `the Vercel "${releaseEnv[0].toUpperCase()}${releaseEnv.slice(1)}" environment`
        : 'this environment (.env locally, see .env.example)';
    fail(stage, [
      `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set for ${scope}.`,
      'Prisma Client (runtime) needs DATABASE_URL and Prisma Migrate needs DIRECT_URL.',
      '',
      'Vercel: Project → Settings → Environment Variables → Add',
      `  Key: DATABASE_URL   Value: pooled Neon connection string of the ${releaseEnv} branch`,
      `  Key: DIRECT_URL     Value: direct (non-pooler) connection string of the SAME branch`,
      `  Environments: tick ONLY "${releaseEnv === 'production' ? 'Production' : 'Preview'}"`,
      'then redeploy. Never reuse the Preview branch credentials for Production.',
      'Runbook: docs/RELEASE_PROCESS.md',
    ]);
  }

  for (const [name, value] of [
    ['DATABASE_URL', dbUrl!],
    ['DIRECT_URL', directUrl!],
  ] as const) {
    if (!/^postgres(ql)?:\/\//i.test(value) || !normaliseDbHost(value)) {
      fail(stage, [
        `${name} is not a valid postgresql:// connection URL (value not shown).`,
        'Copy it again from Neon → Dashboard → Connection details.',
      ]);
    }
  }

  const dbHost = normaliseDbHost(dbUrl!)!;
  const directHost = normaliseDbHost(directUrl!)!;
  if (dbHost !== directHost) {
    fail(stage, [
      'DATABASE_URL and DIRECT_URL point at DIFFERENT database hosts ' +
        `(fingerprints ${fingerprint(dbHost)} vs ${fingerprint(directHost)}).`,
      'Both must belong to the same Neon branch: DATABASE_URL = pooled URL (host contains "-pooler"),',
      'DIRECT_URL = direct URL of that branch. Mixed branches would migrate one database and run the app against another.',
    ]);
  }

  const isNeon = /\.neon\.tech$/i.test(dbHost);
  if (isNeon) {
    const pooled = /-pooler\./i.test(new URL(dbUrl!).hostname);
    const directIsPooled = /-pooler\./i.test(new URL(directUrl!).hostname);
    if (!pooled) {
      log(
        stage,
        'warning: DATABASE_URL is not the Neon pooled URL (host without "-pooler"); serverless functions may exhaust connections.'
      );
    }
    if (directIsPooled) {
      log(
        stage,
        'warning: DIRECT_URL is the pooled URL; Prisma Migrate should use the direct (non-pooler) URL.'
      );
    }
  }

  log(stage, `database host fingerprint: ${fingerprint(dbHost)}`);
  return { directUrl: directUrl! };
}

// ---------------------------------------------------------------------------
// 3 + 5. environment guard / claim (uses the generated client via DIRECT_URL)
// ---------------------------------------------------------------------------
interface MarkerRow {
  environment: string;
  databaseHost: string;
}

type RawClient = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $disconnect(): Promise<void>;
};

async function openDirectClient(directUrl: string): Promise<RawClient> {
  // Imported lazily: the client only exists after `prisma generate`.
  const { PrismaClient } = await import('@prisma/client');
  return new PrismaClient({
    datasources: { db: { url: directUrl } },
    log: ['error'],
  }) as unknown as RawClient;
}

async function readMarker(db: RawClient): Promise<MarkerRow | null | 'no-table'> {
  const exists = await db.$queryRawUnsafe<Array<{ present: boolean }>>(
    `SELECT to_regclass('"deployment_environment"') IS NOT NULL AS present`
  );
  if (!exists[0]?.present) return 'no-table';
  const rows = await db.$queryRawUnsafe<MarkerRow[]>(
    `SELECT "environment", "databaseHost" FROM "deployment_environment" WHERE "id" = 1`
  );
  return rows[0] ?? null;
}

async function envGuard(directUrl: string): Promise<void> {
  const stage = 'env-guard';
  const current = { environment: releaseEnv, databaseHost: normaliseDbHost(directUrl)! };
  const db = await openDirectClient(directUrl);
  try {
    const marker = await readMarker(db);
    if (marker === 'no-table') {
      log(stage, 'marker table not present yet (created by migrations) — will claim after migrate');
      return;
    }
    const verdict = evaluateMarker(marker, current);
    log(stage, verdict.reason);
    if (verdict.action === 'refuse' && process.env.RELEASE_RECLAIM_DATABASE === '1') {
      log(stage, 'RELEASE_RECLAIM_DATABASE=1 set — overriding the refusal for this build only');
      return;
    }
    if (verdict.action === 'refuse') {
      fail(stage, [
        verdict.reason + '.',
        'Refusing to run migrations or build against it.',
        '',
        'This almost always means DATABASE_URL / DIRECT_URL are scoped to the wrong Vercel',
        'environment. Fix: Vercel → Settings → Environment Variables → make sure the',
        'Production rows point at the Neon PRODUCTION branch and the Preview rows at the',
        'dedicated Neon PREVIEW branch, then redeploy.',
        'Only if you are intentionally re-purposing this database: set',
        'RELEASE_RECLAIM_DATABASE=1 for ONE build to overwrite the marker.',
      ]);
    }
  } catch (err) {
    fail(stage, [
      'Could not connect to the database with DIRECT_URL (value not shown).',
      `Reason: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
      'Check that the Neon branch/endpoint is active and the credentials are current.',
    ]);
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
}

async function claimMarker(directUrl: string): Promise<void> {
  const stage = 'claim';
  const current = { environment: releaseEnv, databaseHost: normaliseDbHost(directUrl)! };
  const db = await openDirectClient(directUrl);
  try {
    const marker = await readMarker(db);
    if (marker === 'no-table') {
      // RELEASE_SKIP_MIGRATIONS=1 on a database that has not received the
      // marker migration yet: nothing to claim, migrate status already passed.
      log(stage, 'marker table still absent (pending migration) — skipping claim');
      return;
    }
    const verdict = evaluateMarker(marker, current);
    if (verdict.action === 'refuse' && process.env.RELEASE_RECLAIM_DATABASE !== '1') {
      fail(stage, [verdict.reason + '.']);
    }
    if (verdict.action === 'ok') {
      await db.$executeRawUnsafe(
        `UPDATE "deployment_environment" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 1`
      );
      return;
    }
    await db.$executeRawUnsafe(
      `INSERT INTO "deployment_environment" ("id", "environment", "databaseHost", "claimedAt", "updatedAt")
       VALUES (1, $1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT ("id") DO UPDATE
         SET "environment" = EXCLUDED."environment",
             "databaseHost" = EXCLUDED."databaseHost",
             "claimedAt" = CURRENT_TIMESTAMP,
             "updatedAt" = CURRENT_TIMESTAMP`,
      current.environment,
      current.databaseHost
    );
    log(
      stage,
      `database claimed for "${current.environment}" (host fingerprint ${fingerprint(current.databaseHost)})`
    );
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const { directUrl } = preflight();

  run('generate', 'prisma', ['generate']);

  await envGuard(directUrl);

  if (skipMigrations) {
    // Enforced sequencing without applying anything: exits 1 while the
    // database is behind the migrations shipped with this commit.
    run('migrate', 'prisma', ['migrate', 'status']);
  } else {
    run('migrate', 'prisma', ['migrate', 'deploy']);
  }

  await claimMarker(directUrl);

  run('admin', 'tsx', ['scripts/create-admin.ts']);

  run('build', 'next', ['build']);

  log('done', `release build complete (${releaseEnv})`);
}

const invokedDirectly =
  typeof require !== 'undefined'
    ? require.main === module
    : /release\.ts$/.test(process.argv[1] ?? '');

if (invokedDirectly) {
  main().catch((err) => {
    console.error('[release] unexpected failure:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
