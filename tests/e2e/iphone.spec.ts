import { connect, expect, test, type Page, type Locator } from './fixtures';

const profiles = [
  { name: 'se-320', width: 320, height: 568, top: 20, bottom: 0, side: 0 },
  { name: 'se-375', width: 375, height: 667, top: 20, bottom: 0, side: 0 },
  { name: 'plus-classic', width: 414, height: 736, top: 20, bottom: 0, side: 0 },
  { name: 'mini', width: 375, height: 812, top: 50, bottom: 34, side: 0 },
  { name: 'standard', width: 390, height: 844, top: 47, bottom: 34, side: 0 },
  { name: 'pro', width: 393, height: 852, top: 59, bottom: 34, side: 0 },
  { name: 'pro-402', width: 402, height: 874, top: 62, bottom: 34, side: 0 },
  { name: 'max-414', width: 414, height: 896, top: 44, bottom: 34, side: 0 },
  { name: 'plus-428', width: 428, height: 926, top: 47, bottom: 34, side: 0 },
  { name: 'max-430', width: 430, height: 932, top: 59, bottom: 34, side: 0 },
  { name: 'max-440', width: 440, height: 956, top: 62, bottom: 34, side: 0 },
  { name: 'se-landscape', width: 568, height: 320, top: 0, bottom: 0, side: 0 },
  { name: 'notch-landscape', width: 844, height: 390, top: 0, bottom: 21, side: 47 },
  { name: 'max-landscape', width: 956, height: 440, top: 0, bottom: 21, side: 62 },
];

async function keyboard(page: Page, width: number, height: number, inset: number) {
  await page.evaluate(
    async ({ width, height, inset }) => {
      const path = '/src/lib/keyboard.ts';
      const { renderKeyboardFrame } = await import(path);
      renderKeyboardFrame({
        viewportWidth: width,
        viewportHeight: height - inset,
        keyboardHeight: inset,
        duration: 0,
        curve: 0,
      });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    },
    { width, height, inset },
  );
}

async function reachable(control: Locator, width: number, bottom: number, side: number) {
  await expect(control).toBeInViewport();
  const box = (await control.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(side - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(width - side + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(bottom + 1);
}

test('iPhone size matrix: safe areas, focus, long requests, attachments and keyboard', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'ios-webkit', 'iPhone viewport matrix uses WebKit.');
  test.setTimeout(240000);
  await connect(page);
  const questions = [
    {
      header: 'План релиза',
      question: 'Нужно выбрать способ проверки нового интерфейса перед публикацией. '.repeat(5),
      options: [
        {
          label: 'Проверить основные сценарии',
          description:
            'Открыть диалог, выбрать модель, ввести длинный текст, прикрепить файл и ответить на вопрос. '.repeat(
              2,
            ),
        },
        {
          label: 'Проверить адаптивную раскладку',
          description:
            'Проверить маленький экран, безопасные зоны, горизонтальный режим и открытую клавиатуру. '.repeat(
              2,
            ),
        },
        {
          label: 'Оба варианта',
          description: 'Сохранить результаты проверок и убедиться, что кнопки доступны на каждом шаге.',
        },
      ],
    },
  ];
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: { type: 'question.asked', properties: { id: 'q_layout', sessionID: 'ses_panel', questions } },
  });
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(
      ['one', 'two'].map((name) => ({
        name: `${name}-long-attachment-name-for-the-layout-test.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n'),
      })),
    );
  for (const profile of profiles)
    await test.step(profile.name, async () => {
      const { width, height, top, bottom, side } = profile;
      await page.setViewportSize({ width, height });
      await page.evaluate(
        async ({ top, bottom, side }) => {
          for (const [edge, value] of Object.entries({ top, bottom, left: side, right: side }))
            document.documentElement.style.setProperty(`--safe-area-inset-${edge}`, `${value}px`);
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        },
        { top, bottom, side },
      );
      await keyboard(page, width, height, 0);
      const input = page.getByLabel('Промпт для OpenCode');
      await input.fill('Дополнение к работающей задаче. '.repeat(8));
      await expect(input).toHaveCSS('outline-style', 'none');
      await expect(input).toHaveCSS('box-shadow', 'none');
      await reachable(page.getByRole('button', { name: 'Отправить промпт' }), width, height - bottom, side);
      const inset = width > height ? 180 : Math.min(336, Math.round(height * 0.45));
      await keyboard(page, width, height, inset);
      await reachable(page.getByRole('button', { name: 'Отправить промпт' }), width, height - inset, side);
      if (width > height)
        await reachable(page.getByRole('button', { name: 'Скрыть клавиатуру' }), width, height - inset, side);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await input.blur();
      await keyboard(page, width, height, 0);
      await page.getByRole('button', { name: /Нужен твой ответ/ }).click();
      const sheet = page.getByRole('dialog', { name: 'Запросы', exact: true });
      await expect(sheet).toBeVisible();
      await sheet.getByRole('radio').first().check();
      const send = sheet.getByRole('button', { name: 'Отправить ответ' });
      await reachable(send, width, height - bottom, side);
      const custom = sheet.getByLabel('Свой ответ: План релиза');
      await custom.fill('Проверить все размеры');
      await expect(custom).toHaveCSS('outline-style', 'none');
      await keyboard(page, width, height, inset);
      await reachable(send, width, height - inset, side);
      const fieldBox = (await custom.boundingBox())!;
      const body = (await sheet.locator('.request-body').boundingBox())!;
      expect(fieldBox.y).toBeGreaterThanOrEqual(body.y - 1);
      expect(fieldBox.y + fieldBox.height).toBeLessThanOrEqual(body.y + body.height + 1);
      await custom.blur();
      await keyboard(page, width, height, 0);
      if (['se-320', 'max-440', 'notch-landscape'].includes(profile.name))
        await page.screenshot({ path: info.outputPath(`${profile.name}-requests.png`) });
      await sheet.getByRole('button', { name: 'Закрыть', exact: true }).click();
      await expect(sheet).toHaveCount(0);
    });
});
