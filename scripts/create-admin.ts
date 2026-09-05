/**
 * Production admin bootstrap — safe to run on every deploy.
 *
 *   npm run db:create-admin          (local)
 *   also runs automatically inside `npm run build` (Vercel build step)
 *
 * Behavior (mirrors the seed's admin logic, WITHOUT any demo data):
 *  - ADMIN_EMAIL/ADMIN_PASSWORD unset  → skip with a warning (never invents
 *    credentials, never fails the build).
 *  - Admin email already exists        → leave untouched (password changes go
 *    through the admin UI; redeploys must not resurrect old env passwords).
 *  - Otherwise                         → create the ADMIN user (bcrypt hash).
 *
 * Loads .env when present (local); on Vercel the variables are already in the
 * environment, and dotenv.config() is a silent no-op without a .env file.
 */
import dotenv from 'dotenv';

dotenv.config();

import { prisma } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth/password';

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.warn(
      '[create-admin] ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin bootstrap. ' +
        'Set them in the environment (see .env.example) and redeploy.'
    );
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`[create-admin] ${email} already exists (role: ${existing.role}) — left untouched.`);
    if (existing.role !== 'ADMIN') {
      console.warn(`[create-admin] WARNING: ${email} exists but its role is ${existing.role}, not ADMIN.`);
    }
    return;
  }

  await prisma.user.create({
    data: {
      email,
      name: 'Store Admin',
      passwordHash: await hashPassword(password),
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  console.log(`[create-admin] created admin user ${email} (password from ADMIN_PASSWORD env var).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('[create-admin] failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
