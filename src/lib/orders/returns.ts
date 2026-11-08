import { prisma } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { toPaise } from '../money';
import { getSettings } from '../settings';
import { auditLog } from '../audit';
import { transitionOrder, canTransition } from './state';
import { restockOrderItems } from './inventory';
import { processRefundReservation, reserveRefund } from '../payments/refunds';
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
  const settings = await getSettings();
  const orderItemId = params.orderItemId ?? null;
  const { order, ret } = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "orders" WHERE "id" = ${params.orderId} FOR UPDATE
    `;
      const lockedOrder = await tx.order.findUnique({
        where: { id: params.orderId },
        include: { items: true, user: true },
      });
      if (!lockedOrder) throw notFound('Order not found');
      if (lockedOrder.status !== 'DELIVERED') {
        throw badRequest(
          `Returns can only be requested for delivered orders (current status: ${lockedOrder.status.replace(/_/g, ' ')}). Not delivered yet? You can cancel instead if fulfilment has not started.`
        );
      }
      const deliveredAt = lockedOrder.deliveredAt ?? lockedOrder.updatedAt;
      const windowMs = settings.policies.returnWindowDays * 86400e3;
      if (windowMs > 0 && Date.now() - deliveredAt.getTime() > windowMs) {
        throw badRequest(
          `The ${settings.policies.returnWindowDays}-day return window for this order has closed. Please contact support for assistance.`
        );
      }
      const openReturn = await tx.returnRequest.findFirst({
        where: { orderId: lockedOrder.id, status: { in: ['REQUESTED', 'APPROVED', 'RECEIVED'] } },
      });
      if (openReturn) throw conflict('A return request for this order is already in progress.');
      if (orderItemId && !lockedOrder.items.some((item) => item.id === orderItemId)) {
        throw badRequest('The selected item does not belong to this order.');
      }

      const created = await tx.returnRequest.create({
        data: {
          orderId: lockedOrder.id,
          orderItemId,
          reason: params.reason,
          customerNote: params.note ?? null,
          status: 'REQUESTED',
        },
      });
      if (canTransition(lockedOrder.status, 'RETURN_REQUESTED')) {
        const moved = await tx.order.updateMany({
          where: { id: lockedOrder.id, status: 'DELIVERED' },
          data: { status: 'RETURN_REQUESTED' },
        });
        if (moved.count !== 1) throw conflict('Order changed while requesting return.');
        await tx.orderEvent.create({
          data: {
            orderId: lockedOrder.id,
            type: 'STATUS_TRANSITION',
            fromStatus: lockedOrder.status,
            toStatus: 'RETURN_REQUESTED',
            message: `Return requested: ${params.reason}`,
            actorType: params.actorType,
            actorId: params.actorId ?? null,
            data: { returnId: created.id },
          },
        });
      } else {
        await tx.orderEvent.create({
          data: {
            orderId: lockedOrder.id,
            type: 'RETURN_REQUESTED',
            message: `Return requested: ${params.reason}`,
            actorType: params.actorType,
            actorId: params.actorId ?? null,
            data: { returnId: created.id },
          },
        });
      }
      return { order: lockedOrder, ret: created };
    },
    { isolationLevel: 'Serializable' }
  );

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
      const approval = await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "orders" WHERE "id" = ${order.id} FOR UPDATE
        `;
          const locked = await tx.returnRequest.findUnique({
            where: { id: ret.id },
            include: { order: { include: { items: true } } },
          });
          if (!locked) throw notFound('Return request not found');
          if (!['REQUESTED', 'RECEIVED', 'APPROVED'].includes(locked.status)) {
            throw conflict(`Cannot approve a return in status ${locked.status}`);
          }
          if (params.refundAmountPaise != null && params.refundAmountPaise < 0) {
            throw badRequest('Refund amount cannot be negative.');
          }
          const refundAmount =
            params.refundAmountPaise != null
              ? params.refundAmountPaise
              : locked.refundAmount != null
                ? toPaise(locked.refundAmount)
                : defaultRefundForReturn(locked.orderItemId, locked.order.items);
          if (!Number.isSafeInteger(refundAmount))
            throw badRequest('Refund amount must be a whole number of paise.');

          const reservation =
            refundAmount > 0
              ? await reserveRefund(tx, {
                  orderId: locked.orderId,
                  amountPaise: refundAmount,
                  reason: `Return approved: ${locked.reason}`,
                  returnRequestId: locked.id,
                  actor: 'ADMIN',
                  actorId: params.adminId,
                })
              : null;
          await tx.returnRequest.update({
            where: { id: locked.id },
            data: {
              status: 'APPROVED',
              adminNote: params.adminNote ?? locked.adminNote,
              refundAmount: (refundAmount / 100).toFixed(2),
            },
          });
          return { refundAmount, reservation };
        },
        { isolationLevel: 'Serializable' }
      );

      if (approval.reservation) {
        await processRefundReservation(approval.reservation, `Return approved: ${ret.reason}`);
      }
      const finalReturn = await prisma.returnRequest.findUniqueOrThrow({ where: { id: ret.id } });
      const approvalNote =
        finalReturn.status === 'REFUNDED'
          ? 'Your return was approved and the refund is confirmed completed.'
          : approval.reservation
            ? 'Your return has been approved. Refund settlement is not yet confirmed.'
            : (params.adminNote ?? 'Your return has been approved.');
      await notifyReturnUpdate(order.id, finalReturn.status, approvalNote);
      break;
    }
    case 'REJECT': {
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "orders" WHERE "id" = ${order.id} FOR UPDATE
        `;
          const locked = await tx.returnRequest.findUnique({ where: { id: ret.id } });
          if (!locked) throw notFound('Return request not found');
          if (locked.status !== 'REQUESTED') {
            throw conflict(`Cannot reject a return in status ${locked.status}`);
          }
          const refund = await tx.refund.findFirst({ where: { returnRequestId: locked.id } });
          if (refund) throw conflict('A return with a refund record cannot be rejected.');
          const update = await tx.returnRequest.updateMany({
            where: { id: locked.id, status: 'REQUESTED' },
            data: {
              status: 'REJECTED',
              adminNote: params.adminNote ?? locked.adminNote,
              resolvedAt: new Date(),
            },
          });
          if (update.count !== 1)
            throw conflict('Return decision changed concurrently. Refresh and try again.');

          if (
            order.status === 'RETURN_REQUESTED' &&
            canTransition('RETURN_REQUESTED', 'DELIVERED')
          ) {
            const moved = await tx.order.updateMany({
              where: { id: order.id, status: 'RETURN_REQUESTED' },
              data: { status: 'DELIVERED' },
            });
            if (moved.count === 1) {
              await tx.orderEvent.create({
                data: {
                  orderId: order.id,
                  type: 'STATUS_TRANSITION',
                  fromStatus: 'RETURN_REQUESTED',
                  toStatus: 'DELIVERED',
                  message: 'Return rejected - order restored to delivered',
                  actorType: 'ADMIN',
                  actorId: params.adminId,
                },
              });
            }
          }
        },
        { isolationLevel: 'Serializable' }
      );
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
      // Returned LOCAL-mode items go back into sellable stock (idempotent).
      await restockOrderItems({
        orderId: order.id,
        reason: 'RETURN_RESTOCK',
        actorId: params.adminId ?? null,
      });
      await notifyReturnUpdate(order.id, 'RECEIVED', 'We have received the returned item(s).');
      break;
    }
    case 'CLOSE': {
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "orders" WHERE "id" = ${order.id} FOR UPDATE
        `;
          const locked = await tx.returnRequest.findUnique({ where: { id: ret.id } });
          if (!locked) throw notFound('Return request not found');
          if (!['APPROVED', 'RECEIVED'].includes(locked.status)) {
            throw conflict(`Cannot close a return in status ${locked.status}`);
          }
          const unresolved = await tx.refund.findFirst({
            where: {
              returnRequestId: locked.id,
              status: { not: 'COMPLETED' },
            },
          });
          if (unresolved) throw conflict('Cannot close a return while its refund is unresolved.');
          const updated = await tx.returnRequest.updateMany({
            where: { id: locked.id, status: locked.status },
            data: {
              status: 'CLOSED',
              resolvedAt: new Date(),
              adminNote: params.adminNote ?? locked.adminNote,
            },
          });
          if (updated.count !== 1) throw conflict('Return status changed concurrently.');
        },
        { isolationLevel: 'Serializable' }
      );
      await notifyReturnUpdate(
        order.id,
        'CLOSED',
        params.adminNote ?? 'The return request has been closed.'
      );
      break;
    }
  }

  const linkedRefund =
    params.decision === 'APPROVE'
      ? await prisma.refund.findFirst({
          where: { returnRequestId: ret.id },
          orderBy: { createdAt: 'desc' },
        })
      : null;
  await auditLog({
    actor: { id: params.adminId },
    action: `return.${params.decision.toLowerCase()}`,
    entityType: 'ReturnRequest',
    entityId: ret.id,
    data: {
      orderId: order.id,
      note: params.adminNote ?? null,
      refundId: linkedRefund?.id ?? null,
      refundStatus: linkedRefund?.status ?? null,
      refundAmount: linkedRefund?.amount ?? null,
    },
  });
  const currentReturn = await prisma.returnRequest.findUniqueOrThrow({ where: { id: ret.id } });
  return { status: currentReturn.status };
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
