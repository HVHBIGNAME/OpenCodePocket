export const keyboardNavigation = () => document.documentElement.dataset.inputMode === 'keyboard';

export function pointerNavigation() {
  document.documentElement.dataset.inputMode = 'pointer';
}

export function installFocusHandling() {
  const root = document.documentElement;
  const previous = root.dataset.inputMode;
  pointerNavigation();
  const keyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (
      ['Tab', 'Escape', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
    )
      root.dataset.inputMode = 'keyboard';
  };
  document.addEventListener('keydown', keyDown, true);
  document.addEventListener('pointerdown', pointerNavigation, { capture: true, passive: true });
  document.addEventListener('touchstart', pointerNavigation, { capture: true, passive: true });
  return () => {
    document.removeEventListener('keydown', keyDown, true);
    document.removeEventListener('pointerdown', pointerNavigation, true);
    document.removeEventListener('touchstart', pointerNavigation, true);
    if (previous === undefined) delete root.dataset.inputMode;
    else root.dataset.inputMode = previous;
  };
}
