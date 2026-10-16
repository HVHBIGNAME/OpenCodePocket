import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { swipeAccepted } from '../lib/gestures';

const ActivePage = createContext(true);
const BackPage = createContext<() => boolean>(() => false);
export const PageScroll = createContext<RefObject<HTMLElement | null> | null>(null);
export const usePageActive = () => useContext(ActivePage);
export const usePageBack = () => useContext(BackPage);
export const usePageScroll = () => useContext(PageScroll);

type Page = { key: string; node: ReactNode };
type Transition = { target: Page; direction: number; pop: boolean; gesture: boolean };
type Frame = { page: Page; transition?: Transition };
type Props = {
  pageKey: string;
  children: ReactNode;
  onBack?: (key: string) => void;
  order?: readonly string[];
  scroll?: boolean;
  enabled?: boolean;
  gestureSurface?: RefObject<HTMLElement | null>;
  name: string;
};

function Ready({ onReady, children }: { onReady: () => void; children: ReactNode }) {
  useEffect(onReady, [onReady]);
  return children;
}

function DeckPanel({
  page,
  active,
  preview,
  scroll,
  register,
  ready,
  children,
}: {
  page: Page;
  active: boolean;
  preview: boolean;
  scroll: boolean;
  register: (key: string, element: HTMLElement | null) => void;
  ready: (key: string) => void;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const onReady = useCallback(() => ready(page.key), [ready, page.key]);
  return (
    <section
      className="deck-panel"
      data-page-key={page.key}
      data-active={active}
      data-preview={preview}
      aria-hidden={!active}
      inert={!active}
      ref={useCallback((element: HTMLElement | null) => register(page.key, element), [register, page.key])}
    >
      <fieldset className="deck-surface" disabled={!active}>
        <ActivePage.Provider value={active}>
          <Suspense
            fallback={
              <div className="loading-state" role="status">
                Загружаем…
              </div>
            }
          >
            <Ready onReady={onReady}>
              {scroll ? (
                <PageScroll.Provider value={scroller}>
                  <div className="page-scroll" ref={scroller} data-page-scroll>
                    {children}
                  </div>
                </PageScroll.Provider>
              ) : (
                children
              )}
            </Ready>
          </Suspense>
        </ActivePage.Provider>
      </fieldset>
    </section>
  );
}

/** Keeps both page trees mounted until their shared transition has finished. */
export function PageDeck(props: Props) {
  const parentActive = usePageActive();
  const interactive = useRef(parentActive && props.enabled !== false);
  const [frame, setFrame] = useState<Frame>({ page: { key: props.pageKey, node: props.children } });
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const state = useRef(frame);
  const cache = useRef(new Map<string, ReactNode>());
  const history = useRef([props.pageKey]);
  const panels = useRef(new Map<string, HTMLElement>());
  const mounted = useRef(new Set<string>());
  const positions = useRef(new Map<string, number[]>());
  const progress = useRef(0);
  const animations = useRef<Animation[]>([]);
  const epoch = useRef(0);
  const settle = useRef<(commit: boolean) => void>(() => undefined);
  const register = useCallback((key: string, element: HTMLElement | null) => {
    if (element) panels.current.set(key, element);
    else {
      panels.current.delete(key);
      mounted.current.delete(key);
    }
  }, []);
  const update = useCallback((next: Frame) => {
    state.current = next;
    setFrame(next);
  }, []);
  useLayoutEffect(() => {
    latest.current = props;
    interactive.current = parentActive && props.enabled !== false;
    cache.current.set(props.pageKey, props.children);
  });
  const begin = useCallback(
    (key: string, pop: boolean, gesture: boolean) => {
      const current = state.current;
      if (current.transition || key === current.page.key || !cache.current.has(key)) return false;
      const order = latest.current.order;
      const from = order?.indexOf(current.page.key) ?? -1;
      const to = order?.indexOf(key) ?? -1;
      const direction = from >= 0 && to >= 0 ? Math.sign(to - from) : pop ? -1 : 1;
      progress.current = 0;
      const element = panels.current.get(current.page.key);
      if (element)
        positions.current.set(
          current.page.key,
          [...element.querySelectorAll<HTMLElement>('[data-page-scroll]')].map((item) => item.scrollTop),
        );
      update({
        page: { ...current.page, node: cache.current.get(current.page.key) },
        transition: {
          target: { key, node: cache.current.get(key) },
          direction,
          pop,
          gesture,
        },
      });
      return true;
    },
    [update],
  );
  const back = useCallback(() => {
    const key = history.current.at(-2);
    return Boolean(latest.current.onBack && key && begin(key, true, false));
  }, [begin]);
  const ready = useCallback((key: string) => {
    mounted.current.add(key);
    const element = panels.current.get(key);
    const saved = positions.current.get(key);
    if (element && saved)
      [...element.querySelectorAll<HTMLElement>('[data-page-scroll]')].forEach((item, index) => {
        item.scrollTop = saved[index] ?? 0;
      });
    const transition = state.current.transition;
    if (transition?.target.key === key && !transition.gesture) settle.current(true);
  }, []);
  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    const surface = props.gestureSurface?.current ?? container;
    const transforms = (amount: number) => {
      const transition = state.current.transition!;
      return [
        `translate3d(${-transition.direction * amount * 100}%,0,0)`,
        `translate3d(${transition.direction * (1 - amount) * 100}%,0,0)`,
      ];
    };
    const paint = (amount: number) => {
      progress.current = amount;
      const current = state.current;
      if (!current.transition) return;
      const [from, to] = transforms(amount);
      panels.current.get(current.page.key)?.style.setProperty('transform', from!);
      panels.current.get(current.transition.target.key)?.style.setProperty('transform', to!);
    };
    const finish = (commit: boolean) => {
      const current = state.current;
      const transition = current.transition;
      if (!transition) return;
      const token = ++epoch.current;
      const source = panels.current.get(current.page.key);
      if (animations.current.length && source) {
        const offset = new DOMMatrixReadOnly(getComputedStyle(source).transform).m41;
        progress.current = Math.max(0, Math.min(1, -offset / (transition.direction * container.clientWidth)));
      }
      paint(progress.current);
      for (const animation of animations.current) animation.cancel();
      animations.current = [];
      const complete = () => {
        if (token !== epoch.current) return;
        // Keep the final positions after removing the effects, until React commits the page.
        paint(Number(commit));
        for (const animation of animations.current) animation.cancel();
        animations.current = [];
        progress.current = 0;
        if (commit) {
          const index = history.current.indexOf(transition.target.key);
          history.current =
            index >= 0
              ? history.current.slice(0, index + 1)
              : [...history.current, transition.target.key].slice(-12);
          for (const key of cache.current.keys())
            if (!history.current.includes(key) && key !== latest.current.pageKey) {
              cache.current.delete(key);
              positions.current.delete(key);
            }
          update({ page: transition.target });
          if (transition.pop && latest.current.pageKey !== transition.target.key)
            latest.current.onBack?.(transition.target.key);
        } else update({ page: current.page });
      };
      if (
        matchMedia('(prefers-reduced-motion: reduce)').matches ||
        Math.abs(Number(commit) - progress.current) < 0.001
      ) {
        complete();
        return;
      }
      const from = transforms(progress.current);
      const to = transforms(Number(commit));
      const nodes = [panels.current.get(current.page.key), panels.current.get(transition.target.key)];
      const timing = {
        duration: Math.max(140, Math.abs(Number(commit) - progress.current) * 300),
        easing: 'cubic-bezier(.22,.72,.18,1)',
        fill: 'forwards' as const,
      };
      animations.current = nodes.flatMap((node, index) =>
        node ? [node.animate([{ transform: from[index] }, { transform: to[index] }], timing)] : [],
      );
      void Promise.all(animations.current.map((animation) => animation.finished)).then(
        complete,
        () => undefined,
      );
    };
    settle.current = finish;
    let touch: { id: number; x: number; y: number; time: number; claimed: boolean } | undefined;
    let blockedUntil = 0;
    const down = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        if (touch?.claimed) finish(false);
        touch = undefined;
        return;
      }
      const point = event.touches[0];
      const target = event.target;
      if (
        !interactive.current ||
        !point ||
        !(target instanceof Element) ||
        state.current.transition ||
        !latest.current.onBack ||
        history.current.length < 2 ||
        (surface === container &&
          (target.closest('[data-page-deck]') !== container ||
            target.closest('[data-page-back="blocked"]'))) ||
        target.closest('input, textarea, select, button, a, summary, pre, code, [contenteditable="true"]') ||
        (document.querySelector('dialog[open]') &&
          !document.querySelector('dialog[open]')!.contains(container)) ||
        getSelection()?.toString() ||
        point.clientX - container.getBoundingClientRect().left > 28
      )
        return;
      touch = {
        id: point.identifier,
        x: point.clientX,
        y: point.clientY,
        time: performance.now(),
        claimed: false,
      };
    };
    const cancel = () => {
      if (touch?.claimed) {
        blockedUntil = performance.now() + 400;
        finish(false);
      }
      touch = undefined;
    };
    const move = (event: TouchEvent) => {
      if (!touch) return;
      const point = event.touches[0];
      if (
        event.touches.length !== 1 ||
        !point ||
        point.identifier !== touch.id ||
        getSelection()?.toString()
      ) {
        cancel();
        return;
      }
      const dx = point.clientX - touch.x;
      const dy = point.clientY - touch.y;
      if (!touch.claimed) {
        if (
          (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) ||
          performance.now() - touch.time > 600 ||
          dx < -10
        ) {
          touch = undefined;
          return;
        }
        if (dx < 10 || dx < Math.abs(dy) * 1.4) return;
        touch.claimed = begin(history.current.at(-2)!, true, true);
      }
      if (!touch.claimed) return;
      if (event.cancelable) event.preventDefault();
      paint(Math.max(0, Math.min(1, dx / container.clientWidth)));
    };
    const up = (event: TouchEvent) => {
      if (!touch?.claimed) {
        touch = undefined;
        return;
      }
      const point = event.changedTouches[0];
      blockedUntil = performance.now() + 400;
      finish(
        Boolean(
          point &&
          point.identifier === touch.id &&
          point.clientX > touch.x &&
          swipeAccepted(
            point.clientX - touch.x,
            point.clientY - touch.y,
            performance.now() - touch.time,
            container.clientWidth,
          ),
        ),
      );
      touch = undefined;
    };
    const click = (event: MouseEvent) => {
      if (performance.now() < blockedUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const pointerDown = () => {
      blockedUntil = 0;
    };
    let width = container.clientWidth;
    const resize = new ResizeObserver(() => {
      if (container.clientWidth === width) return;
      width = container.clientWidth;
      if (state.current.transition) finish(!state.current.transition.gesture);
      touch = undefined;
    });
    resize.observe(container);
    surface.addEventListener('touchstart', down, { passive: true });
    surface.addEventListener('touchmove', move, { passive: false });
    surface.addEventListener('touchend', up);
    surface.addEventListener('touchcancel', cancel);
    surface.addEventListener('click', click, true);
    surface.addEventListener('pointerdown', pointerDown, { passive: true });
    return () => {
      epoch.current++;
      for (const animation of animations.current) animation.cancel();
      resize.disconnect();
      surface.removeEventListener('touchstart', down);
      surface.removeEventListener('touchmove', move);
      surface.removeEventListener('touchend', up);
      surface.removeEventListener('touchcancel', cancel);
      surface.removeEventListener('click', click, true);
      surface.removeEventListener('pointerdown', pointerDown);
    };
  }, [begin, update, props.gestureSurface]);
  useLayoutEffect(() => {
    if (frame.transition) {
      if (!animations.current.length) {
        const amount = progress.current;
        const direction = frame.transition.direction;
        panels.current
          .get(frame.page.key)
          ?.style.setProperty('transform', `translate3d(${-direction * amount * 100}%,0,0)`);
        panels.current
          .get(frame.transition.target.key)
          ?.style.setProperty('transform', `translate3d(${direction * (1 - amount) * 100}%,0,0)`);
        if (!frame.transition.gesture && mounted.current.has(frame.transition.target.key))
          settle.current(true);
      }
      return;
    }
    panels.current.get(frame.page.key)?.style.removeProperty('transform');
    if (props.pageKey !== frame.page.key)
      begin(props.pageKey, history.current.includes(props.pageKey), false);
  }, [props.pageKey, frame, begin]);
  const pages = frame.transition ? [frame.page, frame.transition.target] : [frame.page];
  return (
    <div
      className="page-deck"
      ref={root}
      data-page-deck={props.name}
      data-current-page={frame.page.key}
      data-target-page={frame.transition?.target.key}
      data-page-transition={frame.transition ? 'true' : undefined}
      data-has-back={history.current.length > 1}
    >
      <BackPage.Provider value={back}>
        {pages.map((page) => (
          <DeckPanel
            key={page.key}
            page={page}
            scroll={props.scroll ?? false}
            active={
              parentActive && props.enabled !== false && !frame.transition && page.key === frame.page.key
            }
            preview={page.key === frame.transition?.target.key}
            register={register}
            ready={ready}
          >
            {page.key === props.pageKey
              ? props.children
              : frame.transition
                ? page.node
                : (cache.current.get(page.key) ?? page.node)}
          </DeckPanel>
        ))}
      </BackPage.Provider>
    </div>
  );
}
