import { describe, expect, it } from 'vitest';
import {
  toPaise,
  paiseToDecimalString,
  paiseToNumber,
  assertIntegerPaise,
  percentOfPaise,
  formatINR,
  sumPaise,
  divRound,
  clampInt,
  formatDiscountPercent,
} from '@/lib/money';

describe('toPaise', () => {
  it('converts decimal strings exactly (no float drift)', () => {
    expect(toPaise('12.34')).toBe(1234);
    expect(toPaise('0.01')).toBe(1);
    expect(toPaise('999999.99')).toBe(99999999);
  });

  it('converts numbers and rounds sub-paise fractions', () => {
    expect(toPaise(12.34)).toBe(1234);
    expect(toPaise(0)).toBe(0);
    expect(toPaise(19.999)).toBe(2000);
  });

  it('always yields integer paise', () => {
    expect(Number.isInteger(toPaise('8.115'))).toBe(true);
    expect(Number.isInteger(toPaise(1.005))).toBe(true);
  });

  it('rejects garbage input loudly (never silent NaN)', () => {
    expect(() => toPaise('abc')).toThrow();
    expect(() => toPaise(Number.NaN)).toThrow();
  });
});

describe('paise conversions', () => {
  it('paiseToDecimalString keeps two decimals', () => {
    expect(paiseToDecimalString(1234)).toBe('12.34');
    expect(paiseToDecimalString(5)).toBe('0.05');
    expect(paiseToDecimalString(0)).toBe('0.00');
  });

  it('paiseToNumber converts to rupees', () => {
    expect(paiseToNumber(1234)).toBeCloseTo(12.34, 10);
  });

  it('assertIntegerPaise rejects fractional or NaN values', () => {
    expect(() => assertIntegerPaise(1.5)).toThrow();
    expect(() => assertIntegerPaise(Number.NaN)).toThrow();
    expect(() => assertIntegerPaise(100)).not.toThrow();
  });
});

describe('percentOfPaise', () => {
  it('computes integer paise percentages', () => {
    expect(percentOfPaise(10000, 2)).toBe(200);
    expect(percentOfPaise(999, 10)).toBe(100); // rounds
    expect(percentOfPaise(1000, 0)).toBe(0);
  });
});

describe('formatINR', () => {
  it('formats with the rupee symbol and Indian digit grouping', () => {
    const s = formatINR(123456789); // ₹12,34,567.89
    expect(s).toContain('₹');
    expect(s).toMatch(/12,34,567/);
    expect(s).toContain('89');
  });

  it('supports symbol-less output', () => {
    const s = formatINR(10050, { withSymbol: false });
    expect(s).not.toContain('₹');
    expect(s).toMatch(/100/);
  });
});

describe('aggregates & clamps', () => {
  it('sumPaise adds integers', () => {
    expect(sumPaise([1, 2, 3])).toBe(6);
    expect(sumPaise([])).toBe(0);
  });

  it('divRound rounds half up', () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(4, 2)).toBe(2);
    expect(divRound(0, 3)).toBe(0);
  });

  it('clampInt clamps into range', () => {
    expect(clampInt(15, 0, 10)).toBe(10);
    expect(clampInt(-5, 0, 10)).toBe(0);
    expect(clampInt(7, 0, 10)).toBe(7);
  });

  it('formatDiscountPercent computes whole-percent discounts', () => {
    expect(formatDiscountPercent(8000, 10000)).toBe(20);
    expect(formatDiscountPercent(10000, 10000)).toBeNull(); // no genuine discount
    expect(formatDiscountPercent(10000, null)).toBeNull();
    expect(formatDiscountPercent(12000, 10000)).toBeNull(); // compare-at must be higher
  });
});
