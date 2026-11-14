import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// All shop dialogs share one overlay z-index, so document order is visual order.
function topmostDialog() {
  const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')];
  return dialogs[dialogs.length - 1] || null;
}

/**
 * Keeps keyboard focus inside the topmost open dialog, moves focus into it on
 * open, restores the trigger on close, and calls `onEscape` for Escape. A lower
 * dialog ignores both keys until the dialog above it closes.
 * The visible CSS still owns all motion, so this stays dependency-free.
 */
export default function useDialogFocus(active, dialogRef, onEscape, initialFocusRef) {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active || !dialogRef.current) return undefined;
    const dialog = dialogRef.current;
    const previous = document.activeElement;

    const focusIntoDialog = () => {
      if (!dialog.isConnected || dialog.contains(document.activeElement)) return;
      if (topmostDialog() !== dialog) return;
      const requested = initialFocusRef?.current;
      const preferred = requested?.isConnected ? requested : dialog.querySelector('[data-autofocus]');
      const first = preferred || dialog.querySelector(FOCUSABLE) || dialog;
      if (first === dialog && !dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
      first.focus({ preventScroll: true });
    };

    // Move focus immediately, then repeat after the entrance settles. A click
    // that opened the dialog can otherwise put focus back on its trigger.
    focusIntoDialog();
    const frame = window.requestAnimationFrame(focusIntoDialog);
    const settle = window.setTimeout(focusIntoDialog, 90);

    const onKey = (event) => {
      if (topmostDialog() !== dialog) return;
      if (event.key === 'Escape') {
        if (escapeRef.current) {
          event.preventDefault();
          escapeRef.current();
        }
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = [...dialog.querySelectorAll(FOCUSABLE)].filter(
        (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true'
      );
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      document.removeEventListener('keydown', onKey);
      // Let a newly opened dialog (cart → checkout, checkout → success) claim
      // focus first. When a lower dialog remains, return to the control that
      // opened the top dialog instead of leaving focus on a removed element.
      window.setTimeout(() => {
        const remaining = topmostDialog();
        if (remaining) {
          if (previous instanceof HTMLElement && previous.isConnected && remaining.contains(previous)) {
            previous.focus({ preventScroll: true });
          }
          return;
        }
        if (previous instanceof HTMLElement && previous.isConnected && !dialog.contains(previous)) {
          previous.focus({ preventScroll: true });
        }
      }, 0);
    };
  }, [active, dialogRef, initialFocusRef]);
}
