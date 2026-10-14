import { expect, test } from './fixtures';
import catalog from '../../src/themes/catalog.json' with { type: 'json' };

test('keeps original palettes and migrates the old glass theme without a CSS imitation', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('occ.appearance', JSON.stringify({ theme: 'liquid-glass', scheme: 'dark' })),
  );
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'mercury');
  await expect(page.locator('html')).toHaveAttribute('data-native-glass', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-glass-renderer', 'none');
  await page
    .getByRole('navigation', { name: 'Главная навигация' })
    .getByRole('button', { name: 'Настройки' })
    .click();
  await page.getByRole('button', { name: 'Тема: Mercury', exact: true }).click();
  await page.getByLabel('Поиск тем').fill('Liquid Glass');
  const option = page.getByRole('button', { name: 'Liquid Glass', exact: true });
  await expect(option).toHaveCount(0);
  await expect(page.getByRole('switch', { name: /Apple Liquid Glass/ })).toHaveCount(0);
});

test('hands native controls back to HTML for sheets and accessibility changes', async ({ page }) => {
  await page.emulateMedia({ contrast: 'no-preference' });
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      original(query === '(prefers-reduced-transparency: reduce)' ? '(max-width: 0px)' : query);
  });
  await page.goto('/');
  await expect(page.locator('.connection-switch')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-glass-renderer', 'none');
  await page.evaluate(async () => {
    const appearancePath = '/src/lib/appearance.ts';
    const glassPath = '/src/lib/glass.ts';
    const { setAppearance } = await import(appearancePath);
    const { installGlassHandling } = await import(glassPath);
    await setAppearance({ theme: 'github', nativeGlass: true });
    const callbacks = new Map<string, (event: unknown) => void>();
    const calls: { regions: { id: string }[] }[] = [];
    const capabilities = {
      nativeGlass: true,
      reduceTransparency: false,
      reduceMotion: false,
      lowPower: false,
    };
    const cleanup = installGlassHandling(true, {
      appearanceCapabilities: async () => capabilities,
      setGlassAppearance: async ({ enabled }: { enabled: boolean }) => ({ enabled }),
      setGlassRegions: async (options: { regions: { id: string }[] }) => {
        calls.push(options);
        return { ids: options.regions.map((region) => region.id) };
      },
      addListener: async (name: string, callback: (event: unknown) => void) => {
        callbacks.set(name, callback);
        return {
          remove: async () => {
            callbacks.delete(name);
          },
        };
      },
    });
    Reflect.set(window, 'glassTest', { callbacks, calls, capabilities, cleanup });
  });
  const connection = page.locator('.connection-switch');
  await expect(connection).toHaveAttribute('data-native-control', 'true');
  await expect(connection).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'github');
  await page.evaluate(() =>
    Reflect.get(window, 'glassTest').callbacks.get('glassAction')({ id: 'connection' }),
  );
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(connection).not.toHaveAttribute('data-native-control', 'true');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(connection).toHaveAttribute('data-native-control', 'true');
  await page.evaluate(() => {
    const state = Reflect.get(window, 'glassTest');
    state.callbacks.get('appearanceAccessibility')({ ...state.capabilities, reduceTransparency: true });
  });
  await expect(connection).not.toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-glass-renderer', 'none');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'github');
  await page.evaluate(() => Reflect.get(window, 'glassTest').cleanup());
});

test('loads palettes on demand and ignores an older theme selection that finishes late', async ({ page }) => {
  const palettes: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/palettes/')) palettes.push(request.url());
  });
  await page.goto('/');
  expect(palettes.every((url) => url.includes('mercury'))).toBe(true);
  await page
    .getByRole('navigation', { name: 'Главная навигация' })
    .getByRole('button', { name: 'Настройки' })
    .click();
  await page.getByRole('button', { name: 'Тема: Mercury', exact: true }).click();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/palettes/catppuccin.json*', async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByLabel('Поиск тем').fill('Catppuccin');
  await page
    .getByRole('group', { name: 'Каталог тем' })
    .getByRole('button', { name: 'Catppuccin', exact: true })
    .click();
  await page.getByLabel('Поиск тем').fill('GitHub');
  await page.getByRole('button', { name: 'GitHub', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'github');
  release();
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Тема: GitHub', exact: true })).toBeVisible();
});

for (const mode of ['dark', 'light'] as const) {
  test(`all ${catalog.themes.length} original OpenCode themes render in ${mode} mode`, async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Главная навигация' })
      .getByRole('button', { name: 'Настройки' })
      .click();
    await page.getByRole('button', { name: mode === 'dark' ? 'Тёмная' : 'Светлая', exact: true }).click();
    await page.getByRole('button', { name: 'Тема: Mercury', exact: true }).click();
    for (const theme of catalog.themes) {
      await page.getByLabel('Поиск тем').fill(theme.name);
      await page
        .getByRole('group', { name: 'Каталог тем' })
        .getByRole('button', { name: theme.name, exact: true })
        .click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
      await expect(page.locator('html')).toHaveAttribute('data-color-mode', mode);
      const result = await page.evaluate((tokens) => {
        const root = document.documentElement;
        const missing = Object.entries(tokens)
          .filter(([key, value]) => root.style.getPropertyValue(`--${key}`) !== value)
          .map(([key]) => key);
        const sample = document.createElement('span');
        sample.style.backgroundColor = tokens['background-base'];
        document.body.append(sample);
        const expectedBackground = getComputedStyle(sample).backgroundColor;
        sample.remove();
        return {
          missing,
          background: getComputedStyle(document.querySelector('.app-shell')!).backgroundColor,
          expectedBackground,
          overflow: root.scrollWidth > innerWidth + 1,
        };
      }, theme[mode]);
      expect(result.missing, theme.name).toEqual([]);
      expect(result.background, theme.name).toBe(result.expectedBackground);
      expect(result.overflow, theme.name).toBe(false);
    }
    expect(errors).toEqual([]);
  });
}

test('persists the theme across restarts and follows system appearance only when selected', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Главная навигация' })
    .getByRole('button', { name: 'Настройки' })
    .click();
  await page.getByRole('button', { name: 'Тема: Mercury', exact: true }).click();
  await page.getByLabel('Поиск тем').fill('Catppuccin');
  await page
    .getByRole('group', { name: 'Каталог тем' })
    .getByRole('button', { name: 'Catppuccin', exact: true })
    .click();
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await page.getByRole('button', { name: 'Системная', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'catppuccin');
  await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'light');
  await page
    .getByRole('navigation', { name: 'Главная навигация' })
    .getByRole('button', { name: 'Настройки' })
    .click();
  await page.getByRole('button', { name: 'Тёмная', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'dark');
});
