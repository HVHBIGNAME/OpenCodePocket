import { test, expect, connect, settlePages, type Page, type Locator } from './fixtures';

async function touch(
  target: Locator,
  type: string,
  dx = 0,
  dy = 0,
  x = 0.5,
  fingers = 1,
  ghostClick?: string,
) {
  if (type === 'touchstart' && fingers === 1) await settlePages(target.page());
  return target.evaluate(
    (element, { type, dx, dy, x, fingers, ghostClick }) => {
      const box = element.getBoundingClientRect();
      if (type === 'touchstart' && fingers === 1)
        Reflect.set(element, 'touchOrigin', { x: box.left + box.width * x, y: box.top + 25 });
      const origin = Reflect.get(element, 'touchOrigin') as { x: number; y: number };
      const finger = {
        identifier: 7,
        target: element,
        clientX: origin.x + dx,
        clientY: origin.y + dy,
      };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: {
          value:
            type === 'touchend' || type === 'touchcancel'
              ? []
              : Array.from({ length: fingers }, (_, index) => ({ ...finger, identifier: 7 + index })),
        },
        changedTouches: { value: [finger] },
      });
      element.dispatchEvent(event);
      if (ghostClick)
        return element
          .querySelector(ghostClick)!
          .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    },
    { type, dx, dy, x, fingers, ghostClick },
  );
}

async function settled(page: Page, index: number) {
  await settlePages(page);
  await expect(page.locator('.page-slider')).toHaveAttribute('data-index', String(index));
  await expect(page.locator('.chat-page')).not.toHaveAttribute('data-page-transition');
  await expect
    .poll(() =>
      page
        .locator('.page-slider-track')
        .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41),
    )
    .toBe(0);
}

test.beforeEach(async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await expect(page.getByText('Предлагаемая структура', { exact: true })).toBeVisible();
  await settlePages(page);
});

test('shows both pages under the finger, moves the indicator, and restores a cancelled drag', async ({
  page,
}, testInfo) => {
  const tabs = page.locator('.chat-tabs');
  const heading = (await page.locator('.chat-heading').boundingBox())!;
  await touch(tabs, 'touchstart');
  await touch(tabs, 'touchmove', -90, 2);
  const current = (await page.locator('.slider-panel[data-active="true"]').boundingBox())!;
  const preview = page.locator('.slider-panel[data-preview="true"]');
  const next = (await preview.boundingBox())!;
  expect(current.x).toBeCloseTo(-90, 0);
  expect(next.x).toBeCloseTo(current.x + current.width, 0);
  expect((await page.locator('.chat-heading').boundingBox())!.x).toBe(heading.x);
  await expect(preview).toHaveAttribute('inert');
  await expect(preview).toHaveAttribute('aria-hidden', 'true');
  expect(
    await page
      .locator('.chat-tab-indicator')
      .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41),
  ).toBeGreaterThan(0);
  await expect(tabs.getByRole('button', { name: 'Диалог', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.screenshot({ path: testInfo.outputPath('drag-preview.png') });
  await touch(tabs, 'touchcancel', -90, 2);
  await settled(page, 0);
  await expect(preview).toHaveCount(0);
  await expect(page.getByLabel('Поиск изменённых файлов')).not.toBeVisible();
});

test('cancels short and multi-touch gestures, and resists dragging beyond the last tab', async ({ page }) => {
  const tabs = page.locator('.chat-tabs');
  await touch(tabs, 'touchstart');
  await touch(tabs, 'touchmove', -18);
  await touch(tabs, 'touchend', -18);
  await settled(page, 0);
  await touch(tabs, 'touchstart');
  await touch(tabs, 'touchmove', -110);
  expect(await touch(tabs, 'touchstart', -110, 0, 0.5, 2, 'button:last-of-type')).toBe(false);
  await touch(tabs, 'touchend', -110);
  await settled(page, 0);
  await tabs.getByRole('button', { name: 'Файлы', exact: true }).click();
  await settled(page, 3);
  await touch(tabs, 'touchstart');
  await touch(tabs, 'touchmove', -120);
  const displacement = await page
    .locator('.page-slider-track')
    .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41);
  expect(displacement).toBeLessThan(0);
  expect(displacement).toBeGreaterThan(-120);
  await expect(page.locator('.slider-panel[data-preview="true"]')).toHaveCount(0);
  await touch(tabs, 'touchend', -120);
  await settled(page, 3);
});

test('honors the latest tab tap while a transition is running', async ({ page }) => {
  const files = page.getByRole('button', { name: 'Файлы', exact: true });
  await files.click();
  await expect(page.locator('.chat-page')).toHaveAttribute('data-page-transition', 'true');
  await page.getByRole('button', { name: 'Диалог', exact: true }).dispatchEvent('click');
  await settled(page, 0);
  await expect(page.getByLabel('Промпт для OpenCode')).toBeVisible();
  await files.click();
  await page.getByRole('button', { name: 'Задачи', exact: true }).dispatchEvent('click');
  await settled(page, 2);
  await expect(page.getByLabel('Поиск задач')).toBeVisible();
});

test('keeps the draft, scroll, expanded messages and file selection across tab visits', async ({ page }) => {
  const draft = page.getByLabel('Промпт для OpenCode');
  await draft.fill('Черновик при смене вкладок');
  await draft.blur();
  const chat = page.locator('.chat-scroll');
  const tool = chat.locator('.tool-block').first();
  await tool.locator('summary').click();
  await expect(tool).toHaveAttribute('open');
  const top = await chat.evaluate((element) => {
    element.scrollTop = 80;
    element.dispatchEvent(new Event('scroll'));
    return element.scrollTop;
  });
  await page.getByRole('button', { name: 'Файлы', exact: true }).click();
  await settled(page, 3);
  await page
    .locator('.file-list')
    .getByRole('button', { name: /README/ })
    .click();
  await expect(page.getByText('Your servers, under control.')).toBeVisible();
  await page.getByRole('button', { name: 'Изменения', exact: true }).click();
  await settled(page, 1);
  await expect(page.getByRole('button', { name: 'Назад к диалогу', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Файлы', exact: true }).click();
  await settled(page, 3);
  await expect(page.getByText('Your servers, under control.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Назад к файлам', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Диалог', exact: true }).click();
  await settled(page, 0);
  await expect(draft).toHaveValue('Черновик при смене вкладок');
  await expect(tool).toHaveAttribute('open');
  expect(await chat.evaluate((element) => element.scrollTop)).toBeCloseTo(top, 0);
});

test('previews the previous screen without navigating until release', async ({ page }) => {
  const surface = page.locator('.chat-page');
  await touch(surface, 'touchstart', 0, 0, 0.015);
  await touch(surface, 'touchmove', 120, 2, 0.015);
  await expect(
    page.locator('[data-page-deck="app"] > .deck-panel[data-preview="true"] .session-feed'),
  ).toBeVisible();
  await expect(surface).toBeVisible();
  await touch(surface, 'touchcancel', 120, 2, 0.015);
  await settled(page, 0);
  await expect(page.locator('.session-feed')).toHaveCount(0);
  await touch(surface, 'touchstart', 0, 0, 0.015);
  await touch(surface, 'touchmove', 140, 2, 0.015);
  await touch(surface, 'touchend', 140, 2, 0.015);
  await expect(surface).toHaveCount(0);
  await expect(page.locator('.session-feed')).toBeVisible();
});

test('settles immediately with reduced motion and cancels on a viewport resize', async ({ page }) => {
  const tabs = page.locator('.chat-tabs');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await tabs.getByRole('button', { name: 'Изменения', exact: true }).click();
  await settled(page, 1);
  await touch(tabs, 'touchstart');
  await touch(tabs, 'touchmove', -120);
  await touch(tabs, 'touchend', -120);
  await settled(page, 2);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await touch(tabs, 'touchstart');
  await touch(tabs, 'touchmove', -120);
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width + 40, height: size.height });
  await settled(page, 2);
  await touch(tabs, 'touchend', -120);
  await settled(page, 2);
});

test('previews the containing folder and retains the open file when back is cancelled', async ({ page }) => {
  await page.getByRole('button', { name: 'Файлы', exact: true }).click();
  await page
    .locator('.file-list')
    .getByRole('button', { name: /README/ })
    .click();
  await expect(page.getByText('Your servers, under control.')).toBeVisible();
  const surface = page.locator('.chat-page');
  await touch(surface, 'touchstart', 0, 0, 0.015);
  await touch(surface, 'touchmove', 130, 2, 0.015);
  await expect(
    page.locator('[data-page-deck="files"] > .deck-panel[data-preview="true"] .file-list'),
  ).toContainText('README.md');
  await expect(page.locator('[data-page-deck="files"] > .deck-panel[data-preview="true"]')).toHaveAttribute(
    'inert',
  );
  await touch(surface, 'touchcancel', 130, 2, 0.015);
  await settled(page, 3);
  await expect(page.getByText('Your servers, under control.')).toBeVisible();
  await touch(surface, 'touchstart', 0, 0, 0.015);
  await touch(surface, 'touchmove', 130, 2, 0.015);
  await touch(surface, 'touchend', 130, 2, 0.015);
  await settled(page, 3);
  await expect(page.locator('.slider-panel[data-active="true"] .file-list')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Назад к диалогу', exact: true })).toBeVisible();
});

test('hides native glass controls for the entire transition and restores them on cancellation', async ({
  page,
}) => {
  await page.emulateMedia({ contrast: 'no-preference' });
  await page.evaluate(async () => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      original(query === '(prefers-reduced-transparency: reduce)' ? '(max-width: 0px)' : query);
    const appearancePath = '/src/lib/appearance.ts';
    const glassPath = '/src/lib/glass.ts';
    const { setAppearance } = await import(appearancePath);
    const { installGlassHandling } = await import(glassPath);
    await setAppearance({ theme: 'mercury', nativeGlass: true });
    const cleanup = installGlassHandling(true, {
      appearanceCapabilities: async () => ({
        nativeGlass: true,
        reduceTransparency: false,
        reduceMotion: false,
        lowPower: false,
      }),
      setGlassAppearance: async ({ enabled }: { enabled: boolean }) => ({ enabled }),
      setGlassRegions: async ({ regions }: { regions: { id: string }[] }) => ({
        ids: regions.map((region) => region.id),
      }),
      addListener: async () => ({ remove: async () => undefined }),
    });
    Reflect.set(window, 'cleanupSliderGlass', cleanup);
  });
  const model = page.locator('[data-pocket-glass="model"]');
  await expect(model).toHaveAttribute('data-native-control', 'true');
  const tabs = page.locator('.chat-tabs');
  await touch(tabs, 'touchstart');
  await touch(tabs, 'touchmove', -100);
  await expect(model).not.toHaveAttribute('data-native-control');
  await touch(tabs, 'touchcancel', -100);
  await settled(page, 0);
  await expect(model).toHaveAttribute('data-native-control', 'true');
  await touch(tabs, 'touchstart');
  await touch(tabs, 'touchmove', -120);
  await touch(tabs, 'touchend', -120);
  await settled(page, 1);
  await expect(model).not.toHaveAttribute('data-native-control');
  await page.getByRole('button', { name: 'Диалог', exact: true }).click();
  await settled(page, 0);
  await expect(model).toHaveAttribute('data-native-control', 'true');
  await page.evaluate(() => Reflect.get(window, 'cleanupSliderGlass')());
});
