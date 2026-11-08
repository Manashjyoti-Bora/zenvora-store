import { z } from 'zod';
import type { Prisma } from '@prisma/client';

const ORDER_STATUSES = [
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
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
  'RETURN_REQUESTED',
  'RETURNED',
  'FULFILMENT_FAILED',
  'RTO',
  'RTO_RECEIVED',
] as const;

/** Query parsing is fail-safe: an unknown filter is ignored, never cast into a Prisma enum. */
export const adminOrderFilterSchema = z.object({
  q: z.string().trim().max(120).catch(''),
  status: z.enum(['ALL', ...ORDER_STATUSES]).catch('ALL'),
  payment: z
    .enum(['PENDING', 'COD_PENDING', 'PAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED'])
    .optional()
    .catch(undefined),
  fulfilment: z
    .enum([
      'PENDING',
      'SENT_TO_SUPPLIER',
      'SUPPLIER_ACCEPTED',
      'PROCESSING',
      'SHIPPED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED',
      'FAILED',
    ])
    .optional()
    .catch(undefined),
  method: z.enum(['COD', 'PREPAID_GATEWAY']).optional().catch(undefined),
  provider: z.enum(['RAZORPAY', 'TEST']).optional().catch(undefined),
});

export type AdminOrderFilters = z.infer<typeof adminOrderFilterSchema>;

export function parseAdminOrderFilters(input: {
  q?: string;
  status?: string;
  payment?: string;
  fulfilment?: string;
  method?: string;
  provider?: string;
}): AdminOrderFilters {
  return adminOrderFilterSchema.parse({
    q: input.q ?? '',
    status: input.status ?? 'ALL',
    payment: input.payment,
    fulfilment: input.fulfilment,
    method: input.method,
    provider: input.provider,
  });
}

export function buildAdminOrderWhere(filters: AdminOrderFilters): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  if (filters.q) {
    where.OR = [
      { orderNumber: { contains: filters.q, mode: 'insensitive' } },
      { guestEmail: { contains: filters.q, mode: 'insensitive' } },
      { guestName: { contains: filters.q, mode: 'insensitive' } },
      { user: { email: { contains: filters.q, mode: 'insensitive' } } },
      { user: { name: { contains: filters.q, mode: 'insensitive' } } },
    ];
  }
  if (filters.status !== 'ALL') where.status = filters.status;
  if (filters.payment) where.paymentStatus = filters.payment;
  if (filters.fulfilment) where.fulfilmentStatus = filters.fulfilment;
  if (filters.method) where.paymentMethod = filters.method;
  if (filters.provider) {
    // Provider is recorded on Payment attempts, not on the two-value
    // Order.paymentMethod enum. A TEST provider can therefore never become a
    // paymentMethod=TEST Prisma query.
    where.payments = { some: { provider: filters.provider } };
  }
  return where;
}
