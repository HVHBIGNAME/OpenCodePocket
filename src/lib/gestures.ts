import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

export function swipeAccepted(distance: number, cross: number, elapsed: number, extent: number) {
  return (
    Math.abs(distance) > Math.abs(cross) * 1.4 &&
    (Math.abs(distance) >= Math.min(96, extent * 0.24) ||
      (Math.abs(distance) >= 32 && Math.abs(distance) / Math.max(elapsed, 1) > 0.5))
  );
}

export function useSwipe(
  ref: RefObject<HTMLElement | null>,
  options: {
    axis: 'x' | 'y';
    canStart: (target: Element, x: number, y: number) => boolean;
    onSwipe: (direction: -1 | 1) => void;
    onProgress?: (distance: number) => void;
    resetKey?: string;
    settleOnCommit?: boolean;
  },
) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let start: { id: number; x: number; y: number; time: number; claimed: boolean } | undefined;
    let blockClickUntil = 0;
    const reset = () => {
      start = undefined;
      latest.current.onProgress?.(0);
    };
    const down = (event: TouchEvent) => {
      reset();
      const touch = event.touches[0];
      if (
        event.touches.length !== 1 ||
        !touch ||
        !(event.target instanceof Element) ||
        window.getSelection()?.toString()
      )
        return;
      if (!latest.current.canStart(event.target, touch.clientX, touch.clientY)) return;
      start = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        time: performance.now(),
        claimed: false,
      };
    };
    const delta = (touch: Touch) =>
      latest.current.axis === 'x'
        ? ([touch.clientX - start!.x, touch.clientY - start!.y] as const)
        : ([touch.clientY - start!.y, touch.clientX - start!.x] as const);
    const move = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.touches[0];
      if (
        event.touches.length !== 1 ||
        !touch ||
        touch.identifier !== start.id ||
        window.getSelection()?.toString()
      ) {
        reset();
        return;
      }
      const [distance, cross] = delta(touch);
      if (!start.claimed) {
        if (Math.abs(cross) > 10 && Math.abs(cross) >= Math.abs(distance)) {
          reset();
          return;
        }
        if (performance.now() - start.time > 600) {
          reset();
          return;
        }
        if (Math.abs(distance) < 10 || Math.abs(distance) < Math.abs(cross) * 1.4) return;
        start.claimed = true;
      }
      if (event.cancelable) event.preventDefault();
      latest.current.onProgress?.(distance);
    };
    const up = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!start || !touch || touch.identifier !== start.id) {
        reset();
        return;
      }
      const [distance, cross] = delta(touch);
      const extent = latest.current.axis === 'x' ? element.clientWidth : element.clientHeight;
      const accepted =
        start.claimed && swipeAccepted(distance, cross, performance.now() - start.time, extent);
      if (start.claimed) blockClickUntil = performance.now() + 400;
      if (accepted && latest.current.settleOnCommit === false) start = undefined;
      else reset();
      if (accepted) latest.current.onSwipe(distance > 0 ? 1 : -1);
    };
    const click = (event: MouseEvent) => {
      if (performance.now() < blockClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    element.addEventListener('touchstart', down, { passive: true });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', up);
    element.addEventListener('touchcancel', reset);
    element.addEventListener('click', click, true);
    return () => {
      element.removeEventListener('touchstart', down);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', up);
      element.removeEventListener('touchcancel', reset);
      element.removeEventListener('click', click, true);
      reset();
    };
  }, [ref, options.resetKey]);
}

const settling = new WeakMap<HTMLElement, Animation>();
export function dragFeedback(element: HTMLElement | null, axis: 'x' | 'y', distance: number) {
  if (!element) return;
  settling.get(element)?.cancel();
  settling.delete(element);
  const previous = element.style.transform;
  element.style.transform = distance ? `translate${axis.toUpperCase()}(${distance}px)` : '';
  if (!distance && previous && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    settling.set(
      element,
      element.animate([{ transform: previous }, { transform: 'none' }], {
        duration: 150,
        easing: 'ease-out',
      }),
    );
}
