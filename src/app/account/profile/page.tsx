import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { ProfileManager } from '@/components/account/profile-manager';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Profile & security', robots: { index: false } };

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const full = await prisma.user.findUnique({
    where: { id: user.id },
    select: { phone: true, createdAt: true },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1>Profile &amp; security</h1>
        <p className="mt-1 text-sm text-gray-500">
          Update your personal details or change your password.
        </p>
      </header>
      <ProfileManager
        initial={{ name: user.name, email: user.email, phone: full?.phone ?? '' }}
        memberSince={full?.createdAt ? full.createdAt.toISOString() : null}
        role={user.role}
      />
    </div>
  );
}
