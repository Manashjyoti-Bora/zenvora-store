import { describe, expect, it } from 'vitest';
import { jsonLdScript } from '@/lib/utils';

/**
 * Regression test for the JSON-LD stored-XSS vector (final production audit):
 * inline <script type="application/ld+json"> blocks are built from database
 * strings (product names/descriptions — which can arrive via supplier sync —
 * category names, FAQ content, store settings). Raw JSON.stringify does not
 * escape `<`, `>` or `&`, so a value containing `</script>` could close the
 * tag early and inject markup into customer-facing pages.
 */
describe('jsonLdScript (safe inline JSON-LD serialization)', () => {
  it('neutralizes </script> breakout attempts', () => {
    const hostile = {
      '@type': 'Product',
      name: '</script><script>alert(1)</script>',
      description: 'a < b > c & d',
    };
    const out = jsonLdScript(hostile);
    expect(out).not.toContain('</script');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('&');
    // spec 1: the escaped sequences themselves must be present
    expect(out).toContain('\\u003c');
    expect(out).toContain('\\u003e');
    expect(out).toContain('\\u0026');
  });

  it('output is still valid JSON that round-trips to the original data', () => {
    const data = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: '</script><img src=x onerror=alert(1)>',
      offers: { price: 1234.5, currency: 'INR', note: 'a & b < c > d' },
      tags: ['x</script>y', 'plain'],
    };
    const out = jsonLdScript(data);
    // spec 2: parsing succeeds (does not throw)
    expect(() => JSON.parse(out)).not.toThrow();
    // spec 3: parsed output equals the original object exactly
    const parsed = JSON.parse(out);
    expect(parsed).toEqual(data); // escapes are invisible to JSON parsers
  });

  it('leaves ordinary structured data unchanged except the three escapes', () => {
    const data = { name: 'Zenvora Widget', price: 999, url: 'https://example.test/p/w' };
    expect(jsonLdScript(data)).toBe(JSON.stringify(data));
  });

  it('handles arrays and nested objects (layout + breadcrumb shapes)', () => {
    const arr = [
      { '@type': 'Organization', name: 'Store </script>' },
      { '@type': 'WebSite', name: 'Site & Co' },
    ];
    const out = jsonLdScript(arr);
    expect(out.startsWith('[')).toBe(true);
    expect(out).not.toContain('</script');
    expect(JSON.parse(out)).toEqual(arr);
  });
});
