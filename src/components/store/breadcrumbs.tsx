import Link from 'next/link';

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-ink-400">
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true">/</span>}
            {c.href ? (
              <Link href={c.href} className="hover:text-brand-700 hover:underline">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-medium text-ink-700">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
