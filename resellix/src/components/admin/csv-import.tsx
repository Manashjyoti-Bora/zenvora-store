'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { TableWrap, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface RowResult {
  row: number;
  name?: string;
  sku?: string;
  status: 'created' | 'updated' | 'error';
  message?: string;
}
interface Summary {
  total: number;
  created: number;
  updated: number;
  failed: number;
  results: RowResult[];
}

const TEMPLATE = `name,description,sku,brand,category,supplier,supplierSku,supplierCost,supplierShipping,otherCost,pricingMode,fixedPrice,fixedMargin,percentMarkup,minProfit,roundingRule,taxRatePercent,compareAtPrice,status,stock,stockMode,imageUrl,slug
"Example Product","A clear description of at least ten characters.",EX-001,"BrandX","Electronics","","SUP-EX-001",250,30,0,PERCENT_MARKUP,,,30,,ROUND_UP_10,0,,DRAFT,10,SUPPLIER_SYNC,https://example.com/img.jpg,`;

export function CsvImport() {
  const router = useRouter();
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function loadFile(file: File) {
    if (file.size > 2_000_000) {
      setError('File is larger than 2 MB. Split it into smaller imports.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ''));
    reader.onerror = () => setError('Could not read the file.');
    reader.readAsText(file);
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<Summary>('/api/admin/products/import', { body: { csv } });
      setSummary(result);
      toast(
        `Import finished: ${result.created} created, ${result.updated} updated, ${result.failed} failed`,
        result.failed > 0 ? 'info' : 'success'
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Alert tone="info" title="How the importer works">
        <ul className="list-disc space-y-1 pl-4 text-sm">
          <li>
            Header row is required; column order does not matter. Required: <code>name</code>,{' '}
            <code>description</code>, <code>supplierCost</code>.
          </li>
          <li>
            Rows whose <code>sku</code> matches an existing product <strong>update</strong> it; all
            others <strong>create</strong> new products.
          </li>
          <li>
            Each row is validated with the same rules as the product form — bad rows are reported,
            good rows still import.
          </li>
          <li>
            New products are created as <strong>DRAFT</strong> unless the row says otherwise —
            review pricing before publishing.
          </li>
          <li>
            Money columns are plain rupee numbers (e.g. <code>249.99</code>).{' '}
            <code>pricingMode</code>: PERCENT_MARKUP | FIXED_MARGIN | FIXED_PRICE.
          </li>
        </ul>
      </Alert>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            const blob = new Blob([TEMPLATE], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'product-import-template.csv';
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          ⬇ Download CSV template
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          aria-label="Choose CSV file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
            e.target.value = '';
          }}
        />
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          📁 Load CSV file
        </Button>
      </div>

      <div>
        <label htmlFor="csv-text" className="label-text mb-1">
          CSV content{' '}
          {csv && (
            <span className="text-xs font-normal text-gray-400">
              ({csv.split('\n').filter(Boolean).length - 1} data rows loaded)
            </span>
          )}
        </label>
        <textarea
          id="csv-text"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={10}
          spellCheck={false}
          className="input-base font-mono text-xs"
          placeholder="Paste CSV here or load a file…"
        />
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex gap-2">
        <Button size="lg" onClick={runImport} loading={busy} disabled={!csv.trim()}>
          Run import
        </Button>
        <Link
          href="/admin/products"
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Back to products
        </Link>
      </div>

      {summary && (
        <section className="space-y-3" aria-labelledby="import-result">
          <h2 id="import-result" className="text-base font-semibold text-gray-900">
            Result: {summary.created} created · {summary.updated} updated · {summary.failed} failed
            (of {summary.total})
          </h2>
          <TableWrap className="max-h-[420px] overflow-y-auto">
            <table className="table-base">
              <thead className="sticky top-0 bg-gray-50">
                <tr>
                  <Th>Row</Th>
                  <Th>Product</Th>
                  <Th>Result</Th>
                  <Th>Message</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summary.results.map((r, i) => (
                  <tr key={i}>
                    <Td className="tabular-nums text-gray-400">{r.row}</Td>
                    <Td>
                      {r.name ?? '—'}
                      {r.sku ? <span className="ml-1 text-xs text-gray-400">({r.sku})</span> : null}
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          r.status === 'created' ? 'green' : r.status === 'updated' ? 'blue' : 'red'
                        }
                      >
                        {r.status}
                      </Badge>
                    </Td>
                    <Td className="max-w-xs text-xs text-gray-500">{r.message ?? ''}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </section>
      )}
    </div>
  );
}
