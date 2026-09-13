import { prisma } from '../db';
import { forbidden, notFound } from '../errors';
import type { SessionUser } from '../auth/session';

export type AccessibleOrder = Awaited<ReturnType<typeof findOrderForAccess>>;

/**
 * Order access control (anti-IDOR):
 *  - admins/staff: any order
 *  - customers: only orders belonging to their user id
 *  - guests: only with orderNumber + the exact email used at checkout
 */
export async function findOrderForAccess(
  orderNumber: string,
  user: SessionUser | null,
  guestEmail?: string | null
) {
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: { user: true },
  });
  if (!order) throw notFound('Order not found. Check the order number and try again.');

  if (user && (user.role === 'ADMIN' || user.role === 'STAFF')) return order;
  if (user && order.userId === user.id) return order;
  if (!order.userId && order.guestEmail && guestEmail) {
    if (order.guestEmail.toLowerCase() === guestEmail.toLowerCase().trim()) return order;
  }
  throw forbidden(
    'You do not have access to this order. Guests must provide the email used at checkout.'
  );
}
