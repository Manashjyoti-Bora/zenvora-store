'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea, Select, Checkbox } from '@/components/ui/form';
import { Alert } from '@/components/ui/feedback';
import { Modal } from '@/components/ui/modal';
import { Badge } from '@/components/ui/badge';
import { formatINR } from '@/lib/money';
import { Spinner } from '@/components/ui/button';

export interface ProductFormInitial {
  id?: string;
  name: string;
  slug: string;
  description: string;
  shortDescription: string;
  sku: string;
  brand: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  categoryId: string;
  supplierId: string;
  supplierSku: string;
  stockMode: 'SUPPLIER_SYNC' | 'LOCAL';
  supplierCost: string;
  supplierShippingCost: string;
  otherCost: string;
  pricingMode: 'FIXED_PRICE' | 'FIXED_MARGIN' | 'PERCENT_MARKUP';
  fixedPrice: string;
  fixedMargin: string;
  percentMarkup: string;
  minProfit: string;
  roundingRule: 'NONE' | 'ROUND_UP_10' | 'NEAREST_9' | 'NEAREST_99';
  compareAtPrice: string;
  taxRatePercent: string;
  weightGrams: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  seoTitle: string;
  seoDescription: string;
  stock: number;
  sellingPricePaise: number;
  images: Array<{ id?: string; url: string; alt: string }>;
  variants: Array<{
    id?: string;
    name: string;
    sku: string;
    size: string;
    color: string;
    supplierCost: string;
    sellingPrice: string;
    compareAtPrice: string;
    taxRatePercent: string;
    stock: number;
    isActive: boolean;
  }>;
}

interface Breakdown {
  totalCostPaise: number;
  sellingPricePaise: number;
  grossMarginPaise: number;
  effectiveMarginPercent: number;
  markupOnCostPercent: number | null;
  estimatedPaymentFeePaise: number;
  estimatedNetProfitPaise: number;
  taxComponentPaise: number;
  minProfitApplied: boolean;
  belowCost: boolean;
  warnings: string[];
}

const EMPTY: ProductFormInitial = {
  name: '',
  slug: '',
  description: '',
  shortDescription: '',
  sku: '',
  brand: '',
  status: 'DRAFT',
  categoryId: '',
  supplierId: '',
  supplierSku: '',
  stockMode: 'SUPPLIER_SYNC',
  supplierCost: '',
  supplierShippingCost: '',
  otherCost: '',
  pricingMode: 'PERCENT_MARKUP',
  fixedPrice: '',
  fixedMargin: '',
  percentMarkup: '30',
  minProfit: '',
  roundingRule: 'ROUND_UP_10',
  compareAtPrice: '',
  taxRatePercent: '0',
  weightGrams: '',
  lengthCm: '',
  widthCm: '',
  heightCm: '',
  seoTitle: '',
  seoDescription: '',
  stock: 0,
  sellingPricePaise: 0,
  images: [],
  variants: [],
};

const num = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function ProductForm({
  initial,
  categories,
  suppliers,
}: {
  initial?: ProductFormInitial;
  categories: Array<{ id: string; name: string }>;
  suppliers: Array<{ id: string; name: string; type: string }>;
}) {
  const router = useRouter();
  const editing = Boolean(initial?.id);
  const [form, setForm] = useState<ProductFormInitial>(initial ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Breakdown | null>(null);
  const [previewRule, setPreviewRule] = useState<{ name: string; scope: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [hardDelete, setHardDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof ProductFormInitial, v: string | number | boolean) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors((fe) => ({ ...fe, [k as string]: '' }));
  };

  // Debounced pricing-engine preview (same pipeline the server will apply).
  const previewKey = useMemo(
    () =>
      JSON.stringify({
        productId: form.id ?? null,
        supplierCost: num(form.supplierCost) ?? 0,
        supplierShippingCost: num(form.supplierShippingCost) ?? 0,
        otherCost: num(form.otherCost) ?? 0,
        pricingMode: form.pricingMode,
        fixedPrice: num(form.fixedPrice),
        fixedMargin: num(form.fixedMargin),
        percentMarkup: num(form.percentMarkup),
        minProfit: num(form.minProfit),
        roundingRule: form.roundingRule,
        taxRatePercent: num(form.taxRatePercent) ?? 0,
        categoryId: form.categoryId || null,
        supplierId: form.supplierId || null,
      }),
    [form]
  );

  useEffect(() => {
    const t = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const result = await apiFetch<{
          breakdown: Breakdown;
          appliedRule: { name: string; scope: string } | null;
        }>('/api/admin/pricing-preview', { body: JSON.parse(previewKey) });
        setPreview(result.breakdown);
        setPreviewRule(result.appliedRule);
      } catch {
        setPreview(null);
        setPreviewRule(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [previewKey]);

  function setVariant(i: number, patch: Partial<ProductFormInitial['variants'][number]>) {
    setForm((f) => ({
      ...f,
      variants: f.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)),
    }));
  }
  function addVariant() {
    setForm((f) => ({
      ...f,
      variants: [
        ...f.variants,
        {
          name: '',
          sku: '',
          size: '',
          color: '',
          supplierCost: '',
          sellingPrice: '',
          compareAtPrice: '',
          taxRatePercent: '',
          stock: 0,
          isActive: true,
        },
      ],
    }));
  }
  function removeVariant(i: number) {
    setForm((f) => ({ ...f, variants: f.variants.filter((_, j) => j !== i) }));
  }

  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const csrf = document.cookie.match(/(?:^|; )resellix_csrf=([^;]*)/)?.[1];
      const res = await fetch('/api/admin/uploads', {
        method: 'POST',
        headers: csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : undefined,
        body: fd,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok)
        throw new ApiClientError(
          res.status,
          json?.error?.message ?? 'Upload failed',
          json?.error?.details
        );
      const url = (json?.data?.url ?? json?.url) as string;
      setForm((f) => ({ ...f, images: [...f.images, { url, alt: '' }] }));
      toast('Image uploaded', 'success');
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const payload = {
      ...(form.id ? { id: form.id } : {}),
      name: form.name.trim(),
      slug: form.slug.trim(),
      description: form.description.trim(),
      shortDescription: form.shortDescription.trim() || null,
      sku: form.sku.trim() || null,
      brand: form.brand.trim() || null,
      status: form.status,
      categoryId: form.categoryId || null,
      supplierId: form.supplierId || null,
      supplierSku: form.supplierSku.trim() || null,
      stockMode: form.stockMode,
      supplierCost: num(form.supplierCost) ?? 0,
      supplierShippingCost: num(form.supplierShippingCost) ?? 0,
      otherCost: num(form.otherCost) ?? 0,
      pricingMode: form.pricingMode,
      fixedPrice: num(form.fixedPrice),
      fixedMargin: num(form.fixedMargin),
      percentMarkup: num(form.percentMarkup),
      minProfit: num(form.minProfit),
      roundingRule: form.roundingRule,
      compareAtPrice: num(form.compareAtPrice),
      taxRatePercent: num(form.taxRatePercent) ?? 0,
      weightGrams: num(form.weightGrams),
      lengthCm: num(form.lengthCm),
      widthCm: num(form.widthCm),
      heightCm: num(form.heightCm),
      seoTitle: form.seoTitle.trim() || null,
      seoDescription: form.seoDescription.trim() || null,
      images: form.images.map((img, i) => ({
        ...(img.id ? { id: img.id } : {}),
        url: img.url,
        alt: img.alt || '',
        position: i,
        isPrimary: i === 0,
      })),
      variants: form.variants.map((v, i) => ({
        ...(v.id ? { id: v.id } : {}),
        name: v.name.trim(),
        sku: v.sku.trim() || null,
        size: v.size.trim() || null,
        color: v.color.trim() || null,
        supplierCost: num(v.supplierCost),
        sellingPrice: num(v.sellingPrice),
        compareAtPrice: num(v.compareAtPrice),
        taxRatePercent: num(v.taxRatePercent),
        stock: v.stock,
        isActive: v.isActive,
        sortOrder: i,
      })),
    };

    try {
      if (editing) {
        await apiFetch(`/api/admin/products/${form.id}`, { method: 'PATCH', body: payload });
        toast('Product updated', 'success');
      } else {
        await apiFetch('/api/admin/products', { body: payload });
        toast('Product created', 'success');
      }
      router.push('/admin/products');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (Array.isArray(err.details)) {
          const map: Record<string, string> = {};
          for (const d of err.details as Array<{ path: string; message: string }>) {
            map[d.path.replace(/^variants\.\d+\./, '').replace(/^images\.\d+\./, '')] = d.message;
          }
          setFieldErrors(map);
        }
        setError(err.message);
      } else {
        setError('Could not reach the server.');
      }
      setBusy(false);
    }
  }

  async function onDelete() {
    setDeleting(true);
    try {
      await apiFetch(`/api/admin/products/${form.id}?hard=${hardDelete ? '1' : '0'}`, {
        method: 'DELETE',
      });
      toast(hardDelete ? 'Product permanently deleted' : 'Product archived', 'success');
      router.push('/admin/products');
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {error && (
        <Alert tone="error" title="Could not save product">
          {error}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {/* Basics */}
          <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="sec-basics">
            <h2 id="sec-basics" className="text-base font-semibold text-gray-900">
              Basics
            </h2>
            <Field label="Product name" required error={fieldErrors.name}>
              {(p) => (
                <Input
                  {...p}
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  maxLength={200}
                />
              )}
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="URL slug" hint="Leave blank to auto-generate from the name">
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
              <Field label="Status" hint="Only ACTIVE products are visible in the store">
                {(p) => (
                  <Select
                    {...p}
                    value={form.status}
                    onChange={(e) => set('status', e.target.value)}
                  >
                    <option value="DRAFT">Draft (hidden)</option>
                    <option value="ACTIVE">Active (live)</option>
                    <option value="ARCHIVED">Archived (hidden, kept for history)</option>
                  </Select>
                )}
              </Field>
              <Field label="Brand">
                {(p) => (
                  <Input
                    {...p}
                    value={form.brand}
                    onChange={(e) => set('brand', e.target.value)}
                    maxLength={80}
                  />
                )}
              </Field>
              <Field label="SKU" error={fieldErrors.sku}>
                {(p) => (
                  <Input
                    {...p}
                    value={form.sku}
                    onChange={(e) => set('sku', e.target.value)}
                    maxLength={64}
                  />
                )}
              </Field>
              <Field label="Category">
                {(p) => (
                  <Select
                    {...p}
                    value={form.categoryId}
                    onChange={(e) => set('categoryId', e.target.value)}
                  >
                    <option value="">— No category —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Short description" hint="One line shown in listings (max 500)">
                {(p) => (
                  <Input
                    {...p}
                    value={form.shortDescription}
                    onChange={(e) => set('shortDescription', e.target.value)}
                    maxLength={500}
                  />
                )}
              </Field>
            </div>
            <Field
              label="Full description"
              required
              error={fieldErrors.description}
              hint="Shown on the product page (min 10 characters)"
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={6}
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  maxLength={20000}
                />
              )}
            </Field>
          </section>

          {/* Cost & pricing */}
          <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="sec-pricing">
            <h2 id="sec-pricing" className="text-base font-semibold text-gray-900">
              Cost &amp; pricing
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field
                label="Supplier cost (₹)"
                required
                error={fieldErrors.supplierCost}
                hint="What you pay the supplier"
              >
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={form.supplierCost}
                    onChange={(e) => set('supplierCost', e.target.value)}
                  />
                )}
              </Field>
              <Field label="Supplier shipping (₹)" hint="Charged by supplier per unit">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={form.supplierShippingCost}
                    onChange={(e) => set('supplierShippingCost', e.target.value)}
                  />
                )}
              </Field>
              <Field label="Other cost (₹)" hint="Packaging, handling, etc.">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={form.otherCost}
                    onChange={(e) => set('otherCost', e.target.value)}
                  />
                )}
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Pricing mode"
                hint="Markup ≠ margin: markup is % over cost, margin is % of selling price"
              >
                {(p) => (
                  <Select
                    {...p}
                    value={form.pricingMode}
                    onChange={(e) => set('pricingMode', e.target.value)}
                  >
                    <option value="PERCENT_MARKUP">Percentage markup on landed cost</option>
                    <option value="FIXED_MARGIN">Fixed margin (₹ added to cost)</option>
                    <option value="FIXED_PRICE">Fixed selling price (₹)</option>
                  </Select>
                )}
              </Field>
              <Field label="Rounding rule" hint="Applied to the computed price">
                {(p) => (
                  <Select
                    {...p}
                    value={form.roundingRule}
                    onChange={(e) => set('roundingRule', e.target.value)}
                  >
                    <option value="NONE">No rounding (exact)</option>
                    <option value="ROUND_UP_10">Round up to next ₹10</option>
                    <option value="NEAREST_9">Nearest ₹X9 (e.g. 499)</option>
                    <option value="NEAREST_99">Nearest ₹X99 (e.g. 499, 999)</option>
                  </Select>
                )}
              </Field>
              {form.pricingMode === 'PERCENT_MARKUP' && (
                <Field label="Markup %" required error={fieldErrors.percentMarkup}>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min="0"
                      max="1000"
                      step="0.01"
                      inputMode="decimal"
                      value={form.percentMarkup}
                      onChange={(e) => set('percentMarkup', e.target.value)}
                    />
                  )}
                </Field>
              )}
              {form.pricingMode === 'FIXED_MARGIN' && (
                <Field label="Fixed margin (₹)" required error={fieldErrors.fixedMargin}>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={form.fixedMargin}
                      onChange={(e) => set('fixedMargin', e.target.value)}
                    />
                  )}
                </Field>
              )}
              {form.pricingMode === 'FIXED_PRICE' && (
                <Field label="Fixed selling price (₹)" required error={fieldErrors.fixedPrice}>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={form.fixedPrice}
                      onChange={(e) => set('fixedPrice', e.target.value)}
                    />
                  )}
                </Field>
              )}
              <Field
                label="Minimum profit (₹)"
                hint="Price floor: raised automatically if margin would fall below this"
              >
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={form.minProfit}
                    onChange={(e) => set('minProfit', e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Compare-at price (₹)"
                hint="Optional strike-through price — must be genuinely higher"
                error={fieldErrors.compareAtPrice}
              >
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={form.compareAtPrice}
                    onChange={(e) => set('compareAtPrice', e.target.value)}
                  />
                )}
              </Field>
              <Field label="GST rate %" hint="Included in the selling price (tax-inclusive model)">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min="0"
                    max="40"
                    step="0.01"
                    inputMode="decimal"
                    value={form.taxRatePercent}
                    onChange={(e) => set('taxRatePercent', e.target.value)}
                  />
                )}
              </Field>
            </div>
          </section>

          {/* Supplier & stock */}
          <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="sec-supply">
            <h2 id="sec-supply" className="text-base font-semibold text-gray-900">
              Supplier &amp; stock
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Supplier" hint="Fulfilment source for automated ordering">
                {(p) => (
                  <Select
                    {...p}
                    value={form.supplierId}
                    onChange={(e) => set('supplierId', e.target.value)}
                  >
                    <option value="">— None (manual fulfilment) —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.type})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Supplier SKU">
                {(p) => (
                  <Input
                    {...p}
                    value={form.supplierSku}
                    onChange={(e) => set('supplierSku', e.target.value)}
                    maxLength={120}
                  />
                )}
              </Field>
              <Field
                label="Stock mode"
                hint="SUPPLIER_SYNC: stock follows supplier feeds/orders. LOCAL: you manage stock yourself."
              >
                {(p) => (
                  <Select
                    {...p}
                    value={form.stockMode}
                    onChange={(e) => set('stockMode', e.target.value)}
                  >
                    <option value="SUPPLIER_SYNC">Supplier-synced</option>
                    <option value="LOCAL">Locally managed</option>
                  </Select>
                )}
              </Field>
            </div>
            {form.variants.length === 0 && (
              <Field
                label="Stock quantity"
                hint={
                  form.stockMode === 'SUPPLIER_SYNC'
                    ? 'Kept in sync automatically when supplier stock updates arrive'
                    : 'Managed by you (Inventory page)'
                }
              >
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={form.stock}
                    onChange={(e) => set('stock', parseInt(e.target.value, 10) || 0)}
                  />
                )}
              </Field>
            )}
          </section>

          {/* Variants */}
          <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="sec-variants">
            <div className="flex items-center justify-between gap-3">
              <h2 id="sec-variants" className="text-base font-semibold text-gray-900">
                Variants ({form.variants.length})
              </h2>
              <Button type="button" variant="outline" size="sm" onClick={addVariant}>
                + Add variant
              </Button>
            </div>
            {form.variants.length === 0 ? (
              <p className="text-sm text-gray-500">
                No variants — this product sells as a single option. Add variants for sizes/colours;
                each can override cost, price, tax and stock.
              </p>
            ) : (
              <ul className="space-y-3">
                {form.variants.map((v, i) => (
                  <li key={v.id ?? i} className="rounded-xl border border-gray-200 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
                        Variant {i + 1}
                      </p>
                      <div className="flex items-center gap-3">
                        <Checkbox
                          label="Active"
                          checked={v.isActive}
                          onChange={(e) => setVariant(i, { isActive: e.target.checked })}
                        />
                        <button
                          type="button"
                          onClick={() => removeVariant(i)}
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Field label="Name" required>
                        {(p) => (
                          <Input
                            {...p}
                            value={v.name}
                            onChange={(e) => setVariant(i, { name: e.target.value })}
                            placeholder="e.g. Red / M"
                            maxLength={80}
                          />
                        )}
                      </Field>
                      <Field label="SKU">
                        {(p) => (
                          <Input
                            {...p}
                            value={v.sku}
                            onChange={(e) => setVariant(i, { sku: e.target.value })}
                            maxLength={64}
                          />
                        )}
                      </Field>
                      <Field label="Stock" required>
                        {(p) => (
                          <Input
                            {...p}
                            type="number"
                            min="0"
                            inputMode="numeric"
                            value={v.stock}
                            onChange={(e) =>
                              setVariant(i, { stock: parseInt(e.target.value, 10) || 0 })
                            }
                          />
                        )}
                      </Field>
                      <Field label="Supplier cost (₹)" hint="Blank = use product cost">
                        {(p) => (
                          <Input
                            {...p}
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={v.supplierCost}
                            onChange={(e) => setVariant(i, { supplierCost: e.target.value })}
                          />
                        )}
                      </Field>
                      <Field label="Selling price (₹)" hint="Blank = pricing engine decides">
                        {(p) => (
                          <Input
                            {...p}
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={v.sellingPrice}
                            onChange={(e) => setVariant(i, { sellingPrice: e.target.value })}
                          />
                        )}
                      </Field>
                      <Field label="Compare-at (₹)">
                        {(p) => (
                          <Input
                            {...p}
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={v.compareAtPrice}
                            onChange={(e) => setVariant(i, { compareAtPrice: e.target.value })}
                          />
                        )}
                      </Field>
                      <Field label="Size">
                        {(p) => (
                          <Input
                            {...p}
                            value={v.size}
                            onChange={(e) => setVariant(i, { size: e.target.value })}
                            maxLength={40}
                          />
                        )}
                      </Field>
                      <Field label="Colour">
                        {(p) => (
                          <Input
                            {...p}
                            value={v.color}
                            onChange={(e) => setVariant(i, { color: e.target.value })}
                            maxLength={40}
                          />
                        )}
                      </Field>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Images */}
          <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="sec-images">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="sec-images" className="text-base font-semibold text-gray-900">
                Images ({form.images.length}/12)
              </h2>
              <div className="flex gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                  className="hidden"
                  aria-label="Upload product image"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadImage(f);
                    e.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  loading={uploading}
                  disabled={form.images.length >= 12}
                >
                  Upload image
                </Button>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Uploaded files are stored on this server&apos;s disk. On serverless hosts (for
              example Vercel) the disk is ephemeral: uploads can disappear on the next deploy. For
              permanent production images, prefer an external image URL (CDN/object storage) or
              re-upload after deploys — see SETUP_CHECKLIST.md.
            </p>
            {form.images.length === 0 ? (
              <p className="text-sm text-gray-500">
                No images yet. Upload (JPEG/PNG/WEBP/GIF/AVIF, max 5 MB) or paste a URL below. The
                first image is the primary one.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {form.images.map((img, i) => (
                  <li
                    key={img.url + i}
                    className="space-y-1.5 rounded-lg border border-gray-200 p-2"
                  >
                    <div className="relative aspect-square overflow-hidden rounded bg-gray-100">
                      {img.url && (
                        <Image
                          src={img.url}
                          alt={img.alt || `Product image ${i + 1}`}
                          fill
                          sizes="150px"
                          className="object-cover"
                          unoptimized={!img.url.startsWith('/')}
                        />
                      )}
                      {i === 0 && (
                        <span className="absolute left-1 top-1">
                          <Badge tone="green">Primary</Badge>
                        </span>
                      )}
                    </div>
                    <Input
                      value={img.alt}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          images: f.images.map((x, j) =>
                            j === i ? { ...x, alt: e.target.value } : x
                          ),
                        }))
                      }
                      placeholder="Alt text (accessibility)"
                      maxLength={200}
                      aria-label={`Alt text for image ${i + 1}`}
                      className="text-xs"
                    />
                    <div className="flex items-center justify-between gap-1 text-xs">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          aria-label={`Move image ${i + 1} earlier`}
                          disabled={i === 0}
                          className="rounded px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                          onClick={() =>
                            setForm((f) => {
                              const arr = [...f.images];
                              [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                              return { ...f, images: arr };
                            })
                          }
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Move image ${i + 1} later`}
                          disabled={i === form.images.length - 1}
                          className="rounded px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                          onClick={() =>
                            setForm((f) => {
                              const arr = [...f.images];
                              [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
                              return { ...f, images: arr };
                            })
                          }
                        >
                          ↓
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((f) => ({ ...f, images: f.images.filter((_, j) => j !== i) }))
                        }
                        className="font-medium text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-gray-600">
                Add image by URL
              </summary>
              <UrlImageAdd
                onAdd={(url) => setForm((f) => ({ ...f, images: [...f.images, { url, alt: '' }] }))}
                disabled={form.images.length >= 12}
              />
            </details>
          </section>

          {/* SEO & shipping dims */}
          <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="sec-seo">
            <h2 id="sec-seo" className="text-base font-semibold text-gray-900">
              SEO &amp; logistics
            </h2>
            <Field
              label="SEO title"
              hint={`${form.seoTitle.length}/70 — blank uses the product name`}
            >
              {(p) => (
                <Input
                  {...p}
                  value={form.seoTitle}
                  onChange={(e) => set('seoTitle', e.target.value)}
                  maxLength={70}
                />
              )}
            </Field>
            <Field
              label="SEO description"
              hint={`${form.seoDescription.length}/160 — shown in search results`}
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  value={form.seoDescription}
                  onChange={(e) => set('seoDescription', e.target.value)}
                  maxLength={160}
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Weight (g)">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={form.weightGrams}
                    onChange={(e) => set('weightGrams', e.target.value)}
                  />
                )}
              </Field>
              <Field label="Length (cm)">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={form.lengthCm}
                    onChange={(e) => set('lengthCm', e.target.value)}
                  />
                )}
              </Field>
              <Field label="Width (cm)">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={form.widthCm}
                    onChange={(e) => set('widthCm', e.target.value)}
                  />
                )}
              </Field>
              <Field label="Height (cm)">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={form.heightCm}
                    onChange={(e) => set('heightCm', e.target.value)}
                  />
                )}
              </Field>
            </div>
          </section>
        </div>

        {/* Sticky preview + actions */}
        <aside className="space-y-4 xl:sticky xl:top-4 xl:h-fit">
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-gray-900">Pricing engine preview</h2>
            {previewLoading && !preview ? (
              <p className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                <Spinner className="h-3.5 w-3.5" /> Calculating…
              </p>
            ) : preview ? (
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">Landed cost</dt>
                  <dd className="font-medium tabular-nums">{formatINR(preview.totalCostPaise)}</dd>
                </div>
                <div className="flex justify-between gap-2 rounded-lg bg-brand-50 px-2 py-1.5">
                  <dt className="font-semibold text-brand-900">Selling price</dt>
                  <dd className="font-bold tabular-nums text-brand-900">
                    {formatINR(preview.sellingPricePaise)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">Gross margin</dt>
                  <dd className="tabular-nums">
                    {formatINR(preview.grossMarginPaise)} (
                    {preview.effectiveMarginPercent.toFixed(1)}%)
                    {preview.markupOnCostPercent != null && (
                      <span className="block text-[11px] text-gray-400">
                        markup on cost: {preview.markupOnCostPercent.toFixed(1)}%
                      </span>
                    )}
                  </dd>
                </div>
                {preview.taxComponentPaise > 0 && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-500">GST component (incl.)</dt>
                    <dd className="tabular-nums">{formatINR(preview.taxComponentPaise)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">Est. gateway fee</dt>
                  <dd className="tabular-nums">−{formatINR(preview.estimatedPaymentFeePaise)}</dd>
                </div>
                <div className="flex justify-between gap-2 border-t border-gray-100 pt-1.5">
                  <dt className="font-medium text-gray-700">Est. net profit</dt>
                  <dd
                    className={`font-bold tabular-nums ${preview.estimatedNetProfitPaise >= 0 ? 'text-emerald-700' : 'text-red-700'}`}
                  >
                    {formatINR(preview.estimatedNetProfitPaise)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-xs text-gray-400">
                Enter cost fields to see the computed price.
              </p>
            )}
            {previewRule && (
              <p className="mt-2 rounded bg-purple-50 px-2 py-1 text-[11px] text-purple-700">
                Pricing rule applied: <strong>{previewRule.name}</strong> (
                {previewRule.scope.toLowerCase()} scope) — it overrides the mode/margin fields
                above.
              </p>
            )}
            {preview && preview.minProfitApplied && (
              <p className="mt-2 text-[11px] text-amber-700">
                ⚠ Minimum profit floor raised the price.
              </p>
            )}
            {preview?.belowCost && (
              <p className="mt-2 text-[11px] font-semibold text-red-700">
                ⚠ Selling below landed cost!
              </p>
            )}
            {preview?.warnings.map((w) => (
              <p key={w} className="mt-1 text-[11px] text-amber-700">
                ⚠ {w}
              </p>
            ))}
            <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
              Net profit here is an <em>estimate</em> (settings-based gateway fee). Actual profit is
              recorded per order from real fees, shipping and refunds.
            </p>
          </div>

          <div className="card space-y-3 p-4">
            <Button type="submit" size="lg" className="w-full" loading={busy}>
              {editing ? 'Save changes' : 'Create product'}
            </Button>
            {editing && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => window.open(`/products/${form.slug || ''}`, '_blank')}
                >
                  View in store ↗
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="w-full"
                  onClick={() => setDeleteOpen(true)}
                >
                  Delete / archive…
                </Button>
                {initial && (
                  <p className="text-center text-xs text-gray-400">
                    Current live price:{' '}
                    <span className="font-semibold tabular-nums">
                      {formatINR(initial.sellingPricePaise)}
                    </span>
                  </p>
                )}
              </>
            )}
          </div>
        </aside>
      </div>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this product?"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={onDelete} loading={deleting}>
              {hardDelete ? 'Permanently delete' : 'Archive product'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-gray-600">
          <p>
            <strong>Archive (recommended):</strong> hides the product from the store but keeps it —
            and all order history that references it — intact.
          </p>
          <Checkbox
            label="Permanently delete instead (only possible if no orders reference this product)"
            checked={hardDelete}
            onChange={(e) => setHardDelete(e.target.checked)}
          />
          {hardDelete && (
            <Alert tone="warning">
              Hard deletion is blocked by the server if the product appears in any order, keeping
              your financial history consistent.
            </Alert>
          )}
        </div>
      </Modal>
    </form>
  );
}

function UrlImageAdd({ onAdd, disabled }: { onAdd: (url: string) => void; disabled: boolean }) {
  const [url, setUrl] = useState('');
  return (
    <div className="mt-2 flex gap-2">
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://… or /uploads/…"
        aria-label="Image URL"
        type="url"
      />
      <Button
        type="button"
        variant="outline"
        disabled={disabled || !url.trim()}
        onClick={() => {
          onAdd(url.trim());
          setUrl('');
        }}
      >
        Add
      </Button>
    </div>
  );
}
