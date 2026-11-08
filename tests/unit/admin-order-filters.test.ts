import { describe, expect, it } from 'vitest';
import { buildAdminOrderWhere, parseAdminOrderFilters } from '@/lib/orders/admin-filters';

describe('admin order filters', () => {
  it('treats TEST as a recorded payment provider, never as paymentMethod', () => {
    const filters = parseAdminOrderFilters({ provider: 'TEST' });
    const where = buildAdminOrderWhere(filters);
    expect(filters.provider).toBe('TEST');
    expect(filters.method).toBeUndefined();
    expect(where).toEqual({ payments: { some: { provider: 'TEST' } } });
    expect(where.paymentMethod).toBeUndefined();
  });

  it('supports Razorpay and method filters independently and together', () => {
    expect(buildAdminOrderWhere(parseAdminOrderFilters({ provider: 'RAZORPAY' }))).toEqual({
      payments: { some: { provider: 'RAZORPAY' } },
    });
    expect(
      buildAdminOrderWhere(
        parseAdminOrderFilters({ provider: 'TEST', method: 'PREPAID_GATEWAY', payment: 'PAID' })
      )
    ).toEqual({
      paymentMethod: 'PREPAID_GATEWAY',
      paymentStatus: 'PAID',
      payments: { some: { provider: 'TEST' } },
    });
  });

  it.each(['TEST', 'RAZORPAY', 'not-a-method'])(
    'ignores invalid payment method %s instead of casting it into a Prisma enum',
    (method) => {
      const filters = parseAdminOrderFilters({ method });
      expect(filters.method).toBeUndefined();
      expect(buildAdminOrderWhere(filters)).toEqual({});
    }
  );

  it('fails safely for unknown provider/status filters', () => {
    const filters = parseAdminOrderFilters({ provider: 'STRIPE', status: 'NOT_A_STATUS' });
    expect(filters.provider).toBeUndefined();
    expect(filters.status).toBe('ALL');
    expect(buildAdminOrderWhere(filters)).toEqual({});
  });

  it('keeps search, payment status, fulfilment and provider predicates composable', () => {
    const where = buildAdminOrderWhere(
      parseAdminOrderFilters({
        q: '  RX-123  ',
        status: 'DELIVERED',
        payment: 'PAID',
        fulfilment: 'DELIVERED',
        method: 'COD',
        provider: 'TEST',
      })
    );
    expect(where.status).toBe('DELIVERED');
    expect(where.paymentStatus).toBe('PAID');
    expect(where.fulfilmentStatus).toBe('DELIVERED');
    expect(where.paymentMethod).toBe('COD');
    expect(where.payments).toEqual({ some: { provider: 'TEST' } });
    expect(where.OR).toHaveLength(5);
  });
});
