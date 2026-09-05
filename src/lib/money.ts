/**
 * Structural stand-in for Prisma's Decimal. We deliberately do NOT import
 * `@prisma/client/runtime/library` here: this module is used by client
 * components (price formatting), and pulling the Prisma runtime into the
 * browser bundle breaks the webpack build (node:* schemes).
 */
export interface DecimalLike {
  mul(n: number): { round(): { toNumber(): number } };
}

/**
 * Money helpers.
 *
 * ALL arithmetic in the application is performed in integer paise (1/100 of a
 * rupee) to avoid floating point drift. Decimals are used only at the database
 * boundary (Prisma Decimal(14,2)). Display uses Intl with the en-IN locale.
 */

export type MoneyInput = DecimalLike | number | string;

/** Convert a rupee amount (Decimal/number/string) to integer paise. */
export function toPaise(value: MoneyInput): number {
  // Prisma Decimals are detected structurally: `instanceof` is unreliable when
  // two copies of the runtime library are loaded (ESM/CJS dual instances).
  if (typeof value === 'object' && value !== null) {
    const dec = value as { mul?: unknown };
    if (typeof dec.mul === 'function') {
      return (value as DecimalLike).mul(100).round().toNumber();
    }
    throw new Error(`Invalid money value: ${String(value)}`);
  }
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid money value: ${String(value)}`);
  }
  return Math.round(n * 100);
}

/** Convert integer paise to a rupee Decimal-compatible string ("499.99"). */
export function paiseToDecimalString(paise: number): string {
  assertIntegerPaise(paise);
  return (paise / 100).toFixed(2);
}

/** Convert integer paise to a rupee number (for non-financial display math). */
export function paiseToNumber(paise: number): number {
  assertIntegerPaise(paise);
  return paise / 100;
}

export function assertIntegerPaise(paise: number): void {
  if (!Number.isInteger(paise)) {
    throw new Error(`Money must be integer paise, got: ${paise}`);
  }
}

/** Percentage of an amount, rounded half-up to whole paise. */
export function percentOfPaise(amountPaise: number, percent: number): number {
  assertIntegerPaise(amountPaise);
  if (!Number.isFinite(percent) || percent < 0) {
    throw new Error(`Invalid percent: ${percent}`);
  }
  return Math.round((amountPaise * percent) / 100);
}

/** Format integer paise as Indian rupees, e.g. 49990 -> "₹499.90". */
export function formatINR(paise: number, opts?: { withSymbol?: boolean }): string {
  const withSymbol = opts?.withSymbol ?? true;
  const value = paise / 100;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
  return withSymbol ? `₹${formatted}` : formatted;
}

/** Sum a list of integer-paise values. */
export function sumPaise(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

/** Round half-up on integer division results. */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round(numerator / denominator);
}

/** Clamp an integer to [min, max]. */
export function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

/**
 * Discount percentage between a selling price and a compare-at price.
 * Returns null when there is no genuine discount (missing/invalid compare-at
 * or compare-at <= price) - we never invent a discount badge.
 */
export function formatDiscountPercent(
  pricePaise: number,
  compareAtPaise: number | null | undefined
): number | null {
  if (compareAtPaise == null || compareAtPaise <= 0 || compareAtPaise <= pricePaise) return null;
  const pct = Math.round(((compareAtPaise - pricePaise) / compareAtPaise) * 100);
  return pct > 0 ? pct : null;
}
