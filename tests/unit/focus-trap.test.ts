import { describe, expect, it } from 'vitest';
import { nextFocusTarget } from '@/lib/a11y/focus';

/**
 * Pure focus-trap logic used by <MobileMenu/> and <Modal/>. These are the
 * cases that make or break keyboard-only navigation of an overlay.
 */

// Minimal stand-ins for HTMLElement: the function only needs identity and
// order, so plain labelled objects keep the test DOM-free.
function el(id: string) {
  return { id } as unknown as HTMLElement;
}

const A = el('a');
const B = el('b');
const C = el('c');
const all = [A, B, C];

describe('nextFocusTarget', () => {
  it('moves forward through the trap', () => {
    expect(nextFocusTarget(all, A, false)).toBe(B);
    expect(nextFocusTarget(all, B, false)).toBe(C);
  });

  it('moves backward through the trap', () => {
    expect(nextFocusTarget(all, B, true)).toBe(A);
    expect(nextFocusTarget(all, C, true)).toBe(B);
  });

  it('wraps at both ends (focus can never escape the overlay)', () => {
    expect(nextFocusTarget(all, C, false)).toBe(A);
    expect(nextFocusTarget(all, A, true)).toBe(C);
  });

  it('handles a single focusable element (wraps onto itself)', () => {
    const only = [A];
    expect(nextFocusTarget(only, A, false)).toBe(A);
    expect(nextFocusTarget(only, A, true)).toBe(A);
  });

  it('pulls focus back in when it sits outside the trap', () => {
    // e.g. focus moved to the page behind the overlay, or to a
    // tabindex="-1" container that focusablesIn() filtered out.
    const outside = el('outside');
    expect(nextFocusTarget(all, outside, false)).toBe(A);
    expect(nextFocusTarget(all, outside, true)).toBe(C);
  });

  it('starts at the first element when nothing is focused', () => {
    expect(nextFocusTarget(all, null, false)).toBe(A);
    expect(nextFocusTarget(all, null, true)).toBe(C);
  });

  it('returns null when the trap is empty (caller lets the browser decide)', () => {
    expect(nextFocusTarget([], A, false)).toBeNull();
    expect(nextFocusTarget([], null, false)).toBeNull();
  });

  it('never returns an element that is not in the list', () => {
    for (const active of [...all, el('x')]) {
      for (const shift of [false, true]) {
        expect(all).toContain(nextFocusTarget(all, active, shift));
      }
    }
  });
});
