import { describe, expect, it } from 'vitest';
import { slugify, truncate, safeJsonParse, cartLineKey } from '@/lib/utils';
import { randomToken, randomCode, generateOrderNumber, sha256, safeEqual } from '@/lib/crypto';

describe('slugify', () => {
  it('lowercases, dashes and trims', () => {
    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify('  USB-C  Fast Charger! ')).toBe('usb-c-fast-charger');
  });

  it('strips diacritics', () => {
    expect(slugify('Café Crème')).toBe('cafe-creme');
  });

  it('caps length at 80 chars', () => {
    expect(slugify('a'.repeat(200))).toHaveLength(80);
  });
});

describe('randomToken / randomCode', () => {
  it('randomToken returns hex of the requested byte length', () => {
    const t = randomToken(16);
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(randomToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('randomCode uses the unambiguous uppercase alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const c = randomCode(8);
      expect(c).toHaveLength(8);
      expect(c).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]+$/);
    }
  });

  it('produces different values across calls', () => {
    const set = new Set(Array.from({ length: 100 }, () => randomToken(12)));
    expect(set.size).toBe(100);
  });
});

describe('generateOrderNumber', () => {
  it('formats RX-YYMMDD-XXXXXX', () => {
    const n = generateOrderNumber(new Date('2026-03-07T10:00:00+05:30'));
    expect(n).toMatch(/^RX-\d{6}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    expect(n.startsWith('RX-260307-')).toBe(true);
  });

  it('is collision-resistant over many generations', () => {
    const set = new Set(Array.from({ length: 500 }, () => generateOrderNumber()));
    expect(set.size).toBe(500);
  });
});

describe('sha256 / safeEqual', () => {
  it('sha256 matches the known vector for "abc"', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('safeEqual compares equal strings true and others false', () => {
    expect(safeEqual('secret-token', 'secret-token')).toBe(true);
    expect(safeEqual('secret-token', 'secret-tokem')).toBe(false);
    expect(safeEqual('short', 'much-longer-string')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('truncate / safeJsonParse / cartLineKey', () => {
  it('truncate keeps short strings and cuts long ones with an ellipsis', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello world', 5)).toBe('hello…');
  });

  it('safeJsonParse returns the fallback on invalid JSON (never throws)', () => {
    expect(safeJsonParse('{"a":1}', null)).toEqual({ a: 1 });
    expect(safeJsonParse('{bad json', { fb: true })).toEqual({ fb: true });
  });

  it('cartLineKey distinguishes variant lines', () => {
    expect(cartLineKey('p1')).toBe('p1');
    expect(cartLineKey('p1', null)).toBe('p1');
    expect(cartLineKey('p1', 'v1')).toBe('p1:v1');
    expect(cartLineKey('p1', 'v1')).not.toBe(cartLineKey('p1', 'v2'));
  });
});

describe('isPlaceholderEmail / configuredSupportEmail (settings)', () => {
  it('treats RFC 2606 example domains and empty values as unconfigured', async () => {
    const { isPlaceholderEmail, configuredSupportEmail } = await import('@/lib/settings');
    expect(isPlaceholderEmail('support@example.com')).toBe(true);
    expect(isPlaceholderEmail('Care@Sub.Example.ORG')).toBe(true);
    expect(isPlaceholderEmail('')).toBe(true);
    expect(isPlaceholderEmail(undefined)).toBe(true);
    expect(isPlaceholderEmail('care@zenvora.in')).toBe(false);
    expect(isPlaceholderEmail('owner@notexample.com')).toBe(false);
    expect(configuredSupportEmail({ supportEmail: 'support@example.com' })).toBeNull();
    expect(configuredSupportEmail({ supportEmail: ' care@zenvora.in ' })).toBe('care@zenvora.in');
  });
});

describe('e-mail footer support line', () => {
  it('links the contact form instead of a placeholder address', async () => {
    const { supportLineHtml } = await import('@/lib/notifications/templates');
    const unset = supportLineHtml({ storeName: 'Zenvora', supportEmail: '', appUrl: 'https://shop.test/' });
    expect(unset).toContain('https://shop.test/contact');
    expect(unset).not.toContain('mailto:');
    expect(unset).not.toContain('example.com');
    const set = supportLineHtml({ storeName: 'Zenvora', supportEmail: 'help@zenvora.in', appUrl: 'https://shop.test' });
    expect(set).toContain('mailto:help@zenvora.in');
  });
});
