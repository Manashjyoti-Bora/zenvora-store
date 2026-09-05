'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea, Checkbox } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { Alert } from '@/components/ui/feedback';
import { TableWrap, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  productCount: number;
}

const EMPTY = {
  name: '',
  slug: '',
  description: '',
  sortOrder: 0,
  isActive: true,
  seoTitle: '',
  seoDescription: '',
};

export function CategoryManager({ initial }: { initial: CategoryRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY });
    setError(null);
    setOpen(true);
  }
  function openEdit(c: CategoryRow) {
    setEditing(c);
    setForm({
      name: c.name,
      slug: c.slug,
      description: c.description ?? '',
      sortOrder: c.sortOrder,
      isActive: c.isActive,
      seoTitle: c.seoTitle ?? '',
      seoDescription: c.seoDescription ?? '',
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
      description: form.description.trim() || null,
      sortOrder: form.sortOrder,
      isActive: form.isActive,
      seoTitle: form.seoTitle.trim() || null,
      seoDescription: form.seoDescription.trim() || null,
    };
    try {
      if (editing) {
        await apiFetch(`/api/admin/categories/${editing.id}`, { method: 'PATCH', body });
        toast('Category updated', 'success');
      } else {
        await apiFetch('/api/admin/categories', { body });
        toast('Category created', 'success');
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: CategoryRow) {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/categories/${c.id}`, { method: 'DELETE' });
      toast('Category deleted', 'success');
      setDeleting(null);
      setRows((r) => r.filter((x) => x.id !== c.id));
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
        <Button onClick={openNew}>+ New category</Button>
      </div>

      <TableWrap>
        <table className="table-base">
          <thead className="bg-gray-50">
            <tr>
              <Th>Name</Th>
              <Th className="hidden sm:table-cell">Slug</Th>
              <Th>Products</Th>
              <Th className="hidden md:table-cell">Order</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <Td className="py-8 text-center text-gray-400">
                  No categories yet — create your first one.
                </Td>
              </tr>
            )}
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50/60">
                <Td>
                  <p className="font-medium text-gray-900">{c.name}</p>
                  {c.description && (
                    <p className="max-w-[240px] truncate text-[11px] text-gray-400">
                      {c.description}
                    </p>
                  )}
                </Td>
                <Td className="hidden font-mono text-xs text-gray-500 sm:table-cell">/{c.slug}</Td>
                <Td className="tabular-nums">{c.productCount}</Td>
                <Td className="hidden tabular-nums text-gray-500 md:table-cell">{c.sortOrder}</Td>
                <Td>
                  <Badge tone={c.isActive ? 'green' : 'gray'}>
                    {c.isActive ? 'Active' : 'Hidden'}
                  </Badge>
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
        title={editing ? `Edit: ${editing.name}` : 'New category'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button form="cat-form" type="submit" loading={busy}>
              {editing ? 'Save changes' : 'Create category'}
            </Button>
          </div>
        }
      >
        <form id="cat-form" onSubmit={save} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Name" required>
            {(p) => (
              <Input
                {...p}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={80}
              />
            )}
          </Field>
          <Field label="Slug" hint="Blank = auto-generated from name">
            {(p) => (
              <Input
                {...p}
                value={form.slug}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                  }))
                }
                maxLength={90}
                placeholder="auto"
              />
            )}
          </Field>
          <Field label="Description">
            {(p) => (
              <Textarea
                {...p}
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                maxLength={1000}
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Sort order" hint="Lower first">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  value={form.sortOrder}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sortOrder: parseInt(e.target.value, 10) || 0 }))
                  }
                />
              )}
            </Field>
            <div className="flex items-end pb-2">
              <Checkbox
                label="Active (visible in store)"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
            </div>
          </div>
          <Field label="SEO title" hint={`${form.seoTitle.length}/70`}>
            {(p) => (
              <Input
                {...p}
                value={form.seoTitle}
                onChange={(e) => setForm((f) => ({ ...f, seoTitle: e.target.value }))}
                maxLength={70}
              />
            )}
          </Field>
          <Field label="SEO description" hint={`${form.seoDescription.length}/160`}>
            {(p) => (
              <Textarea
                {...p}
                rows={2}
                value={form.seoDescription}
                onChange={(e) => setForm((f) => ({ ...f, seoDescription: e.target.value }))}
                maxLength={160}
              />
            )}
          </Field>
        </form>
      </Modal>

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={busy}>
              Keep
            </Button>
            <Button variant="danger" loading={busy} onClick={() => deleting && remove(deleting)}>
              Delete category
            </Button>
          </div>
        }
      >
        <p className="text-sm text-gray-600">
          {deleting && deleting.productCount > 0
            ? `This category has ${deleting.productCount} product(s). Deletion is blocked while products are assigned — move them to another category first, or just deactivate the category by editing it.`
            : 'This will permanently remove the category. This cannot be undone.'}
        </p>
      </Modal>
    </div>
  );
}
