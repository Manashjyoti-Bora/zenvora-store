'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea, Select, Checkbox } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { Alert } from '@/components/ui/feedback';
import { TableWrap, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export interface SupplierRow {
  id: string;
  name: string;
  slug: string;
  type: 'MANUAL' | 'HTTP_REST' | 'CJ' | 'DEMO';
  contactEmail: string | null;
  contactPhone: string | null;
  baseUrl: string | null;
  apiKeyEnvVar: string | null;
  apiSecretEnvVar: string | null;
  configText: string;
  leadTimeDays: number;
  isActive: boolean;
  notes: string | null;
  productCount: number;
  supplierProductCount: number;
  supplierOrderCount: number;
  lastSyncedAt: string | null;
}

interface FormState {
  name: string;
  slug: string;
  type: SupplierRow['type'];
  contactEmail: string;
  contactPhone: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  apiSecretEnvVar: string;
  config: string;
  leadTimeDays: string;
  isActive: boolean;
  notes: string;
}

const EMPTY: FormState = {
  name: '',
  slug: '',
  type: 'MANUAL',
  contactEmail: '',
  contactPhone: '',
  baseUrl: '',
  apiKeyEnvVar: '',
  apiSecretEnvVar: '',
  config: '',
  leadTimeDays: '3',
  isActive: true,
  notes: '',
};

const TYPE_INFO: Record<
  SupplierRow['type'],
  { label: string; tone: 'blue' | 'purple' | 'gray'; hint: string }
> = {
  MANUAL: {
    label: 'Manual',
    tone: 'gray',
    hint: 'You fulfil these orders yourself: mark shipments, enter tracking. No API needed.',
  },
  HTTP_REST: {
    label: 'HTTP REST',
    tone: 'blue',
    hint: 'Automated via the supplier’s REST API — configure endpoints in the JSON config (see docs/SUPPLIER_API.md).',
  },
  CJ: {
    label: 'CJ Dropshipping',
    tone: 'blue',
    hint: 'General-catalogue dropshipping via CJ’s official API v2: catalogue import, stock, automated order forwarding, wallet payment, tracking. Needs a CJ API key env var + fxRateInrPerUsd config.',
  },
  DEMO: {
    label: 'Demo',
    tone: 'purple',
    hint: 'Built-in simulator for end-to-end testing of automation. Clearly marked; never used for real fulfilment.',
  },
};

export function SupplierManager({ initial }: { initial: SupplierRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SupplierRow | null>(null);

  const set = (k: keyof FormState, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY });
    setError(null);
    setOpen(true);
  }
  function openEdit(s: SupplierRow) {
    setEditing(s);
    setForm({
      name: s.name,
      slug: s.slug,
      type: s.type,
      contactEmail: s.contactEmail ?? '',
      contactPhone: s.contactPhone ?? '',
      baseUrl: s.baseUrl ?? '',
      apiKeyEnvVar: s.apiKeyEnvVar ?? '',
      apiSecretEnvVar: s.apiSecretEnvVar ?? '',
      config: s.configText,
      leadTimeDays: String(s.leadTimeDays),
      isActive: s.isActive,
      notes: s.notes ?? '',
    });
    setError(null);
    setOpen(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: form.name.trim(),
      slug: form.slug.trim(),
      type: form.type,
      contactEmail: form.contactEmail.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
      baseUrl: form.baseUrl.trim() || null,
      apiKeyEnvVar: form.apiKeyEnvVar.trim() || null,
      apiSecretEnvVar: form.apiSecretEnvVar.trim() || null,
      config: form.config.trim() || null,
      leadTimeDays: Number(form.leadTimeDays) || 0,
      isActive: form.isActive,
      notes: form.notes.trim() || null,
    };
    try {
      if (editing) {
        await apiFetch(`/api/admin/suppliers/${editing.id}`, { method: 'PATCH', body });
        toast('Supplier updated', 'success');
      } else {
        await apiFetch('/api/admin/suppliers', { body });
        toast('Supplier created', 'success');
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function sync(s: SupplierRow) {
    setSyncingId(s.id);
    try {
      const result = await apiFetch<{ created: number; updated: number; total: number }>(
        `/api/admin/suppliers/${s.id}/sync`
      );
      toast(
        `Catalog sync: ${result.created} new, ${result.updated} updated (${result.total} fetched)`,
        'success'
      );
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Catalog sync failed', 'error');
    } finally {
      setSyncingId(null);
    }
  }

  async function remove(s: SupplierRow) {
    setBusy(true);
    try {
      const result = await apiFetch<{ deactivated?: boolean }>(`/api/admin/suppliers/${s.id}`, {
        method: 'DELETE',
      });
      toast(
        result?.deactivated
          ? 'Supplier deactivated (it has order history — records kept)'
          : 'Supplier deleted',
        'success'
      );
      setDeleting(null);
      setRows((r) =>
        result?.deactivated
          ? r.map((x) => (x.id === s.id ? { ...x, isActive: false } : x))
          : r.filter((x) => x.id !== s.id)
      );
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Delete failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew}>+ New supplier</Button>
      </div>

      <TableWrap>
        <table className="table-base">
          <thead className="bg-gray-50">
            <tr>
              <Th>Supplier</Th>
              <Th>Type</Th>
              <Th className="hidden md:table-cell">Products</Th>
              <Th className="hidden md:table-cell">Catalog</Th>
              <Th className="hidden lg:table-cell">Orders</Th>
              <Th className="hidden lg:table-cell">Last sync</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <Td className="py-8 text-center text-gray-400">
                  No suppliers yet — orders without a supplier are fulfilled manually.
                </Td>
              </tr>
            )}
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50/60">
                <Td>
                  <Link
                    href={`/admin/suppliers/${s.id}`}
                    className="font-medium text-gray-900 hover:text-brand-700"
                  >
                    {s.name}
                  </Link>
                  <p className="max-w-[200px] truncate text-[11px] text-gray-400">
                    {s.baseUrl ?? s.contactEmail ?? `/${s.slug}`}
                  </p>
                </Td>
                <Td>
                  <Badge tone={TYPE_INFO[s.type].tone}>{TYPE_INFO[s.type].label}</Badge>
                </Td>
                <Td className="hidden tabular-nums md:table-cell">{s.productCount}</Td>
                <Td className="hidden tabular-nums md:table-cell">
                  {s.supplierProductCount}
                  {s.supplierProductCount > 0 && s.productCount < s.supplierProductCount && (
                    <span className="block text-[10px] text-amber-600">
                      {s.supplierProductCount - s.productCount} unmapped
                    </span>
                  )}
                </Td>
                <Td className="hidden tabular-nums lg:table-cell">{s.supplierOrderCount}</Td>
                <Td className="hidden text-[11px] text-gray-500 lg:table-cell">
                  {s.lastSyncedAt
                    ? new Intl.DateTimeFormat('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(s.lastSyncedAt))
                    : 'never'}
                </Td>
                <Td>
                  <Badge tone={s.isActive ? 'green' : 'gray'}>
                    {s.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-3 text-xs">
                    <Link
                      href={`/admin/suppliers/${s.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      Manage
                    </Link>
                    <button
                      type="button"
                      onClick={() => openEdit(s)}
                      className="font-medium text-gray-600 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => sync(s)}
                      disabled={syncingId === s.id}
                      className="font-medium text-gray-600 hover:underline disabled:opacity-50"
                    >
                      {syncingId === s.id ? 'Syncing…' : 'Sync catalog'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(s)}
                      className="font-medium text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit supplier: ${editing.name}` : 'New supplier'}
        wide
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button form="supplier-form" type="submit" loading={busy}>
              {editing ? 'Save changes' : 'Create supplier'}
            </Button>
          </div>
        }
      >
        <form id="supplier-form" onSubmit={save} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              {(p) => (
                <Input
                  {...p}
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  maxLength={120}
                />
              )}
            </Field>
            <Field label="Slug" hint="Blank = auto from name">
              {(p) => (
                <Input
                  {...p}
                  value={form.slug}
                  onChange={(e) =>
                    set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
                  }
                  maxLength={90}
                  placeholder="auto"
                />
              )}
            </Field>
            <Field label="Type" required>
              {(p) => (
                <Select
                  {...p}
                  value={form.type}
                  onChange={(e) => set('type', e.target.value as SupplierRow['type'])}
                >
                  <option value="MANUAL">Manual fulfilment</option>
                  <option value="HTTP_REST">HTTP REST API (automated)</option>
                  <option value="CJ">CJ Dropshipping (automated, general catalogue)</option>
                  <option value="DEMO">Demo simulator (testing)</option>
                </Select>
              )}
            </Field>
            <Field label="Lead time (days)" hint="Expected handling time before dispatch">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min="0"
                  max="120"
                  value={form.leadTimeDays}
                  onChange={(e) => set('leadTimeDays', e.target.value)}
                />
              )}
            </Field>
            <Field label="Contact email">
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => set('contactEmail', e.target.value)}
                  maxLength={160}
                />
              )}
            </Field>
            <Field label="Contact phone">
              {(p) => (
                <Input
                  {...p}
                  value={form.contactPhone}
                  onChange={(e) => set('contactPhone', e.target.value)}
                  maxLength={32}
                />
              )}
            </Field>
            {form.type === 'HTTP_REST' && (
              <Field label="API base URL" hint="e.g. https://api.supplier.example.com/v1">
                {(p) => (
                  <Input
                    {...p}
                    type="url"
                    value={form.baseUrl}
                    onChange={(e) => set('baseUrl', e.target.value)}
                    maxLength={500}
                    placeholder="https://…"
                  />
                )}
              </Field>
            )}
          </div>

          {form.type === 'HTTP_REST' && (
            <div className="space-y-3 rounded-lg border border-gray-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                API credentials & endpoints
              </p>
              <Alert tone="warning">
                Secrets are <strong>never stored in the database</strong>. Enter only the NAME of
                the environment variable that holds the key (e.g. <code>SUPPLIER_ACME_API_KEY</code>
                ); the value goes in <code>.env</code> on the server.
              </Alert>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="API key env var name" hint="UPPER_SNAKE_CASE">
                  {(p) => (
                    <Input
                      {...p}
                      value={form.apiKeyEnvVar}
                      onChange={(e) =>
                        set('apiKeyEnvVar', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))
                      }
                      maxLength={80}
                      placeholder="SUPPLIER_X_API_KEY"
                    />
                  )}
                </Field>
                <Field label="API secret env var name">
                  {(p) => (
                    <Input
                      {...p}
                      value={form.apiSecretEnvVar}
                      onChange={(e) =>
                        set(
                          'apiSecretEnvVar',
                          e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '')
                        )
                      }
                      maxLength={80}
                      placeholder="SUPPLIER_X_API_SECRET"
                    />
                  )}
                </Field>
              </div>
              <Field
                label="Config JSON"
                hint="Auth style, endpoint paths/field mappings, status map — schema documented in docs/SUPPLIER_API.md"
              >
                {(p) => (
                  <Textarea
                    {...p}
                    rows={7}
                    value={form.config}
                    onChange={(e) => set('config', e.target.value)}
                    className="font-mono text-xs"
                    placeholder={
                      '{\n  "auth": { "type": "bearer" },\n  "endpoints": { … },\n  "statusMap": { … }\n}'
                    }
                  />
                )}
              </Field>
            </div>
          )}

          {form.type === 'CJ' && (
            <div className="space-y-3 rounded-lg border border-gray-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                CJ Dropshipping API v2
              </p>
              <Alert tone="warning">
                The CJ API key lives <strong>only in an environment variable</strong>. Enter the
                variable NAME here (default <code>CJ_API_KEY</code>); put the actual key in
                Vercel/server env (CJ dashboard → My CJ → Authorization → API). Never paste the
                key into this form or into chat.
              </Alert>
              <Field label="API key env var name" hint="UPPER_SNAKE_CASE">
                {(p) => (
                  <Input
                    {...p}
                    value={form.apiKeyEnvVar}
                    onChange={(e) =>
                      set('apiKeyEnvVar', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))
                    }
                    maxLength={80}
                    placeholder="CJ_API_KEY"
                  />
                )}
              </Field>
              <Field
                label="Config JSON"
                hint="fxRateInrPerUsd is REQUIRED (CJ costs are USD; conversion is explicit). logisticName / fromCountryCode optional."
              >
                {(p) => (
                  <Textarea
                    {...p}
                    rows={5}
                    value={form.config}
                    onChange={(e) => set('config', e.target.value)}
                    className="font-mono text-xs"
                    placeholder={
                      '{\n  "fxRateInrPerUsd": 88.5,\n  "logisticName": "CJPacket Ordinary",\n  "fromCountryCode": "CN"\n}'
                    }
                  />
                )}
              </Field>
              <p className="text-xs text-gray-500">
                Map each Zenvora product to a CJ variant: store the CJ <code>vid</code> (or CJ SKU)
                in the product&apos;s supplier SKU field. Cancellations/returns are manual via the
                CJ dashboard — CJ&apos;s public API v2 does not expose them, and Zenvora says so
                instead of pretending otherwise.
              </p>
            </div>
          )}

          <Field label="Internal notes">
            {(p) => (
              <Textarea
                {...p}
                rows={2}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                maxLength={2000}
                placeholder="Account manager, payment terms, quirks…"
              />
            )}
          </Field>
          <Checkbox
            label="Active (usable for fulfilment)"
            checked={form.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
          />
          <p className="text-xs text-gray-400">{TYPE_INFO[form.type].hint}</p>
        </form>
      </Modal>

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete supplier “${deleting?.name}”?`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={busy}>
              Keep
            </Button>
            <Button variant="danger" loading={busy} onClick={() => deleting && remove(deleting)}>
              Delete
            </Button>
          </div>
        }
      >
        <p className="text-sm text-gray-600">
          {deleting?.type === 'MANUAL'
            ? 'Manual-fulfilment suppliers are the fallback for products without automation and cannot be deleted. Deactivate it instead (edit → uncheck Active).'
            : deleting && deleting.supplierOrderCount > 0
              ? 'This supplier has order history, so it will be DEACTIVATED instead of deleted — financial records must stay consistent.'
              : 'This permanently removes the supplier and its unmapped catalog entries. Mapped products keep working (their supplier link is cleared).'}
        </p>
      </Modal>
    </div>
  );
}
