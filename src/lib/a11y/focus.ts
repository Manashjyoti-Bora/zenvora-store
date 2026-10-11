/**
 * Keyboard-focus helpers for interactive overlays (mobile nav, modals,
 * drawers). The DOM-touching wrappers are deliberately thin so the *logic*
 * stays pure and unit-testable in the repo's node test environment (no DOM
 * shim, no new dependency).
 *
 * Used by <MobileMenu/> and <Modal/> so every overlay in the app behaves
 * identically for keyboard and screen-reader users:
 *   - focus moves into the overlay when it opens,
 *   - Tab/Shift+Tab cycle inside it (focus trap),
 *   - focus returns to the trigger when it closes.
 */

/** Elements that can receive keyboard focus, in DOM order. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Focusable descendants of `root`, in document order. */
export function focusablesIn(root: ParentNode | null | undefined): HTMLElement[] {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('aria-hidden') && el.tabIndex !== -1
  );
}

/**
 * The element that should be focused after a Tab (`shift` = false) or
 * Shift+Tab (`shift` = true) press, wrapping at both ends of the trap.
 *
 * Pure: it only reads the list and the currently active element, so it can be
 * unit-tested without a DOM. Returns null when there is nothing to focus
 * (empty list), which callers treat as "let the browser handle it".
 */
export function nextFocusTarget(
  focusables: readonly HTMLElement[],
  active: Element | null,
  shift: boolean
): HTMLElement | null {
  if (focusables.length === 0) return null;
  if (!active) return shift ? focusables[focusables.length - 1] : focusables[0];

  const current = focusables.indexOf(active as HTMLElement);
  // Focus sits outside the trap (e.g. on the page behind it): pull it back in.
  if (current === -1) return shift ? focusables[focusables.length - 1] : focusables[0];

  if (shift) {
    return current <= 0 ? focusables[focusables.length - 1] : focusables[current - 1];
  }
  return current >= focusables.length - 1 ? focusables[0] : focusables[current + 1];
}

/**
 * Prevent the page behind an open overlay from scrolling. Returns a restore
 * function; safe to call repeatedly (only the first call wins) so nested
 * overlays do not clear each other's lock.
 */
export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {};
  const body = document.body;
  const previous = body.style.overflow;
  body.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    body.style.overflow = previous;
  };
}
