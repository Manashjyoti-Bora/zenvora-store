'use client';

import { useState } from 'react';
import { useToast } from '@/components/ui/toaster';

export function ShareButton({ title, url }: { title: string; url: string }) {
  const [sharing, setSharing] = useState(false);
  const { toast } = useToast();

  const handleShare = async () => {
    setSharing(true);
    try {
      if (navigator.share) {
        await navigator.share({
          title,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        toast('Link copied to clipboard!');
      }
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') {
        toast('Failed to share.');
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <button
      onClick={handleShare}
      disabled={sharing}
      className="btn-press inline-flex h-11 w-11 items-center justify-center rounded-lg border border-ink-900/10 bg-white text-ink-600 shadow-hair hover:border-ink-900/20 hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:opacity-50"
      aria-label="Share product"
      title="Share product"
    >
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
      </svg>
    </button>
  );
}