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

export interface RuleRow {
  id: string;
  name: string;
  scope: 'GLOBAL' | 'SUPPLIER' | 'CATEGORY' | 'PRODUCT';
  supplierId: string | null;
  categoryId: string | null;
  productId: string | null;
  supplierName: string | null;
  categoryName: string | null;
  productName: string | null;
  mode: 'FIXED_MARGIN' | 'PERCENT_MARKUP' | 'FIXED_PRICE';
  fixedMargin: number | null;
  percentMarkup: number | null;
  minProfit: number | null;
  roundingRule: string;
  priority: number;
  isActive: boolean;
}

interface FormState {
  name: string;
  scope: RuleRow['scope'];
  supplierId: string;
  categoryId: string;
  productId: string;
  mode: 'FIXED_MARGIN' | 'PERCENT_MARKUP' | 'FIXED_PRICE';
  fixedMargin: string;
  percentMarkup: string;
  minProfit: string;
  roundingRule: string;
  priority: string;
  isActive: boolean;
}

const EMPTY: FormState = {
  name: '',
  scope: 'GLOBAL',
  supplierId: '',
  categoryId: '',
  productId: '',
  mode: 'PERCENT_MARKUP',
  fixedMargin: '',
  percentMarkup: '25',
  minProfit: '',
  roundingRule: 'ROUND_UP_10',
  priority: '0',
  isActive: true,
};

export function PricingRuleManager({
  initial,
  categories,
  suppliers,
  products,
}: {
  initial: RuleRow[];
  categories: Array<{ id: string; name: string }>;
  suppliers: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof FormState, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY });
    setError(null);
    setOpen(true);
  }
  function openEdit(r: RuleRow) {
    setEditing(r);
    setForm({
      name: r.name,
      scope: r.scope,
      supplierId: r.supplierId ?? '',
      categoryId: r.categoryId ?? '',
      productId: r.productId ?? '',
      mode: r.mode,
      fixedMargin: r.fixedMargin != null ? String(r.fixedMargin) : '',
      percentMarkup: r.percentMarkup != null ? String(r.percentMarkup) : '',
      minProfit: r.minProfit != null ? String(r.minProfit) : '',
      roundingRule: r.roundingRule,
      priority: String(r.priority),
      isActive: r.isActive,
    });
    setError(null);
    setOpen(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));
    const body = {
      name: form.name.trim(),
      scope: form.scope,
      supplierId: form.scope === 'SUPPLIER' ? form.supplierId || null : null,
      categoryId: form.scope === 'CATEGORY' ? form.categoryId || null : null,
      productId: form.scope === 'PRODUCT' ? form.productId || null : null,
      mode: form.mode,
      fixedMargin: numOrNull(form.fixedMargin),
      percentMarkup: numOrNull(form.percentMarkup),
      minProfit: numOrNull(form.minProfit),
      roundingRule: form.roundingRule,
      priority: Number(form.priority) || 0,
      isActive: form.isActive,
    };
    try {
      if (editing) {
        await apiFetch(`/api/admin/pricing-rules/${editing.id}`, { method: 'PATCH', body });
        toast('Rule updated — run Bulk reprice to apply to existing products', 'success');
      } else {
        await apiFetch('/api/admin/pricing-rules', { body });
        toast('Rule created — run Bulk reprice to apply to existing products', 'success');
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: RuleRow) {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/pricing-rules/${r.id}`, { method: 'DELETE' });
      toast('Rule deleted', 'success');
      setRows((prev) => prev.filter((x) => x.id !== r.id));
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Delete failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  const target = (r: RuleRow) =>
    r.scope === 'GLOBAL'
      ? 'All products'
      : r.scope === 'SUPPLIER'
        ? (r.supplierName ?? 'supplier')
        : r.scope === 'CATEGORY'
          ? (r.categoryName ?? 'category')
          : (r.productName ?? 'product');

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Rule precedence">
        When several active rules match a product, the winner is chosen by scope (PRODUCT &gt;
        CATEGORY &gt; SUPPLIER &gt; GLOBAL) and then by priority (higher first). The winning rule
        overrides the product&apos;s own pricing mode/margins. Changes affect prices when the
        pricing engine runs — use <strong>Bulk reprice</strong> for existing products, and
        new/edited products pick rules up automatically.
      </Alert>

      <div className="flex justify-end">
        <Button onClick={openNew}>+ New rule</Button>
      </div>

      <TableWrap>
        <table className="table-base">
          <thead className="bg-gray-50">
            <tr>
              <Th>Rule</Th>
              <Th>Applies to</Th>
              <Th>Mode</Th>
              <Th className="hidden md:table-cell">Min profit</Th>
              <Th className="hidden md:table-cell">Rounding</Th>
              <Th className="hidden lg:table-cell">Priority</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <Td className="py-8 text-center text-gray-400">
                  No pricing rules — products use their own pricing fields.
                </Td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50/60">
                <Td className="font-medium text-gray-900">{r.name}</Td>
                <Td>
                  <Badge tone={r.scope === 'GLOBAL' ? 'blue' : 'purple'}>{r.scope}</Badge>{' '}
                  <span className="text-xs text-gray-500">
                    {r.scope !== 'GLOBAL' ? target(r) : ''}
                  </span>
                </Td>
                <Td className="text-xs text-gray-600">
                  {r.mode === 'PERCENT_MARKUP'
                    ? `markup ${r.percentMarkup ?? '?'}%`
                    : `margin ₹${r.fixedMargin ?? '?'}`}
                </Td>
                <Td className="hidden text-xs tabular-nums text-gray-600 md:table-cell">
                  {r.minProfit != null ? `₹${r.minProfit}` : '—'}
                </Td>
                <Td className="hidden text-xs text-gray-500 md:table-cell">
                  {r.roundingRule.replace(/_/g, ' ').toLowerCase()}
                </Td>
                <Td className="hidden text-xs tabular-nums lg:table-cell">{r.priority}</Td>
                <Td>
                  <Badge tone={r.isActive ? 'green' : 'gray'}>
                    {r.isActive ? 'Active' : 'Off'}
                  </Badge>
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      disabled={busy}
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
        title={editing ? `Edit rule: ${editing.name}` : 'New pricing rule'}
        wide
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button form="rule-form" type="submit" loading={busy}>
              {editing ? 'Save changes' : 'Create rule'}
            </Button>
          </div>
        }
      >
        <form id="rule-form" onSubmit={save} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Rule name" required>
              {(p) => (
                <Input
                  {...p}
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Electronics 30% markup"
                />
              )}
            </Field>
            <Field label="Scope" required>
              {(p) => (
                <Select
                  {...p}
                  value={form.scope}
                  onChange={(e) => set('scope', e.target.value as FormState['scope'])}
                >
                  <option value="GLOBAL">Global (all products)</option>
                  <option value="SUPPLIER">Supplier</option>
                  <option value="CATEGORY">Category</option>
                  <option value="PRODUCT">Single product</option>
                </Select>
              )}
            </Field>
            {form.scope === 'SUPPLIER' && (
              <Field label="Supplier" required>
                {(p) => (
                  <Select
                    {...p}
                    value={form.supplierId}
                    onChange={(e) => set('supplierId', e.target.value)}
                  >
                    <option value="">Select…</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
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
            {form.scope === 'PRODUCT' && (
              <Field label="Product" required>
                {(p) => (
                  <Select
                    {...p}
                    value={form.productId}
                    onChange={(e) => set('productId', e.target.value)}
                  >
                    <option value="">Select…</option>
                    {products.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Mode" required hint="Rules use margin-based modes (no fixed price)">
              {(p) => (
                <Select
                  {...p}
                  value={form.mode}
                  onChange={(e) => set('mode', e.target.value as FormState['mode'])}
                >
                  <option value="PERCENT_MARKUP">Percentage markup on landed cost</option>
                  <option value="FIXED_MARGIN">Fixed margin (₹ over cost)</option>
                </Select>
              )}
            </Field>
            {form.mode === 'PERCENT_MARKUP' ? (
              <Field label="Markup %" required>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min="0"
                    max="1000"
                    step="0.01"
                    value={form.percentMarkup}
                    onChange={(e) => set('percentMarkup', e.target.value)}
                  />
                )}
              </Field>
            ) : (
              <Field label="Fixed margin (₹)" required>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.fixedMargin}
                    onChange={(e) => set('fixedMargin', e.target.value)}
                  />
                )}
              </Field>
            )}
            <Field
              label="Minimum profit floor (₹)"
              hint="Raises price if margin would fall below this"
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.minProfit}
                  onChange={(e) => set('minProfit', e.target.value)}
                />
              )}
            </Field>
            <Field label="Rounding rule">
              {(p) => (
                <Select
                  {...p}
                  value={form.roundingRule}
                  onChange={(e) => set('roundingRule', e.target.value)}
                >
                  <option value="NONE">No rounding</option>
                  <option value="ROUND_UP_10">Round up to ₹10</option>
                  <option value="NEAREST_9">Nearest ₹X9</option>
                  <option value="NEAREST_99">Nearest ₹X99</option>
                </Select>
              )}
            </Field>
            <Field label="Priority" hint="Higher wins among same-scope rules">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min="0"
                  max="1000"
                  value={form.priority}
                  onChange={(e) => set('priority', e.target.value)}
                />
              )}
            </Field>
          </div>
          <Checkbox
            label="Active"
            checked={form.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
          />
        </form>
      </Modal>
    </div>
  );
}
