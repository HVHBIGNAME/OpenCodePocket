import { test, expect, connect, settlePages } from './fixtures';

test.beforeEach(async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).tap();
  await settlePages(page);
  await expect(page.getByLabel('Промпт для OpenCode')).toBeEnabled();
});

test('touch-opened sheets do not select their first button or restore the editor on close', async ({
  page,
}) => {
  const editor = page.getByLabel('Промпт для OpenCode');
  await editor.fill('Сохранённый черновик');
  await page.getByRole('button', { name: 'Модель и режим сессии' }).tap();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.modal-handle')).not.toBeFocused();
  await expect(sheet.locator('.modal-inner')).toBeFocused();
  await expect(sheet.locator('.modal-inner')).toHaveCSS('outline-style', 'none');
  await sheet.getByRole('button', { name: 'Готово', exact: true }).tap();
  await expect(sheet).toHaveCount(0);
  await expect(editor).not.toBeFocused();
  await expect(editor).toHaveValue('Сохранённый черновик');
});

test('Tab focus stays visible and returns to the opener after keyboard dismissal', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Модель и режим сессии' });
  await opener.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(opener).toBeFocused();
  await expect(opener).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog');
  await expect(sheet.locator('.modal-handle')).toBeFocused();
  await expect(sheet.locator('.modal-handle')).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(opener).toHaveCSS('outline-style', 'solid');
});

test('touch after keyboard navigation removes the keyboard ring and preserves selectable message text', async ({
  page,
}) => {
  const opener = page.getByRole('button', { name: 'Модель и режим сессии' });
  await opener.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(opener).toHaveCSS('outline-style', 'solid');
  await page.locator('.chat-heading h1').tap();
  await expect(opener).toHaveCSS('outline-style', 'none');
  const paragraph = page.locator('.message-assistant .markdown p').first();
  const selected = await paragraph.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return { text: selection.toString(), selectable: getComputedStyle(element).userSelect };
  });
  expect(selected.text.length).toBeGreaterThan(10);
  expect(selected.selectable).not.toBe('none');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
});

test('native glass activation does not inherit keyboard focus styling', async ({ page }) => {
  await page.emulateMedia({ contrast: 'no-preference' });
  await page.evaluate(async () => {
    const media = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      media(query === '(prefers-reduced-transparency: reduce)' ? '(max-width: 0px)' : query);
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
      addListener: async (name: string, callback: (value: { id: string }) => void) => {
        if (name === 'glassAction') Reflect.set(window, 'activateGlass', callback);
        return { remove: async () => undefined };
      },
    });
    Reflect.set(window, 'cleanupFocusGlass', cleanup);
  });
  await expect(page.locator('[data-pocket-glass="model"]')).toHaveAttribute('data-native-control', 'true');
  await page.keyboard.press('Tab');
  await expect(page.locator('html')).toHaveAttribute('data-input-mode', 'keyboard');
  await page.evaluate(() => Reflect.get(window, 'activateGlass')({ id: 'model' }));
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-input-mode', 'pointer');
  await expect(sheet.locator('.modal-inner')).toBeFocused();
  await expect(sheet.locator('.modal-handle')).toHaveCSS('outline-style', 'none');
  await sheet.getByRole('button', { name: 'Готово', exact: true }).tap();
  await expect(sheet).toHaveCount(0);
  await page.evaluate(() => Reflect.get(window, 'cleanupFocusGlass')());
});
