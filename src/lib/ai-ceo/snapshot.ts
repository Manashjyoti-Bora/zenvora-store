import { prisma } from '@/lib/db';
import { getSettings, isPlaceholderEmail } from '@/lib/settings';
import { describePaymentProvider } from '@/lib/payments';
import { aiProviderConfig, env } from '@/lib/env';
import { toPaise, type MoneyInput } from '@/lib/money';
import { getAllSupplierSyncReports } from '@/lib/catalog/auto-import';
import type { AiCeoSnapshot, OrderLedgerRow, SupplierProductRow, SupplierSyncSummary } from './contracts';

/**
 * The single database adapter for the AI CEO.
 *
 * Every query is bounded (`take`) and selects only aggregates or the money
 * ledger — never customer names, e-mails, phones or addresses. `truncated`
 * records whether a cap was hit so the report can say "this is a floor" instead
 * of presenting a partial total as complete.
 */

export const ORDER_ROW_CAP = 2000;
export const SUPPLIER_ROW_CAP = 500;
export const DEFAULT_WINDOW_DAYS = 30;

/** Shapes of the bounded SELECTs below, declared explicitly so the adapter is
 *  readable without opening the Prisma schema. */
interface OrderRowSelect {
  id: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  placedAt: Date | null;
  paidAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  grandTotal: MoneyInput;
  subtotal: MoneyInput;
  discountTotal: MoneyInput;
  shippingTotal: MoneyInput;
  taxTotal: MoneyInput;
  supplierCostTotal: MoneyInput;
  shippingCostTotal: MoneyInput;
  paymentFeeTotal: MoneyInput;
  otherCostTotal: MoneyInput;
  refundedTotal: MoneyInput;
  estimatedProfit: MoneyInput;
  actualProfit: MoneyInput;
  profitFinalizedAt: Date | null;
}

interface SupplierRowSelect {
  id: string;
  supplierId: string;
  supplierCost: MoneyInput;
  supplierShippingCost: MoneyInput | null;
  inStock: boolean | null;
  stockQty: number | null;
  lastSyncedAt: Date | null;
  supplier: { name: string; isActive: boolean };
  product: { status: string } | null;
}

export interface LoadSnapshotOptions {
  windowDays?: number;
  now?: Date;
}

export async function loadAiCeoSnapshot(options: LoadSnapshotOptions = {}): Promise<AiCeoSnapshot> {
  const now = options.now ?? new Date();
  const windowDays = Math.min(Math.max(options.windowDays ?? DEFAULT_WINDOW_DAYS, 1), 365);
  const windowStart = new Date(now.getTime() - windowDays * 86_400_000);
  const dayAgo = new Date(now.getTime() - 86_400_000);

  const settingsPromise = getSettings();

  const [
    settings,
    orderRows,
    orderStatusGroups,
    pendingPaymentOlderThan24h,
    refundGroups,
    openReturns,
    openMessages,
    jobGroups,
    jobsFailed24h,
    oldestPending,
    webhookGroups,
    errorsLast24h,
    fatalLast24h,
    supplierRowsRaw,
    supplierCount,
    inactiveSuppliers,
    productGroups,
    activeWithoutSupplierLink,
    activeWithoutImage,
    lastAudit,
    syncReports,
  ] = await Promise.all([
    settingsPromise,
    prisma.order.findMany({
      where: { createdAt: { gte: windowStart } },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        placedAt: true,
        paidAt: true,
        deliveredAt: true,
        cancelledAt: true,
        grandTotal: true,
        subtotal: true,
        discountTotal: true,
        shippingTotal: true,
        taxTotal: true,
        supplierCostTotal: true,
        shippingCostTotal: true,
        paymentFeeTotal: true,
        otherCostTotal: true,
        refundedTotal: true,
        estimatedProfit: true,
        actualProfit: true,
        profitFinalizedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: ORDER_ROW_CAP,
    }),
    prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.order.count({
      where: { status: 'PENDING_PAYMENT', createdAt: { lt: dayAgo } },
    }),
    prisma.refund.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.returnRequest.count({ where: { status: { in: ['REQUESTED', 'APPROVED'] } } }),
    prisma.contactMessage.count({ where: { status: 'NEW' } }),
    prisma.job.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.job.count({ where: { status: 'FAILED', updatedAt: { gte: dayAgo } } }),
    prisma.job.findFirst({
      where: { status: 'PENDING' },
      orderBy: { nextRunAt: 'asc' },
      select: { type: true, nextRunAt: true },
    }),
    prisma.webhookEvent.groupBy({
      by: ['status'],
      where: { receivedAt: { gte: dayAgo } },
      _count: { _all: true },
    }),
    prisma.errorLog.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.errorLog.count({ where: { createdAt: { gte: dayAgo }, level: 'FATAL' } }),
    prisma.supplierProduct.findMany({
      select: {
        id: true,
        supplierId: true,
        supplierCost: true,
        supplierShippingCost: true,
        inStock: true,
        stockQty: true,
        lastSyncedAt: true,
        supplier: { select: { name: true, isActive: true } },
        product: { select: { status: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: SUPPLIER_ROW_CAP,
    }),
    prisma.supplier.count(),
    prisma.supplier.count({ where: { isActive: false } }),
    prisma.product.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.product.count({ where: { status: 'ACTIVE', supplierProduct: { is: null } } }),
    prisma.product.count({ where: { status: 'ACTIVE', images: { none: {} } } }),
    prisma.auditLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { action: true, createdAt: true } }),
    getAllSupplierSyncReports(),
  ]);

  const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
  const counts = <T extends string>(groups: Array<{ _count: { _all: number } } & Record<string, unknown>>, key: T) => {
    const out: Record<string, number> = {};
    for (const group of groups) {
      const label = group[key];
      if (typeof label === 'string') out[label] = group._count._all;
    }
    return out;
  };

  const orderRowsTyped = orderRows as unknown as OrderRowSelect[];
  const window: OrderLedgerRow[] = orderRowsTyped.map((row: OrderRowSelect) => ({
    id: row.id,
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod === 'COD' ? 'COD' : 'PREPAID_GATEWAY',
    placedAt: iso(row.placedAt),
    paidAt: iso(row.paidAt),
    deliveredAt: iso(row.deliveredAt),
    cancelledAt: iso(row.cancelledAt),
    grandTotalPaise: toPaise(row.grandTotal),
    subtotalPaise: toPaise(row.subtotal),
    discountTotalPaise: toPaise(row.discountTotal),
    shippingTotalPaise: toPaise(row.shippingTotal),
    taxTotalPaise: toPaise(row.taxTotal),
    supplierCostTotalPaise: toPaise(row.supplierCostTotal),
    shippingCostTotalPaise: toPaise(row.shippingCostTotal),
    paymentFeeTotalPaise: toPaise(row.paymentFeeTotal),
    otherCostTotalPaise: toPaise(row.otherCostTotal),
    refundedTotalPaise: toPaise(row.refundedTotal),
    estimatedProfitPaise: toPaise(row.estimatedProfit),
    actualProfitPaise: toPaise(row.actualProfit),
    profitFinalizedAt: iso(row.profitFinalizedAt),
  }));

  const supplierRowsTyped = supplierRowsRaw as unknown as SupplierRowSelect[];
  const supplierRows: SupplierProductRow[] = supplierRowsTyped.map((row: SupplierRowSelect) => ({
    id: row.id,
    supplierId: row.supplierId,
    supplierName: row.supplier.name,
    supplierActive: row.supplier.isActive,
    supplierCostPaise: toPaise(row.supplierCost),
    supplierShippingPaise: row.supplierShippingCost === null ? null : toPaise(row.supplierShippingCost),
    inStock: row.inStock,
    stockQty: row.stockQty,
    lastSyncedAt: iso(row.lastSyncedAt),
    linkedProductStatus: row.product?.status ?? null,
  }));

  const syncBySupplier: Record<string, SupplierSyncSummary> = {};
  for (const report of syncReports) {
    syncBySupplier[report.supplierId] = {
      at: report.completedAt ?? null,
      status: report.status,
      failed: report.totals.failed,
      total: report.totals.discovered,
    };
  }

  const payments = describePaymentProvider();
  const business = settings.business;
  const identityParts = [business.legalName, business.gstin, business.addressLine, business.city, business.state];
  const identityFilled = identityParts.filter((part) => part && part.trim() !== '').length;
  const businessIdentity: AiCeoSnapshot['store']['businessIdentity'] =
    identityFilled === 0 ? 'MISSING' : identityFilled === identityParts.length ? 'COMPLETE' : 'PARTIAL';

  return {
    asOf: now.toISOString(),
    windowDays,
    truncated: orderRowsTyped.length >= ORDER_ROW_CAP || supplierRowsTyped.length >= SUPPLIER_ROW_CAP,
    store: {
      name: settings.storeName,
      demoMode: settings.demoMode,
      supportEmailConfigured: !isPlaceholderEmail(settings.supportEmail),
      supportPhoneConfigured: Boolean(settings.supportPhone && settings.supportPhone.trim() !== ''),
      businessIdentity,
    },
    payments: {
      kind: payments.kind,
      isTest: payments.isTest,
      environment: env.NODE_ENV,
    },
    automation: {
      autoPublishEligible: settings.autoImport.autoPublishEligible,
      supplierLiveOrderingEnabled: settings.autoImport.supplierLiveOrderingEnabled,
      cronSecretConfigured: Boolean(env.CRON_SECRET),
      aiProviderConfigured: aiProviderConfig() !== null,
      aiCeoEnabled: settings.aiCeo.enabled,
      aiCeoActionsEnabled: settings.aiCeo.actionsEnabled,
    },
    orders: {
      window,
      countsByStatus: counts(orderStatusGroups, 'status'),
      pendingPaymentOlderThan24h,
      windowCount: window.length,
    },
    refunds: {
      requested: groupCount(refundGroups, 'REQUESTED'),
      processing: groupCount(refundGroups, 'PROCESSING'),
      completed: groupCount(refundGroups, 'COMPLETED'),
      failed: groupCount(refundGroups, 'FAILED'),
    },
    returns: { open: openReturns },
    supportMessages: { open: openMessages },
    jobs: {
      counts: counts(jobGroups, 'status'),
      failedLast24h: jobsFailed24h,
      oldestPendingAt: iso(oldestPending?.nextRunAt ?? null),
      oldestPendingType: oldestPending?.type ?? null,
    },
    webhooks: { last24hByStatus: counts(webhookGroups, 'status') },
    errors: { last24h: errorsLast24h, fatalLast24h },
    suppliers: {
      total: supplierCount,
      inactive: inactiveSuppliers,
      rows: supplierRows,
      syncBySupplier,
    },
    catalog: {
      productCounts: counts(productGroups, 'status'),
      activeWithoutSupplierLink,
      activeWithoutImage,
    },
    audit: { lastAction: lastAudit?.action ?? null, lastAt: iso(lastAudit?.createdAt ?? null) },
  };
}

function groupCount(groups: Array<{ status: string; _count: { _all: number } }>, status: string): number {
  return groups.find((g) => g.status === status)?._count._all ?? 0;
}

export type SnapshotResult =
  | { ok: true; snapshot: AiCeoSnapshot }
  | { ok: false; error: string };

/**
 * Safe wrapper for pages/route handlers: a database outage produces an explicit
 * unavailable state instead of an empty-looking dashboard that could be
 * mistaken for "no problems".
 */
export async function loadAiCeoSnapshotSafe(options: LoadSnapshotOptions = {}): Promise<SnapshotResult> {
  try {
    return { ok: true, snapshot: await loadAiCeoSnapshot(options) };
  } catch {
    return {
      ok: false,
      error:
        'The store database could not be read, so no verified figures can be shown. Nothing on this page is estimated or cached.',
    };
  }
}
