import { prisma } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { toPaise } from '../money';
import { getSettings } from '../settings';
import { auditLog } from '../audit';
import { transitionOrder, recordOrderEvent, canTransition } from './state';
import { createRefund } from '../payments/refunds';
import { queueNotification } from '../notifications/notify';
import { renderOrderEmailVars } from '../notifications/order-vars';
import type { OrderActorType } from '@prisma/client';

/**
 * Return / refund-request workflow.
 *
 * Customer eligibility: order DELIVERED and within `returnWindowDays` of
 * delivery (store policy setting). Admin then approves/rejects, marks items
 * received, and issues the refund through the gateway when possible.
 */

export async function requestReturn(params: {
  orderId: string;
  orderItemId?: string | null;
  reason: string;
  note?: string | null;
  actorType: OrderActorType;
  actorId?: string | null;
}): Promise<{ returnId: string }> {
  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    include: { items: true, user: true },
  });
  if (!order) throw notFound('Order not found');

  if (order.status !== 'DELIVERED') {
    throw badRequest(
      `Returns can only be requested for delivered orders (current status: ${order.status.replace(/_/g, ' ')}). Not delivered yet? You can cancel instead if fulfilment has not started.`
    );
  }
  const settings = await getSettings();
  const deliveredAt = order.deliveredAt ?? order.updatedAt;
  const windowMs = settings.policies.returnWindowDays * 86400e3;
  if (windowMs > 0 && Date.now() - deliveredAt.getTime() > windowMs) {
    throw badRequest(
      `The ${settings.policies.returnWindowDays}-day return window for this order has closed. Please contact support for assistance.`
    );
  }
  const openReturn = await prisma.returnRequest.findFirst({
    where: { orderId: order.id, status: { in: ['REQUESTED', 'APPROVED', 'RECEIVED'] } },
  });
  if (openReturn) throw conflict('A return request for this order is already in progress.');

  const orderItemId = params.orderItemId ?? null;
  if (orderItemId && !order.items.some((i) => i.id === orderItemId)) {
    throw badRequest('The selected item does not belong to this order.');
  }

  const ret = await prisma.returnRequest.create({
    data: {
      orderId: order.id,
      orderItemId,
      reason: params.reason,
      customerNote: params.note ?? null,
      status: 'REQUESTED',
    },
  });

  if (canTransition(order.status, 'RETURN_REQUESTED')) {
    await transitionOrder({
      orderId: order.id,
      to: 'RETURN_REQUESTED',
      actorType: params.actorType,
      actorId: params.actorId ?? null,
      message: `Return requested: ${params.reason}`,
      data: { returnId: ret.id },
    });
  } else {
    await recordOrderEvent({
      orderId: order.id,
      type: 'RETURN_REQUESTED',
      message: `Return requested: ${params.reason}`,
      actorType: params.actorType,
      actorId: params.actorId ?? null,
      data: { returnId: ret.id },
    });
  }

  const vars = await renderOrderEmailVars(order.id);
  await queueNotification({
    template: 'RETURN_UPDATE',
    email: order.guestEmail ?? vars.email,
    userId: order.userId,
    orderId: order.id,
    vars: { ...vars, returnStatus: 'REQUESTED', note: 'We will review your request shortly.' },
    skipIfNoEmail: true,
  });
  // Admin visibility
  await queueNotification({
    template: 'CONTACT_MESSAGE_ADMIN',
    email: settings.supportEmail,
    vars: {
      name: order.user?.name ?? order.guestName ?? 'Customer',
      email: order.user?.email ?? order.guestEmail ?? '-',
      subject: `Return request for ${order.orderNumber}`,
      message: `Reason: ${params.reason}${params.note ? `\nNote: ${params.note}` : ''}`,
      adminUrl: `${process.env.APP_URL ?? ''}/admin/returns`,
    },
    relatedType: 'ReturnRequest',
    relatedId: ret.id,
  });

  return { returnId: ret.id };
}

export async function decideReturn(params: {
  returnId: string;
  decision: 'APPROVE' | 'REJECT' | 'MARK_RECEIVED' | 'CLOSE';
  adminNote?: string | null;
  refundAmountPaise?: number | null;
  adminId: string;
}): Promise<{ status: string }> {
  const ret = await prisma.returnRequest.findUnique({
    where: { id: params.returnId },
    include: { order: { include: { items: true } } },
  });
  if (!ret) throw notFound('Return request not found');
  const order = ret.order;

  switch (params.decision) {
    case 'APPROVE': {
      if (!['REQUESTED', 'RECEIVED'].includes(ret.status)) {
        throw conflict(`Cannot approve a return in status ${ret.status}`);
      }
      const refundAmount =
        params.refundAmountPaise != null && params.refundAmountPaise > 0
          ? params.refundAmountPaise
          : defaultRefundForReturn(ret.orderItemId, order.items);
      await prisma.returnRequest.update({
        where: { id: ret.id },
        data: {
          status: 'APPROVED',
          adminNote: params.adminNote ?? ret.adminNote,
          refundAmount: (refundAmount / 100).toFixed(2),
        },
      });
      if (refundAmount > 0) {
        await createRefund({
          orderId: order.id,
          amountPaise: refundAmount,
          reason: `Return approved: ${ret.reason}`,
          returnRequestId: ret.id,
          actor: 'ADMIN',
          actorId: params.adminId,
        });
      }
      await notifyReturnUpdate(
        order.id,
        'APPROVED',
        params.adminNote ?? 'Your return has been approved.'
      );
      break;
    }
    case 'REJECT': {
      if (!['REQUESTED', 'APPROVED'].includes(ret.status)) {
        throw conflict(`Cannot reject a return in status ${ret.status}`);
      }
      await prisma.returnRequest.update({
        where: { id: ret.id },
        data: {
          status: 'REJECTED',
          adminNote: params.adminNote ?? ret.adminNote,
          resolvedAt: new Date(),
        },
      });
      if (order.status === 'RETURN_REQUESTED' && canTransition('RETURN_REQUESTED', 'DELIVERED')) {
        await transitionOrder({
          orderId: order.id,
          to: 'DELIVERED',
          actorType: 'ADMIN',
          actorId: params.adminId,
          message: 'Return rejected - order restored to delivered',
        });
      }
      await notifyReturnUpdate(
        order.id,
        'REJECTED',
        params.adminNote ?? 'Unfortunately your return request was not approved.'
      );
      break;
    }
    case 'MARK_RECEIVED': {
      if (!['APPROVED', 'REQUESTED'].includes(ret.status)) {
        throw conflict(`Cannot mark a return in status ${ret.status} as received`);
      }
      await prisma.returnRequest.update({
        where: { id: ret.id },
        data: { status: 'RECEIVED', adminNote: params.adminNote ?? ret.adminNote },
      });
      if (canTransition(order.status, 'RETURNED')) {
        await transitionOrder({
          orderId: order.id,
          to: 'RETURNED',
          actorType: 'ADMIN',
          actorId: params.adminId,
          message: 'Returned item(s) received',
        });
      }
      await notifyReturnUpdate(order.id, 'RECEIVED', 'We have received the returned item(s).');
      break;
    }
    case 'CLOSE': {
      await prisma.returnRequest.update({
        where: { id: ret.id },
        data: {
          status: 'CLOSED',
          resolvedAt: new Date(),
          adminNote: params.adminNote ?? ret.adminNote,
        },
      });
      await notifyReturnUpdate(
        order.id,
        'CLOSED',
        params.adminNote ?? 'The return request has been closed.'
      );
      break;
    }
  }

  await auditLog({
    actor: { id: params.adminId },
    action: `return.${params.decision.toLowerCase()}`,
    entityType: 'ReturnRequest',
    entityId: ret.id,
    data: { orderId: order.id, note: params.adminNote ?? null },
  });
  return { status: params.decision };
}

function defaultRefundForReturn(
  orderItemId: string | null,
  items: Array<{ id: string; lineTotal: unknown; lineDiscount: unknown }>
): number {
  if (orderItemId) {
    const item = items.find((i) => i.id === orderItemId);
    return item ? toPaise(item.lineTotal as never) - toPaise(item.lineDiscount as never) : 0;
  }
  return items.reduce(
    (a, i) => a + toPaise(i.lineTotal as never) - toPaise(i.lineDiscount as never),
    0
  );
}

async function notifyReturnUpdate(orderId: string, status: string, note: string): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const vars = await renderOrderEmailVars(orderId);
  await queueNotification({
    template: 'RETURN_UPDATE',
    email: order.guestEmail ?? vars.email,
    userId: order.userId,
    orderId,
    vars: { ...vars, returnStatus: status, note },
    skipIfNoEmail: true,
    dedupeExtra: status,
  });
}
