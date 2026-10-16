import { isNative, platform, PocketNative, type AppearanceCapabilities, type GlassRegion } from './native';
import { captureDiagnostic } from './diagnostics';

export function glassRenderer(enabled: boolean, supported: boolean, reduced: boolean) {
  return enabled && supported && !reduced ? 'native' : 'none';
}

const selector = 'button[data-pocket-glass="connection"], button[data-pocket-glass="model"]';

export function installGlassHandling(native = isNative && platform === 'ios', api = PocketNative) {
  const root = document.documentElement;
  root.dataset.glassRenderer = 'none';
  if (!native) return;
  const contrast = matchMedia('(prefers-contrast: more)');
  const transparency = matchMedia('(prefers-reduced-transparency: reduce)');
  let capabilities: AppearanceCapabilities = {
    nativeGlass: false,
    reduceTransparency: false,
    reduceMotion: false,
    lowPower: false,
  };
  let disposed = false;
  let frame = 0;
  let revision = 0;
  let geometry = 0;
  let serialized = '';
  let queue = Promise.resolve();
  let targets: HTMLButtonElement[] = [];
  let animationUntil = 0;
  const hidden = new Map<HTMLButtonElement, { tabindex: string | null; aria: string | null }>();
  const restore = (element: HTMLButtonElement) => {
    const previous = hidden.get(element);
    if (!previous) return;
    delete element.dataset.nativeControl;
    for (const [name, value] of [
      ['tabindex', previous.tabindex],
      ['aria-hidden', previous.aria],
    ] as const) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
    hidden.delete(element);
  };
  const restoreAll = () => {
    for (const element of hidden.keys()) restore(element);
  };
  const fail = (error: unknown) => {
    restoreAll();
    serialized = '';
    captureDiagnostic(error, { kind: 'action' });
  };
  const measure = () => {
    frame = 0;
    if (disposed || document.hidden || root.dataset.glassRenderer !== 'native') return;
    if (performance.now() < animationUntil) frame = requestAnimationFrame(measure);
    const viewport = window.visualViewport;
    const blocked =
      Boolean(document.querySelector('dialog[open], [data-page-transition]')) ||
      (viewport && Math.abs(viewport.scale - 1) > 0.01);
    if (blocked) restoreAll();
    const regions: GlassRegion[] = blocked
      ? []
      : targets.flatMap((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          if (
            !element.isConnected ||
            rect.width <= 0 ||
            rect.height <= 0 ||
            rect.top < 0 ||
            rect.bottom > innerHeight ||
            style.visibility === 'hidden' ||
            element.closest('[hidden], [inert]')
          )
            return [];
          const rgb =
            style.color
              .match(/[\d.]+/g)
              ?.slice(0, 3)
              .map((value) => Number(value) / 255) ?? [];
          return [
            {
              id: element.dataset.pocketGlass!,
              x: rect.x - (viewport?.offsetLeft ?? 0),
              y: rect.y - (viewport?.offsetTop ?? 0),
              width: rect.width,
              height: rect.height,
              title: element.textContent?.trim() ?? '',
              label: element.getAttribute('aria-label') ?? '',
              disabled: element.disabled,
              fontSize: parseFloat(style.fontSize),
              foreground: rgb,
            },
          ];
        });
    const options = { viewportWidth: innerWidth, regions };
    const next = JSON.stringify(options);
    if (next === serialized) return;
    serialized = next;
    const request = ++geometry;
    queue = queue
      .then(async () => {
        if (disposed || request !== geometry || root.dataset.glassRenderer !== 'native') return;
        const result = await api.setGlassRegions(options);
        if (disposed || request !== geometry || root.dataset.glassRenderer !== 'native') return;
        restoreAll();
        for (const element of targets) {
          if (!result.ids.includes(element.dataset.pocketGlass!)) continue;
          hidden.set(element, {
            tabindex: element.getAttribute('tabindex'),
            aria: element.getAttribute('aria-hidden'),
          });
          element.dataset.nativeControl = 'true';
          element.tabIndex = -1;
          element.setAttribute('aria-hidden', 'true');
        }
      })
      .catch(fail);
  };
  const schedule = () => {
    if (disposed || document.hidden || frame || root.dataset.glassRenderer !== 'native') return;
    frame = requestAnimationFrame(measure);
  };
  const scroll = (event: Event) => {
    const scroller = event.target;
    if (!(scroller instanceof Element) || targets.some((target) => scroller.contains(target))) schedule();
  };
  const resize = new ResizeObserver(schedule);
  const discover = () => {
    restoreAll();
    resize.disconnect();
    targets = [...document.querySelectorAll<HTMLButtonElement>(selector)].slice(0, 2);
    for (const element of targets) resize.observe(element);
    serialized = '';
    schedule();
  };
  const reconcile = () => {
    const request = ++revision;
    geometry++;
    restoreAll();
    const reduced =
      root.dataset.reduceTransparency === 'true' ||
      capabilities.reduceTransparency ||
      capabilities.lowPower ||
      contrast.matches ||
      transparency.matches;
    const renderer = glassRenderer(root.dataset.nativeGlass === 'true', capabilities.nativeGlass, reduced);
    root.dataset.glassRenderer = 'none';
    queue = queue
      .then(async () => {
        if (disposed || request !== revision) return;
        const result = await api.setGlassAppearance({
          enabled: renderer === 'native',
          dark: root.dataset.colorMode === 'dark',
        });
        if (!disposed && request === revision) {
          root.dataset.glassRenderer = result.enabled ? renderer : 'none';
          discover();
        }
      })
      .catch(fail);
  };
  const appearance = new MutationObserver(reconcile);
  appearance.observe(root, {
    attributes: true,
    attributeFilter: ['data-native-glass', 'data-color-mode', 'data-theme', 'data-reduce-transparency'],
  });
  const content = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.type === 'childList' &&
          [...record.addedNodes, ...record.removedNodes].some(
            (node) => node instanceof Element && (node.matches(selector) || node.querySelector(selector)),
          ),
      )
    )
      discover();
    else if (
      records.some((record) => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        return (
          element &&
          (element.matches('dialog, [data-page-transition]') ||
            record.attributeName === 'data-page-transition' ||
            targets.some((target) => target.contains(element) || element.contains(target)))
        );
      })
    )
      schedule();
  });
  content.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'disabled',
      'aria-label',
      'open',
      'hidden',
      'inert',
      'data-page-transition',
      'class',
      'style',
    ],
  });
  const keyboardFrame = (event: Event) => {
    const duration = (event as CustomEvent<{ duration?: number }>).detail?.duration ?? 0;
    animationUntil = performance.now() + Math.min(1000, Math.max(0, duration)) + 50;
    schedule();
  };
  const handles = [
    api.addListener('appearanceAccessibility', (state) => {
      capabilities = state;
      reconcile();
    }),
    api.addListener('glassAction', ({ id }) => {
      if (
        document.querySelector('dialog[open], [data-page-transition]') ||
        root.dataset.glassRenderer !== 'native'
      )
        return;
      const element = targets.find((target) => target.dataset.pocketGlass === id);
      if (element?.isConnected && !element.disabled && hidden.has(element)) element.click();
    }),
  ];
  void api
    .appearanceCapabilities()
    .then((state) => {
      if (!disposed) {
        capabilities = state;
        reconcile();
      }
    })
    .catch(fail);
  for (const media of [contrast, transparency]) media.addEventListener('change', reconcile);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', scroll, { passive: true, capture: true });
  window.addEventListener('pocket:keyboard-frame', keyboardFrame);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  const visibility = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (!document.hidden) schedule();
  };
  document.addEventListener('visibilitychange', visibility);
  reconcile();
  return () => {
    disposed = true;
    restoreAll();
    root.dataset.glassRenderer = 'none';
    cancelAnimationFrame(frame);
    appearance.disconnect();
    content.disconnect();
    resize.disconnect();
    document.removeEventListener('visibilitychange', visibility);
    for (const media of [contrast, transparency]) media.removeEventListener('change', reconcile);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', scroll, true);
    window.removeEventListener('pocket:keyboard-frame', keyboardFrame);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
    for (const handle of handles) void handle.then((value) => value.remove()).catch(fail);
    void queue.then(() => api.setGlassAppearance({ enabled: false, dark: true })).catch(fail);
  };
}
