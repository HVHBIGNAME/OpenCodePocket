import { expect, test } from '@playwright/test';
import catalog from '../../src/themes/catalog.json' with { type: 'json' };

test('offers Liquid Glass only on iPhone and preserves readable reduced-transparency surfaces', async ({
  page,
}, info) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Главная навигация' })
    .getByRole('button', { name: 'Настройки' })
    .click();
  await page.getByRole('button', { name: 'Тема: Mercury', exact: true }).click();
  await page.getByLabel('Поиск тем').fill('Liquid Glass');
  const option = page.getByRole('button', { name: 'Liquid Glass', exact: true });
  if (info.project.name !== 'ios-webkit') {
    await expect(option).toHaveCount(0);
    return;
  }
  await option.click();
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'liquid-glass');
  await expect(page.locator('html')).toHaveAttribute('data-glass-renderer', 'css');
  for (const label of ['Тёмная', 'Светлая']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({
      path: info.outputPath(`liquid-glass-${label === 'Тёмная' ? 'dark' : 'light'}.png`),
    });
  }
  await page.getByRole('switch', { name: /Уменьшить прозрачность/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-glass-renderer', 'opaque');
  expect(
    await page.locator('.mobile-nav').evaluate((element) => getComputedStyle(element).backdropFilter),
  ).toBe('none');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'liquid-glass');
  await expect(page.locator('html')).toHaveAttribute('data-glass-renderer', 'opaque');
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
