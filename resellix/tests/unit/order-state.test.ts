import { describe, expect, it } from 'vitest';
import { canTransition, allowedTransitions, deriveOrderStatus } from '@/lib/orders/state';
import type { OrderStatus } from '@prisma/client';

describe('canTransition (order state machine)', () => {
  it('allows the happy prepaid path', () => {
    expect(canTransition('PENDING_PAYMENT', 'PAYMENT_VERIFIED')).toBe(true);
    expect(canTransition('PAYMENT_VERIFIED', 'ORDER_CONFIRMED')).toBe(true);
    expect(canTransition('ORDER_CONFIRMED', 'SENT_TO_SUPPLIER')).toBe(true);
    expect(canTransition('SENT_TO_SUPPLIER', 'SUPPLIER_ACCEPTED')).toBe(true);
    expect(canTransition('SUPPLIER_ACCEPTED', 'PROCESSING')).toBe(true);
    expect(canTransition('PROCESSING', 'SHIPPED')).toBe(true);
    expect(canTransition('SHIPPED', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(canTransition('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(true);
  });

  it('allows the COD path (confirmed without gateway payment)', () => {
    expect(canTransition('PENDING_PAYMENT', 'ORDER_CONFIRMED')).toBe(true);
  });

  it('treats same-status transitions as idempotent no-ops', () => {
    expect(canTransition('SHIPPED', 'SHIPPED')).toBe(true);
  });

  it('blocks illegal jumps and regressions', () => {
    expect(canTransition('PENDING_PAYMENT', 'DELIVERED')).toBe(false);
    expect(canTransition('DELIVERED', 'PENDING_PAYMENT')).toBe(false);
    expect(canTransition('CANCELLED', 'PROCESSING')).toBe(false);
    expect(canTransition('SHIPPED', 'ORDER_CONFIRMED')).toBe(false);
  });

  it('REFUNDED is terminal', () => {
    expect(allowedTransitions('REFUNDED')).toEqual([]);
  });

  it('cancellation is possible only before shipping', () => {
    expect(canTransition('ORDER_CONFIRMED', 'CANCELLED')).toBe(true);
    expect(canTransition('SHIPPED', 'CANCELLED')).toBe(false);
    expect(canTransition('DELIVERED', 'CANCELLED')).toBe(false);
  });

  it('returns/refunds after delivery follow the allowed path', () => {
    expect(canTransition('DELIVERED', 'RETURN_REQUESTED')).toBe(true);
    expect(canTransition('RETURN_REQUESTED', 'REFUNDED')).toBe(true);
    expect(canTransition('CANCELLED', 'REFUNDED')).toBe(true);
  });
});

describe('deriveOrderStatus (payment + fulfilment → status)', () => {
  it('pending payment dominates everything', () => {
    expect(deriveOrderStatus('PENDING', 'PENDING')).toBe('PENDING_PAYMENT');
    expect(deriveOrderStatus('PENDING', 'SHIPPED')).toBe('PENDING_PAYMENT');
  });

  it('failed payment maps to PAYMENT_FAILED', () => {
    expect(deriveOrderStatus('FAILED', 'PENDING')).toBe('PAYMENT_FAILED');
  });

  it('COD orders are confirmed immediately and paid on delivery', () => {
    expect(deriveOrderStatus('COD_PENDING', 'PENDING')).toBe('ORDER_CONFIRMED');
    expect(deriveOrderStatus('COD_PENDING', 'SHIPPED')).toBe('SHIPPED');
    expect(deriveOrderStatus('COD_PENDING', 'DELIVERED')).toBe('DELIVERED');
  });

  it('paid orders map through fulfilment', () => {
    expect(deriveOrderStatus('PAID', 'PENDING')).toBe('PAYMENT_VERIFIED');
    expect(deriveOrderStatus('PAID', 'PROCESSING')).toBe('PROCESSING');
    expect(deriveOrderStatus('PAID', 'FAILED')).toBe('FULFILMENT_FAILED');
  });

  it('refunded before any fulfilment is REFUNDED', () => {
    expect(deriveOrderStatus('REFUNDED', 'PENDING')).toBe('REFUNDED');
    expect(deriveOrderStatus('PARTIALLY_REFUNDED', 'DELIVERED')).toBe('DELIVERED');
  });

  it('every derived value is a real OrderStatus', () => {
    const payments = [
      'PENDING',
      'FAILED',
      'COD_PENDING',
      'PAID',
      'PARTIALLY_REFUNDED',
      'REFUNDED',
    ] as const;
    const fulfilments = [
      'PENDING',
      'SENT_TO_SUPPLIER',
      'SUPPLIER_ACCEPTED',
      'PROCESSING',
      'SHIPPED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED',
      'FAILED',
    ] as const;
    const valid: OrderStatus[] = [
      'PENDING_PAYMENT',
      'PAYMENT_FAILED',
      'PAYMENT_VERIFIED',
      'ORDER_CONFIRMED',
      'SENT_TO_SUPPLIER',
      'SUPPLIER_ACCEPTED',
      'PROCESSING',
      'SHIPPED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'RETURN_REQUESTED',
      'RETURNED',
      'REFUND_PENDING',
      'REFUNDED',
      'FULFILMENT_FAILED',
      'CANCELLED',
    ];
    for (const p of payments) {
      for (const f of fulfilments) {
        expect(valid).toContain(deriveOrderStatus(p, f));
      }
    }
  });
});
