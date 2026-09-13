'use client';

import { useState, type FormEvent, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Alert } from '@/components/ui/feedback';
import Link from 'next/link';

function ContactFormInner({
  defaultName,
  defaultEmail,
}: {
  defaultName: string;
  defaultEmail: string;
}) {
  const params = useSearchParams();
  const [form, setForm] = useState({
    name: defaultName,
    email: defaultEmail,
    subject: params.get('subject') ?? '',
    message: '',
  });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors((fe) => ({ ...fe, [k]: '' }));
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiFetch('/api/contact', {
        body: {
          name: form.name.trim(),
          email: form.email.trim(),
          subject: form.subject.trim() || undefined,
          message: form.message.trim(),
        },
      });
      setSent(true);
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
        setError('Could not send your message. Please try again or email us directly.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="card space-y-3 p-5 sm:p-6">
        <Alert tone="success" title="Message sent">
          Thank you for reaching out. Our team replies within 1 business day to{' '}
          <strong>{form.email.trim()}</strong>. For order-specific issues, include your order number
          (e.g. RX-260905-XXXXXX) to speed things up.
        </Alert>
        <p className="text-sm text-ink-400">
          <Link href="/faq" className="link-primary">
            Check the FAQ
          </Link>{' '}
          for instant answers to common questions.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-5 sm:p-6" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Your name" required error={fieldErrors.name}>
          {(p) => (
            <Input
              {...p}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              autoComplete="name"
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
      </div>
      <Field
        label="Subject"
        error={fieldErrors.subject}
        hint="Optional — e.g. order number or product name"
      >
        {(p) => (
          <Input
            {...p}
            value={form.subject}
            onChange={(e) => set('subject', e.target.value)}
            maxLength={120}
          />
        )}
      </Field>
      <Field label="Message" required error={fieldErrors.message} hint="Minimum 10 characters">
        {(p) => (
          <Textarea
            {...p}
            value={form.message}
            onChange={(e) => set('message', e.target.value)}
            maxLength={3000}
            rows={6}
            placeholder="How can we help?"
          />
        )}
      </Field>
      <Button type="submit" size="lg" loading={busy}>
        Send message
      </Button>
    </form>
  );
}

export function ContactForm({
  defaultName = '',
  defaultEmail = '',
}: {
  defaultName?: string;
  defaultEmail?: string;
}) {
  return (
    <Suspense fallback={<div className="card p-6 text-sm text-ink-400">Loading form…</div>}>
      <ContactFormInner defaultName={defaultName} defaultEmail={defaultEmail} />
    </Suspense>
  );
}
