'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Cookie notice + privacy preferences.
 *
 * Honest by design: this store uses ONLY essential cookies (session + cart +
 * CSRF). No third-party trackers are loaded by default. The preferences panel
 * states this and stores the acknowledgement locally. If analytics are added
 * later, the optional toggle is where they must be gated.
 */

const KEY = 'resellix_cookie_consent_v1';

export function CookieConsent({ storeName }: { storeName: string }) {
  const [visible, setVisible] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  function accept() {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ essential: true, analytics: false, at: new Date().toISOString() })
      );
    } catch {
      // storage unavailable (private mode) - banner just disappears
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-ink-900/10 bg-white p-4 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]"
    >
      <div className="container-store flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-ink-500 sm:max-w-2xl sm:text-sm">
          {/* Short mobile line keeps the banner's paint area smaller than the
              hero headline so it can never become the LCP element on phones. */}
          <span className="sm:hidden">
            Essential cookies only — no trackers.{' '}
            <Link href="/policies/privacy" className="link-primary">
              Privacy
            </Link>
          </span>
          <span className="hidden sm:inline">
            {storeName} uses only <strong>essential cookies</strong> (login session, cart,
            security). No third-party trackers are enabled. See our{' '}
            <Link href="/policies/privacy" className="link-primary">
              Privacy Policy
            </Link>
            .
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPrefs((v) => !v)}
            className="rounded-lg border border-ink-900/20 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-cream-50"
            aria-expanded={showPrefs}
          >
            Preferences
          </button>
          <button
            type="button"
            onClick={accept}
            className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
          >
            OK, understood
          </button>
        </div>
      </div>
      {showPrefs && (
        <div className="container-store mt-3 rounded-lg border border-ink-900/10 bg-cream-50 p-3 text-xs text-ink-500">
          <p className="mb-2 font-semibold text-ink-800">Cookie preferences</p>
          <ul className="space-y-1.5">
            <li className="flex items-center justify-between gap-4">
              <span>
                <strong>Essential</strong> — session, cart, CSRF protection
              </span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
                Always on
              </span>
            </li>
            <li className="flex items-center justify-between gap-4">
              <span>
                <strong>Analytics</strong> — none enabled in this deployment
              </span>
              <span className="rounded-full bg-cream-200 px-2 py-0.5 font-medium text-ink-500">
                Off
              </span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
