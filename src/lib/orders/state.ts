import { prisma } from '../db';
import type {
  Order,
  OrderStatus,
  OrderPaymentStatus,
  OrderFulfilmentStatus,
  OrderActorType,
  Prisma,
} from '@prisma/client';
import { conflict } from '../errors';
import { logger } from '../logger';

/**
 * Order lifecycle state machine.
 *
 * Full supported flow:
 *   PENDING_PAYMENT → PAYMENT_VERIFIED → ORDER_CONFIRMED → SENT_TO_SUPPLIER
 *   → SUPPLIER_ACCEPTED → PROCESSING → SHIPPED → OUT_FOR_DELIVERY → DELIVERED
 *
 * Plus: PAYMENT_FAILED, CANCELLED, REFUND_PENDING, REFUNDED,
 *       RETURN_REQUESTED, RETURNED, FULFILMENT_FAILED.
 *
 * Every transition is written to `order_events` (audit trail) and validated
 * against the allowed-transition map - illegal transitions throw.
 */

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  // ORDER_CONFIRMED directly from PENDING_PAYMENT is the COD path (no gateway).
  PENDING_PAYMENT: ['PAYMENT_VERIFIED', 'ORDER_CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED'],
  PAYMENT_FAILED: ['PENDING_PAYMENT', 'PAYMENT_VERIFIED', 'CANCELLED'],
  PAYMENT_VERIFIED: ['ORDER_CONFIRMED', 'CANCELLED', 'REFUND_PENDING'],
  ORDER_CONFIRMED: ['SENT_TO_SUPPLIER', 'FULFILMENT_FAILED', 'CANCELLED', 'REFUND_PENDING'],
  SENT_TO_SUPPLIER: [
    'SUPPLIER_ACCEPTED',
    'PROCESSING',
    'FULFILMENT_FAILED',
    'REFUND_PENDING',
    'CANCELLED',
  ],
  SUPPLIER_ACCEPTED: ['PROCESSING', 'SHIPPED', 'FULFILMENT_FAILED', 'REFUND_PENDING'],
  PROCESSING: ['SHIPPED', 'FULFILMENT_FAILED', 'REFUND_PENDING'],
  SHIPPED: ['OUT_FOR_DELIVERY', 'DELIVERED', 'REFUND_PENDING', 'RTO'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'REFUND_PENDING', 'RTO'],
  RTO: ['RTO_RECEIVED', 'REFUND_PENDING', 'CANCELLED'],
  RTO_RECEIVED: ['REFUND_PENDING', 'REFUNDED'],
  DELIVERED: ['RETURN_REQUESTED', 'REFUND_PENDING', 'REFUNDED'],
  RETURN_REQUESTED: ['RETURNED', 'REFUND_PENDING', 'REFUNDED', 'DELIVERED'],
  RETURNED: ['REFUND_PENDING', 'REFUNDED'],
  REFUND_PENDING: ['REFUNDED', 'DELIVERED', 'RETURN_REQUESTED'],
  FULFILMENT_FAILED: ['REFUND_PENDING', 'REFUNDED', 'CANCELLED', 'ORDER_CONFIRMED'],
  CANCELLED: ['REFUNDED'],
  REFUNDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true; // idempotent no-op
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function allowedTransitions(from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[from] ?? [];
}

/** Standard mapping used by the payment/fulfilment pipelines. */
export function deriveOrderStatus(
  payment: OrderPaymentStatus,
  fulfilment: OrderFulfilmentStatus
): OrderStatus {
  if (payment === 'PENDING') return 'PENDING_PAYMENT';
  if (payment === 'FAILED') return 'PAYMENT_FAILED';
  if (payment === 'COD_PENDING') {
    // COD orders are confirmed immediately and paid on delivery.
    return fulfilmentToStatus(fulfilment, 'ORDER_CONFIRMED');
  }
  // PAID / PARTIALLY_REFUNDED / REFUNDED
  if (payment === 'REFUNDED' && fulfilment === 'PENDING') return 'REFUNDED';
  return fulfilmentToStatus(fulfilment, 'PAYMENT_VERIFIED');
}

function fulfilmentToStatus(f: OrderFulfilmentStatus, pendingStatus: OrderStatus): OrderStatus {
  switch (f) {
    case 'PENDING':
      return pendingStatus;
    case 'SENT_TO_SUPPLIER':
      return 'SENT_TO_SUPPLIER';
    case 'SUPPLIER_ACCEPTED':
      return 'SUPPLIER_ACCEPTED';
    case 'PROCESSING':
      return 'PROCESSING';
    case 'SHIPPED':
      return 'SHIPPED';
    case 'OUT_FOR_DELIVERY':
      return 'OUT_FOR_DELIVERY';
    case 'DELIVERED':
      return 'DELIVERED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'FAILED':
      return 'FULFILMENT_FAILED';
    default:
      return pendingStatus;
  }
}

export interface TransitionParams {
  orderId: string;
  to: OrderStatus;
  actorType?: OrderActorType;
  actorId?: string | null;
  message?: string;
  data?: Prisma.InputJsonValue;
  /** Additional Order fields to set atomically with the transition. */
  set?: Prisma.OrderUpdateInput;
  /** When provided, the transition only applies if current status matches. */
  expectedFrom?: OrderStatus[];
}

/**
 * Atomically move an order to a new status (optimistic concurrency: the
 * UPDATE is conditioned on the current status) and record the event.
 * Returns the updated order, or null when the transition became a no-op
 * because another process already moved the order (idempotent pipelines).
 */
export async function transitionOrder(params: TransitionParams): Promise<Order | null> {
  const {
    orderId,
    to,
    actorType = 'SYSTEM',
    actorId = null,
    message,
    data,
    set,
    expectedFrom,
  } = params;

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw conflict('Order not found');

    if (order.status === to) {
      logger.info('Order transition no-op (already in target status)', { orderId, to });
      return order;
    }
    if (!canTransition(order.status, to)) {
      throw conflict(`Illegal order status transition: ${order.status} → ${to}`);
    }
    if (expectedFrom && !expectedFrom.includes(order.status)) {
      logger.info('Order transition skipped (concurrent update)', {
        orderId,
        from: order.status,
        expectedFrom,
        to,
      });
      return null;
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: { status: to, ...(set ?? {}) },
    });

    await tx.orderEvent.create({
      data: {
        orderId,
        type: 'STATUS_TRANSITION',
        fromStatus: order.status,
        toStatus: to,
        message: message ?? null,
        actorType,
        actorId,
        data: (data ?? {}) as Prisma.InputJsonValue,
      },
    });

    logger.info('Order status transition', { orderId, from: order.status, to, actorType });
    return updated;
  });
}

/** Record a non-transition order event (payment captured, note added, ...). */
export async function recordOrderEvent(params: {
  orderId: string;
  type: string;
  message?: string;
  actorType?: OrderActorType;
  actorId?: string | null;
  data?: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.orderEvent.create({
    data: {
      orderId: params.orderId,
      type: params.type,
      message: params.message ?? null,
      actorType: params.actorType ?? 'SYSTEM',
      actorId: params.actorId ?? null,
      data: (params.data ?? {}) as Prisma.InputJsonValue,
    },
  });
}
