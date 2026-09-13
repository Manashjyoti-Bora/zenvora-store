import Link from 'next/link';
import { LinkButton } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="container-store relative flex flex-col items-center overflow-hidden py-20 text-center sm:py-28">
      {/* Oversized editorial numeral - pure decoration, sits behind the copy */}
      <svg
        viewBox="0 0 300 140"
        aria-hidden="true"
        className="pointer-events-none absolute -top-6 left-1/2 h-[10rem] w-auto -translate-x-1/2 select-none sm:h-[14rem]"
      >
        <text
          x="150"
          y="120"
          textAnchor="middle"
          className="fill-ink-900/[0.06] font-black tracking-tighter"
          style={{ fontSize: 130 }}
        >
          404
        </text>
      </svg>

      <p className="eyebrow relative mt-10 text-brand-700">Error 404</p>
      <h1 className="display relative mt-3 text-3xl text-ink-900 sm:text-4xl">Page not found</h1>
      <p className="relative mt-3 max-w-md text-sm leading-relaxed text-ink-500">
        The page you are looking for was moved, removed, or never existed. If you followed a link
        from an email, the address may have expired.
      </p>
      <div className="relative mt-8 flex flex-wrap justify-center gap-3">
        <LinkButton href="/" size="lg">
          Go home
        </LinkButton>
        <LinkButton href="/shop" variant="outline" size="lg">
          Browse products
        </LinkButton>
        <LinkButton href="/track" variant="ghost" size="lg">
          Track an order
        </LinkButton>
      </div>
      <p className="relative mt-10 text-xs text-ink-400">
        Still stuck?{' '}
        <Link href="/contact" className="link-primary">
          Contact support
        </Link>
      </p>
    </div>
  );
}
