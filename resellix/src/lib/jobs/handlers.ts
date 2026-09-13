import type { Job, Prisma } from '@prisma/client';

/**
 * Job handlers. Imports are dynamic so the queue/runner layer has no static
 * dependency cycles with the order/fulfilment domain.
 */

export interface RescheduleSignal {
  rescheduleAt: Date;
  payload?: Prisma.InputJsonValue;
}

export type HandlerResult = void | RescheduleSignal;

export async function runJobHandler(job: Job): Promise<HandlerResult> {
  const payload = job.payload as Record<string, unknown>;

  switch (job.type) {
    case 'FULFIL_SUPPLIER_ORDER': {
      const { sendToSupplier } = await import('../orders/fulfilment');
      await sendToSupplier(String(payload.supplierOrderId));
      return;
    }
    case 'SYNC_SUPPLIER_ORDER': {
      const { syncSupplierOrder } = await import('../orders/fulfilment');
      const attempt = Number(payload.attempt ?? 0);
      const result = await syncSupplierOrder(String(payload.supplierOrderId), attempt);
      if (result.rescheduleAt) {
        return {
          rescheduleAt: result.rescheduleAt,
          payload: { ...payload, attempt: attempt + 1 } as Prisma.InputJsonValue,
        };
      }
      return;
    }
    case 'CANCEL_SUPPLIER_ORDER': {
      const { cancelSupplierOrder } = await import('../orders/fulfilment');
      await cancelSupplierOrder(
        String(payload.supplierOrderId),
        String(payload.reason ?? 'Order cancelled')
      );
      return;
    }
    case 'SEND_NOTIFICATION': {
      const { dispatchNotification } = await import('../notifications/notify');
      await dispatchNotification(String(payload.notificationId));
      return;
    }
    default:
      throw new Error(`Unknown job type: ${String(job.type)}`);
  }
}
