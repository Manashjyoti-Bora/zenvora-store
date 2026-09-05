import type { Metadata } from 'next';
import { TrackOrderForm } from '@/components/store/track-order-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Track your order',
  description: 'Track your order status and shipping updates with your order number and email.',
  alternates: { canonical: '/track' },
};

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div className="container-store py-8 sm:py-12">
      <header className="mx-auto mb-8 max-w-2xl text-center">
        <h1>Track your order</h1>
        <p className="mt-2 text-sm text-gray-500">
          Enter your order number and the email address used at checkout to see live status and
          shipping updates.
        </p>
      </header>
      <TrackOrderForm initialOrderNumber={sp.order} />
    </div>
  );
}
