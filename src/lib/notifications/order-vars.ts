import { prisma } from '../db';
import { env } from '../env';
import { toPaise, formatINR } from '../money';
import { getSettings } from '../settings';
import { formatDate } from '../utils';
import type { TemplateVars } from './templates';

/**
 * Builds the email variables for order-related notifications from REAL order
 * data (items, totals, address). Used by every order email so templates stay
 * presentation-only.
 */

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function renderOrderEmailVars(orderId: string): Promise<TemplateVars> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, user: true },
  });
  if (!order) throw new Error(`Order not found: ${orderId}`);
  const settings = await getSettings();

  const linesHtml = order.items
    .map((item) => {
      const snap = item.productSnapshot as Record<string, string | null>;
      const variant = snap?.variantName ? ` (${escapeHtml(snap.variantName)})` : '';
      return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;">
        <span>${escapeHtml(snap?.name ?? 'Item')}${variant} &times; ${item.quantity}</span>
        <span>${escapeHtml(formatINR(toPaise(item.lineTotal) - toPaise(item.lineDiscount)))}</span>
      </div>`;
    })
    .join('');

  const itemsSummary = order.items
    .map((item) => {
      const snap = item.productSnapshot as Record<string, string | null>;
      return `- ${snap?.name ?? 'Item'} x ${item.quantity} = ${formatINR(toPaise(item.lineTotal) - toPaise(item.lineDiscount))}`;
    })
    .join('\n');

  const addr = order.shippingAddress as unknown as Record<string, string | null>;
  const addressHtml = [addr.line1, addr.line2, addr.city, addr.state, addr.postalCode, addr.country]
    .filter(Boolean)
    .map((l) => escapeHtml(l!))
    .join('<br/>');
  const addressText = [addr.line1, addr.line2, addr.city, addr.state, addr.postalCode, addr.country]
    .filter(Boolean)
    .join(', ');

  const estMin = settings.shipping.estimatedDaysMin;
  const estMax = settings.shipping.estimatedDaysMax;
  const base = order.placedAt ?? order.createdAt;
  const estDate = new Date(base.getTime() + estMax * 86400e3);

  const customerName = order.user?.name ?? order.guestName ?? 'there';
  const email = order.user?.email ?? order.guestEmail ?? '';
  const trackUrl = `${env.APP_URL}/track?orderNumber=${encodeURIComponent(order.orderNumber)}`;
  const orderUrl = order.userId ? `${env.APP_URL}/account/orders/${order.orderNumber}` : trackUrl;

  return {
    email,
    customerName,
    orderNumber: order.orderNumber,
    placedDate: formatDate(order.placedAt ?? order.createdAt, true),
    paymentMethod: order.paymentMethod === 'COD' ? 'Cash on Delivery' : 'Prepaid',
    linesHtml,
    itemsSummary,
    subtotal: formatINR(toPaise(order.subtotal)),
    discount: formatINR(toPaise(order.discountTotal)),
    shipping: toPaise(order.shippingTotal) === 0 ? 'FREE' : formatINR(toPaise(order.shippingTotal)),
    total: formatINR(toPaise(order.grandTotal)),
    addressHtml,
    addressText,
    estimatedDelivery: `${estMin}-${estMax} business days (by ${formatDate(estDate)})`,
    trackUrl,
    orderUrl,
    retryUrl: `${env.APP_URL}/checkout/payment/${order.orderNumber}`,
    returnWindowDays: String(settings.policies.returnWindowDays),
    supportEmail: settings.supportEmail,
  };
}
