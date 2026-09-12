'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Signature scroll depth for the hero product panel (design language §9).
 *
 * The panel drifts down ≤14px and settles to 0.985 scale as the hero scrolls
 * away — a quiet "the product stays with you a moment longer" effect.
 *
 * Hard gates (all cheap, all checked once):
 *  - fine pointer + hover capability only (desktop; touch never gets parallax),
 *  - prefers-reduced-motion ⇒ no-op,
 *  - IntersectionObserver unmounts the scroll listener once the hero is gone —
 *    zero handler cost for the rest of the page session,
 *  - transform-only + rAF-throttled + passive listener ⇒ compositor thread,
 *    no layout, no CLS, no LCP impact (the LCP image renders untransformed
 *    first; JS only adds motion afterwards),
 *  - without JS the panel is simply static — the full experience remains.
 */
export function HeroPanel({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mm = window.matchMedia?.bind(window);
    if (!mm) return;
    if (!mm('(hover: hover) and (pointer: fine)').matches) return;
    if (mm('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        // Normalize over the hero's approximate scroll life (700px), clamped.
        const t = Math.min(Math.max(window.scrollY / 700, 0), 1);
        el.style.transform = `translate3d(0, ${(t * 14).toFixed(2)}px, 0) scale(${(1 - t * 0.015).toFixed(4)})`;
      });
    };

    // Only listen while the hero section is actually on screen.
    const section = el.closest('section');
    if (!section || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            window.addEventListener('scroll', onScroll, { passive: true });
            onScroll();
          } else {
            window.removeEventListener('scroll', onScroll);
          }
        }
      },
      { threshold: 0 }
    );
    io.observe(section);

    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} style={{ willChange: 'transform' }}>
      {children}
    </div>
  );
}
