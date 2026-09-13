import { describe, expect, it } from 'vitest';
import {
  addressSchema,
  productInputSchema,
  couponBaseSchema,
  inventoryUpdateSchema,
  userRoleUpdateSchema,
  adminCreateUserSchema,
  supplierInputSchema,
  repriceSchema,
} from '@/lib/validation/schemas';

const validAddress = {
  fullName: 'Ashok Sharma',
  phone: '9876543210',
  line1: '12 MG Road',
  city: 'Guwahati',
  state: 'Assam',
  postalCode: '781001',
};

describe('addressSchema', () => {
  it('accepts a valid Indian address and defaults country to IN', () => {
    const a = addressSchema.parse(validAddress);
    expect(a.country).toBe('IN');
  });

  it('enforces the 6-digit PIN starting 1-9', () => {
    expect(addressSchema.safeParse({ ...validAddress, postalCode: '012345' }).success).toBe(false);
    expect(addressSchema.safeParse({ ...validAddress, postalCode: '12345' }).success).toBe(false);
    expect(addressSchema.safeParse({ ...validAddress, postalCode: '1234567' }).success).toBe(false);
    expect(addressSchema.safeParse({ ...validAddress, postalCode: '781001' }).success).toBe(true);
  });
});

describe('productInputSchema (pricing-mode refinement)', () => {
  const base = {
    name: 'Test Product',
    description: 'A sufficiently long description for validation.',
    supplierCost: 100,
  };

  it('PERCENT_MARKUP requires percentMarkup', () => {
    expect(productInputSchema.safeParse({ ...base, pricingMode: 'PERCENT_MARKUP' }).success).toBe(
      false
    );
    expect(
      productInputSchema.safeParse({ ...base, pricingMode: 'PERCENT_MARKUP', percentMarkup: 30 })
        .success
    ).toBe(true);
  });

  it('FIXED_MARGIN requires fixedMargin', () => {
    expect(productInputSchema.safeParse({ ...base, pricingMode: 'FIXED_MARGIN' }).success).toBe(
      false
    );
    expect(
      productInputSchema.safeParse({ ...base, pricingMode: 'FIXED_MARGIN', fixedMargin: 50 })
        .success
    ).toBe(true);
  });

  it('FIXED_PRICE requires fixedPrice', () => {
    expect(productInputSchema.safeParse({ ...base, pricingMode: 'FIXED_PRICE' }).success).toBe(
      false
    );
    expect(
      productInputSchema.safeParse({ ...base, pricingMode: 'FIXED_PRICE', fixedPrice: 299 }).success
    ).toBe(true);
  });

  it('converts rupee inputs to integer paise', () => {
    const p = productInputSchema.parse({ ...base, percentMarkup: 25, supplierShippingCost: 10.5 });
    expect(p.supplierCost).toBe(10_000); // ₹100 → 10000 paise
    expect(p.supplierShippingCost).toBe(1_050);
  });

  it('applies safe defaults', () => {
    const p = productInputSchema.parse({ ...base, percentMarkup: 20 });
    expect(p.status).toBe('DRAFT');
    expect(p.stockMode).toBe('SUPPLIER_SYNC');
    expect(p.roundingRule).toBe('ROUND_UP_10');
    expect(p.images).toEqual([]);
    expect(p.variants).toEqual([]);
  });
});

describe('couponBaseSchema', () => {
  it('normalises codes to uppercase and requires positive value', () => {
    const c = couponBaseSchema.parse({ code: 'save10', type: 'PERCENT', value: 10 });
    expect(c.code).toBe('SAVE10');
    expect(couponBaseSchema.safeParse({ code: 'X1', type: 'PERCENT', value: 10 }).success).toBe(
      false
    ); // min 3 chars
    expect(couponBaseSchema.safeParse({ code: 'ABC', type: 'PERCENT', value: 0 }).success).toBe(
      false
    );
    expect(couponBaseSchema.safeParse({ code: 'ABC', type: 'PERCENT', value: -5 }).success).toBe(
      false
    );
  });

  it('rejects invalid code characters', () => {
    expect(
      couponBaseSchema.safeParse({ code: 'BAD CODE!', type: 'FIXED', value: 50 }).success
    ).toBe(false);
    expect(
      couponBaseSchema.safeParse({ code: 'GOOD_CODE-1', type: 'FIXED', value: 50 }).success
    ).toBe(true);
  });

  it('keeps rupee values as rupees (no paise transform) with sane defaults', () => {
    const c = couponBaseSchema.parse({
      code: 'FLAT50',
      type: 'FIXED',
      value: 50,
      minOrderAmount: 299,
    });
    expect(c.value).toBe(50);
    expect(c.minOrderAmount).toBe(299);
    expect(c.scope).toBe('ALL_PRODUCTS');
    expect(c.perUserLimit).toBe(1);
    expect(c.isActive).toBe(true);
  });
});

describe('inventoryUpdateSchema', () => {
  it('coerces numeric strings and requires productId', () => {
    const u = inventoryUpdateSchema.parse({ productId: 'p1', stock: '7' });
    expect(u.stock).toBe(7);
    expect(inventoryUpdateSchema.safeParse({ stock: 7 }).success).toBe(false);
    expect(inventoryUpdateSchema.safeParse({ productId: 'p1', stock: -1 }).success).toBe(false);
  });

  it('accepts status changes only from the allowed enum', () => {
    expect(inventoryUpdateSchema.safeParse({ productId: 'p1', status: 'ACTIVE' }).success).toBe(
      true
    );
    expect(inventoryUpdateSchema.safeParse({ productId: 'p1', status: 'LIVE' }).success).toBe(
      false
    );
  });
});

describe('user administration schemas', () => {
  it('userRoleUpdateSchema restricts roles', () => {
    expect(userRoleUpdateSchema.safeParse({ userId: 'u1', role: 'STAFF' }).success).toBe(true);
    expect(userRoleUpdateSchema.safeParse({ userId: 'u1', role: 'SUPERUSER' }).success).toBe(false);
  });

  it('adminCreateUserSchema enforces the password policy', () => {
    expect(
      adminCreateUserSchema.safeParse({
        name: 'Ops Person',
        email: 'ops@store.local',
        password: 'short',
        role: 'STAFF',
      }).success
    ).toBe(false);
    expect(
      adminCreateUserSchema.safeParse({
        name: 'Ops Person',
        email: 'ops@store.local',
        password: 'Str0ng!Passw0rd',
        role: 'STAFF',
      }).success
    ).toBe(true);
  });
});

describe('supplierInputSchema (no secrets in DB)', () => {
  it('accepts env-var NAMES and rejects lowercase secret-ish keys', () => {
    const s = supplierInputSchema.parse({
      name: 'Acme Distributors',
      type: 'HTTP_REST',
      apiKeyEnvVar: 'ACME_API_KEY',
      apiSecretEnvVar: 'ACME_API_SECRET',
    });
    expect(s.apiKeyEnvVar).toBe('ACME_API_KEY');
    expect(
      supplierInputSchema.safeParse({ name: 'Acme', apiKeyEnvVar: 'sk_live_12345' }).success
    ).toBe(false); // lowercase → rejected (env var names must be UPPER_SNAKE_CASE)
  });
});

describe('repriceSchema', () => {
  it('accepts scoped bulk reprice requests', () => {
    expect(repriceSchema.safeParse({ scope: 'ALL', apply: false }).success).toBe(true);
    expect(
      repriceSchema.safeParse({ scope: 'CATEGORY', categoryId: 'c1', apply: true }).success
    ).toBe(true);
    expect(repriceSchema.safeParse({ scope: 'WORLD', apply: true }).success).toBe(false);
  });
});
