import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/auth/password-reset-forms';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Forgot password',
  robots: { index: false },
};

export default function ForgotPasswordPage() {
  return (
    <div className="container-store max-w-md py-10 sm:py-16">
      <header className="mb-6 text-center">
        <h1>Reset your password</h1>
        <p className="mt-1 text-sm text-ink-400">
          Enter the email you registered with and we&apos;ll send a reset link.
        </p>
      </header>
      <ForgotPasswordForm />
    </div>
  );
}
