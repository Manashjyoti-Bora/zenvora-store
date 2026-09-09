'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Checkbox } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { Alert } from '@/components/ui/feedback';
import { TableWrap, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export interface CouponRow {
  code: string;
  description: string | null;
  type: 'PERCENT' | 'FIXED';
  value: number;
  scope: string;
  categoryId: string | null;
  categoryName: string | null;
  minOrderAmount: number | null;
  maxDiscountAmount: number | null;
  usageLimit: number | null;
  usageCount: number;
  perUserLimit: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  bypassMarginProtection: boolean;
  firstOrderOnly: boolean;
}

interface FormState {
  code: string;
  description: string;
  type: 'PERCENT' | 'FIXED';
  value: string;
  scope: 'ALL_PRODUCTS' | 'CATEGORY';
  categoryId: string;
  minOrderAmount: string;
  maxDiscountAmount: string;
  usageLimit: string;
  perUserLimit: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  bypassMarginProtection: boolean;
  firstOrderOnly: boolean;
}

const EMPTY: FormState = {
  code: '',
  description: '',
  type: 'PERCENT',
  value: '10',
  scope: 'ALL_PRODUCTS',
  categoryId: '',
  minOrderAmount: '',
  maxDiscountAmount: '',
  usageLimit: '',
  perUserLimit: '1',
  startsAt: '',
  endsAt: '',
  isActive: true,
  bypassMarginProtection: false,
  firstOrderOnly: false,
};

const dtLocal = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');

export function CouponManager({
  initial,
  categories,
}: {
  initial: CouponRow[];
  categories: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CouponRow | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CouponRow | null>(null);

  const set = (k: keyof FormState, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY });
    setError(null);
    setOpen(true);
  }
  function openEdit(c: CouponRow) {
    setEditing(c);
    setForm({
      code: c.code,
      description: c.description ?? '',
      type: c.type,
      value: String(c.value),
      scope: (c.scope as FormState['scope']) ?? 'ALL_PRODUCTS',
      categoryId: c.categoryId ?? '',
      minOrderAmount: c.minOrderAmount != null ? String(c.minOrderAmount) : '',
      maxDiscountAmount: c.maxDiscountAmount != null ? String(c.maxDiscountAmount) : '',
      usageLimit: c.usageLimit != null ? String(c.usageLimit) : '',
      perUserLimit: String(c.perUserLimit),
      startsAt: dtLocal(c.startsAt),
      endsAt: dtLocal(c.endsAt),
      isActive: c.isActive,
      bypassMarginProtection: c.bypassMarginProtection,
      firstOrderOnly: c.firstOrderOnly,
    });
    setError(null);
    setOpen(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));
    const dtOrNull = (v: string) => (v ? new Date(v).toISOString() : null);
    const body = {
      code: form.code.trim().toUpperCase(),
      description: form.description.trim() || null,
      type: form.type,
      value: Number(form.value),
      scope: form.scope,
      categoryId: form.scope === 'CATEGORY' ? form.categoryId || null : null,
      minOrderAmount: numOrNull(form.minOrderAmount),
      maxDiscountAmount: numOrNull(form.maxDiscountAmount),
      usageLimit: numOrNull(form.usageLimit),
      perUserLimit: Number(form.perUserLimit) || 1,
      startsAt: dtOrNull(form.startsAt),
      endsAt: dtOrNull(form.endsAt),
      isActive: form.isActive,
      bypassMarginProtection: form.bypassMarginProtection,
      firstOrderOnly: form.firstOrderOnly,
    };
    try {
      if (editing) {
        await apiFetch(`/api/admin/coupons/${editing.code}`, { method: 'PATCH', body });
        toast('Coupon updated', 'success');
      } else {
        await apiFetch('/api/admin/coupons', { body });
        toast('Coupon created', 'success');
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: CouponRow) {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/coupons/${c.code}`, { method: 'DELETE' });
      toast(
        c.usageCount > 0 ? 'Coupon deactivated (it has usage history)' : 'Coupon deleted',
        'success'
      );
      setDeleting(null);
      setRows((r) =>
        c.usageCount > 0
          ? r.map((x) => (x.code === c.code ? { ...x, isActive: false } : x))
          : r.filter((x) => x.code !== c.code)
      );
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Delete failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  const fmtMoney = (v: number | null) => (v == null ? '—' : `₹${v.toLocaleString('en-IN')}`);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew}>+ New coupon</Button>
      </div>

      <TableWrap>
        <table className="table-base">
          <thead className="bg-gray-50">
            <tr>
              <Th>Code</Th>
              <Th>Discount</Th>
              <Th className="hidden md:table-cell">Scope</Th>
              <Th className="hidden lg:table-cell">Limits</Th>
              <Th className="hidden lg:table-cell">Validity</Th>
              <Th>Used</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <Td className="py-8 text-center text-gray-400">No coupons yet.</Td>
              </tr>
            )}
            {rows.map((c) => (
              <tr key={c.code} className="hover:bg-gray-50/60">
                <Td>
                  <p className="font-mono text-xs font-bold text-gray-900">{c.code}</p>
                  {c.description && (
                    <p className="max-w-[180px] truncate text-[11px] text-gray-400">
                      {c.description}
                    </p>
                  )}
                </Td>
                <Td className="font-medium">
                  {c.type === 'PERCENT' ? `${c.value}% off` : `₹${c.value} off`}
                  {c.maxDiscountAmount != null && (
                    <span className="block text-[10px] text-gray-400">
                      max {fmtMoney(c.maxDiscountAmount)}
                    </span>
                  )}
                </Td>
                <Td className="hidden text-xs text-gray-600 md:table-cell">
                  {c.scope === 'CATEGORY'
                    ? `Category: ${c.categoryName ?? c.categoryId}`
                    : 'All products'}
                  {c.minOrderAmount != null && (
                    <span className="block text-[10px] text-gray-400">
                      min order {fmtMoney(c.minOrderAmount)}
                    </span>
                  )}
                </Td>
                <Td className="hidden text-xs tabular-nums text-gray-600 lg:table-cell">
                  {c.usageLimit != null ? `${c.usageLimit} total` : 'unlimited'} · {c.perUserLimit}
                  /user
                </Td>
                <Td className="hidden text-[11px] text-gray-500 lg:table-cell">
                  {c.startsAt ? new Date(c.startsAt).toLocaleDateString('en-IN') : 'now'} →{' '}
                  {c.endsAt ? new Date(c.endsAt).toLocaleDateString('en-IN') : 'no end'}
                </Td>
                <Td className="tabular-nums">{c.usageCount}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={c.isActive ? 'green' : 'gray'}>
                      {c.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    {c.bypassMarginProtection && <Badge tone="red">Margin bypass</Badge>}
                    {c.firstOrderOnly && <Badge tone="blue">First order</Badge>}
                  </div>
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => openEdit(c)}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(c)}
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
        title={editing ? `Edit coupon ${editing.code}` : 'New coupon'}
        wide
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button form="coupon-form" type="submit" loading={busy}>
              {editing ? 'Save changes' : 'Create coupon'}
            </Button>
          </div>
        }
      >
        <form id="coupon-form" onSubmit={save} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Code" required hint="A–Z, 0–9, dash/underscore">
              {(p) => (
                <Input
                  {...p}
                  value={form.code}
                  onChange={(e) =>
                    set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))
                  }
                  maxLength={24}
                  disabled={Boolean(editing)}
                />
              )}
            </Field>
            <Field label="Description" hint="Internal note shown in admin">
              {(p) => (
                <Input
                  {...p}
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  maxLength={300}
                />
              )}
            </Field>
            <Field label="Type" required>
              {(p) => (
                <Select {...p} value={form.type} onChange={(e) => set('type', e.target.value)}>
                  <option value="PERCENT">Percent off</option>
                  <option value="FIXED">Fixed ₹ off</option>
                </Select>
              )}
            </Field>
            <Field label={form.type === 'PERCENT' ? 'Percent (1–100)' : 'Amount (₹)'} required>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min="0.01"
                  step={form.type === 'PERCENT' ? '1' : '0.01'}
                  value={form.value}
                  onChange={(e) => set('value', e.target.value)}
                />
              )}
            </Field>
            <Field label="Scope">
              {(p) => (
                <Select {...p} value={form.scope} onChange={(e) => set('scope', e.target.value)}>
                  <option value="ALL_PRODUCTS">All products</option>
                  <option value="CATEGORY">Specific category</option>
                </Select>
              )}
            </Field>
            {form.scope === 'CATEGORY' && (
              <Field label="Category" required>
                {(p) => (
                  <Select
                    {...p}
                    value={form.categoryId}
                    onChange={(e) => set('categoryId', e.target.value)}
                  >
                    <option value="">Select…</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Minimum order (₹)" hint="Blank = no minimum">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.minOrderAmount}
                  onChange={(e) => set('minOrderAmount', e.target.value)}
                />
              )}
            </Field>
            <Field label="Max discount (₹)" hint="Caps PERCENT coupons; blank = uncapped">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.maxDiscountAmount}
                  onChange={(e) => set('maxDiscountAmount', e.target.value)}
                />
              )}
            </Field>
            <Field label="Total usage limit" hint="Blank = unlimited">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min="1"
                  value={form.usageLimit}
                  onChange={(e) => set('usageLimit', e.target.value)}
                />
              )}
            </Field>
            <Field label="Per-user limit" required>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min="1"
                  max="1000"
                  value={form.perUserLimit}
                  onChange={(e) => set('perUserLimit', e.target.value)}
                />
              )}
            </Field>
            <Field label="Starts at" hint="Blank = immediately">
              {(p) => (
                <Input
                  {...p}
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(e) => set('startsAt', e.target.value)}
                />
              )}
            </Field>
            <Field label="Ends at" hint="Blank = never expires">
              {(p) => (
                <Input
                  {...p}
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(e) => set('endsAt', e.target.value)}
                />
              )}
            </Field>
          </div>
          <Checkbox
            label="Active"
            checked={form.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
          />
          <Checkbox
            label="Bypass minimum-margin protection"
            checked={form.bypassMarginProtection}
            onChange={(e) => set('bypassMarginProtection', e.target.checked)}
          />
          <Checkbox
            label="First order only"
            checked={form.firstOrderOnly}
            onChange={(e) => set('firstOrderOnly', e.target.checked)}
          />
          {form.firstOrderOnly && (
            <p className="text-xs text-gray-500">
              Valid only for signed-in customers with no previous non-cancelled orders.
            </p>
          )}
          {form.bypassMarginProtection && (
            <p className="text-xs text-red-600">
              Warning: this coupon can push the selling price below your configured minimum margin.
              Only use it for deliberate loss-leader campaigns.
            </p>
          )}
        </form>
      </Modal>

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete coupon ${deleting?.code}?`}
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
          {deleting && deleting.usageCount > 0
            ? `This coupon has been used ${deleting.usageCount} time(s). It will be DEACTIVATED instead of deleted so past orders keep referencing it correctly.`
            : 'This permanently removes the coupon.'}
        </p>
      </Modal>
    </div>
  );
}
