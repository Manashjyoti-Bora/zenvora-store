'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Minimal toast system (no dependency): call `toast('Saved', 'success')`
 * from any client code; <Toaster/> renders the stack.
 */

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const EVENT = 'resellix-toast';

export function toast(message: string, tone: ToastTone = 'info'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ToastItem>(EVENT, { detail: { id: Date.now() + Math.random(), message, tone } })
  );
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const item = (e as CustomEvent<ToastItem>).detail;
      setItems((prev) => [...prev.slice(-3), item]);
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== item.id)), 4500);
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-6"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            // Toasts are one of the allowed glass surfaces: dark glass body with
            // a solid semantic rule so success/error remain readable (AA) and
            // distinguishable without relying on colour alone.
            'glass-dark motion-reveal pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-xl border-l-4 px-4 py-2.5 text-sm font-medium',
            t.tone === 'success' && 'border-l-sage-400',
            t.tone === 'error' && 'border-l-red-600',
            t.tone === 'info' && 'border-l-brand-400'
          )}
          role="status"
        >
          <span className="sr-only">
            {t.tone === 'success' ? 'Success: ' : t.tone === 'error' ? 'Error: ' : ''}
          </span>
          {t.message}
        </div>
      ))}
    </div>
  );
}
