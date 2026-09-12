import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/guards';
import { RegisterForm } from '@/components/auth/register-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Create account',
  robots: { index: false },
};

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect('/account');

  return (
    <div className="container-store max-w-md py-10 sm:py-16">
      <header className="mb-6 text-center">
        <h1>Create your account</h1>
        <p className="mt-1 text-sm text-ink-400">
          Faster checkout, saved addresses and order tracking in one place.
        </p>
      </header>
      <RegisterForm />
    </div>
  );
}
