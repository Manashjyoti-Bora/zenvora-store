import { describe, expect, it } from 'vitest';
import { buildSearchWhere, tokenizeSearchQuery, SEARCH_QUERY_MAX_LENGTH } from '@/lib/catalog/search';

describe('tokenizeSearchQuery', () => {
  it('lower-cases, splits on whitespace/punctuation and de-duplicates', () => {
    expect(tokenizeSearchQuery('  USB-C   Charger, charger!  ')).toEqual(['usb-c', 'charger']);
  });
  it('keeps product-ish tokens like 65w, 2.0 and c+', () => {
    expect(tokenizeSearchQuery('65W type c 2.0')).toEqual(['65w', 'type', 'c', '2.0']);
  });
  it('strips leading/trailing dashes and dots', () => {
    expect(tokenizeSearchQuery('-usb- ...cable.')).toEqual(['usb', 'cable']);
  });
  it('caps the number of tokens and the query length', () => {
    const long = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
    expect(tokenizeSearchQuery(long)).toHaveLength(6);
    expect(tokenizeSearchQuery('a'.repeat(500))).toEqual(['a'.repeat(SEARCH_QUERY_MAX_LENGTH)]);
  });
  it('handles unicode letters (Hindi, accented)', () => {
    expect(tokenizeSearchQuery('चार्जर café')).toEqual(['चार्जर', 'café']);
  });
  it('returns [] for empty / symbol-only input', () => {
    expect(tokenizeSearchQuery('')).toEqual([]);
    expect(tokenizeSearchQuery('   ')).toEqual([]);
    expect(tokenizeSearchQuery('!!! ???')).toEqual([]);
    expect(tokenizeSearchQuery(null)).toEqual([]);
  });
});

describe('buildSearchWhere', () => {
  it('is null when there is nothing to search for', () => {
    expect(buildSearchWhere('')).toBeNull();
    expect(buildSearchWhere('%%%')).toBeNull();
  });
  it('single token → one OR across searchable fields', () => {
    const w = buildSearchWhere('charger')!;
    expect(w.OR).toBeDefined();
    expect(w.AND).toBeUndefined();
    expect(JSON.stringify(w)).toContain('"contains":"charger"');
  });
  it('multiple tokens → AND of per-token ORs (every word must match)', () => {
    const w = buildSearchWhere('usb charger')!;
    expect(Array.isArray(w.AND)).toBe(true);
    expect((w.AND as unknown[]).length).toBe(2);
  });
  it('SQL LIKE wildcards and quotes never reach the query (treated as separators)', () => {
    const w = buildSearchWhere(`ab%cd_ef' OR 1=1 --`)!;
    const json = JSON.stringify(w);
    expect(json).not.toMatch(/[%_'=-]{2}|OR 1/);
    expect(tokenizeSearchQuery(`ab%cd_ef' OR 1=1 --`)).toEqual(['ab', 'cd', 'ef', 'or', '1']);
  });
});
