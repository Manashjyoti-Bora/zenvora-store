'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Card, Alert } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import type { StoreSettings } from '@/lib/settings';

/** ₹ display strings for the paise-based settings; converted back on save. */
interface FormState {
  storeName: string;
  storeTagline: string;
  supportEmail: string;
  supportPhone: string;
  demoMode: boolean;
  announcementEnabled: boolean;
  announcementText: string;
  legalName: string;
  gstin: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  feePercent: string;
  feeFixed: string;
  flatRate: string;
  freeAbove: string;
  codEnabled: boolean;
  codFee: string;
  estimatedDaysMin: string;
  estimatedDaysMax: string;
  defaultGstPercent: string;
  pricesIncludeTax: boolean;
  invoicePrefix: string;
  returnWindowDays: string;
  cancellationWindowHours: string;
  instagram: string;
  facebook: string;
  youtube: string;
}

const paiseToRs = (p: number) => (p / 100).toFixed(2);
const rsToPaise = (v: string) => Math.max(0, Math.round((Number(v) || 0) * 100));

function toForm(s: StoreSettings): FormState {
  return {
    storeName: s.storeName,
    storeTagline: s.storeTagline,
    supportEmail: s.supportEmail,
    supportPhone: s.supportPhone,
    demoMode: s.demoMode,
    announcementEnabled: s.announcement?.enabled ?? false,
    announcementText: s.announcement?.text ?? '',
    legalName: s.business.legalName,
    gstin: s.business.gstin,
    addressLine: s.business.addressLine,
    city: s.business.city,
    state: s.business.state,
    postalCode: s.business.postalCode,
    feePercent: String(s.payments.feePercent),
    feeFixed: paiseToRs(s.payments.feeFixedPaise),
    flatRate: paiseToRs(s.shipping.flatRatePaise),
    freeAbove: paiseToRs(s.shipping.freeAbovePaise),
    codEnabled: s.shipping.codEnabled,
    codFee: paiseToRs(s.shipping.codFeePaise),
    estimatedDaysMin: String(s.shipping.estimatedDaysMin),
    estimatedDaysMax: String(s.shipping.estimatedDaysMax),
    defaultGstPercent: String(s.tax.defaultGstPercent),
    pricesIncludeTax: s.tax.pricesIncludeTax,
    invoicePrefix: s.tax.invoicePrefix,
    returnWindowDays: String(s.policies.returnWindowDays),
    cancellationWindowHours: String(s.policies.cancellationWindowHours),
    instagram: s.social.instagram,
    facebook: s.social.facebook,
    youtube: s.social.youtube,
  };
}

function toPatch(f: FormState) {
  return {
    storeName: f.storeName.trim(),
    storeTagline: f.storeTagline.trim(),
    supportEmail: f.supportEmail.trim(),
    supportPhone: f.supportPhone.trim(),
    demoMode: f.demoMode,
    announcement: f.announcementEnabled ? { enabled: true, text: f.announcementText.trim() } : null,
    business: {
      legalName: f.legalName.trim(),
      gstin: f.gstin.trim().toUpperCase(),
      addressLine: f.addressLine.trim(),
      city: f.city.trim(),
      state: f.state.trim(),
      postalCode: f.postalCode.trim(),
    },
    payments: { feePercent: Number(f.feePercent) || 0, feeFixedPaise: rsToPaise(f.feeFixed) },
    shipping: {
      flatRatePaise: rsToPaise(f.flatRate),
      freeAbovePaise: rsToPaise(f.freeAbove),
      codEnabled: f.codEnabled,
      codFeePaise: rsToPaise(f.codFee),
      estimatedDaysMin: parseInt(f.estimatedDaysMin, 10) || 0,
      estimatedDaysMax: parseInt(f.estimatedDaysMax, 10) || 0,
    },
    tax: {
      defaultGstPercent: Number(f.defaultGstPercent) || 0,
      pricesIncludeTax: f.pricesIncludeTax,
      invoicePrefix: f.invoicePrefix.trim() || 'INV',
    },
    policies: {
      returnWindowDays: parseInt(f.returnWindowDays, 10) || 0,
      cancellationWindowHours: parseInt(f.cancellationWindowHours, 10) || 0,
    },
    social: {
      instagram: f.instagram.trim(),
      facebook: f.facebook.trim(),
      youtube: f.youtube.trim(),
    },
  };
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 sm:col-span-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
      />
      <span>
        <span className="block text-sm font-medium text-gray-800">{label}</span>
        {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      </span>
    </label>
  );
}

export function SettingsForm({ initial }: { initial: StoreSettings }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (Number(form.estimatedDaysMin) > Number(form.estimatedDaysMax)) {
      toast('Estimated delivery days: min cannot exceed max', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/admin/settings', { method: 'PATCH', body: toPatch(form) });
      toast('Settings saved — live across the storefront (cache refreshes within 30s)', 'success');
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Could not save settings', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 pb-16">
      <Section
        title="Store identity"
        description="Shown in the header, footer, emails and invoices."
      >
        <Field label="Store name" required>
          {(p) => (
            <Input
              {...p}
              value={form.storeName}
              onChange={(e) => set('storeName', e.target.value)}
              maxLength={80}
            />
          )}
        </Field>
        <Field label="Tagline">
          {(p) => (
            <Input
              {...p}
              value={form.storeTagline}
              onChange={(e) => set('storeTagline', e.target.value)}
              maxLength={160}
            />
          )}
        </Field>
        <Field label="Support email" required>
          {(p) => (
            <Input
              {...p}
              type="email"
              value={form.supportEmail}
              onChange={(e) => set('supportEmail', e.target.value)}
              maxLength={160}
            />
          )}
        </Field>
        <Field label="Support phone">
          {(p) => (
            <Input
              {...p}
              value={form.supportPhone}
              onChange={(e) => set('supportPhone', e.target.value)}
              maxLength={32}
              placeholder="+91…"
            />
          )}
        </Field>
        <Toggle
          label="Demo mode"
          checked={form.demoMode}
          onChange={(v) => set('demoMode', v)}
          hint="Marks the TEST payment provider, demo supplier and seeded data with clear DEMO banners. Turn OFF only after real gateway credentials, a real supplier and production data are in place."
        />
        {form.announcementEnabled ? (
          <Field label="Announcement text" className="sm:col-span-2">
            {(p) => (
              <Input
                {...p}
                value={form.announcementText}
                onChange={(e) => set('announcementText', e.target.value)}
                maxLength={200}
                placeholder="e.g. Free shipping above ₹999 this week"
              />
            )}
          </Field>
        ) : null}
        <Toggle
          label="Show storefront announcement bar"
          checked={form.announcementEnabled}
          onChange={(v) => set('announcementEnabled', v)}
        />
      </Section>

      <Section
        title="Business details"
        description="Printed on invoices and shown on the About/policy pages."
      >
        <Alert tone="warning" className="sm:col-span-2">
          GSTIN, legal name and address are compliance-sensitive: enter your real registered details
          and have them reviewed by your accountant/CA. Placeholder values must not ship to
          production (see SETUP_CHECKLIST.md).
        </Alert>
        <Field label="Legal business name">
          {(p) => (
            <Input
              {...p}
              value={form.legalName}
              onChange={(e) => set('legalName', e.target.value)}
              maxLength={160}
            />
          )}
        </Field>
        <Field label="GSTIN" hint="15-character GST identification number (if registered)">
          {(p) => (
            <Input
              {...p}
              value={form.gstin}
              onChange={(e) => set('gstin', e.target.value)}
              maxLength={32}
              placeholder="22AAAAA0000A1Z5"
              className="font-mono uppercase"
            />
          )}
        </Field>
        <Field label="Address line" className="sm:col-span-2">
          {(p) => (
            <Input
              {...p}
              value={form.addressLine}
              onChange={(e) => set('addressLine', e.target.value)}
              maxLength={200}
            />
          )}
        </Field>
        <Field label="City">
          {(p) => (
            <Input
              {...p}
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
              maxLength={80}
            />
          )}
        </Field>
        <Field label="State">
          {(p) => (
            <Input
              {...p}
              value={form.state}
              onChange={(e) => set('state', e.target.value)}
              maxLength={80}
            />
          )}
        </Field>
        <Field label="Postal code">
          {(p) => (
            <Input
              {...p}
              value={form.postalCode}
              onChange={(e) => set('postalCode', e.target.value)}
              maxLength={16}
              inputMode="numeric"
            />
          )}
        </Field>
      </Section>

      <Section
        title="Payments"
        description="Estimated gateway fee used in profit forecasts. Real fees captured from Razorpay payloads override these per payment."
      >
        <Field
          label="Estimated fee %"
          hint="Razorpay standard plans are commonly around 2% — use your contracted rate"
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              min="0"
              max="15"
              step="0.01"
              value={form.feePercent}
              onChange={(e) => set('feePercent', e.target.value)}
            />
          )}
        </Field>
        <Field label="Estimated fixed fee (₹ per transaction)">
          {(p) => (
            <Input
              {...p}
              type="number"
              min="0"
              step="0.01"
              value={form.feeFixed}
              onChange={(e) => set('feeFixed', e.target.value)}
            />
          )}
        </Field>
      </Section>

      <Section title="Shipping & COD">
        <Field label="Flat shipping rate (₹)">
          {(p) => (
            <Input
              {...p}
              type="number"
              min="0"
              step="0.01"
              value={form.flatRate}
              onChange={(e) => set('flatRate', e.target.value)}
            />
          )}
        </Field>
        <Field label="Free shipping above (₹)" hint="0 = never free">
          {(p) => (
            <Input
              {...p}
              type="number"
              min="0"
              step="0.01"
              value={form.freeAbove}
              onChange={(e) => set('freeAbove', e.target.value)}
            />
          )}
        </Field>
        <Field label="Estimated delivery — min days">
          {(p) => (
            <Input
              {...p}
              type="number"
              min="0"
              max="60"
              step="1"
              value={form.estimatedDaysMin}
              onChange={(e) => set('estimatedDaysMin', e.target.value)}
            />
          )}
        </Field>
        <Field label="Estimated delivery — max days">
          {(p) => (
            <Input
              {...p}
              type="number"
              min="0"
              max="90"
              step="1"
              value={form.estimatedDaysMax}
              onChange={(e) => set('estimatedDaysMax', e.target.value)}
            />
          )}
        </Field>
        <Toggle
          label="Enable Cash on Delivery"
          checked={form.codEnabled}
          onChange={(v) => set('codEnabled', v)}
          hint="COD orders skip the gateway; profit is finalised when you mark COD collected after delivery."
        />
        <Field label="COD handling fee (₹)">
          {(p) => (
            <Input
              {...p}
              type="number"
              min="0"
              step="0.01"
              value={form.codFee}
              onChange={(e) => set('codFee', e.target.value)}
              disabled={!form.codEnabled}
            />
          )}
        </Field>
      </Section>

      <Section
        title="Tax & invoicing"
        description="GST handling — confirm rates and invoice format with your CA."
      >
        <Field label="Default GST %" hint="Applied to products without an explicit tax rate">
          {(p) => (
            <Input
              {...p}
              type="number"
              min="0"
              max="40"
              step="0.01"
              value={form.defaultGstPercent}
              onChange={(e) => set('defaultGstPercent', e.target.value)}
            />
          )}
        </Field>
        <Field label="Invoice prefix">
          {(p) => (
            <Input
              {...p}
              value={form.invoicePrefix}
              onChange={(e) => set('invoicePrefix', e.target.value)}
              maxLength={16}
              className="font-mono"
            />
          )}
        </Field>
        <Toggle
          label="Prices include tax"
          checked={form.pricesIncludeTax}
          onChange={(v) => set('pricesIncludeTax', v)}
          hint="When ON (recommended for Indian B2C), GST is extracted from the displayed price instead of added at checkout."
        />
      </Section>

      <Section
        title="Policies"
        description="Enforced by the customer self-service flows (cancel/return windows)."
      >
        <Field label="Return window (days)">
          {(p) => (
            <Input
              {...p}
              type="number"
              min="0"
              max="90"
              step="1"
              value={form.returnWindowDays}
              onChange={(e) => set('returnWindowDays', e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Cancellation window (hours)"
          hint="Self-service cancellation allowed while unshipped, within this window"
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              min="0"
              max="720"
              step="1"
              value={form.cancellationWindowHours}
              onChange={(e) => set('cancellationWindowHours', e.target.value)}
            />
          )}
        </Field>
      </Section>

      <Section title="Social links" description="Shown in the footer. Leave blank to hide.">
        <Field label="Instagram URL">
          {(p) => (
            <Input
              {...p}
              type="url"
              value={form.instagram}
              onChange={(e) => set('instagram', e.target.value)}
              maxLength={300}
              placeholder="https://instagram.com/…"
            />
          )}
        </Field>
        <Field label="Facebook URL">
          {(p) => (
            <Input
              {...p}
              type="url"
              value={form.facebook}
              onChange={(e) => set('facebook', e.target.value)}
              maxLength={300}
              placeholder="https://facebook.com/…"
            />
          )}
        </Field>
        <Field label="YouTube URL" className="sm:col-span-2">
          {(p) => (
            <Input
              {...p}
              type="url"
              value={form.youtube}
              onChange={(e) => set('youtube', e.target.value)}
              maxLength={300}
              placeholder="https://youtube.com/…"
            />
          )}
        </Field>
      </Section>

      <div className="sticky bottom-0 -mx-4 border-t border-gray-200 bg-white/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            Changes apply storefront-wide immediately (30s settings cache).
          </p>
          <Button onClick={save} loading={saving}>
            Save settings
          </Button>
        </div>
      </div>
    </div>
  );
}
