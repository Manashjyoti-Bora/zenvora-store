import { describe, expect, it } from 'vitest';
import { parseUsd, extractCjCategories, classifyCjFailure, isUncertainTransportFailure } from '@/lib/suppliers/cj';

/**
 * CJ Dropshipping adapter parsing regression tests.
 *
 * These tests pin the exact parsing behaviour for CJ API responses, ensuring
 * that price extraction, category parsing, and error classification remain
 * consistent across code changes.
 */

describe('CJ USD price parsing (parseUsd)', () => {
  it('parses numeric values', () => {
    expect(parseUsd(8.79)).toBe(8.79);
    expect(parseUsd(0)).toBe(0);
    expect(parseUsd(100)).toBe(100);
  });

  it('parses numeric strings', () => {
    expect(parseUsd('8.79')).toBe(8.79);
    expect(parseUsd(' 12.50 ')).toBe(12.5);
    expect(parseUsd('0')).toBe(0);
  });

  it('parses currency-prefixed strings', () => {
    expect(parseUsd('$8.79')).toBe(8.79);
    expect(parseUsd('$12.50')).toBe(12.5);
  });

  it('parses multi-variant price range strings (returns upper bound)', () => {
    expect(parseUsd('8.79 - 12.50')).toBe(12.5);
    expect(parseUsd('8.79--12.50')).toBe(12.5);
    expect(parseUsd('8.79~12.50')).toBe(12.5);
    expect(parseUsd('$5.99 - $15.99')).toBe(15.99);
  });

  it('returns null for invalid inputs', () => {
    expect(parseUsd(null)).toBeNull();
    expect(parseUsd(undefined)).toBeNull();
    expect(parseUsd('')).toBeNull();
    expect(parseUsd('free')).toBeNull();
    expect(parseUsd(-1)).toBeNull();
    expect(parseUsd(-5.5)).toBeNull();
    expect(parseUsd(Infinity)).toBeNull();
    expect(parseUsd(Number.NaN)).toBeNull();
  });

  it('returns null for non-string/non-number types', () => {
    expect(parseUsd(true)).toBeNull();
    expect(parseUsd({})).toBeNull();
    expect(parseUsd([])).toBeNull();
  });
});

describe('CJ category extraction (extractCjCategories)', () => {
  it('returns empty array for non-array input', () => {
    expect(extractCjCategories(null)).toEqual([]);
    expect(extractCjCategories(undefined)).toEqual([]);
    expect(extractCjCategories('string')).toEqual([]);
    expect(extractCjCategories({})).toEqual([]);
  });

  it('extracts flat categories with id and name', () => {
    const data = [
      { categoryFirstId: 'c1', categoryFirstName: 'Electronics' },
      { categoryFirstId: 'c2', categoryFirstName: 'Clothing' },
    ];
    const result = extractCjCategories(data);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'c1', name: 'Electronics', parentId: null, level: 1 });
    expect(result[1]).toEqual({ id: 'c2', name: 'Clothing', parentId: null, level: 1 });
  });

  it('extracts nested categories (3 levels)', () => {
    const data = [
      {
        categoryFirstId: 'l1',
        categoryFirstName: 'Electronics',
        categoryFirstList: [
          {
            categorySecondId: 'l2',
            categorySecondName: 'Phones',
            categorySecondList: [
              { categoryThirdId: 'l3', categoryThirdName: 'Smartphones' },
            ],
          },
        ],
      },
    ];
    const result = extractCjCategories(data);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ id: 'l1', name: 'Electronics', parentId: null, level: 1 });
    expect(result[1]).toEqual({ id: 'l2', name: 'Phones', parentId: 'l1', level: 2 });
    expect(result[2]).toEqual({ id: 'l3', name: 'Smartphones', parentId: 'l2', level: 3 });
  });

  it('skips entries without id or name', () => {
    const data = [
      { categoryFirstName: 'No ID' },  // Falls back to name as ID → included
      { categoryFirstId: 'only-id' },  // Has ID but no name → SKIPPED
      { categoryFirstId: 'valid', categoryFirstName: 'Valid' },  // Both → included
    ];
    const result = extractCjCategories(data);
    // "No ID" uses name as fallback ID, "only-id" has no name so skipped, "valid" is complete
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('No ID');
    expect(result[0].name).toBe('No ID');
    expect(result[1].id).toBe('valid');
    expect(result[1].name).toBe('Valid');
  });
});

describe('CJ failure classification', () => {
  it('classifies credential failures', () => {
    expect(classifyCjFailure(1600005)).toBe('AUTH_CREDENTIAL_FAILURE');
    expect(classifyCjFailure(1600006)).toBe('AUTH_CREDENTIAL_FAILURE');
    expect(classifyCjFailure(1601000)).toBe('AUTH_CREDENTIAL_FAILURE');
  });

  it('classifies token failures', () => {
    expect(classifyCjFailure(1600001)).toBe('AUTH_TOKEN_FAILURE');
    expect(classifyCjFailure(1600002)).toBe('AUTH_TOKEN_FAILURE');
    expect(classifyCjFailure(1600003)).toBe('AUTH_TOKEN_FAILURE');
  });

  it('classifies authorization failures', () => {
    expect(classifyCjFailure(1600004)).toBe('AUTHORIZATION_FAILURE');
    expect(classifyCjFailure(1600013)).toBe('AUTHORIZATION_FAILURE');
  });

  it('classifies rate limits', () => {
    expect(classifyCjFailure(1600200)).toBe('RATE_LIMIT');
    expect(classifyCjFailure(1600201)).toBe('RATE_LIMIT');
  });

  it('classifies server failures', () => {
    expect(classifyCjFailure(1600000)).toBe('CJ_SERVER_FAILURE');
    expect(classifyCjFailure(1608002)).toBe('CJ_SERVER_FAILURE');
  });

  it('classifies network failures for null/undefined/zero code', () => {
    expect(classifyCjFailure(null)).toBe('NETWORK_FAILURE');
    expect(classifyCjFailure(undefined)).toBe('NETWORK_FAILURE');
    expect(classifyCjFailure(0)).toBe('NETWORK_FAILURE');
  });

  it('classifies unknown codes as CJ_SERVER_FAILURE', () => {
    expect(classifyCjFailure(999999)).toBe('CJ_SERVER_FAILURE');
  });
});

describe('Uncertain transport failure detection', () => {
  it('marks missing code as uncertain', () => {
    expect(isUncertainTransportFailure({ code: null })).toBe(true);
    expect(isUncertainTransportFailure({ code: undefined })).toBe(true);
    expect(isUncertainTransportFailure({})).toBe(true);
  });

  it('marks code 0 as uncertain (transport failure)', () => {
    expect(isUncertainTransportFailure({ code: 0 })).toBe(true);
  });

  it('marks 5xx as uncertain (may have been processed)', () => {
    expect(isUncertainTransportFailure({ code: 500 })).toBe(true);
    expect(isUncertainTransportFailure({ code: 502 })).toBe(true);
    expect(isUncertainTransportFailure({ code: 599 })).toBe(true);
  });

  it('does NOT mark CJ business rejections as uncertain', () => {
    expect(isUncertainTransportFailure({ code: 1600001 })).toBe(false);
    expect(isUncertainTransportFailure({ code: 1600005 })).toBe(false);
    expect(isUncertainTransportFailure({ code: 400 })).toBe(false);
  });
});