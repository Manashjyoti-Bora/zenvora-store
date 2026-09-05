import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { AddressManager } from '@/components/account/address-manager';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'My addresses', robots: { index: false } };

export default async function AddressesPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const addresses = await prisma.address.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefaultShipping: 'desc' }, { createdAt: 'desc' }],
  });

  return (
    <div className="space-y-6">
      <header>
        <h1>My addresses</h1>
        <p className="mt-1 text-sm text-gray-500">
          Saved addresses speed up checkout. The default address is pre-selected.
        </p>
      </header>
      <AddressManager
        initial={addresses.map((a) => ({
          id: a.id,
          label: a.label,
          fullName: a.fullName,
          phone: a.phone,
          line1: a.line1,
          line2: a.line2,
          city: a.city,
          state: a.state,
          postalCode: a.postalCode,
          country: a.country,
          isDefaultShipping: a.isDefaultShipping,
        }))}
      />
    </div>
  );
}
