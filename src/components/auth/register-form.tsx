'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent, Suspense } from 'react';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/feedback';
import { safeNext } from './login-form';

function RegisterFormInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));

  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors((fe) => ({ ...fe, [k]: '' }));
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    if (form.password !== form.confirm) {
      setFieldErrors({ confirm: 'Passwords do not match' });
      return;
    }
    if (!consent) {
      setError('Please accept the Terms and Privacy Policy to create an account.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/auth/register', {
        body: {
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          password: form.password,
        },
      });
      router.push(next);
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
        setError('Could not reach the server. Please try again.');
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-5 sm:p-6" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Full name" required error={fieldErrors.name}>
        {(p) => (
          <Input
            {...p}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            autoComplete="name"
            autoFocus
          />
        )}
      </Field>
      <Field label="Email" required error={fieldErrors.email}>
        {(p) => (
          <Input
            {...p}
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            autoComplete="email"
          />
        )}
      </Field>
      <Field
        label="Mobile number"
        error={fieldErrors.phone}
        hint="Optional — for delivery updates (10-digit Indian mobile)"
      >
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
      <Field
        label="Password"
        required
        error={fieldErrors.password}
        hint="Minimum 8 characters with at least one letter and one number"
      >
        {(p) => (
          <Input
            {...p}
            type="password"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            autoComplete="new-password"
          />
        )}
      </Field>
      <Field label="Confirm password" required error={fieldErrors.confirm}>
        {(p) => (
          <Input
            {...p}
            type="password"
            value={form.confirm}
            onChange={(e) => set('confirm', e.target.value)}
            autoComplete="new-password"
          />
        )}
      </Field>
      <label className="flex items-start gap-2.5 text-sm text-gray-600">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          aria-describedby="consent-text"
        />
        <span id="consent-text">
          I agree to the{' '}
          <Link href="/policies/terms" target="_blank" className="link-primary">
            Terms &amp; Conditions
          </Link>{' '}
          and{' '}
          <Link href="/policies/privacy" target="_blank" className="link-primary">
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        Create account
      </Button>
      <p className="text-center text-sm text-gray-500">
        Already have an account?{' '}
        <Link href={`/auth/login?next=${encodeURIComponent(next)}`} className="link-primary">
          Log in
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm() {
  return (
    <Suspense fallback={<div className="card p-6 text-sm text-gray-400">Loading…</div>}>
      <RegisterFormInner />
    </Suspense>
  );
}
