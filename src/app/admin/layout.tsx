import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/guards';
import { AdminNav } from '@/components/admin/admin-nav';
import { getSettings } from '@/lib/settings';
import { MenuIcon } from '@/components/ui/icons';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/login?next=/admin');
  if (user.role !== 'ADMIN') redirect('/account'); // STAFF sees account; admin-only panel
  const settings = await getSettings();

  return (
    <div className="min-h-screen bg-cream-50 lg:flex">
      {/* Sidebar: off-canvas on mobile via details-like toggle, static on lg */}
      <aside className="print-hide border-b border-ink-900/10 bg-white shadow-hair lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-2 border-b border-ink-900/10 bg-brand-800 px-4 py-3.5 text-cream-50">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-cream-50">{settings.storeName}</p>
            <p className="text-[10px] font-semibold uppercase tracking-eyebrow text-accent-300">
              Admin Console
            </p>
          </div>
          {settings.demoMode && (
            <span className="shrink-0 rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-200 ring-1 ring-amber-300/30">
              Demo
            </span>
          )}
        </div>
        <details className="group lg:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-semibold text-ink-800">
            <span className="inline-flex items-center gap-2">
              <MenuIcon className="h-4 w-4 text-brand-700" />
              <span>Sections</span>
            </span>
            <span className="text-ink-400 group-open:hidden">▾</span>
          </summary>
          <div className="px-2 pb-3">
            <AdminNav />
          </div>
        </details>
        <div className="hidden px-2.5 py-3 lg:block">
          <AdminNav />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="print-hide border-b border-ink-900/10 bg-white px-4 py-2.5 lg:hidden">
          <p className="text-sm font-semibold text-ink-900">Admin Console</p>
        </header>
        <main className="p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
