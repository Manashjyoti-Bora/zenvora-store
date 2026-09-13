'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { Alert } from '@/components/ui/feedback';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: 'CUSTOMER' | 'STAFF' | 'ADMIN';
  status: 'ACTIVE' | 'DISABLED';
  isSelf: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export function UserRowActions({ user }: { user: UserRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: { role, status },
      });
      toast('User updated — sessions revoked if access changed', 'success');
      setOpen(false);
      router.refresh();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : 'Could not update user';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  const dirty = role !== user.role || status !== user.status;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
          setRole(user.role);
          setStatus(user.status);
          setError(null);
        }}
      >
        Edit access
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Edit access — ${user.name}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} loading={busy} disabled={!dirty}>
              Save changes
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          {user.isSelf && (
            <Alert tone="warning">
              This is your own account — you cannot demote or disable yourself (protection against
              accidental lockout).
            </Alert>
          )}
          <Field
            label="Role"
            hint="STAFF: operational access (orders, products). ADMIN: everything incl. settings, users, refunds."
          >
            {(p) => (
              <Select
                {...p}
                value={role}
                onChange={(e) => setRole(e.target.value as UserRow['role'])}
                disabled={user.isSelf}
              >
                <option value="CUSTOMER">CUSTOMER — storefront account only</option>
                <option value="STAFF">STAFF — admin panel (operations)</option>
                <option value="ADMIN">ADMIN — full control</option>
              </Select>
            )}
          </Field>
          <Field
            label="Account status"
            hint="Disabling revokes all sessions immediately and blocks login."
          >
            {(p) => (
              <Select
                {...p}
                value={status}
                onChange={(e) => setStatus(e.target.value as UserRow['status'])}
                disabled={user.isSelf}
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="DISABLED">DISABLED</option>
              </Select>
            )}
          </Field>
        </div>
      </Modal>
    </>
  );
}

export function CreateUserButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'STAFF' | 'ADMIN'>('STAFF');

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/admin/users', {
        body: { name: name.trim(), email: email.trim(), password, role },
      });
      toast(`${role} user created — share the credentials through a secure channel`, 'success');
      setOpen(false);
      setName('');
      setEmail('');
      setPassword('');
      setRole('STAFF');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(
          err.fieldError('password') ??
            err.fieldError('email') ??
            err.fieldError('name') ??
            err.message
        );
      } else {
        setError('Could not create user');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
      >
        + Add staff / admin
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create staff or admin user"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={create}
              loading={busy}
              disabled={!name.trim() || !email.trim() || password.length < 8}
            >
              Create user
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Alert tone="info">
            Passwords are hashed with bcrypt before storage. New users set their own session by
            logging in; no credentials are emailed or logged.
          </Alert>
          <Field label="Full name" required>
            {(p) => (
              <Input
                {...p}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                autoComplete="off"
              />
            )}
          </Field>
          <Field label="Email" required>
            {(p) => (
              <Input
                {...p}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={160}
                autoComplete="off"
              />
            )}
          </Field>
          <Field
            label="Temporary password"
            required
            hint="Min 8 chars — share via a secure channel, then have the user change it (forgot-password flow)"
          >
            {(p) => (
              <Input
                {...p}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={128}
                autoComplete="new-password"
              />
            )}
          </Field>
          <Field label="Role" required>
            {(p) => (
              <Select
                {...p}
                value={role}
                onChange={(e) => setRole(e.target.value as 'STAFF' | 'ADMIN')}
              >
                <option value="STAFF">STAFF — operations (orders, products, fulfilment)</option>
                <option value="ADMIN">ADMIN — full control incl. settings & users</option>
              </Select>
            )}
          </Field>
        </div>
      </Modal>
    </>
  );
}
