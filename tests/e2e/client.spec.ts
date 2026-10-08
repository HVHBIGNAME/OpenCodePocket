import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

async function connect(page: Page) {
  await page.request.post('http://127.0.0.1:4097/__test/reset');
  const pair = (await (await page.request.get('http://127.0.0.1:4097/__test/pair')).json()) as {
    link: string;
  };
  await page.goto('/');
  await page.getByRole('button', { name: 'Подключить компьютер', exact: true }).click();
  await page.getByLabel('Ссылка подключения').fill(pair.link);
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Подключение: DESKTOP-1337' })).toBeVisible();
  await expect(page.getByText('Панель управления — новая архитектура', { exact: true })).toBeVisible();
}

async function tab(page: Page, name: string) {
  if (await page.getByRole('button', { name: 'Назад к сессиям' }).count())
    await page.getByRole('button', { name: 'Назад к сессиям' }).click();
  await page
    .getByRole('navigation', { name: 'Главная навигация' })
    .getByRole('button', { name, exact: true })
    .click();
}

test('pairs, resumes a session, streams a prompt and reads files, tasks and patches', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await expect(page.getByRole('navigation', { name: 'Главная навигация' })).toHaveCount(0);
  await expect(page.getByText('Предлагаемая структура', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Изменения', exact: true }).click();
  await expect(page.getByText('src/modules/servers/events.ts')).toBeVisible();
  await page.getByRole('button', { name: 'Задачи', exact: true }).click();
  await expect(page.getByText('Подключить интерфейс управления', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Файлы', exact: true }).click();
  await page.getByRole('button', { name: /README.md/ }).click();
  await expect(page.getByText('Your servers, under control.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Диалог', exact: true }).click();
  await page.getByLabel('Промпт для OpenCode').fill('Добавь интеграционные тесты для событий.');
  await page.getByRole('button', { name: 'Отправить промпт' }).click();
  await expect(
    page.getByText('Готово. Изменения применены, проверка пройдена.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Промпт для OpenCode')).toHaveValue('');
  const state = await (await page.request.get('http://127.0.0.1:4097/__test/state')).json();
  expect(state.prompts).toHaveLength(1);
  expect(state.prompts[0]).toMatchObject({
    sessionID: 'ses_panel',
    directory: 'C:/coding/emberdeck',
    model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
  });
  expect(errors).toEqual([]);
});

test('answers a question step by step, preserves answers when going back, and approves once', async ({
  page,
}) => {
  await connect(page);
  await tab(page, 'Запросы');
  await page.getByRole('radio', { name: /Redis/ }).check();
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await page.getByRole('checkbox', { name: /OAuth/ }).check();
  await page.getByRole('checkbox', { name: /Passkeys/ }).check();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByRole('radio', { name: /Redis/ })).toBeChecked();
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /Passkeys/ })).toBeChecked();
  await page.getByRole('button', { name: 'Отправить ответ' }).click();
  await page.getByRole('button', { name: 'Разрешить', exact: true }).click();
  await expect(page.getByText('Можно выдохнуть', { exact: true })).toBeVisible();
  const state = await (await page.request.get('http://127.0.0.1:4097/__test/state')).json();
  expect(state.replies).toEqual([
    { kind: 'question', id: 'que_auth', answers: [['Redis'], ['OAuth', 'Passkeys']] },
    { kind: 'permission', id: 'per_build', reply: 'once' },
  ]);
});

test('changes the default model, global permissions, and provider credentials', async ({ page }) => {
  await connect(page);
  await tab(page, 'Модели');
  const card = page
    .locator('.model-card')
    .filter({ has: page.getByRole('heading', { name: 'GPT-5.4', exact: true }) });
  await card.getByRole('button', { name: 'Выбрать', exact: true }).click();
  await page.getByRole('button', { name: 'По умолчанию', exact: true }).click();
  await page.getByRole('button', { name: 'Провайдер', exact: true }).click();
  await page.getByLabel('API-ключ', { exact: true }).fill('test-only-never-a-real-key');
  await page.getByRole('button', { name: 'Подключить', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await tab(page, 'Настройки');
  await page.getByRole('button', { name: /Автопилот/ }).click();
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const state = await (await page.request.get('http://127.0.0.1:4097/__test/state')).json();
  expect(state.config.model).toBe('openai/gpt-5.4');
  expect(state.config.permission).toBe('allow');
  expect(state.providerKeys).toContain('anthropic');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(
    /test-only-never-a-real-key|Bearer/,
  );
});

test('mobile ergonomics: bottom sheets, agent and variant, keyboard space, readable targets', async ({
  page,
}) => {
  await connect(page);
  const newButton = await page.getByRole('button', { name: 'Новая сессия', exact: true }).boundingBox();
  expect(newButton!.height).toBeGreaterThanOrEqual(48);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await page.getByRole('button', { name: 'Модель и режим сессии' }).click();
  await page.getByRole('button', { name: /Планировать/ }).click();
  await page.getByRole('button', { name: 'high', exact: true }).click();
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  const size = page.viewportSize()!;
  for (const width of [320, size.width]) {
    await page.setViewportSize({ width, height: 440 });
    await page.getByLabel('Промпт для OpenCode').fill('Сначала составь план.');
    for (const name of ['Назад к сессиям', 'Прикрепить файл', 'Надиктовать промпт', 'Отправить промпт']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toBeInViewport();
      const bounds = await button.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'Отправить промпт' }).click();
  const state = await (await page.request.get('http://127.0.0.1:4097/__test/state')).json();
  expect(state.prompts[0]).toMatchObject({ agent: 'plan', variant: 'high' });
  await page.setViewportSize(size);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('keeps the reading position during streaming and jumps to the latest on request', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  const chat = page.locator('.chat-scroll');
  await expect(chat).toContainText('Предлагаемая структура');
  await chat.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(page.getByRole('button', { name: 'К последнему' })).toBeVisible();
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: {
      type: 'message.part.delta',
      properties: {
        sessionID: 'ses_panel',
        messageID: 'msg_answer',
        partID: 'prt_end',
        field: 'text',
        delta: '\n\nНовая часть потокового ответа.',
      },
    },
  });
  await expect(chat).toContainText('Новая часть потокового ответа.');
  const historyReload = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/session/ses_panel/message',
  );
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: { type: 'session.idle', properties: { sessionID: 'ses_panel' } },
  });
  expect(await (await historyReload).json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        info: expect.objectContaining({ id: 'msg_answer' }),
        parts: expect.arrayContaining([
          expect.objectContaining({
            id: 'prt_end',
            text: expect.stringContaining('Новая часть потокового ответа.'),
          }),
        ]),
      }),
    ]),
  );
  await expect(chat).toContainText('Новая часть потокового ответа.');
  expect(await chat.evaluate((element) => element.scrollTop)).toBeLessThan(2);
  await page.getByRole('button', { name: 'К последнему' }).click();
  await expect(page.getByText('Новая часть потокового ответа.', { exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'К последнему' })).toHaveCount(0);
});

test('automatically queues a redacted failure and allows opting out', async ({ page }) => {
  await connect(page);
  const uploads: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/occ/reports') && request.method() === 'POST')
      uploads.push(request.postData() ?? '');
  });
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('PRIVATE_PROMPT_MUST_NOT_LEAVE_DEVICE');
    }, 0);
  });
  await expect.poll(() => uploads.length).toBeGreaterThan(0);
  expect(uploads.join('')).not.toContain('PRIVATE_PROMPT_MUST_NOT_LEAVE_DEVICE');
  await tab(page, 'Настройки');
  await page.getByRole('switch', { name: /Отправлять обезличенные отчёты/ }).uncheck();
  await expect(page.getByRole('button', { name: 'Проверить отправку' })).toBeDisabled();
  const count = uploads.length;
  await page.evaluate(() => {
    setTimeout(() => {
      throw new RangeError('DISABLED_DIAGNOSTIC');
    }, 0);
  });
  await page.waitForTimeout(500);
  expect(uploads.length).toBe(count);
});

test('mobile release screenshots and absence of desktop navigation', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Подключить компьютер', exact: true })).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/${info.project.name}-welcome.png` });
  await connect(page);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expect(page.locator('aside.sidebar')).toHaveCount(0);
  await page.screenshot({ path: `artifacts/screenshots/${info.project.name}-sessions.png` });
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await expect(page.getByText('Предлагаемая структура', { exact: true })).toBeVisible();
  await page.locator('.chat-scroll').evaluate((element) => {
    const answer = element.querySelector('.message-assistant');
    if (answer)
      element.scrollTop += answer.getBoundingClientRect().top - element.getBoundingClientRect().top - 16;
  });
  await page.screenshot({ path: `artifacts/screenshots/${info.project.name}-chat.png` });
  await page.getByRole('button', { name: 'Модель и режим сессии' }).click();
  await page.screenshot({ path: `artifacts/screenshots/${info.project.name}-options.png` });
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await tab(page, 'Запросы');
  await expect(page.getByText('Где храним пользовательские сессии?', { exact: true })).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/${info.project.name}-inbox.png` });
  for (const [name, suffix] of [
    ['Модели', 'models'],
    ['Настройки', 'settings'],
  ] as const) {
    await tab(page, name);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: `artifacts/screenshots/${info.project.name}-${suffix}.png` });
  }
  await page.getByRole('button', { name: 'Тема: Mercury', exact: true }).click();
  await page.screenshot({ path: `artifacts/screenshots/${info.project.name}-themes.png` });
  await page.getByLabel('Поиск тем').fill('Catppuccin');
  await page
    .getByRole('group', { name: 'Каталог тем' })
    .getByRole('button', { name: 'Catppuccin', exact: true })
    .click();
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await tab(page, 'Сессии');
  await page.screenshot({ path: `artifacts/screenshots/${info.project.name}-catppuccin.png` });
  await tab(page, 'Настройки');
  await page.getByRole('button', { name: 'Светлая', exact: true }).click();
  await page.getByRole('button', { name: 'Тема: Catppuccin', exact: true }).click();
  await page.getByLabel('Поиск тем').fill('GitHub');
  await page
    .getByRole('group', { name: 'Каталог тем' })
    .getByRole('button', { name: 'GitHub', exact: true })
    .click();
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await tab(page, 'Сессии');
  await page.screenshot({ path: `artifacts/screenshots/${info.project.name}-github-light.png` });
});
