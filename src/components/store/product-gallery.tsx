'use client';

import Image from 'next/image';
import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/modal';

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
  const [enlarged, setEnlarged] = useState(false);
  const current = images[active];

  const markLoaded = useCallback((url: string) => {
    setLoaded((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  }, []);

  const step = useCallback(
    (delta: 1 | -1) => {
      setActive((i) => (i + delta + images.length) % images.length);
    },
    [images.length]
  );

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
      {/* Main image is a real button: the zoom cursor promises an enlarged
          view, and clicking delivers it (accessible dialog, ESC/backdrop to
          close, focus trapped + restored by <Modal>). */}
      <button
        type="button"
        onClick={() => setEnlarged(true)}
        aria-label={`Enlarge product image: ${current.alt || name} (image ${active + 1} of ${images.length})`}
        className="relative block aspect-square w-full overflow-hidden rounded-xl bg-cream-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
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
        <span
          aria-hidden="true"
          className="absolute bottom-3 right-3 rounded-full bg-ink-950/70 px-2.5 py-1 text-[11px] font-semibold text-cream-50 backdrop-blur-sm"
        >
          Click to enlarge
        </span>
      </button>
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

      <Modal
        open={enlarged}
        onClose={() => setEnlarged(false)}
        title={`${name} — image ${active + 1} of ${images.length}`}
        wide
      >
        <div className="space-y-3 p-4 sm:p-5">
          <div className="relative aspect-square overflow-hidden rounded-xl bg-cream-100">
            <Image
              src={current.url}
              alt={current.alt || name}
              fill
              sizes="(max-width: 640px) 100vw, 672px"
              className="object-contain"
            />
          </div>
          {images.length > 1 && (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous image"
                className="btn-press rounded-lg border border-ink-900/15 bg-white px-3.5 py-2 text-sm font-medium text-ink-800 hover:bg-cream-50"
              >
                ← Previous
              </button>
              <p className="text-xs tabular-nums text-ink-400" aria-live="polite">
                {active + 1} of {images.length}
              </p>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next image"
                className="btn-press rounded-lg border border-ink-900/15 bg-white px-3.5 py-2 text-sm font-medium text-ink-800 hover:bg-cream-50"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
