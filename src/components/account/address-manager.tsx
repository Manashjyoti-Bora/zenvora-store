'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Field, Input, Checkbox } from '@/components/ui/form';
import { PhoneIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { Badge } from '@/components/ui/badge';
import { PinIcon } from '@/components/ui/icons';

export interface AddressData {
  id: string;
  label: string | null;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefaultShipping: boolean;
}

const EMPTY = {
  label: '',
  fullName: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'IN',
  isDefaultShipping: false,
};

export function AddressManager({ initial }: { initial: AddressData[] }) {
  const router = useRouter();
  const [addresses, setAddresses] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AddressData | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY });
    setError(null);
    setFieldErrors({});
    setModalOpen(true);
  }

  function openEdit(a: AddressData) {
    setEditing(a);
    setForm({
      label: a.label ?? '',
      fullName: a.fullName,
      phone: a.phone,
      line1: a.line1,
      line2: a.line2 ?? '',
      city: a.city,
      state: a.state,
      postalCode: a.postalCode,
      country: a.country,
      isDefaultShipping: a.isDefaultShipping,
    });
    setError(null);
    setFieldErrors({});
    setModalOpen(true);
  }

  const set = (k: keyof typeof form, v: string | boolean) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors((fe) => ({ ...fe, [k]: '' }));
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const body = {
        label: form.label.trim() || undefined,
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        line1: form.line1.trim(),
        line2: form.line2.trim() || undefined,
        city: form.city.trim(),
        state: form.state.trim(),
        postalCode: form.postalCode.trim(),
        country: form.country.trim() || 'IN',
        isDefaultShipping: form.isDefaultShipping,
      };
      if (editing) {
        const result = await apiFetch<{ address: AddressData }>(
          `/api/account/addresses/${editing.id}`,
          {
            method: 'PATCH',
            body,
          }
        );
        setAddresses((prev) =>
          prev
            .map((a) => (result.address.isDefaultShipping ? { ...a, isDefaultShipping: false } : a))
            .map((a) => (a.id === result.address.id ? result.address : a))
        );
        toast('Address updated', 'success');
      } else {
        const result = await apiFetch<{ address: AddressData }>('/api/account/addresses', { body });
        setAddresses((prev) =>
          result.address.isDefaultShipping
            ? [result.address, ...prev.map((a) => ({ ...a, isDefaultShipping: false }))]
            : [...prev, result.address]
        );
        toast('Address saved', 'success');
      }
      setModalOpen(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (Array.isArray(err.details)) {
          const map: Record<string, string> = {};
          for (const d of err.details as Array<{ path: string; message: string }>)
            map[d.path] = d.message;
          setFieldErrors(map);
        }
        setError(err.message);
      } else {
        setError('Could not reach the server.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(a: AddressData) {
    try {
      await apiFetch(`/api/account/addresses/${a.id}`, {
        method: 'PATCH',
        body: { isDefaultShipping: true },
      });
      setAddresses((prev) => prev.map((x) => ({ ...x, isDefaultShipping: x.id === a.id })));
      toast('Default address updated', 'success');
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Could not update default', 'error');
    }
  }

  async function remove(a: AddressData) {
    setDeletingId(a.id);
    try {
      await apiFetch(`/api/account/addresses/${a.id}`, { method: 'DELETE' });
      setAddresses((prev) => prev.filter((x) => x.id !== a.id));
      toast('Address deleted', 'success');
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Could not delete address', 'error');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew}>+ Add new address</Button>
      </div>

      {addresses.length === 0 ? (
        <EmptyState
          icon={<PinIcon className="h-6 w-6" />}
          title="No saved addresses"
          description="Add an address to speed up future checkouts."
          action={<Button onClick={openNew}>Add your first address</Button>}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {addresses.map((a) => (
            <li key={a.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">
                    {a.fullName}
                    {a.label && (
                      <span className="ml-2 rounded bg-cream-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-ink-400">
                        {a.label}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-400">
                    {a.line1}
                    {a.line2 && <>, {a.line2}</>}
                    <br />
                    {a.city}, {a.state} — {a.postalCode}
                    <br />
                    {a.country} ·{' '}
                    <PhoneIcon className="inline h-3.5 w-3.5 align-[-0.125em] text-ink-400" />{' '}
                    {a.phone}
                  </p>
                </div>
                {a.isDefaultShipping && <Badge tone="green">Default</Badge>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-900/5 pt-3 text-xs">
                <button
                  type="button"
                  onClick={() => openEdit(a)}
                  className="font-medium text-brand-700 hover:underline"
                >
                  Edit
                </button>
                {!a.isDefaultShipping && (
                  <button
                    type="button"
                    onClick={() => makeDefault(a)}
                    className="font-medium text-ink-500 hover:underline"
                  >
                    Make default
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(a)}
                  disabled={deletingId === a.id}
                  className="font-medium text-red-600 hover:underline disabled:opacity-50"
                >
                  {deletingId === a.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit address' : 'Add address'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button form="address-form" type="submit" loading={busy}>
              {editing ? 'Save changes' : 'Save address'}
            </Button>
          </div>
        }
      >
        <form id="address-form" onSubmit={save} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Label" hint="e.g. Home, Office">
              {(p) => (
                <Input
                  {...p}
                  value={form.label}
                  onChange={(e) => set('label', e.target.value)}
                  maxLength={40}
                />
              )}
            </Field>
            <Field label="Full name" required error={fieldErrors.fullName}>
              {(p) => (
                <Input
                  {...p}
                  value={form.fullName}
                  onChange={(e) => set('fullName', e.target.value)}
                  autoComplete="name"
                />
              )}
            </Field>
            <Field label="Phone" required error={fieldErrors.phone}>
              {(p) => (
                <Input
                  {...p}
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value.replace(/\D/g, ''))}
                  autoComplete="tel"
                />
              )}
            </Field>
            <Field label="PIN code" required error={fieldErrors.postalCode}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  maxLength={6}
                  value={form.postalCode}
                  onChange={(e) => set('postalCode', e.target.value.replace(/\D/g, ''))}
                  autoComplete="postal-code"
                />
              )}
            </Field>
            <Field
              label="Address line 1"
              required
              error={fieldErrors.line1}
              className="sm:col-span-2"
            >
              {(p) => (
                <Input
                  {...p}
                  value={form.line1}
                  onChange={(e) => set('line1', e.target.value)}
                  autoComplete="address-line1"
                />
              )}
            </Field>
            <Field label="Address line 2" error={fieldErrors.line2} className="sm:col-span-2">
              {(p) => (
                <Input
                  {...p}
                  value={form.line2}
                  onChange={(e) => set('line2', e.target.value)}
                  autoComplete="address-line2"
                />
              )}
            </Field>
            <Field label="City" required error={fieldErrors.city}>
              {(p) => (
                <Input
                  {...p}
                  value={form.city}
                  onChange={(e) => set('city', e.target.value)}
                  autoComplete="address-level2"
                />
              )}
            </Field>
            <Field label="State" required error={fieldErrors.state}>
              {(p) => (
                <Input
                  {...p}
                  value={form.state}
                  onChange={(e) => set('state', e.target.value)}
                  autoComplete="address-level1"
                />
              )}
            </Field>
            <Field label="Country" required error={fieldErrors.country}>
              {(p) => (
                <Input
                  {...p}
                  value={form.country}
                  onChange={(e) => set('country', e.target.value)}
                  autoComplete="country-name"
                />
              )}
            </Field>
            <div className="flex items-end pb-1">
              <Checkbox
                label="Set as default shipping address"
                checked={form.isDefaultShipping}
                onChange={(e) => set('isDefaultShipping', e.target.checked)}
              />
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
