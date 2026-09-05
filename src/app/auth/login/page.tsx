import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/guards';
import { LoginForm } from '@/components/auth/login-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Log in',
  robots: { index: false },
};

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect('/account');

  return (
    <div className="container-store max-w-md py-10 sm:py-16">
      <header className="mb-6 text-center">
        <h1>Welcome back</h1>
        <p className="mt-1 text-sm text-gray-500">Log in to your account to continue.</p>
      </header>
      <LoginForm />
    </div>
  );
}
