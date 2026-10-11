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
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-ink-900/10 bg-white p-3.5 shadow-hair">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-950 text-xs font-bold text-brass-300"
            >
              {(user.name || user.email || 'U').slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink-900">{user.name}</p>
              <p className="truncate text-xs text-ink-400">{user.email}</p>
            </div>
          </div>
          <AccountNav isAdmin={isAdmin} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
