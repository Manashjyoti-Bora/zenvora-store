import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST } from '@/app/api/suppliers/cj/webhook/route';

/**
 * CJ webhook ingress is TRIGGER-ONLY: an unsigned CJ payload must never change
 * order state directly - it may only enqueue an authenticated re-sync job.
 */

const suffix = Date.now().toString(36);
const supplierSlug = `cj-wh-${suffix}`;
let supplierId = '';
let orderId = '';
let supplierOrderRowId = '';

beforeAll(async () => {
  const supplier = await prisma.supplier.create({
    data: {
      name: 'CJ Webhook Test',
      slug: supplierSlug,
      type: 'CJ',
      apiKeyEnvVar: 'CJ_TEST_API_KEY',
      config: { fxRateInrPerUsd: 88 },
    },
  });
  supplierId = supplier.id;
  const order = await prisma.order.create({
    data: {
      orderNumber: `RX-CJWH-${suffix}`,
      subtotal: '100.00',
      grandTotal: '100.00',
      shippingAddress: { city: 'Guwahati' },
      paymentMethod: 'PREPAID_GATEWAY',
      status: 'PROCESSING',
      paymentStatus: 'PAID',
    },
  });
  orderId = order.id;
  const so = await prisma.supplierOrder.create({
    data: {
      orderId: order.id,
      supplierId: supplier.id,
      idempotencyKey: `so_cjwh_${suffix}`,
      supplierOrderId: 'CJORD999',
      status: 'ACCEPTED',
    },
  });
  supplierOrderRowId = so.id;
});

afterAll(async () => {
  await prisma.job.deleteMany({ where: { dedupeKey: { startsWith: `cj-webhook-sync:${supplierOrderRowId}:` } } });
  await prisma.supplierOrder.deleteMany({ where: { supplierId } });
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.supplier.deleteMany({ where: { id: supplierId } });
});

function req(body: unknown): Request {
  return new Request('http://127.0.0.1:3000/api/suppliers/cj/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/suppliers/cj/webhook', () => {
  it('rejects invalid JSON', async () => {
    const res = await POST(
      new Request('http://127.0.0.1:3000/api/suppliers/cj/webhook', {
        method: 'POST',
        body: 'not-json',
      })
    );
    expect(res.status).toBe(400);
  });

  it('ignores unknown orders without side effects', async () => {
    const res = await POST(req({ type: 'ORDER', params: { orderNum: 'CJORD-NOPE' } }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ignored).toBe(true);
  });

  it('queues an authenticated re-sync for known CJ orders and does NOT trust the payload status', async () => {
    const before = await prisma.supplierOrder.findUniqueOrThrow({
      where: { id: supplierOrderRowId },
    });
    const res = await POST(
      req({
        type: 'ORDER',
        params: { orderNum: 'CJORD999', orderStatus: 'DELIVERED', trackNumber: 'FAKE123' },
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.queued).toBe(true);

    const job = await prisma.job.findFirst({
      where: { dedupeKey: { startsWith: `cj-webhook-sync:${supplierOrderRowId}:` } },
      orderBy: { createdAt: 'desc' },
    });
    expect(job).toBeTruthy();
    expect(job!.type).toBe('SYNC_SUPPLIER_ORDER');
    expect((job!.payload as Record<string, unknown>).supplierOrderId).toBe(supplierOrderRowId);

    // Payload claimed DELIVERED + a fake tracking number: state must be untouched.
    const after = await prisma.supplierOrder.findUniqueOrThrow({ where: { id: supplierOrderRowId } });
    expect(after.status).toBe(before.status);
    expect(after.trackingNumber).toBe(before.trackingNumber);
  });

  it('deduplicates webhook storms within the same minute', async () => {
    const res = await POST(req({ type: 'LOGISTICS', params: { orderNum: 'CJORD999' } }));
    expect(res.status).toBe(200);
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const jobs = await prisma.job.findMany({
      where: { dedupeKey: `cj-webhook-sync:${supplierOrderRowId}:${minuteBucket}` },
    });
    expect(jobs.length).toBeLessThanOrEqual(2); // earlier test may share the bucket; never unbounded
  });
});
