import crypto from 'node:crypto';
import { prisma } from '../db';
import { isDemoSupplierAllowed } from '../env';
import { randomCode } from '../crypto';
import {
  UnsupportedSupplierOperation,
  type SupplierAdapter,
  type SupplierCapabilities,
  type SupplierCategoryDto,
  type SupplierCreateOrderInput,
  type SupplierCreateOrderResult,
  type SupplierDiscoveryOptions,
  type SupplierOrderStatusResult,
  type SupplierActionResult,
  type SupplierProductDto,
  type SupplierStockResult,
  type Supplier,
} from './types';

/**
 * DEMO supplier adapter - DEVELOPMENT/TESTING ONLY (env-gated, refused in
 * production exactly like the TEST payment provider).
 *
 * It simulates a supplier with an automated pipeline: acceptance after a few
 * seconds, then PROCESSING -> SHIPPED (with a tracking number) -> DELIVERED,
 * driven by elapsed time so the polling job advances real statuses through the
 * real code paths. Everything it produces is labelled DEMO (ids start with
 * `SUP-DEMO-`, tracking with `DEMO-`) so demo fulfilment can never be
 * mistaken for real fulfilment.
 */

const PROGRESS_ACCEPTED_SEC = 5;
const PROGRESS_PROCESSING_SEC = 15;
const PROGRESS_SHIPPED_SEC = 30;
const PROGRESS_DELIVERED_SEC = 60;

export class DemoAdapter implements SupplierAdapter {
  readonly type = 'DEMO';
  readonly label = 'DEMO supplier (development only)';

  readonly capabilities: SupplierCapabilities = {
    catalogSync: true,
    stockCheck: true,
    orderCreation: true,
    statusPolling: true,
    tracking: true,
    cancellation: true,
    returns: true,
    refunds: true,
    webhooks: false,
  };

  constructor(private supplier: Supplier) {
    if (!isDemoSupplierAllowed()) {
      throw new UnsupportedSupplierOperation(
        'DEMO supplier adapter is disabled (SUPPLIER_DEMO_MODE is off or this is production)'
      );
    }
  }

  async getCategories(): Promise<SupplierCategoryDto[]> {
    return [
      { id: 'DEMO-CAT-ELEC', name: 'Electronics', parentId: null, level: 1 },
      { id: 'DEMO-CAT-HOME', name: 'Home & Kitchen', parentId: null, level: 1 },
      { id: 'DEMO-CAT-BAGS', name: 'Bags & Accessories', parentId: null, level: 1 },
      { id: 'DEMO-CAT-FIT', name: 'Fitness & Wellness', parentId: null, level: 1 },
    ];
  }

  async discoverCatalog(opts?: SupplierDiscoveryOptions): Promise<SupplierProductDto[]> {
    const limit = Math.max(1, Math.min(opts?.limit ?? 50, 200));
    const items = DEMO_DISCOVERY_CATALOG.filter((item) => {
      if (opts?.categoryId && item.categoryId !== opts.categoryId) return false;
      if (opts?.keyword) {
        const q = opts.keyword.toLowerCase();
        const hay = `${item.name ?? ''} ${item.sku} ${item.categoryName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).slice(0, limit);

    if (opts?.onPageProgress) {
      await opts.onPageProgress({
        source: 'demoCatalog',
        pageNum: 1,
        fetchedCount: items.length,
        cursor: 'demoCatalog:2',
      });
    }
    return items;
  }

  async getProducts(opts?: { limit?: number; cursor?: string }): Promise<SupplierProductDto[]> {
    return this.discoverCatalog({ limit: opts?.limit, cursor: opts?.cursor });
  }

  async checkStock(_supplierSku: string, _quantity: number): Promise<SupplierStockResult> {
    return { inStock: true, qty: 100, raw: { demo: true } };
  }

  async createOrder(input: SupplierCreateOrderInput): Promise<SupplierCreateOrderResult> {
    const supplierOrderId = `SUP-DEMO-${randomCode(8)}`;
    return {
      accepted: true,
      supplierOrderId,
      status: 'ACCEPTED',
      message: '[DEMO] Order accepted by simulated supplier',
      raw: { demo: true, idempotencyKey: input.idempotencyKey, items: input.items.length },
    };
  }

  async getOrderStatus(supplierOrderId: string): Promise<SupplierOrderStatusResult> {
    const record = await prisma.supplierOrder.findFirst({
      where: { OR: [{ supplierOrderId }, { id: supplierOrderId }] },
    });
    if (!record) return { status: 'UNKNOWN', message: '[DEMO] Unknown order' };
    if (record.status === 'CANCELLED') {
      return { status: 'CANCELLED', message: '[DEMO] Cancelled' };
    }

    const since = (record.sentAt ?? record.createdAt).getTime();
    const elapsedSec = (Date.now() - since) / 1000;
    const trackingNumber = `DEMO-${demoDigits(record.id, 11)}`;

    if (elapsedSec >= PROGRESS_DELIVERED_SEC) {
      return {
        status: 'DELIVERED',
        trackingNumber,
        carrier: 'Demo Express',
        trackingUrl: null,
        message: '[DEMO] Delivered',
        events: demoTrackingEvents(since, trackingNumber, 'DELIVERED'),
      };
    }
    if (elapsedSec >= PROGRESS_SHIPPED_SEC) {
      return {
        status: 'SHIPPED',
        trackingNumber,
        carrier: 'Demo Express',
        message: '[DEMO] Shipped',
        events: demoTrackingEvents(since, trackingNumber, 'SHIPPED'),
      };
    }
    if (elapsedSec >= PROGRESS_PROCESSING_SEC) {
      return { status: 'PROCESSING', message: '[DEMO] Being packed' };
    }
    if (elapsedSec >= PROGRESS_ACCEPTED_SEC) {
      return { status: 'ACCEPTED', message: '[DEMO] Accepted' };
    }
    return { status: 'ACCEPTED', message: '[DEMO] Received' };
  }

  async getShipmentTracking(supplierOrderId: string): Promise<SupplierOrderStatusResult> {
    return this.getOrderStatus(supplierOrderId);
  }

  async cancelOrder(_supplierOrderId: string, _reason?: string): Promise<SupplierActionResult> {
    return { success: true, message: '[DEMO] Cancellation accepted', raw: { demo: true } };
  }

  async requestReturn(_supplierOrderId: string, _reason: string): Promise<SupplierActionResult> {
    return {
      success: true,
      referenceId: `RET-DEMO-${randomCode(6)}`,
      message: '[DEMO] Return accepted',
      raw: { demo: true },
    };
  }

  async requestRefund(
    _supplierOrderId: string,
    _amountPaise: number,
    _reason: string
  ): Promise<SupplierActionResult> {
    return {
      success: true,
      referenceId: `REF-DEMO-${randomCode(6)}`,
      message: '[DEMO] Refund accepted',
      raw: { demo: true },
    };
  }
}

function demoDigits(seed: string, length: number): string {
  const hash = crypto.createHash('sha256').update(seed).digest();
  let out = '';
  for (let i = 0; i < length; i++) {
    out += String(hash[i % hash.length] % 10);
  }
  return out;
}

function demoTrackingEvents(
  sinceMs: number,
  trackingNumber: string,
  upto: 'SHIPPED' | 'DELIVERED'
) {
  const events = [
    {
      status: 'IN_TRANSIT',
      message: '[DEMO] Picked up from supplier warehouse',
      location: 'Demo Hub, Guwahati',
      eventAt: new Date(sinceMs + PROGRESS_SHIPPED_SEC * 1000).toISOString(),
    },
  ];
  if (upto === 'DELIVERED') {
    events.push({
      status: 'DELIVERED',
      message: `[DEMO] Delivered (tracking ${trackingNumber})`,
      location: 'Customer address',
      eventAt: new Date(sinceMs + PROGRESS_DELIVERED_SEC * 1000).toISOString(),
    });
  }
  return events;
}

const DEMO_DISCOVERY_CATALOG: SupplierProductDto[] = [
  {
    externalId: 'DEMO-PID-001',
    sku: 'SUP-DEMO-001',
    variantId: 'DEMO-VID-001',
    name: 'Wireless Bluetooth Earbuds',
    description:
      'Compact true-wireless in-ear headphones with USB-C charging case, Bluetooth 5.3 connectivity, and passive noise isolation for daily Indian commuters.',
    categoryId: 'DEMO-CAT-ELEC',
    categoryName: 'Electronics',
    images: ['/uploads/seed/demo-wireless-bluetooth-earbuds.svg'],
    costPaise: 85000,
    shippingPaise: 4000,
    inStock: true,
    qty: 40,
    weightGrams: 120,
    shippingSupportedToIndia: true,
    specifications: { Connectivity: 'Bluetooth 5.3', Charging: 'USB-C', Weight: '120 g' },
    fieldSources: {
      cost: 'demo:catalog.costPaise',
      shipping: 'demo:catalog.shippingPaise',
      stock: 'demo:catalog.qty',
      images: 'demo:catalog.images',
      description: 'demo:catalog.description',
    },
    raw: { demo: true, name: 'Wireless Bluetooth Earbuds', pid: 'DEMO-PID-001', vid: 'DEMO-VID-001' },
  },
  {
    externalId: 'DEMO-PID-002',
    sku: 'SUP-DEMO-002',
    variantId: 'DEMO-VID-002',
    name: 'USB-C Fast Charger 65 W',
    description:
      'Dual-port GaN wall charger (USB-C PD + USB-A) with BIS-compatible Indian plug, suitable for phones, tablets, and ultrabooks.',
    categoryId: 'DEMO-CAT-ELEC',
    categoryName: 'Electronics',
    images: ['/uploads/seed/demo-usb-c-fast-charger-65w.svg'],
    costPaise: 62000,
    shippingPaise: 3500,
    inStock: true,
    qty: 60,
    weightGrams: 145,
    shippingSupportedToIndia: true,
    specifications: { Output: '65 W USB-C PD', Ports: '1x USB-C + 1x USB-A', Plug: 'Indian 2-pin' },
    fieldSources: {
      cost: 'demo:catalog.costPaise',
      shipping: 'demo:catalog.shippingPaise',
      stock: 'demo:catalog.qty',
      images: 'demo:catalog.images',
      description: 'demo:catalog.description',
    },
    raw: { demo: true, name: 'USB-C Fast Charger 65 W', pid: 'DEMO-PID-002', vid: 'DEMO-VID-002' },
  },
  {
    externalId: 'DEMO-PID-009',
    sku: 'SUP-DEMO-009',
    variantId: 'DEMO-VID-009-BLK',
    name: 'Portable Neck Fan Rechargeable 4000mAh',
    description:
      'Bladeless wearable personal cooling fan with 3 speed modes, quiet brushless motor, and USB-C rechargeable 4000mAh battery for Indian summer travel and kitchen use.',
    categoryId: 'DEMO-CAT-ELEC',
    categoryName: 'Electronics',
    images: [
      '/uploads/seed/demo-wireless-bluetooth-earbuds.svg',
      '/uploads/seed/demo-usb-c-fast-charger-65w.svg',
    ],
    costPaise: 42000,
    shippingPaise: 3500,
    inStock: true,
    qty: 85,
    weightGrams: 260,
    shippingSupportedToIndia: true,
    variants: [
      {
        vid: 'DEMO-VID-009-BLK',
        sku: 'SUP-DEMO-009-BLK',
        name: 'Matte Black',
        color: 'Matte Black',
        costPaise: 42000,
        shippingPaise: 3500,
        stockQty: 50,
        inStock: true,
      },
      {
        vid: 'DEMO-VID-009-WHT',
        sku: 'SUP-DEMO-009-WHT',
        name: 'Arctic White',
        color: 'Arctic White',
        costPaise: 44000,
        shippingPaise: 3500,
        stockQty: 35,
        inStock: true,
      },
    ],
    specifications: { Battery: '4000 mAh', Charging: 'USB-C', Material: 'ABS + Silicone', Weight: '260 g' },
    fieldSources: {
      cost: 'demo:catalog.costPaise',
      shipping: 'demo:catalog.shippingPaise',
      stock: 'demo:catalog.qty',
      images: 'demo:catalog.images',
      description: 'demo:catalog.description',
      variants: 'demo:catalog.variants',
    },
    raw: {
      demo: true,
      name: 'Portable Neck Fan Rechargeable 4000mAh',
      pid: 'DEMO-PID-009',
      vid: 'DEMO-VID-009-BLK',
    },
  },
  {
    externalId: 'DEMO-PID-010',
    sku: 'SUP-DEMO-010',
    variantId: 'DEMO-VID-010',
    name: 'Foldable Aluminium Laptop Stand Riser',
    description:
      '6-level ergonomic adjustable aluminium alloy desk stand compatible with 10 to 15.6 inch laptops, non-slip silicone pads, and carry pouch.',
    categoryId: 'DEMO-CAT-ELEC',
    categoryName: 'Electronics',
    images: ['/uploads/seed/demo-laptop-sleeve-15-6-inch.svg'],
    costPaise: 31000,
    shippingPaise: 3000,
    inStock: true,
    qty: 110,
    weightGrams: 240,
    shippingSupportedToIndia: true,
    specifications: { Material: 'Anodized Aluminium', Compatibility: '10–15.6 inch', Weight: '240 g' },
    fieldSources: {
      cost: 'demo:catalog.costPaise',
      shipping: 'demo:catalog.shippingPaise',
      stock: 'demo:catalog.qty',
      images: 'demo:catalog.images',
      description: 'demo:catalog.description',
    },
    raw: {
      demo: true,
      name: 'Foldable Aluminium Laptop Stand Riser',
      pid: 'DEMO-PID-010',
      vid: 'DEMO-VID-010',
    },
  },
  {
    externalId: 'DEMO-PID-011',
    sku: 'SUP-DEMO-011',
    variantId: 'DEMO-VID-011',
    name: 'Multifunction Vegetable Chopper & Mandoline Slicer',
    description:
      'BPA-free ABS kitchen vegetable dicer and grater with 6 interchangeable stainless steel blades, hand guard, and 1.2L catch container.',
    categoryId: 'DEMO-CAT-HOME',
    categoryName: 'Home & Kitchen',
    images: ['/uploads/seed/demo-stainless-steel-water-bottle-1l.svg'],
    costPaise: 28000,
    shippingPaise: 4000,
    inStock: true,
    qty: 45,
    weightGrams: 480,
    shippingSupportedToIndia: true,
    specifications: { Blades: '420 Stainless Steel (6 pcs)', Capacity: '1.2 Litre', Weight: '480 g' },
    fieldSources: {
      cost: 'demo:catalog.costPaise',
      shipping: 'demo:catalog.shippingPaise',
      stock: 'demo:catalog.qty',
      images: 'demo:catalog.images',
      description: 'demo:catalog.description',
    },
    raw: {
      demo: true,
      name: 'Multifunction Vegetable Chopper & Mandoline Slicer',
      pid: 'DEMO-PID-011',
      vid: 'DEMO-VID-011',
    },
  },
  {
    externalId: 'DEMO-PID-012',
    sku: 'SUP-DEMO-012',
    variantId: 'DEMO-VID-012',
    name: 'Minimalist Desk Organizer Tray (Missing Shipping Estimate)',
    description:
      'PU leather valet tray for keys, coins, watches, and daily desk essentials. Held for review because supplier freight to India has not been verified yet.',
    categoryId: 'DEMO-CAT-HOME',
    categoryName: 'Home & Kitchen',
    images: ['/uploads/seed/demo-analog-wall-clock-12-inch.svg'],
    costPaise: 24000,
    shippingPaise: null,
    inStock: true,
    qty: 30,
    weightGrams: 190,
    shippingSupportedToIndia: null,
    fieldSources: {
      cost: 'demo:catalog.costPaise',
      stock: 'demo:catalog.qty',
      images: 'demo:catalog.images',
      description: 'demo:catalog.description',
    },
    raw: {
      demo: true,
      name: 'Minimalist Desk Organizer Tray (Missing Shipping Estimate)',
      pid: 'DEMO-PID-012',
      vid: 'DEMO-VID-012',
    },
  },
  {
    externalId: 'DEMO-PID-013',
    sku: 'SUP-DEMO-013',
    variantId: 'DEMO-VID-013',
    name: 'Travel Cable Organizer Pouch (Missing Product Image)',
    description:
      'Double-layer water-resistant nylon electronics organizer bag for chargers, cables, SD cards, and power banks.',
    categoryId: 'DEMO-CAT-BAGS',
    categoryName: 'Bags & Accessories',
    images: [],
    costPaise: 19500,
    shippingPaise: 2500,
    inStock: true,
    qty: 55,
    weightGrams: 160,
    shippingSupportedToIndia: true,
    fieldSources: {
      cost: 'demo:catalog.costPaise',
      shipping: 'demo:catalog.shippingPaise',
      stock: 'demo:catalog.qty',
      description: 'demo:catalog.description',
    },
    raw: {
      demo: true,
      name: 'Travel Cable Organizer Pouch (Missing Product Image)',
      pid: 'DEMO-PID-013',
      vid: 'DEMO-VID-013',
    },
  },
  {
    externalId: 'DEMO-PID-014',
    sku: 'SUP-DEMO-014',
    variantId: 'DEMO-VID-014',
    name: 'Tactical Hunting Survival Knife Blade (Policy Restricted)',
    description:
      'Fixed-blade tactical survival knife — must be automatically rejected by Indian compliance & platform policy checks.',
    categoryId: 'DEMO-CAT-BAGS',
    categoryName: 'Bags & Accessories',
    images: ['/uploads/seed/demo-bifold-wallet-vegan-leather.svg'],
    costPaise: 50000,
    shippingPaise: 5000,
    inStock: true,
    qty: 20,
    weightGrams: 320,
    shippingSupportedToIndia: true,
    raw: {
      demo: true,
      name: 'Tactical Hunting Survival Knife Blade (Policy Restricted)',
      pid: 'DEMO-PID-014',
      vid: 'DEMO-VID-014',
    },
  },
];

