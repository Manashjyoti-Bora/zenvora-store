'use client';

import { useRecentlyViewed } from '@/hooks/use-recently-viewed';
import Link from 'next/link';
import Image from '@/components/ui/remote-image';

export function RecentlyViewedCarousel({ currentSlug }: { currentSlug?: string }) {
  const { viewed } = useRecentlyViewed();
  
  // Filter out the current product from the recently viewed list
  const displayItems = viewed.filter(item => item.slug !== currentSlug);

  if (displayItems.length === 0) return null;

  return (
    <div className="mt-16 sm:mt-24 border-t border-ink-900/5 pt-12 sm:pt-16">
      <div className="container-store">
        <h2 className="text-xl font-bold text-ink-900 mb-6 sm:text-2xl">Recently viewed</h2>
        <div className="-mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="snap-rail sm:grid sm:grid-cols-4 lg:grid-cols-6 sm:gap-4">
            {displayItems.map((item) => (
              <Link
                key={item.slug}
                href={`/products/${item.slug}`}
                className="group w-36 shrink-0 snap-start sm:w-auto"
              >
                <div className="relative aspect-square mb-3 overflow-hidden rounded-xl bg-ink-50">
                  {item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt={item.name}
                      fill
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                      sizes="(min-width: 640px) 16vw, 9rem"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-ink-300">
                      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                </div>
                <h3 className="truncate text-xs font-medium text-ink-900 group-hover:text-brand-700">
                  {item.name}
                </h3>
                <p className="mt-1 text-xs font-semibold text-ink-900">{item.price}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}