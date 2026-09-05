import Link from 'next/link';
import { LinkButton } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="container-store flex flex-col items-center py-20 text-center">
      <p className="text-6xl font-black text-brand-600" aria-hidden="true">
        404
      </p>
      <h1 className="mt-4">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-gray-500">
        The page you are looking for was moved, removed, or never existed. If you followed a link
        from an email, the address may have expired.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <LinkButton href="/">Go home</LinkButton>
        <LinkButton href="/shop" variant="outline">
          Browse products
        </LinkButton>
        <LinkButton href="/track" variant="ghost">
          Track an order
        </LinkButton>
      </div>
      <p className="mt-8 text-xs text-gray-400">
        Still stuck?{' '}
        <Link href="/contact" className="link-primary">
          Contact support
        </Link>
      </p>
    </div>
  );
}
