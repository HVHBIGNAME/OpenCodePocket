import { test, expect, connect, settlePages, type Page } from './fixtures';

async function navigate(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Главная навигация' })
    .getByRole('button', { name, exact: true })
    .click();
  await settlePages(page);
}

test('opens every settings section, returns with native back, and restores the list position', async ({
  page,
}) => {
  await connect(page);
  await navigate(page, 'Настройки');
  await expect(page.locator('.settings-menu-row')).toHaveCount(9);
  await expect(page.locator('.settings-page input, .settings-page select')).toHaveCount(0);
  for (const title of [
    'Оформление',
    'Уведомления',
    'Голосовой ввод',
    'Интерфейс',
    'Подключение',
    'Разрешения OpenCode',
    'Обновления',
    'Автоотчёты об ошибках',
  ]) {
    const row = page.getByRole('button', { name: title, exact: true });
    await row.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    const position = await row.evaluate((element) => element.closest('[data-page-scroll]')!.scrollTop);
    await row.click();
    await settlePages(page);
    await expect(page.locator('.settings-detail h1')).toHaveText(title);
    await expect(page.getByRole('button', { name: 'Назад к настройкам', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() =>
      document.dispatchEvent(new Event('pocket:navigate-back', { cancelable: true })),
    );
    await expect(page.locator('.settings-detail')).toHaveCount(0);
    await settlePages(page);
    await expect
      .poll(() => row.evaluate((element) => element.closest('[data-page-scroll]')!.scrollTop))
      .toBeCloseTo(position, 0);
  }
});

test('keeps a question answer and its current step after leaving requests', async ({ page }) => {
  await connect(page);
  await navigate(page, 'Запросы');
  await page.getByRole('radio', { name: /Redis/ }).check();
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  const custom = page.getByRole('textbox', { name: /^Свой ответ:/ });
  await custom.fill('Сохранить мой ответ при переходе');
  await navigate(page, 'Сессии');
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await page.getByLabel('Промпт для OpenCode').fill('Другой черновик');
  await page.getByRole('button', { name: 'Назад к сессиям', exact: true }).click();
  await navigate(page, 'Запросы');
  await expect(page.getByText('Вопрос 2 из 2')).toBeVisible();
  await expect(custom).toHaveValue('Сохранить мой ответ при переходе');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByRole('radio', { name: /Redis/ })).toBeChecked();
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await page.getByRole('button', { name: 'Отправить ответ', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Вопрос от OpenCode' })).toHaveCount(0);
  const state = await (await page.request.get('http://127.0.0.1:4097/__test/state')).json();
  expect(state.replies).toContainEqual({
    kind: 'question',
    id: 'que_auth',
    answers: [['Redis'], ['Сохранить мой ответ при переходе']],
  });
});

test('fits the model summary and main controls on small phones in both color modes', async ({
  page,
}, info) => {
  await connect(page);
  for (const mode of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: mode });
    await page.evaluate(async (scheme) => {
      const path = '/src/lib/appearance.ts';
      const { setAppearance } = await import(path);
      await setAppearance({ scheme });
    }, mode);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 780 });
      await navigate(page, 'Модели');
      await page
        .locator('.model-card')
        .first()
        .getByRole('button', { name: /^Выбра/ })
        .click();
      const title = page.locator('.models-active h3');
      await expect(title).toBeVisible();
      const box = (await title.boundingBox())!;
      expect(box.width).toBeGreaterThan(150);
      expect(box.height).toBeLessThan(70);
      await expect(page.locator('.model-card').first()).toBeInViewport();
      await expect(page.getByRole('button', { name: 'По умолчанию', exact: true })).toBeInViewport();
      await page.screenshot({ path: info.outputPath(`models-${mode}-${width}.png`) });
      await navigate(page, 'Настройки');
      await page.screenshot({ path: info.outputPath(`settings-${mode}-${width}.png`) });
      await navigate(page, 'Сессии');
      await page.screenshot({ path: info.outputPath(`sessions-${mode}-${width}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
  }
});
