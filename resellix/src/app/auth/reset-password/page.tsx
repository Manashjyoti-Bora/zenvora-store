import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/auth/password-reset-forms';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Set a new password',
  robots: { index: false },
};

export default function ResetPasswordPage() {
  return (
    <div className="container-store max-w-md py-10 sm:py-16">
      <header className="mb-6 text-center">
        <h1>Choose a new password</h1>
        <p className="mt-1 text-sm text-ink-400">
          For security, all your other sessions will be logged out.
        </p>
      </header>
      <ResetPasswordForm />
    </div>
  );
}
