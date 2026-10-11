import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the scroll-reveal / LCP contract.
 *
 * The reveal hidden state MUST be scoped to `.js .reveal`, and `.js` must be
 * set by a blocking inline script that is the FIRST child of <body>. If either
 * half regresses, the homepage product grids (wrapped in <Reveal>) ship as
 * opacity:0 in the server HTML: they stop being LCP candidates and flash blank
 * until hydration. Nothing in the app asserts that visually, so it is asserted
 * structurally here.
 */

const root = path.resolve(__dirname, '../..');

const css = readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
const layout = readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');

describe('scroll-reveal gating (LCP safety)', () => {
  it('scopes the hidden state to .js so server HTML is always visible', () => {
    // The hidden rule must exist...
    expect(css).toMatch(/\.js\s+\.reveal\s*\{[^}]*opacity:\s*0/);
    // ...and must NOT exist as an unscoped `.reveal { opacity: 0 }`.
    const bareHidden = /(^|[},])\s*\.reveal\s*\{[^}]*opacity:\s*0/.test(css);
    expect(bareHidden).toBe(false);
  });

  it('gates the staggered children too', () => {
    expect(css).toMatch(/\.js\s+\.reveal\s+\.stagger\s*>\s*\*\s*\{[^}]*opacity:\s*0/);
    const bareStagger = /(^|[},])\s*\.reveal\s+\.stagger\s*>\s*\*\s*\{[^}]*opacity:\s*0/.test(
      css
    );
    expect(bareStagger).toBe(false);
  });

  it('keeps the reduced-motion override unconditional', () => {
    // Reduced motion must win regardless of how the reveal state is gated.
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/\.reveal\s*\{[^}]*opacity:\s*1\s*!important/);
  });

  it('marks script support in the layout with a blocking inline script', () => {
    expect(layout).toContain("document.documentElement.classList.add('js')");
  });

  it('runs that script before any reveal content is parsed', () => {
    // It must be the first child of <body>: the browser executes it
    // synchronously during parsing, so `.js` is in force at first paint.
    const bodyOpen = layout.indexOf('<body');
    const scriptStart = layout.indexOf('classList.add');
    const noscriptStart = layout.indexOf('<noscript');
    expect(bodyOpen).toBeGreaterThan(-1);
    expect(scriptStart).toBeGreaterThan(bodyOpen);
    expect(noscriptStart).toBeGreaterThan(scriptStart);
  });
});
