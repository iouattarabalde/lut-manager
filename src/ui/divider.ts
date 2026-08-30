/**
 * Draggable split between the panels, so the viewers can be given more room.
 * Width is remembered per viewer.
 */

import { $ } from './dom.js';

const KEY = 'lut-manager/split';
const MIN = 260;
/** Leave enough room that the right-hand form stays usable. */
const RIGHT_MIN = 380;

function clampWidth(px: number): number {
  const total = window.innerWidth;
  return Math.max(MIN, Math.min(px, total - RIGHT_MIN));
}

let notifyQueued = false;

/**
 * Set the width immediately, but announce it at most once per frame. Dragging
 * fires pointermove far faster than the views can redraw, and the scopes in
 * particular read back a full frame and walk it on the CPU.
 */
function apply(px: number): void {
  document.documentElement.style.setProperty('--left-width', `${clampWidth(px)}px`);
  if (notifyQueued) return;
  notifyQueued = true;
  requestAnimationFrame(() => {
    notifyQueued = false;
    window.dispatchEvent(new Event('resize'));
  });
}

export function init(): void {
  const divider = $('divider');
  const layout = document.querySelector('.layout') as HTMLElement;

  // Below the breakpoint the panels stack and the divider is hidden.
  const stacked = () => window.getComputedStyle(divider).display === 'none';

  let stored = 0;
  try {
    stored = Number(localStorage.getItem(KEY)) || 0;
  } catch {
    // Private windows and blocked storage are fine; fall back to the default.
  }
  if (stored) apply(stored);

  let dragging = false;

  const move = (clientX: number) => {
    if (!dragging) return;
    apply(clientX - layout.getBoundingClientRect().left);
  };

  const stop = () => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('dragging');
    document.body.classList.remove('resizing');
    try {
      const w = document.documentElement.style.getPropertyValue('--left-width');
      localStorage.setItem(KEY, String(parseFloat(w) || 0));
    } catch {
      // Not being able to remember the width is not worth surfacing.
    }
  };

  divider.addEventListener('pointerdown', (e) => {
    if (stacked()) return;
    dragging = true;
    divider.classList.add('dragging');
    document.body.classList.add('resizing');
    divider.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  divider.addEventListener('pointermove', (e) => move(e.clientX));
  divider.addEventListener('pointerup', stop);
  divider.addEventListener('pointercancel', stop);

  // Double-click restores the default third.
  divider.addEventListener('dblclick', () => {
    document.documentElement.style.removeProperty('--left-width');
    try {
      localStorage.removeItem(KEY);
    } catch {
      // As above.
    }
    window.dispatchEvent(new Event('resize'));
  });

  // Keyboard, since the divider is focusable.
  divider.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const current = layout.firstElementChild!.getBoundingClientRect().width;
    apply(current + (e.key === 'ArrowRight' ? step : -step));
    e.preventDefault();
  });

  // Keep the stored width legal when the window changes size.
  window.addEventListener('resize', () => {
    const w = parseFloat(document.documentElement.style.getPropertyValue('--left-width'));
    if (w) {
      const clamped = clampWidth(w);
      if (clamped !== w) {
        document.documentElement.style.setProperty('--left-width', `${clamped}px`);
      }
    }
  });
}
