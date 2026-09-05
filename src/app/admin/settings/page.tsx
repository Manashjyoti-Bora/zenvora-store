import type { Metadata } from 'next';
import { getSettings } from '@/lib/settings';
import { SettingsForm } from '@/components/admin/settings-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Settings — Admin', robots: { index: false } };

export default async function AdminSettingsPage() {
  const settings = await getSettings();
  return (
    <div className="space-y-5">
      <header>
        <h1>Store settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Storefront behaviour, business details, shipping/tax defaults and policy windows — stored
          in the database, effective immediately.
        </p>
      </header>
      <SettingsForm initial={settings} />
    </div>
  );
}
