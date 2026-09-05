import type { Metadata } from 'next';
import { CsvImport } from '@/components/admin/csv-import';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'CSV import — Admin', robots: { index: false } };

export default function ImportPage() {
  return (
    <div className="space-y-5">
      <header>
        <h1>Bulk product import (CSV)</h1>
        <p className="mt-1 text-sm text-gray-500">
          Import or update products from a spreadsheet export. Nothing is published without your
          review.
        </p>
      </header>
      <CsvImport />
    </div>
  );
}
