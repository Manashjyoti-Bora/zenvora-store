/**
 * OWNER RECOVERY TOOL — deterministic admin password reset against the
 * database in DATABASE_URL (run locally/Termux with the production Neon URL
 * in .env; the URL never needs to be shared with anyone).
 *
 *   npm run db:reset-admin-password -- you@yourdomain.com
 *
 * Why this exists: the in-app "forgot password" flow delivers via the email
 * provider; until SMTP is configured that means server logs. This script is
 * the deterministic offline path.
 *
 * Safety:
 *  - the new password is typed interactively into YOUR terminal (never an
 *    argument, never chat, never logged);
 *  - the target user must exist and already have role ADMIN (use
 *    db:promote-admin for role issues) — this tool cannot create admins or
 *    touch non-admin accounts;
 *  - password policy is enforced identically to registration;
 *  - existing password reset tokens for the user are revoked.
 */
import dotenv from 'dotenv';

dotenv.config();

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { prisma } from '../src/lib/db';
import { hashPassword, passwordPolicyIssues } from '../src/lib/auth/password';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    console.error('Usage: npm run db:reset-admin-password -- admin@yourdomain.com');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(
      `[reset-admin-password] no user with email ${email}. ` +
        'If this is your ADMIN_EMAIL, it may not have been bootstrapped yet — ' +
        'set ADMIN_EMAIL/ADMIN_PASSWORD in the host environment and redeploy.'
    );
    process.exit(1);
  }
  if (user.role !== 'ADMIN') {
    console.error(
      `[reset-admin-password] ${email} exists but has role ${user.role}, not ADMIN. ` +
        'Use `npm run db:promote-admin -- ' + email + '` first if this is the owner account.'
    );
    process.exit(1);
  }

  // Line-collector instead of rl.question(): question() silently never
  // resolves when stdin is a pipe that reaches EOF (process exits 0 without
  // doing anything). for-await handles both interactive TTYs and pipes.
  const lines: string[] = [];
  const rl = readline.createInterface({ input: stdin, output: stdout });
  stdout.write('New admin password (typed locally, never logged): ');
  for await (const line of rl) {
    lines.push(line);
    if (lines.length === 1) stdout.write('Type it again to confirm: ');
    if (lines.length === 2) {
      rl.close();
      break;
    }
  }
  if (lines.length < 2) {
    console.error('[reset-admin-password] expected the password typed twice — nothing was changed.');
    process.exit(1);
  }
  const [password, confirm] = lines;
  if (password !== confirm) {
    console.error('[reset-admin-password] the two entries did not match — nothing was changed.');
    process.exit(1);
  }

  const issues = passwordPolicyIssues(password);
  if (issues.length > 0) {
    console.error(`[reset-admin-password] password rejected:\n- ${issues.join('\n- ')}`);
    process.exit(1);
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password), status: 'ACTIVE' },
    }),
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
  console.log(
    `[reset-admin-password] password updated for ${email} (role ADMIN, status ACTIVE). ` +
      'Existing sessions and reset tokens for this user were revoked. Log in at /auth/login.'
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('[reset-admin-password] failed:', err instanceof Error ? err.message : err);
    await prisma.$disconnect();
    process.exit(1);
  });
