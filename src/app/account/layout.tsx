import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/guards';
import { AccountNav } from '@/components/account/account-nav';

export const dynamic = 'force-dynamic';

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  // Redirect (not 401) when the session cookie is missing/expired - the
  // middleware covers the common case, this covers revoked/expired sessions.
  const user = await getCurrentUser();
  if (!user) redirect('/auth/login?next=/account');
  const isAdmin = user.role === 'ADMIN' || user.role === 'STAFF';

  return (
    <div className="container-store py-6 sm:py-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
        <aside className="h-fit lg:sticky lg:top-20">
          <div className="mb-4 hidden rounded-xl border border-ink-900/10 bg-white p-4 lg:block">
            <p className="truncate text-sm font-semibold text-ink-900">{user.name}</p>
            <p className="truncate text-xs text-ink-400">{user.email}</p>
          </div>
          <AccountNav isAdmin={isAdmin} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
