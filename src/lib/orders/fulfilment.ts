import { prisma } from '../db';
import { logger, sanitizeForLog } from '../logger';
import { toPaise, formatINR } from '../money';
import { getSupplierAdapter } from '../suppliers/registry';
import { SupplierRejectedError, UnsupportedSupplierOperation } from '../suppliers/types';
import { PermanentJobError } from '../jobs/errors';
import { enqueueJob, kickJobRunner } from '../jobs/queue';
import { transitionOrder, recordOrderEvent, canTransition } from './state';
import { recalcOrderFinancials } from './finance';
import { queueNotification } from '../notifications/notify';
import { renderOrderEmailVars } from '../notifications/order-vars';
import type { Order, Prisma, ShipmentStatus, SupplierOrder } from '@prisma/client';

/**
 * ============================================================================
 * Supplier fulfilment orchestration
 * ============================================================================
 * Payment confirmed -> supplier orders queued -> adapter.createOrder ->
 * status polling / webhooks -> shipments & tracking -> customer notifications.
 *
 * Design rules:
 * - Every supplier side-effect runs through the durable job queue with
 *   idempotency keys (never duplicates a supplier order on retry).
 * - Transient errors retry with exponential backoff; permanent errors
 *   (out-of-stock, rejection) fail fast, mark the order FULFILMENT_FAILED
 *   and alert the admin - never silently.
 * - Manual suppliers get an honest QUEUED record for the admin to fulfil.
 */

const DEFAULT_SUPPLIER_SLUG = 'manual-fulfilment';

export async function ensureDefaultSupplier(): Promise<{ id: string }> {
  const supplier = await prisma.supplier.upsert({
    where: { slug: DEFAULT_SUPPLIER_SLUG },
    create: {
      name: 'Manual Fulfilment (no API)',
      slug: DEFAULT_SUPPLIER_SLUG,
      type: 'MANUAL',
      notes:
        'Built-in bucket for products without an assigned supplier. Orders are queued here and fulfilled manually by the admin.',
    },
    update: {},
  });
  return { id: supplier.id };
}

/** Create supplier-order rows (grouped by supplier) and enqueue fulfilment. */
export async function enqueueOrderFulfilment(orderId: string): Promise<string[]> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) return [];
  if (['CANCELLED', 'REFUNDED', 'REFUND_PENDING', 'FULFILMENT_FAILED'].includes(order.status)) {
    return [];
  }

  const existing = await prisma.supplierOrder.findMany({ where: { orderId } });
  if (existing.length > 0) {
    // Already queued (idempotent re-entry, e.g. duplicate webhook).
    for (const so of existing.filter((s) => s.status === 'QUEUED')) {
      await enqueueJob({
        type: 'FULFIL_SUPPLIER_ORDER',
        payload: { supplierOrderId: so.id },
        dedupeKey: `fulfil_${so.id}`,
      });
    }
    kickJobRunner();
    return existing.map((s) => s.id);
  }

  const defaultSupplier = await ensureDefaultSupplier();
  const groups = new Map<string, typeof order.items>();
  for (const item of order.items) {
    const supplierId = item.supplierId ?? defaultSupplier.id;
    const list = groups.get(supplierId) ?? [];
    list.push(item);
    groups.set(supplierId, list);
  }

  const ids: string[] = [];
  for (const [supplierId, items] of groups) {
    const idempotencyKey = `so_${orderId}_${supplierId}`;
    const supplierOrder = await prisma.supplierOrder.create({
      data: {
        orderId,
        supplierId,
        idempotencyKey,
        status: 'QUEUED',
        requestPayload: {
          items: items.map((i) => ({
            orderItemId: i.id,
            sku: i.sku,
            supplierSku: i.supplierSku,
            quantity: i.quantity,
          })),
        } as Prisma.InputJsonValue,
      },
    });
    await prisma.orderItem.updateMany({
      where: { id: { in: items.map((i) => i.id) } },
      data: { supplierOrderId: supplierOrder.id },
    });
    await enqueueJob({
      type: 'FULFIL_SUPPLIER_ORDER',
      payload: { supplierOrderId: supplierOrder.id },
      dedupeKey: `fulfil_${supplierOrder.id}`,
    });
    ids.push(supplierOrder.id);
  }

  await recordOrderEvent({
    orderId,
    type: 'FULFILMENT_QUEUED',
    message: `Queued ${ids.length} supplier order(s)`,
  });
  kickJobRunner();
  return ids;
}

/** Job handler: send one supplier order to its supplier via the adapter. */
export async function sendToSupplier(supplierOrderRowId: string): Promise<void> {
  const so = await prisma.supplierOrder.findUnique({
    where: { id: supplierOrderRowId },
    include: {
      supplier: true,
      orderItems: { include: { product: true, variant: true } },
      order: { include: { user: true } },
    },
  });
  if (!so) throw new PermanentJobError(`Supplier order row not found: ${supplierOrderRowId}`);

  // Idempotent: never send twice.
  if (so.status !== 'QUEUED' && so.status !== 'FAILED') {
    logger.info('Supplier order already processed, skipping send', {
      id: so.id,
      status: so.status,
    });
    return;
  }
  if (['CANCELLED', 'REFUNDED'].includes(so.order.status)) {
    await prisma.supplierOrder.update({
      where: { id: so.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    return;
  }

  const adapter = getSupplierAdapter(so.supplier);
  const items = so.orderItems.map((item) => ({
    supplierSku: item.supplierSku ?? item.product?.sku ?? item.sku ?? '',
    name: item.product?.name ?? 'Item',
    quantity: item.quantity,
    unitCostPaise: toPaise(item.unitSupplierCost),
  }));
  const missingSku = so.orderItems.some((i) => !(i.supplierSku ?? i.product?.sku ?? i.sku));
  if (missingSku && so.supplier.type !== 'MANUAL') {
    throw new PermanentJobError(
      'One or more order items are missing a supplier SKU - map the product to a supplier SKU first'
    );
  }

  // Stock check (only when the supplier API can actually verify it).
  if (adapter.capabilities.stockCheck) {
    for (const item of so.orderItems) {
      if (item.product?.stockMode !== 'SUPPLIER_SYNC') continue;
      const sku = item.supplierSku ?? item.product?.sku;
      if (!sku) continue;
      const stock = await adapter.checkStock(sku, item.quantity);
      if (!stock.inStock) {
        throw new PermanentJobError(
          `Supplier reported "${item.product?.name ?? sku}" out of stock (requested ${item.quantity})`,
          new SupplierRejectedError('out of stock')
        );
      }
    }
  }

  const address = so.order.shippingAddress as unknown as Record<string, string | null>;
  let result;
  try {
    result = await adapter.createOrder({
      internalSupplierOrderId: so.id,
      idempotencyKey: so.idempotencyKey,
      orderNumber: so.order.orderNumber,
      currency: so.order.currency,
      items,
      shippingAddress: {
        fullName: address.fullName ?? '',
        phone: address.phone ?? '',
        line1: address.line1 ?? '',
        line2: address.line2 ?? null,
        city: address.city ?? '',
        state: address.state ?? '',
        postalCode: address.postalCode ?? '',
        country: address.country ?? 'IN',
      },
      customer: {
        name: so.order.user?.name ?? so.order.guestName,
        email: so.order.user?.email ?? so.order.guestEmail,
        phone: so.order.user?.phone ?? so.order.guestPhone,
      },
      paymentMethod: so.order.paymentMethod === 'COD' ? 'COD' : 'PREPAID',
      totalPaise: toPaise(so.order.grandTotal),
      note: so.order.customerNote,
    });
  } catch (err) {
    if (err instanceof UnsupportedSupplierOperation) {
      throw new PermanentJobError(err.message, err);
    }
    if (err instanceof SupplierRejectedError) {
      throw new PermanentJobError(err.message, err);
    }
    throw err; // transient -> runner retries with backoff
  }

  if (!result.accepted) {
    throw new PermanentJobError(
      result.message ?? `Supplier rejected the order (${so.supplier.name})`
    );
  }

  const newStatus = result.status === 'ACCEPTED' ? 'ACCEPTED' : 'SENT';
  await prisma.supplierOrder.update({
    where: { id: so.id },
    data: {
      status: newStatus,
      supplierOrderId: result.supplierOrderId ?? so.supplierOrderId,
      sentAt: new Date(),
      acceptedAt: newStatus === 'ACCEPTED' ? new Date() : null,
      attempts: { increment: 1 },
      lastError: null,
      responsePayload: (sanitizeForLog(result.raw ?? { message: result.message }) ??
        {}) as Prisma.InputJsonValue,
    },
  });

  await advanceOrderFulfilment(
    so.order.id,
    newStatus === 'ACCEPTED' ? 'SUPPLIER_ACCEPTED' : 'SENT_TO_SUPPLIER',
    {
      supplierOrderId: result.supplierOrderId ?? undefined,
      supplier: so.supplier.name,
    }
  );

  if (adapter.capabilities.statusPolling) {
    await enqueueJob({
      type: 'SYNC_SUPPLIER_ORDER',
      payload: { supplierOrderId: so.id, attempt: 0 },
      dedupeKey: `sync_${so.id}`,
      runAt: new Date(Date.now() + 15_000),
      maxAttempts: 1000,
    });
  }
}

/** Move the customer-facing order forward (idempotent, transition-checked). */
async function advanceOrderFulfilment(
  orderId: string,
  fulfilmentStatus: Order['fulfilmentStatus'],
  info?: Record<string, unknown>
): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const targetOverall = fulfilmentToOverall(fulfilmentStatus);
  if (!targetOverall || order.status === targetOverall) {
    if (order.fulfilmentStatus !== fulfilmentStatus) {
      await prisma.order.update({ where: { id: orderId }, data: { fulfilmentStatus } });
    }
    return;
  }
  if (!canTransition(order.status, targetOverall)) {
    logger.info('Skipping fulfilment advance (illegal transition)', {
      orderId,
      from: order.status,
      to: targetOverall,
    });
    return;
  }
  await transitionOrder({
    orderId,
    to: targetOverall,
    set: { fulfilmentStatus },
    message: `Fulfilment: ${targetOverall.replace(/_/g, ' ').toLowerCase()}`,
    data: (info ?? {}) as Prisma.InputJsonValue,
  });
  if (fulfilmentStatus === 'SENT_TO_SUPPLIER' && order.fulfilmentStatus === 'PENDING') {
    const vars = await renderOrderEmailVars(orderId);
    await queueNotification({
      template: 'ORDER_PROCESSING',
      email: order.guestEmail ?? vars.email,
      userId: order.userId,
      orderId,
      vars,
      skipIfNoEmail: true,
    });
  }
}

function fulfilmentToOverall(f: Order['fulfilmentStatus']): Order['status'] | null {
  switch (f) {
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
      return null;
  }
}

/** Permanent-failure handler: order FULFILMENT_FAILED + admin alert. */
export async function handleFulfilmentFailure(
  supplierOrderRowId: string,
  errorMessage: string
): Promise<void> {
  const so = await prisma.supplierOrder.findUnique({
    where: { id: supplierOrderRowId },
    include: { supplier: true, order: true },
  });
  if (!so) return;

  await prisma.supplierOrder.update({
    where: { id: so.id },
    data: { status: 'FAILED', lastError: errorMessage.slice(0, 500) },
  });

  const order = so.order;
  if (!['CANCELLED', 'REFUNDED', 'FULFILMENT_FAILED'].includes(order.status)) {
    if (canTransition(order.status, 'FULFILMENT_FAILED')) {
      await transitionOrder({
        orderId: order.id,
        to: 'FULFILMENT_FAILED',
        set: { fulfilmentStatus: 'FAILED' },
        message: `Supplier fulfilment failed: ${errorMessage}`,
      });
    }
  }
  await recordOrderEvent({
    orderId: order.id,
    type: 'FULFILMENT_FAILED',
    message: errorMessage.slice(0, 500),
    data: { supplierOrderId: so.id, supplier: so.supplier.name },
  });

  const settings = await import('../settings').then((m) => m.getSettings());
  await queueNotification({
    template: 'FULFILMENT_FAILED_ADMIN',
    email: settings.supportEmail,
    vars: {
      orderNumber: order.orderNumber,
      supplier: so.supplier.name,
      error: errorMessage.slice(0, 400),
      adminUrl: `${process.env.APP_URL ?? ''}/admin/orders/${order.id}`,
    },
  });
  logger.error('Supplier fulfilment failed', {
    orderId: order.id,
    supplier: so.supplier.slug,
    errorMessage,
  });
}

// ---------------------------------------------------------------------------
// Status synchronisation (polling)
// ---------------------------------------------------------------------------

export interface SyncResult {
  rescheduleAt?: Date;
}

const MAX_SYNC_ATTEMPTS = 400; // ~2+ days of polling at the largest interval

/** Job handler: poll the supplier for order status and apply updates. */
export async function syncSupplierOrder(
  supplierOrderRowId: string,
  attempt: number
): Promise<SyncResult> {
  const so = await prisma.supplierOrder.findUnique({
    where: { id: supplierOrderRowId },
    include: { supplier: true, order: true },
  });
  if (!so) return {};
  if (['DELIVERED', 'CANCELLED', 'REJECTED', 'FAILED'].includes(so.status)) return {};
  if (['CANCELLED', 'REFUNDED', 'FULFILMENT_FAILED'].includes(so.order.status)) return {};

  const adapter = getSupplierAdapter(so.supplier);
  if (!adapter.capabilities.statusPolling) return {};

  let status;
  try {
    status = await adapter.getOrderStatus(so.supplierOrderId ?? so.id);
  } catch (err) {
    logger.warn('Supplier status sync failed (will retry)', {
      supplierOrderId: so.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { rescheduleAt: nextPollTime(attempt) };
  }

  await applySupplierStatusUpdate(so, status);

  const terminal = ['DELIVERED', 'CANCELLED', 'REJECTED'].includes(status.status);
  if (terminal || attempt >= MAX_SYNC_ATTEMPTS) return {};
  return { rescheduleAt: nextPollTime(attempt + 1) };
}

function nextPollTime(attempt: number): Date {
  const delay = attempt < 3 ? 15_000 * (attempt + 1) : attempt < 10 ? 60_000 : 5 * 60_000;
  return new Date(Date.now() + delay);
}

export interface SupplierStatusUpdate {
  status:
    | 'ACCEPTED'
    | 'PROCESSING'
    | 'SHIPPED'
    | 'OUT_FOR_DELIVERY'
    | 'DELIVERED'
    | 'CANCELLED'
    | 'REJECTED'
    | 'UNKNOWN';
  trackingNumber?: string | null;
  carrier?: string | null;
  trackingUrl?: string | null;
  message?: string | null;
  events?: Array<{
    status: string;
    message?: string | null;
    location?: string | null;
    eventAt?: string | null;
  }>;
}

/** Apply a status update from polling OR from a supplier webhook. */
export async function applySupplierStatusUpdate(
  so: SupplierOrder & { order: Order },
  update: SupplierStatusUpdate
): Promise<void> {
  switch (update.status) {
    case 'ACCEPTED':
      await prisma.supplierOrder.update({
        where: { id: so.id },
        data: { status: 'ACCEPTED', acceptedAt: so.acceptedAt ?? new Date() },
      });
      await advanceOrderFulfilment(so.orderId, 'SUPPLIER_ACCEPTED', { message: update.message });
      break;
    case 'PROCESSING':
      await prisma.supplierOrder.update({ where: { id: so.id }, data: { status: 'PROCESSING' } });
      await advanceOrderFulfilment(so.orderId, 'PROCESSING', { message: update.message });
      break;
    case 'SHIPPED':
    case 'OUT_FOR_DELIVERY':
    case 'DELIVERED': {
      await prisma.supplierOrder.update({
        where: { id: so.id },
        data: {
          status: update.status === 'DELIVERED' ? 'DELIVERED' : 'SHIPPED',
          shippedAt: so.shippedAt ?? new Date(),
          deliveredAt: update.status === 'DELIVERED' ? new Date() : so.deliveredAt,
          trackingNumber: update.trackingNumber ?? so.trackingNumber,
          carrier: update.carrier ?? so.carrier,
        },
      });
      await recordShipmentUpdate({
        orderId: so.orderId,
        supplierOrderId: so.id,
        carrier: update.carrier ?? undefined,
        trackingNumber: update.trackingNumber ?? undefined,
        trackingUrl: update.trackingUrl ?? undefined,
        status:
          update.status === 'DELIVERED'
            ? 'DELIVERED'
            : update.status === 'OUT_FOR_DELIVERY'
              ? 'OUT_FOR_DELIVERY'
              : 'IN_TRANSIT',
        message: update.message ?? undefined,
        events: update.events,
      });
      break;
    }
    case 'CANCELLED':
    case 'REJECTED':
      await prisma.supplierOrder.update({
        where: { id: so.id },
        data: {
          status: update.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
          cancelledAt: update.status === 'CANCELLED' ? new Date() : null,
          lastError: update.message ?? `Supplier reported ${update.status}`,
        },
      });
      if (update.status === 'CANCELLED') {
        await advanceOrderFulfilment(so.orderId, 'CANCELLED', { message: update.message });
      } else {
        await handleFulfilmentFailure(
          so.id,
          update.message ?? 'Supplier rejected/cancelled the order'
        );
      }
      break;
    case 'UNKNOWN':
    default:
      logger.info('Supplier status update not understood', {
        supplierOrderId: so.id,
        status: update.status,
      });
  }
}

// ---------------------------------------------------------------------------
// Shipments & tracking
// ---------------------------------------------------------------------------

export interface RecordShipmentParams {
  orderId: string;
  supplierOrderId?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  status: ShipmentStatus;
  message?: string | null;
  location?: string | null;
  eventAt?: Date | null;
  events?: Array<{
    status: string;
    message?: string | null;
    location?: string | null;
    eventAt?: string | null;
  }>;
  actorType?: 'SYSTEM' | 'ADMIN' | 'SUPPLIER';
  actorId?: string | null;
}

export async function recordShipmentUpdate(params: RecordShipmentParams): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: params.orderId } });
  if (!order) return;

  let shipment = params.supplierOrderId
    ? await prisma.shipment.findFirst({ where: { supplierOrderId: params.supplierOrderId } })
    : null;
  if (!shipment && params.trackingNumber) {
    shipment = await prisma.shipment.findFirst({
      where: { orderId: params.orderId, trackingNumber: params.trackingNumber },
    });
  }
  if (!shipment) {
    shipment = await prisma.shipment.findFirst({
      where: { orderId: params.orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (!shipment) {
    shipment = await prisma.shipment.create({
      data: {
        orderId: params.orderId,
        supplierOrderId: params.supplierOrderId ?? null,
        carrier: params.carrier ?? null,
        trackingNumber: params.trackingNumber ?? null,
        trackingUrl: params.trackingUrl ?? null,
        status: params.status,
        shippedAt: params.status !== 'PENDING' ? new Date() : null,
        deliveredAt: params.status === 'DELIVERED' ? new Date() : null,
      },
    });
    await addTrackingEvent(shipment.id, {
      status: params.status,
      message: params.message ?? 'Shipment created',
      location: params.location,
      eventAt: params.eventAt ?? new Date(),
    });
  } else {
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        carrier: params.carrier ?? shipment.carrier,
        trackingNumber: params.trackingNumber ?? shipment.trackingNumber,
        trackingUrl: params.trackingUrl ?? shipment.trackingUrl,
        status: params.status,
        shippedAt: shipment.shippedAt ?? (params.status !== 'PENDING' ? new Date() : null),
        deliveredAt:
          params.status === 'DELIVERED'
            ? (shipment.deliveredAt ?? new Date())
            : shipment.deliveredAt,
      },
    });
    if (params.message || params.status) {
      await addTrackingEvent(shipment.id, {
        status: params.status,
        message: params.message ?? null,
        location: params.location,
        eventAt: params.eventAt ?? new Date(),
      });
    }
  }

  // Replay supplier-provided tracking history (deduplicated).
  for (const ev of params.events ?? []) {
    await addTrackingEvent(shipment.id, {
      status: ev.status,
      message: ev.message ?? null,
      location: ev.location ?? null,
      eventAt: ev.eventAt ? new Date(ev.eventAt) : new Date(),
    });
  }

  // Move the customer-facing order along.
  const target: Order['status'] | null =
    params.status === 'DELIVERED'
      ? 'DELIVERED'
      : params.status === 'OUT_FOR_DELIVERY'
        ? 'OUT_FOR_DELIVERY'
        : params.status === 'IN_TRANSIT'
          ? 'SHIPPED'
          : null;

  if (target && order.status !== target && canTransition(order.status, target)) {
    const fulfilmentStatus =
      target === 'DELIVERED'
        ? 'DELIVERED'
        : target === 'OUT_FOR_DELIVERY'
          ? 'OUT_FOR_DELIVERY'
          : 'SHIPPED';
    await transitionOrder({
      orderId: order.id,
      to: target,
      actorType: params.actorType ?? 'SUPPLIER',
      actorId: params.actorId ?? null,
      set: {
        fulfilmentStatus: fulfilmentStatus as Order['fulfilmentStatus'],
        ...(target === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
      },
      message:
        target === 'DELIVERED'
          ? 'Delivered'
          : `Tracking update: ${params.trackingNumber ? params.trackingNumber + ' ' : ''}${params.status}`,
      data: { trackingNumber: params.trackingNumber ?? undefined } as Prisma.InputJsonValue,
    });
  }

  // Customer notifications (deduplicated per shipment+template).
  if (target === 'SHIPPED') {
    const vars = await renderOrderEmailVars(order.id);
    await queueNotification({
      template: 'ORDER_SHIPPED',
      email: order.guestEmail ?? vars.email,
      userId: order.userId,
      orderId: order.id,
      vars: {
        ...vars,
        trackingNumber: params.trackingNumber ?? '',
        carrier: params.carrier ?? '',
      },
      skipIfNoEmail: true,
      dedupeExtra: shipment.id,
    });
  }
  if (target === 'DELIVERED') {
    const vars = await renderOrderEmailVars(order.id);
    await queueNotification({
      template: 'ORDER_DELIVERED',
      email: order.guestEmail ?? vars.email,
      userId: order.userId,
      orderId: order.id,
      vars,
      skipIfNoEmail: true,
      dedupeExtra: shipment.id,
    });
    await recalcOrderFinancials(order.id);
  }
}

async function addTrackingEvent(
  shipmentId: string,
  event: {
    status: string | ShipmentStatus;
    message?: string | null;
    location?: string | null;
    eventAt: Date;
  }
): Promise<void> {
  const duplicate = await prisma.trackingEvent.findFirst({
    where: {
      shipmentId,
      status: String(event.status),
      message: event.message ?? null,
      eventAt: event.eventAt,
    },
  });
  if (duplicate) return;
  await prisma.trackingEvent.create({
    data: {
      shipmentId,
      status: String(event.status),
      message: event.message?.slice(0, 300) ?? null,
      location: event.location?.slice(0, 160) ?? null,
      eventAt: event.eventAt,
    },
  });
}

// ---------------------------------------------------------------------------
// Admin actions
// ---------------------------------------------------------------------------

/** Admin manually marks a queued supplier order as shipped (manual suppliers). */
export async function markSupplierOrderShipped(params: {
  supplierOrderId: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  adminId: string;
}): Promise<void> {
  const so = await prisma.supplierOrder.findUnique({ where: { id: params.supplierOrderId } });
  if (!so) throw new PermanentJobError('Supplier order not found');
  if (!params.trackingNumber && !params.carrier) {
    throw new PermanentJobError('Provide at least a carrier or tracking number');
  }

  await prisma.supplierOrder.update({
    where: { id: so.id },
    data: {
      status: 'SHIPPED',
      acceptedAt: so.acceptedAt ?? new Date(),
      shippedAt: new Date(),
      carrier: params.carrier ?? null,
      trackingNumber: params.trackingNumber ?? null,
    },
  });
  await recordShipmentUpdate({
    orderId: so.orderId,
    supplierOrderId: so.id,
    carrier: params.carrier,
    trackingNumber: params.trackingNumber,
    trackingUrl: params.trackingUrl,
    status: 'IN_TRANSIT',
    message: 'Marked shipped by admin',
    actorType: 'ADMIN',
    actorId: params.adminId,
  });
}

/** Admin retry after a fulfilment failure. */
export async function retrySupplierFulfilment(
  supplierOrderId: string,
  adminId: string
): Promise<void> {
  const so = await prisma.supplierOrder.findUnique({
    where: { id: supplierOrderId },
    include: { order: true },
  });
  if (!so) throw new PermanentJobError('Supplier order not found');
  if (so.status !== 'FAILED' && so.status !== 'QUEUED') {
    throw new PermanentJobError(`Cannot retry supplier order in status ${so.status}`);
  }
  await prisma.supplierOrder.update({
    where: { id: so.id },
    data: { status: 'QUEUED', lastError: null, attempts: 0 },
  });
  if (
    so.order.status === 'FULFILMENT_FAILED' &&
    canTransition('FULFILMENT_FAILED', 'ORDER_CONFIRMED')
  ) {
    await transitionOrder({
      orderId: so.orderId,
      to: 'ORDER_CONFIRMED',
      actorType: 'ADMIN',
      actorId: adminId,
      set: { fulfilmentStatus: 'PENDING' },
      message: 'Admin retried fulfilment',
    });
  }
  await enqueueJob({
    type: 'FULFIL_SUPPLIER_ORDER',
    payload: { supplierOrderId: so.id },
    dedupeKey: `fulfil_${so.id}`,
  });
  kickJobRunner();
}

/** Job handler: ask the supplier to cancel (best effort, honest failures). */
export async function cancelSupplierOrder(supplierOrderId: string, reason: string): Promise<void> {
  const so = await prisma.supplierOrder.findUnique({
    where: { id: supplierOrderId },
    include: { supplier: true },
  });
  if (!so || so.status === 'CANCELLED') return;
  const adapter = getSupplierAdapter(so.supplier);
  if (!adapter.capabilities.cancellation) {
    await prisma.supplierOrder.update({
      where: { id: so.id },
      data: {
        lastError: `Cancellation not available via API (${so.supplier.name}). Cancel manually with the supplier.`,
      },
    });
    return;
  }
  const result = await adapter.cancelOrder(so.supplierOrderId ?? so.id, reason);
  if (result.success) {
    await prisma.supplierOrder.update({
      where: { id: so.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  } else {
    await prisma.supplierOrder.update({
      where: { id: so.id },
      data: { lastError: result.message ?? 'Supplier cancellation failed' },
    });
    throw new Error(result.message ?? 'Supplier cancellation failed');
  }
}

/** Money summary used in admin alerts. */
export function orderMoneySummary(order: Order): string {
  return `${order.orderNumber} (${formatINR(toPaise(order.grandTotal))})`;
}
