import bcrypt from 'bcryptjs';

/**
 * Password hashing with bcrypt (cost 12).
 * bcryptjs is pure JS - no native build steps - and bcrypt remains a
 * well-vetted adaptive hash. Input is capped at 72 bytes (bcrypt limit).
 */

const BCRYPT_ROUNDS = 12;
const MAX_PASSWORD_BYTES = 72;

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '123456',
  '12345678',
  '123456789',
  'qwerty',
  'qwerty123',
  'abc123',
  'letmein',
  'welcome',
  'admin',
  'admin123',
  'resellix',
  'india123',
  '111111',
  '000000',
]);

export async function hashPassword(password: string): Promise<string> {
  assertPasswordLength(password);
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    assertPasswordLength(password);
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

function assertPasswordLength(password: string): void {
  const bytes = Buffer.byteLength(password, 'utf8');
  if (bytes > MAX_PASSWORD_BYTES) {
    throw new Error('Password exceeds maximum length');
  }
}

/** Lightweight policy check used by the API (UI shows the same rules). */
export function passwordPolicyIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < 8) issues.push('Password must be at least 8 characters.');
  if (password.length > 72) issues.push('Password must be at most 72 characters.');
  if (!/[a-zA-Z]/.test(password)) issues.push('Password must contain a letter.');
  if (!/[0-9]/.test(password)) issues.push('Password must contain a number.');
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    issues.push('This password is too common. Please choose a stronger one.');
  }
  return issues;
}
