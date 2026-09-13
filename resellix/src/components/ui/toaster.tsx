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
            'pointer-events-auto w-full max-w-sm animate-fade-in rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg',
            t.tone === 'success' && 'bg-emerald-600',
            t.tone === 'error' && 'bg-red-600',
            t.tone === 'info' && 'bg-ink-900'
          )}
          role="status"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
