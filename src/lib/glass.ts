import { isNative, platform, PocketNative, type AppearanceCapabilities, type GlassRegion } from './native';
import { isIPhone } from '../themes/loader';
import { captureDiagnostic } from './diagnostics';

export function glassRenderer(enabled: boolean, nativeGlass: boolean, reduced: boolean) {
  return !enabled ? 'none' : reduced ? 'opaque' : nativeGlass ? 'native' : 'css';
}

export function installGlassHandling() {
  if (!isIPhone) return;
  const root = document.documentElement;
  const native = isNative && platform === 'ios';
  const contrast = matchMedia('(prefers-contrast: more)');
  const transparency = matchMedia('(prefers-reduced-transparency: reduce)');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let capabilities: AppearanceCapabilities = {
    nativeGlass: false,
    reduceTransparency: false,
    reduceMotion: false,
    lowPower: false,
  };
  let disposed = false;
  let frame = 0;
  let sequence = 0;
  let serialized = '';
  let queue = Promise.resolve();
  let targets: HTMLElement[] = [];
  let keyboardAnimationUntil = 0;

  const measure = () => {
    if (disposed || root.dataset.glassRenderer !== 'native') return;
    if (performance.now() < keyboardAnimationUntil) frame = requestAnimationFrame(measure);
    const viewport = window.visualViewport;
    const regions: GlassRegion[] =
      viewport && Math.abs(viewport.scale - 1) > 0.01
        ? []
        : targets.flatMap((element) => {
            const rect = element.getBoundingClientRect();
            if (
              !element.isConnected ||
              rect.width <= 0 ||
              rect.height <= 0 ||
              rect.bottom < 0 ||
              rect.top > innerHeight
            )
              return [];
            return [
              {
                id: element.dataset.pocketGlass!,
                x: rect.x - (viewport?.offsetLeft ?? 0),
                y: rect.y - (viewport?.offsetTop ?? 0),
                width: rect.width,
                height: rect.height,
                radius: parseFloat(getComputedStyle(element).borderTopLeftRadius) || 24,
              },
            ];
          });
    const options = {
      viewportWidth: innerWidth,
      regions: regions.map((region) => ({
        ...region,
        x: Math.round(region.x),
        y: Math.round(region.y),
        width: Math.round(region.width),
        height: Math.round(region.height),
      })),
    };
    const next = JSON.stringify(options);
    if (next === serialized) return;
    serialized = next;
    queue = queue
      .then(async () => {
        if (!disposed && root.dataset.glassRenderer === 'native') await PocketNative.setGlassRegions(options);
      })
      .catch((error: unknown) => {
        serialized = '';
        captureDiagnostic(error, { kind: 'action' });
      });
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  };
  const keyboardFrame = (event: Event) => {
    const duration = (event as CustomEvent<{ duration?: number }>).detail?.duration ?? 0;
    keyboardAnimationUntil = performance.now() + Math.min(1000, Math.max(0, duration)) + 50;
    schedule();
  };
  const resize = new ResizeObserver(schedule);
  const discover = () => {
    resize.disconnect();
    targets = [...document.querySelectorAll<HTMLElement>('[data-pocket-glass]')].slice(0, 4);
    for (const target of targets) resize.observe(target);
    schedule();
  };
  const reconcile = () => {
    const revision = ++sequence;
    const enabled = root.dataset.theme === 'liquid-glass';
    const reduced =
      root.dataset.reduceTransparency === 'true' ||
      capabilities.reduceTransparency ||
      capabilities.lowPower ||
      contrast.matches ||
      transparency.matches;
    const renderer = glassRenderer(enabled, native && capabilities.nativeGlass, reduced);
    root.dataset.glassMotion = String(
      !capabilities.reduceMotion && !motion.matches && !capabilities.lowPower,
    );
    root.dataset.glassRenderer = renderer === 'native' ? 'css' : renderer;
    serialized = '';
    if (native)
      queue = queue
        .then(async () => {
          if (disposed || revision !== sequence) return;
          const result = await PocketNative.setGlassAppearance({
            enabled: renderer === 'native',
            dark: root.dataset.colorMode === 'dark',
          });
          if (!disposed && revision === sequence) {
            root.dataset.glassRenderer =
              renderer === 'native' && result.enabled ? 'native' : renderer === 'native' ? 'css' : renderer;
            discover();
          }
        })
        .catch((error: unknown) => {
          captureDiagnostic(error, { kind: 'action' });
        });
    discover();
  };
  const appearance = new MutationObserver(reconcile);
  appearance.observe(root, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-color-mode', 'data-reduce-transparency'],
  });
  const content = new MutationObserver((records) => {
    if (
      records.some((record) =>
        [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.matches('[data-pocket-glass]') || node.querySelector('[data-pocket-glass]')),
        ),
      )
    )
      discover();
  });
  content.observe(document.body, { subtree: true, childList: true });
  const accessibility = native
    ? PocketNative.addListener('appearanceAccessibility', (state) => {
        capabilities = state;
        reconcile();
      })
    : undefined;
  if (native)
    void PocketNative.appearanceCapabilities()
      .then((state) => {
        if (!disposed) {
          capabilities = state;
          reconcile();
        }
      })
      .catch((error: unknown) => captureDiagnostic(error, { kind: 'action' }));
  for (const media of [contrast, transparency, motion]) media.addEventListener('change', reconcile);
  window.addEventListener('resize', schedule);
  window.addEventListener('pocket:keyboard-frame', keyboardFrame);
  window.addEventListener('scroll', schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  reconcile();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    appearance.disconnect();
    content.disconnect();
    resize.disconnect();
    for (const media of [contrast, transparency, motion]) media.removeEventListener('change', reconcile);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('pocket:keyboard-frame', keyboardFrame);
    window.removeEventListener('scroll', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
    void accessibility
      ?.then((handle) => handle.remove())
      .catch((error: unknown) => captureDiagnostic(error, { kind: 'action' }));
    if (native)
      void queue
        .then(() => PocketNative.setGlassAppearance({ enabled: false, dark: true }))
        .catch((error: unknown) => captureDiagnostic(error, { kind: 'action' }));
  };
}
