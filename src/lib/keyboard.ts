import { Keyboard } from '@capacitor/keyboard';
import { isNative, platform, PocketNative, type KeyboardFrame } from './native';
import { captureDiagnostic } from './diagnostics';

export function keyboardLayout(event: KeyboardFrame, width: number) {
  if (!(event.viewportHeight > 0) || !(event.viewportWidth > 0)) return;
  const scale = width / event.viewportWidth;
  return {
    height: Math.round(event.viewportHeight * scale),
    inset: Math.round(event.keyboardHeight * scale),
    duration: Math.max(0, Math.min(event.duration, 1)) * 1000,
    easing: ['ease-in-out', 'ease-in', 'ease-out', 'linear'][event.curve] ?? 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  };
}

export function renderKeyboardFrame(event: KeyboardFrame) {
  const layout = keyboardLayout(event, window.innerWidth);
  if (!layout) return false;
  const style = document.documentElement.style;
  style.setProperty('--keyboard-duration', `${layout.duration}ms`);
  style.setProperty('--keyboard-easing', layout.easing);
  style.setProperty('--keyboard-inset', `${layout.inset}px`);
  style.setProperty('--app-height', `${layout.height}px`);
  document.body.classList.toggle('keyboard-open', layout.inset > 0);
  window.dispatchEvent(new CustomEvent('pocket:keyboard-frame', { detail: { duration: layout.duration } }));
  return true;
}

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
  const ios = isNative && platform === 'ios';
  let nativeFrame = false;
  let dismissTouch: { x: number; y: number } | undefined;
  const applyFrame = (event: KeyboardFrame) => {
    if (disposed) return;
    nativeFrame = renderKeyboardFrame(event) || nativeFrame;
  };
  const sync = () => {
    if (disposed) return;
    if (ios && nativeFrame) return;
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
    if (isNative)
      void Keyboard.hide().catch((error: unknown) => captureDiagnostic(error, { kind: 'action' }));
  };
  const pointerCancel = () => {
    pointer = undefined;
  };
  const touchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    dismissTouch =
      event.touches.length === 1 &&
      touch &&
      editable(document.activeElement) &&
      event.target instanceof Element &&
      event.target.closest('.chat-scroll')
        ? { x: touch.clientX, y: touch.clientY }
        : undefined;
  };
  const touchMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (event.touches.length !== 1 || !touch || !dismissTouch) {
      dismissTouch = undefined;
      return;
    }
    if (touch.clientY - dismissTouch.y < 52 || Math.abs(touch.clientX - dismissTouch.x) > 24) return;
    dismissTouch = undefined;
    const active = document.activeElement;
    if (editable(active)) active.blur();
    if (isNative)
      void Keyboard.hide().catch((error: unknown) => captureDiagnostic(error, { kind: 'action' }));
  };
  window.addEventListener('resize', sync);
  viewport?.addEventListener('resize', sync);
  document.addEventListener('pointerdown', pointerDown, { passive: true });
  document.addEventListener('pointerup', pointerUp, { passive: true });
  document.addEventListener('pointercancel', pointerCancel, { passive: true });
  document.addEventListener('touchstart', touchStart, { passive: true });
  document.addEventListener('touchmove', touchMove, { passive: true });
  const handles = ios
    ? [PocketNative.addListener('keyboardFrame', applyFrame)]
    : isNative
      ? [
          Keyboard.addListener('keyboardWillShow', () => {
            if (!disposed) {
              document.body.classList.add('keyboard-open');
              sync();
            }
          }),
          Keyboard.addListener('keyboardDidShow', sync),
          Keyboard.addListener('keyboardWillHide', () => {
            document.body.classList.remove('keyboard-open');
            sync();
          }),
          Keyboard.addListener('keyboardDidHide', () => {
            if (disposed) return;
            document.body.classList.remove('keyboard-open');
            if (document.querySelector('.app-chat')) window.scrollTo(0, 0);
            sync();
          }),
        ]
      : [];
  const resizeNative = () => {
    if (ios)
      void PocketNative.getKeyboardFrame()
        .then(applyFrame)
        .catch((error: unknown) => captureDiagnostic(error, { kind: 'action' }));
  };
  if (ios)
    void Promise.all(handles)
      .then(resizeNative)
      .catch((error: unknown) => captureDiagnostic(error, { kind: 'action' }));
  window.addEventListener('orientationchange', resizeNative);
  sync();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', sync);
    window.removeEventListener('orientationchange', resizeNative);
    viewport?.removeEventListener('resize', sync);
    document.removeEventListener('pointerdown', pointerDown);
    document.removeEventListener('pointerup', pointerUp);
    document.removeEventListener('pointercancel', pointerCancel);
    document.removeEventListener('touchstart', touchStart);
    document.removeEventListener('touchmove', touchMove);
    document.body.classList.remove('keyboard-open');
    document.documentElement.style.removeProperty('--app-height');
    for (const property of ['--keyboard-duration', '--keyboard-easing', '--keyboard-inset'])
      document.documentElement.style.removeProperty(property);
    for (const handle of handles)
      void handle
        .then((listener) => listener.remove())
        .catch((error: unknown) => captureDiagnostic(error, { kind: 'action' }));
  };
}
