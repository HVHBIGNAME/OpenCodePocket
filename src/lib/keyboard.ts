import { Keyboard } from '@capacitor/keyboard';
import { isNative } from './native';

function editable(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.matches(
      'textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), [contenteditable="true"]',
    )
  );
}

export function installKeyboardHandling() {
  const viewport = window.visualViewport;
  let frame = 0;
  let pointer: { x: number; y: number } | undefined;
  let disposed = false;
  const sync = () => {
    if (disposed) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const height =
        viewport && Math.abs(viewport.scale - 1) < 0.01
          ? Math.min(window.innerHeight, viewport.height)
          : window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
    });
  };
  const pointerDown = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
  };
  const pointerUp = (event: PointerEvent) => {
    const start = pointer;
    pointer = undefined;
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return;
    const target = event.target;
    const active = document.activeElement;
    if (
      !(target instanceof Element) ||
      !editable(active) ||
      target.closest(
        'input, textarea, select, button, a, label, summary, [role="button"], [contenteditable="true"]',
      )
    )
      return;
    active.blur();
    if (isNative) void Keyboard.hide().catch((error: unknown) => console.debug('Keyboard dismissal:', error));
  };
  const pointerCancel = () => {
    pointer = undefined;
  };
  window.addEventListener('resize', sync);
  viewport?.addEventListener('resize', sync);
  document.addEventListener('pointerdown', pointerDown, { passive: true });
  document.addEventListener('pointerup', pointerUp, { passive: true });
  document.addEventListener('pointercancel', pointerCancel, { passive: true });
  const handles = isNative
    ? [
        Keyboard.addListener('keyboardWillShow', () => {
          if (!disposed) {
            document.body.classList.add('keyboard-open');
            sync();
          }
        }),
        Keyboard.addListener('keyboardDidShow', sync),
        Keyboard.addListener('keyboardDidHide', () => {
          if (disposed) return;
          document.body.classList.remove('keyboard-open');
          if (document.querySelector('.app-chat')) window.scrollTo(0, 0);
          sync();
        }),
      ]
    : [];
  sync();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', sync);
    viewport?.removeEventListener('resize', sync);
    document.removeEventListener('pointerdown', pointerDown);
    document.removeEventListener('pointerup', pointerUp);
    document.removeEventListener('pointercancel', pointerCancel);
    document.body.classList.remove('keyboard-open');
    document.documentElement.style.removeProperty('--app-height');
    for (const handle of handles) void handle.then((listener) => listener.remove());
  };
}
