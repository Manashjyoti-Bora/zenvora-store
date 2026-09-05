'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent, Suspense } from 'react';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/feedback';

/** Only same-origin relative paths are accepted as redirect targets. */
export function safeNext(raw: string | null): string {
  if (!raw) return '/account';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/account';
  return raw;
}

function LoginFormInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiFetch('/api/auth/login', { body: { email: email.trim(), password } });
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
      <Field label="Email" required error={fieldErrors.email}>
        {(p) => (
          <Input
            {...p}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus
          />
        )}
      </Field>
      <Field label="Password" required error={fieldErrors.password}>
        {(p) => (
          <Input
            {...p}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        )}
      </Field>
      <div className="flex items-center justify-between gap-2 text-sm">
        <Link href="/auth/forgot-password" className="link-primary">
          Forgot password?
        </Link>
        <Link href={`/auth/register?next=${encodeURIComponent(next)}`} className="link-primary">
          Create an account
        </Link>
      </div>
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        Log in
      </Button>
    </form>
  );
}

export function LoginForm() {
  return (
    <Suspense fallback={<div className="card p-6 text-sm text-gray-400">Loading…</div>}>
      <LoginFormInner />
    </Suspense>
  );
}
