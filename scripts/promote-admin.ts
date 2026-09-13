/**
 * OWNER RECOVERY TOOL — promote an EXISTING user to ADMIN against the
 * database in DATABASE_URL (run locally/Termux; production URL stays local).
 *
 *   npm run db:promote-admin -- you@yourdomain.com
 *
 * Why this exists: if the owner's email was registered as a normal customer
 * before ADMIN_EMAIL bootstrapping, create-admin deliberately leaves the
 * existing account untouched (it must never overwrite passwords). That
 * account then logs in fine but /admin redirects away. This script is the
 * safe, explicit, one-shot promotion path.
 *
 * Safety:
 *  - never runs automatically (manual invocation only — build-time
 *    auto-promotion would let anyone pre-register an email and inherit admin
 *    if it later matched ADMIN_EMAIL);
 *  - requires typing the exact email as confirmation;
 *  - never touches the password hash;
 *  - refuses if the user does not exist or is not ACTIVE.
 */
import dotenv from 'dotenv';

dotenv.config();

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { prisma } from '../src/lib/db';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    console.error('Usage: npm run db:promote-admin -- you@yourdomain.com');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(
      `[promote-admin] no user with email ${email}. Register that account first ` +
        '(or set ADMIN_EMAIL/ADMIN_PASSWORD and redeploy to bootstrap it).'
    );
    process.exit(1);
  }
  if (user.status !== 'ACTIVE') {
    console.error(`[promote-admin] ${email} has status ${user.status} — refusing to promote.`);
    process.exit(1);
  }
  if (user.role === 'ADMIN') {
    console.log(`[promote-admin] ${email} is already ADMIN — nothing to do.`);
    return;
  }

  // Line-collector instead of rl.question(): question() silently never
  // resolves when stdin is a pipe that reaches EOF. for-await handles both
  // interactive TTYs and pipes.
  console.log(
    `[promote-admin] will promote ${email} (current role: ${user.role}) to ADMIN. ` +
      'The password is NOT changed.'
  );
  const rl = readline.createInterface({ input: stdin, output: stdout });
  stdout.write('Type the exact email address to confirm: ');
  let confirm: string | null = null;
  for await (const line of rl) {
    confirm = line;
    rl.close();
    break;
  }
  if (confirm === null) {
    console.error('[promote-admin] no confirmation received — nothing was changed.');
    process.exit(1);
  }
  if (confirm.trim().toLowerCase() !== email) {
    console.error('[promote-admin] confirmation did not match — nothing was changed.');
    process.exit(1);
  }

  await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
  console.log(`[promote-admin] ${email} is now ADMIN. Log in at /auth/login, then open /admin.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('[promote-admin] failed:', err instanceof Error ? err.message : err);
    await prisma.$disconnect();
    process.exit(1);
  });
