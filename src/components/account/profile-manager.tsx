'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/feedback';
import { Badge } from '@/components/ui/badge';

export function ProfileManager({
  initial,
  memberSince,
  role,
}: {
  initial: { name: string; email: string; phone: string };
  memberSince: string | null;
  role: string;
}) {
  const router = useRouter();

  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileBusy(true);
    setProfileErrors({});
    try {
      await apiFetch('/api/account/profile', {
        body: { name: name.trim(), phone: phone.trim() || null },
      });
      toast('Profile updated', 'success');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (Array.isArray(err.details)) {
          const map: Record<string, string> = {};
          for (const d of err.details as Array<{ path: string; message: string }>)
            map[d.path] = d.message;
          setProfileErrors(map);
        } else {
          setProfileErrors({ form: err.message });
        }
      } else {
        setProfileErrors({ form: 'Could not reach the server.' });
      }
    } finally {
      setProfileBusy(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (newPassword !== confirmPassword) {
      setPwError('New passwords do not match.');
      return;
    }
    setPwBusy(true);
    try {
      await apiFetch('/api/account/password', {
        method: 'PATCH',
        body: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast('Password changed — other sessions were logged out', 'success');
    } catch (err) {
      setPwError(err instanceof ApiClientError ? err.message : 'Could not change the password.');
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <form
        onSubmit={saveProfile}
        className="card space-y-4 p-5"
        noValidate
        aria-labelledby="personal-details"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="personal-details" className="text-base font-semibold text-ink-900">
            Personal details
          </h2>
          <Badge tone={role === 'CUSTOMER' ? 'neutral' : 'purple'}>{role}</Badge>
        </div>
        {profileErrors.form && <Alert tone="error">{profileErrors.form}</Alert>}
        <Field
          label="Email"
          hint="Email changes require support verification — contact us if needed."
        >
          {(p) => <Input {...p} type="email" value={initial.email} disabled readOnly />}
        </Field>
        <Field label="Full name" required error={profileErrors.name}>
          {(p) => (
            <Input
              {...p}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          )}
        </Field>
        <Field
          label="Mobile number"
          error={profileErrors.phone}
          hint="10-digit Indian mobile for delivery updates"
        >
          {(p) => (
            <Input
              {...p}
              type="tel"
              inputMode="numeric"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              autoComplete="tel"
            />
          )}
        </Field>
        {memberSince && (
          <p className="text-xs text-ink-400">
            Member since{' '}
            {new Intl.DateTimeFormat('en-IN', { dateStyle: 'long' }).format(new Date(memberSince))}
          </p>
        )}
        <Button type="submit" loading={profileBusy}>
          Save changes
        </Button>
      </form>

      <form
        onSubmit={changePassword}
        className="card h-fit space-y-4 p-5"
        noValidate
        aria-labelledby="change-password"
      >
        <h2 id="change-password" className="text-base font-semibold text-ink-900">
          Change password
        </h2>
        {pwError && <Alert tone="error">{pwError}</Alert>}
        <Alert tone="info">
          Changing your password logs out all other devices for security. You stay signed in here.
        </Alert>
        <Field label="Current password" required>
          {(p) => (
            <Input
              {...p}
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          )}
        </Field>
        <Field label="New password" required hint="Minimum 8 characters with a letter and a number">
          {(p) => (
            <Input
              {...p}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          )}
        </Field>
        <Field label="Confirm new password" required>
          {(p) => (
            <Input
              {...p}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          )}
        </Field>
        <Button type="submit" loading={pwBusy} disabled={!currentPassword || !newPassword}>
          Update password
        </Button>
      </form>
    </div>
  );
}
