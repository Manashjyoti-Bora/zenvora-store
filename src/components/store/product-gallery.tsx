'use client';

import Image from 'next/image';
import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

function BagGlyph({ className = 'h-16 w-16' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 8h13l-1 11.5a1.5 1.5 0 0 1-1.5 1.4H8a1.5 1.5 0 0 1-1.5-1.4L5.5 8Z" />
      <path strokeLinecap="round" d="M9 10V6.8a3 3 0 0 1 6 0V10" />
    </svg>
  );
}

export function ProductGallery({
  images,
  name,
}: {
  images: Array<{ url: string; alt: string | null }>;
  name: string;
}) {
  const [active, setActive] = useState(0);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const current = images[active];

  const markLoaded = useCallback((url: string) => {
    setLoaded((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  }, []);

  const onThumbKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setActive((i + 1) % images.length);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setActive((i - 1 + images.length) % images.length);
    }
  };

  if (images.length === 0) {
    return (
      <div
        className="flex aspect-square items-center justify-center rounded-xl border border-ink-900/10 bg-cream-100 text-cream-300"
        role="img"
        aria-label={`${name} - no image available`}
      >
        <BagGlyph />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-square overflow-hidden rounded-xl bg-cream-100">
        {!loaded[current.url] && <div className="skeleton absolute inset-0" aria-hidden="true" />}
        <Image
          key={current.url}
          src={current.url}
          alt={current.alt || name}
          fill
          sizes="(max-width: 1024px) 100vw, 50vw"
          className={cn(
            'zoom-hover animate-fade-in object-cover transition-opacity duration-300 ease-zenvora',
            loaded[current.url] ? 'opacity-100' : 'opacity-0'
          )}
          onLoad={() => markLoaded(current.url)}
          priority
        />
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Product images">
          {images.map((img, i) => (
            <button
              key={img.url + i}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`View image ${i + 1} of ${images.length}`}
              onClick={() => setActive(i)}
              onKeyDown={(e) => onThumbKey(e, i)}
              className={cn(
                'relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 bg-cream-100 transition-colors',
                i === active ? 'border-brand-600' : 'border-transparent hover:border-ink-900/20'
              )}
            >
              <Image
                src={img.url}
                alt=""
                fill
                sizes="64px"
                className={cn(
                  'object-cover transition-opacity duration-200',
                  loaded[img.url] ? 'opacity-100' : 'opacity-0'
                )}
                onLoad={() => markLoaded(img.url)}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
