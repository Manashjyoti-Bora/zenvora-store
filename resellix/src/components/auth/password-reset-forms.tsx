'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent, Suspense } from 'react';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/feedback';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/auth/forgot-password', { body: { email: email.trim() } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="card space-y-3 p-5 sm:p-6">
        <Alert tone="success" title="Check your inbox">
          If an account exists for <strong>{email.trim()}</strong>, a password-reset link is on its
          way. The link expires in 60 minutes. (We always show this message to protect account
          privacy.)
        </Alert>
        <p className="text-sm text-ink-400">
          Remembered your password?{' '}
          <Link href="/auth/login" className="link-primary">
            Log in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-5 sm:p-6" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Email address" required hint="We'll send a secure, one-time reset link.">
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
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        Send reset link
      </Button>
      <p className="text-center text-sm text-ink-400">
        <Link href="/auth/login" className="link-primary">
          ← Back to log in
        </Link>
      </p>
    </form>
  );
}

function ResetPasswordFormInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <div className="card p-5 sm:p-6">
        <Alert tone="error" title="Missing reset token">
          This reset link is incomplete. Please request a new one from the{' '}
          <Link href="/auth/forgot-password" className="link-primary">
            forgot password page
          </Link>
          .
        </Alert>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/auth/reset-password', { body: { token, password } });
      setDone(true);
      setTimeout(() => router.push('/auth/login'), 2500);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Could not reset the password. The link may have expired.'
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card p-5 sm:p-6">
        <Alert tone="success" title="Password updated">
          All other sessions were logged out for security. Redirecting you to log in…
        </Alert>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-5 sm:p-6" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      <Field
        label="New password"
        required
        hint="Minimum 8 characters with at least one letter and one number"
      >
        {(p) => (
          <Input
            {...p}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            autoFocus
          />
        )}
      </Field>
      <Field label="Confirm new password" required>
        {(p) => (
          <Input
            {...p}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        )}
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        Set new password
      </Button>
    </form>
  );
}

export function ResetPasswordForm() {
  return (
    <Suspense fallback={<div className="card p-6 text-sm text-ink-400">Loading…</div>}>
      <ResetPasswordFormInner />
    </Suspense>
  );
}
