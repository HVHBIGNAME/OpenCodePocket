import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { swipeAccepted } from '../lib/gestures';

type Frame = { index: number; preview?: number; direction: number; visited: number[] };
type Props = {
  index: number;
  count: number;
  surface: RefObject<HTMLElement | null>;
  indicator: RefObject<HTMLElement | null>;
  resetKey: string;
  onSelect: (index: number) => void;
  backIndex?: number;
  nestedBack?: boolean;
  render: (index: number, active: boolean, preview: boolean) => ReactNode;
};

export function PageSlider(props: Props) {
  const [frame, setFrame] = useState<Frame>({ index: props.index, direction: 0, visited: [props.index] });
  const track = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const state = useRef(frame);
  const animation = useRef<Animation | undefined>(undefined);
  const indicatorAnimation = useRef<Animation | undefined>(undefined);
  const distance = useRef(0);
  const generation = useRef(0);
  const release = useRef<(target?: number) => void>(() => undefined);
  useLayoutEffect(() => {
    latest.current = props;
    state.current = frame;
  });
  useLayoutEffect(() => {
    if (frame.preview !== undefined || frame.direction !== 0) return;
    // Rebase the track only after React has moved the selected panel to its resting position.
    distance.current = 0;
    track.current?.style.setProperty('transform', 'translate3d(0px,0,0)');
    props.indicator.current?.style.setProperty(
      'transform',
      `translateX(${Math.max(0, Math.min(props.count - 1, frame.index)) * 100}%)`,
    );
    if (props.surface.current) delete props.surface.current.dataset.pageTransition;
  }, [frame, props.surface, props.indicator, props.count]);
  useEffect(() => {
    const surface = props.surface.current;
    const element = track.current;
    if (!surface || !element) return;
    let start:
      { id: number; x: number; y: number; time: number; edge: boolean; claimed: boolean } | undefined;
    let blockClickUntil = 0;
    let touchTarget: Element | undefined;
    const indicatorTransform = (index: number) =>
      `translateX(${Math.max(0, Math.min(props.count - 1, index)) * 100}%)`;
    const paint = (value: number) => {
      distance.current = value;
      element.style.transform = `translate3d(${value}px,0,0)`;
      const target = state.current.preview;
      const progress =
        target === undefined
          ? state.current.index
          : state.current.index +
            ((target - state.current.index) * Math.abs(value)) / Math.max(element.clientWidth, 1);
      props.indicator.current?.style.setProperty('transform', indicatorTransform(progress));
    };
    const mark = (moving: boolean) => {
      if (moving) surface.dataset.pageTransition = 'true';
      else delete surface.dataset.pageTransition;
    };
    const preview = (target: number | undefined, direction: number) => {
      if (state.current.preview === target && state.current.direction === direction) return;
      const next = {
        ...state.current,
        preview: target,
        direction,
        visited:
          target !== undefined && target >= 0
            ? [...new Set([...state.current.visited, target])]
            : state.current.visited,
      };
      state.current = next;
      setFrame(next);
    };
    const finish = (target?: number) => {
      start = undefined;
      const requestedAtStart = latest.current.index;
      const gesture = requestedAtStart === state.current.index;
      const token = ++generation.current;
      const indicator = props.indicator.current;
      const indicatorStart = indicator ? getComputedStyle(indicator).transform : '';
      if (animation.current)
        distance.current = new DOMMatrixReadOnly(getComputedStyle(element).transform).m41;
      paint(distance.current);
      animation.current?.cancel();
      indicatorAnimation.current?.cancel();
      const destination =
        target === undefined ? 0 : (target < state.current.index ? 1 : -1) * element.clientWidth;
      const complete = () => {
        if (token !== generation.current) return;
        paint(destination);
        animation.current?.cancel();
        animation.current = undefined;
        indicatorAnimation.current?.cancel();
        indicatorAnimation.current = undefined;
        const old = state.current;
        const index = target ?? old.index;
        const next = { ...old, index, preview: undefined, direction: 0 };
        state.current = next;
        setFrame(next);
        if (
          latest.current.index !== index &&
          latest.current.index === requestedAtStart &&
          (gesture || target === undefined)
        )
          latest.current.onSelect(index);
      };
      if (
        matchMedia('(prefers-reduced-motion: reduce)').matches ||
        Math.abs(destination - distance.current) < 1
      ) {
        complete();
        return;
      }
      const timing = {
        duration: Math.max(120, Math.min(260, Math.abs(destination - distance.current) / 2)),
        easing: 'cubic-bezier(.2,.8,.2,1)',
        fill: 'forwards' as const,
      };
      animation.current = element.animate(
        [
          { transform: `translate3d(${distance.current}px,0,0)` },
          { transform: `translate3d(${destination}px,0,0)` },
        ],
        timing,
      );
      indicatorAnimation.current = indicator?.animate(
        [
          { transform: indicatorStart },
          {
            transform: indicatorTransform(target !== undefined && target >= 0 ? target : state.current.index),
          },
        ],
        timing,
      );
      void animation.current.finished.then(complete, () => undefined);
    };
    release.current = finish;
    const cancel = () => {
      if (start?.claimed) blockClickUntil = performance.now() + 400;
      start = undefined;
      finish();
    };
    const down = (event: TouchEvent) => {
      if (start) cancel();
      if (animation.current || event.touches.length !== 1 || window.getSelection()?.toString()) return;
      const touch = event.touches[0];
      const target = event.target;
      if (
        !touch ||
        !(target instanceof Element) ||
        document.querySelector('dialog[open]') ||
        target.closest(
          'input, textarea, select, a, summary, pre, code, [contenteditable="true"], .composer-wrap',
        )
      )
        return;
      if (target.closest('button') && !target.closest('.chat-tabs')) return;
      const edge = touch.clientX - surface.getBoundingClientRect().left <= 28;
      if (edge && (state.current.index === 0 || latest.current.nestedBack)) return;
      if (!edge && !target.closest('.chat-scroll, .details-scroll, .chat-tabs')) return;
      touchTarget = target;
      start = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        time: performance.now(),
        edge,
        claimed: false,
      };
    };
    const move = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.touches[0];
      if (
        event.touches.length !== 1 ||
        !touch ||
        touch.identifier !== start.id ||
        window.getSelection()?.toString()
      ) {
        cancel();
        return;
      }
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!start.claimed) {
        if ((Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) || performance.now() - start.time > 600) {
          start = undefined;
          return;
        }
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
        start.claimed = true;
        mark(true);
      }
      if (event.cancelable) event.preventDefault();
      const back = dx > 0 && start.edge;
      const target = back ? (latest.current.backIndex ?? -1) : state.current.index + (dx < 0 ? 1 : -1);
      const valid = target >= 0 && target < props.count;
      preview(valid ? target : undefined, dx < 0 ? 1 : -1);
      paint(valid ? Math.max(-element.clientWidth, Math.min(element.clientWidth, dx)) : dx * 0.2);
    };
    const up = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.changedTouches[0];
      if (!touch || touch.identifier !== start.id) {
        cancel();
        return;
      }
      const accepted =
        start.claimed &&
        swipeAccepted(
          touch.clientX - start.x,
          touch.clientY - start.y,
          performance.now() - start.time,
          element.clientWidth,
        );
      if (start.claimed) blockClickUntil = performance.now() + 400;
      const target = accepted ? state.current.preview : undefined;
      start = undefined;
      finish(target);
    };
    const click = (event: MouseEvent) => {
      if (
        performance.now() < blockClickUntil &&
        event.target instanceof Node &&
        touchTarget?.contains(event.target)
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const pointerDown = () => {
      blockClickUntil = 0;
    };
    let width = element.clientWidth;
    let height = element.clientHeight;
    const resize = new ResizeObserver(() => {
      const changed = width !== element.clientWidth || height !== element.clientHeight;
      width = element.clientWidth;
      height = element.clientHeight;
      if (changed && (start || animation.current)) cancel();
    });
    resize.observe(element);
    surface.addEventListener('touchstart', down, { passive: true });
    surface.addEventListener('touchmove', move, { passive: false });
    surface.addEventListener('touchend', up);
    surface.addEventListener('touchcancel', cancel);
    surface.addEventListener('click', click, true);
    surface.addEventListener('pointerdown', pointerDown, { passive: true });
    paint(0);
    return () => {
      generation.current++;
      animation.current?.cancel();
      animation.current = undefined;
      indicatorAnimation.current?.cancel();
      indicatorAnimation.current = undefined;
      resize.disconnect();
      mark(false);
      surface.removeEventListener('touchstart', down);
      surface.removeEventListener('touchmove', move);
      surface.removeEventListener('touchend', up);
      surface.removeEventListener('touchcancel', cancel);
      surface.removeEventListener('click', click, true);
      surface.removeEventListener('pointerdown', pointerDown);
    };
  }, [props.surface, props.indicator, props.count, props.resetKey]);
  useEffect(() => {
    if (props.index === state.current.index) {
      if (animation.current || state.current.preview !== undefined) release.current();
      return;
    }
    const direction = props.index > state.current.index ? 1 : -1;
    const next = {
      ...state.current,
      preview: props.index,
      direction,
      visited: [...new Set([...state.current.visited, props.index])],
    };
    state.current = next;
    setFrame(next);
    if (props.surface.current) props.surface.current.dataset.pageTransition = 'true';
    const frame = requestAnimationFrame(() => release.current(props.index));
    return () => cancelAnimationFrame(frame);
  }, [props.index, props.surface, frame.index]);
  return (
    <div className="page-slider" data-index={frame.index}>
      <div className="page-slider-track" ref={track}>
        {Array.from({ length: props.count }, (_, index) => {
          const active = index === frame.index;
          const preview = index === frame.preview;
          return (
            <section
              key={index}
              className="slider-panel"
              data-active={active}
              data-preview={preview}
              aria-hidden={!active}
              inert={!active}
              style={{
                visibility: active || preview ? 'visible' : 'hidden',
                transform: `translateX(${active ? 0 : frame.direction * 100}%)`,
              }}
            >
              {frame.visited.includes(index) && props.render(index, active, preview)}
            </section>
          );
        })}
      </div>
    </div>
  );
}
