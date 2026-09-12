'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Select, Checkbox } from '@/components/ui/form';

/**
 * Sort + availability controls for listing pages. Updates the URL (GET
 * params) so filtered views are shareable, bookmarkable and server-rendered.
 */
export function ListingControls() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value == null || value === '') next.delete(key);
    else next.set(key, value);
    next.delete('page'); // changing filters resets pagination
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-2 text-sm text-ink-500">
        <span className="whitespace-nowrap font-medium">Sort by</span>
        <Select
          value={params.get('sort') ?? 'featured'}
          onChange={(e) => update('sort', e.target.value)}
          className="w-auto py-1.5"
          aria-label="Sort products"
        >
          <option value="featured">Featured</option>
          <option value="newest">Newest first</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
          <option value="popular">Most viewed</option>
        </Select>
      </label>
      <Checkbox
        label="In stock only"
        checked={params.get('stock') === '1'}
        onChange={(e) => update('stock', e.target.checked ? '1' : null)}
      />
    </div>
  );
}
