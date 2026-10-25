import { describe, expect, it } from 'vitest';
import { applySupportEmailFallback, configuredSupportEmail, isPlaceholderEmail } from '@/lib/settings';

describe('support e-mail fallback', () => {
  it('replaces the shipped placeholder with the owner-supplied address', () => {
    const out = applySupportEmailFallback({ supportEmail: 'support@example.com' }, 'owner@real-mailbox.test');
    expect(out.supportEmail).toBe('owner@real-mailbox.test');
    expect(configuredSupportEmail(out)).toBe('owner@real-mailbox.test');
  });
  it('never overrides a real address saved in the admin UI', () => {
    const out = applySupportEmailFallback({ supportEmail: 'help@store.test' }, 'owner@real-mailbox.test');
    expect(out.supportEmail).toBe('help@store.test');
  });
  it('ignores an unset or placeholder fallback', () => {
    expect(applySupportEmailFallback({ supportEmail: 'support@example.com' }, undefined).supportEmail).toBe(
      'support@example.com'
    );
    expect(applySupportEmailFallback({ supportEmail: 'support@example.com' }, 'x@example.org').supportEmail).toBe(
      'support@example.com'
    );
    expect(isPlaceholderEmail('x@example.org')).toBe(true);
  });
});
