import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, passwordPolicyIssues } from '@/lib/auth/password';

describe('password hashing (bcrypt)', () => {
  it('round-trips hash → verify', async () => {
    const hash = await hashPassword('Str0ng!Passphrase');
    expect(hash).not.toBe('Str0ng!Passphrase');
    expect(hash.startsWith('$2')).toBe(true);
    expect(await verifyPassword('Str0ng!Passphrase', hash)).toBe(true);
  }, 15_000);

  it('rejects wrong passwords', async () => {
    const hash = await hashPassword('Correct-Horse-1!');
    expect(await verifyPassword('correct-horse-1!', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  }, 15_000);

  it('produces different hashes for the same password (salted)', async () => {
    const [a, b] = await Promise.all([hashPassword('Same!Pass123'), hashPassword('Same!Pass123')]);
    expect(a).not.toBe(b);
  }, 15_000);

  it('verifyPassword never throws on malformed hashes', async () => {
    expect(await verifyPassword('x', 'not-a-bcrypt-hash')).toBe(false);
  });
});

describe('passwordPolicyIssues', () => {
  it('flags too-short passwords', () => {
    expect(passwordPolicyIssues('Ab1!').length).toBeGreaterThan(0);
  });

  it('accepts a strong passphrase', () => {
    expect(passwordPolicyIssues('LocalDevAdmin#2026!')).toEqual([]);
  });

  it('flags passwords without required character classes', () => {
    expect(passwordPolicyIssues('alllowercaseletters').length).toBeGreaterThan(0);
    expect(passwordPolicyIssues('1234567890').length).toBeGreaterThan(0);
  });
});
