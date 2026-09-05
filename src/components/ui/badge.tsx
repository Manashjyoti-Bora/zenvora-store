import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'gray';

const tones: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-700 ring-gray-200',
  gray: 'bg-gray-100 text-gray-600 ring-gray-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  purple: 'bg-purple-50 text-purple-700 ring-purple-200',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Order status vocabulary -> consistent colours everywhere (customer & admin)
// ---------------------------------------------------------------------------

import type {
  OrderStatus,
  OrderPaymentStatus,
  OrderFulfilmentStatus,
  PaymentStatus,
} from '@prisma/client';

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Pending payment',
  PAYMENT_FAILED: 'Payment failed',
  PAYMENT_VERIFIED: 'Payment verified',
  ORDER_CONFIRMED: 'Confirmed',
  SENT_TO_SUPPLIER: 'Sent to supplier',
  SUPPLIER_ACCEPTED: 'Supplier accepted',
  PROCESSING: 'Processing',
  SHIPPED: 'Shipped',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUND_PENDING: 'Refund pending',
  REFUNDED: 'Refunded',
  RETURN_REQUESTED: 'Return requested',
  RETURNED: 'Returned',
  FULFILMENT_FAILED: 'Fulfilment failed',
};

const ORDER_STATUS_TONES: Record<OrderStatus, Tone> = {
  PENDING_PAYMENT: 'amber',
  PAYMENT_FAILED: 'red',
  PAYMENT_VERIFIED: 'blue',
  ORDER_CONFIRMED: 'blue',
  SENT_TO_SUPPLIER: 'purple',
  SUPPLIER_ACCEPTED: 'purple',
  PROCESSING: 'purple',
  SHIPPED: 'blue',
  OUT_FOR_DELIVERY: 'blue',
  DELIVERED: 'green',
  CANCELLED: 'gray',
  REFUND_PENDING: 'amber',
  REFUNDED: 'gray',
  RETURN_REQUESTED: 'amber',
  RETURNED: 'gray',
  FULFILMENT_FAILED: 'red',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_STATUS_TONES[status]}>{ORDER_STATUS_LABELS[status] ?? status}</Badge>;
}

const PAYMENT_STATUS_LABELS: Record<OrderPaymentStatus, string> = {
  PENDING: 'Pending',
  COD_PENDING: 'COD - due on delivery',
  PAID: 'Paid',
  FAILED: 'Failed',
  PARTIALLY_REFUNDED: 'Partially refunded',
  REFUNDED: 'Refunded',
};
const PAYMENT_STATUS_TONES: Record<OrderPaymentStatus, Tone> = {
  PENDING: 'amber',
  COD_PENDING: 'amber',
  PAID: 'green',
  FAILED: 'red',
  PARTIALLY_REFUNDED: 'blue',
  REFUNDED: 'gray',
};
export function PaymentStatusBadge({ status }: { status: OrderPaymentStatus }) {
  return (
    <Badge tone={PAYMENT_STATUS_TONES[status]}>{PAYMENT_STATUS_LABELS[status] ?? status}</Badge>
  );
}

const FULFIL_STATUS_LABELS: Record<OrderFulfilmentStatus, string> = {
  PENDING: 'Pending',
  SENT_TO_SUPPLIER: 'Sent to supplier',
  SUPPLIER_ACCEPTED: 'Accepted',
  PROCESSING: 'Processing',
  SHIPPED: 'Shipped',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
};
const FULFIL_STATUS_TONES: Record<OrderFulfilmentStatus, Tone> = {
  PENDING: 'amber',
  SENT_TO_SUPPLIER: 'purple',
  SUPPLIER_ACCEPTED: 'purple',
  PROCESSING: 'purple',
  SHIPPED: 'blue',
  OUT_FOR_DELIVERY: 'blue',
  DELIVERED: 'green',
  CANCELLED: 'gray',
  FAILED: 'red',
};
export function FulfilmentStatusBadge({ status }: { status: OrderFulfilmentStatus }) {
  return <Badge tone={FULFIL_STATUS_TONES[status]}>{FULFIL_STATUS_LABELS[status] ?? status}</Badge>;
}

const GATEWAY_PAYMENT_TONES: Record<PaymentStatus, Tone> = {
  CREATED: 'amber',
  PAID: 'green',
  FAILED: 'red',
  PARTIALLY_REFUNDED: 'blue',
  REFUNDED: 'gray',
};
export function GatewayPaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={GATEWAY_PAYMENT_TONES[status]}>{status.replace(/_/g, ' ')}</Badge>;
}

export { ORDER_STATUS_LABELS };
