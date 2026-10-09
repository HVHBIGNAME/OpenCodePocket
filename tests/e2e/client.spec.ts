import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

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

test('opens task sessions, reads agent messages and returns to the parent with its draft', async ({
  page,
}, testInfo) => {
  await connect(page);
  await page.request.post('http://127.0.0.1:4097/__test/agents');
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  const task = page.getByRole('region', { name: 'Задача агента: Аудит модулей' });
  await expect(task).toContainText('В работе');
  await task.screenshot({ path: testInfo.outputPath('agent-task.png') });
  await page.getByLabel('Промпт для OpenCode').fill('Черновик основной сессии');
  await page.route('**/api/session/ses_child?*', (route) =>
    route.fulfill({ status: 503, json: { error: 'Агент временно недоступен' } }),
  );
  await task.getByRole('button', { name: 'Открыть диалог агента' }).click();
  await expect(page.getByRole('alert')).toContainText('Агент временно недоступен');
  await expect(page.getByLabel('Промпт для OpenCode')).toHaveValue('Черновик основной сессии');
  await page.unroute('**/api/session/ses_child?*');
  await task.getByRole('button', { name: 'Открыть диалог агента' }).click();
  await expect(page.getByRole('heading', { name: 'Аудит модулей (@explore subagent)' })).toBeVisible();
  await expect(page.getByText('Агент проверил границы модулей. Найдено два улучшения.')).toBeVisible();
  await expect(page.getByLabel('Промпт для OpenCode')).toHaveValue('');
  await page.screenshot({ path: testInfo.outputPath('agent-session.png') });
  await page.getByRole('button', { name: 'Назад к основной сессии' }).click();
  await expect(page.getByLabel('Промпт для OpenCode')).toHaveValue('Черновик основной сессии');
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: { type: 'session.status', properties: { sessionID: 'ses_child', status: { type: 'idle' } } },
  });
  await expect(task).toContainText('Завершена');
  await page.getByText('Агенты · 1', { exact: true }).click();
  await page.getByRole('button', { name: /Аудит модулей \(@explore subagent\).*Открыть/ }).click();
  await expect(page.getByRole('button', { name: 'Назад к основной сессии' })).toBeVisible();
});

test('configures and revokes a personal ntfy channel without claiming phone delivery', async ({
  page,
}, testInfo) => {
  await connect(page);
  await tab(page, 'Настройки');
  const settings = page.getByRole('region', { name: 'Настройка уведомлений' });
  await expect(settings.getByRole('button', { name: 'Отправить тестовое уведомление' })).toBeDisabled();
  const toggle = settings.getByRole('switch', { name: /Доставка через ntfy/ });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(settings.getByText('Добавьте подписку в ntfy', { exact: true })).toBeVisible();
  await expect(settings.locator('.notification-topic code')).toHaveText(/^occ-[a-f0-9]{48}$/);
  await settings.screenshot({ path: testInfo.outputPath('notifications.png') });
  await page.route('**/occ/notifications/test', (route) =>
    route.fulfill({ json: { dispatched: false, attempted: 1, delivered: 0, failed: 1 } }),
  );
  await settings.getByRole('button', { name: 'Отправить тестовое уведомление' }).click();
  await expect(settings.getByRole('status')).toContainText('Тест не отправлен');
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(settings.locator('.notification-topic')).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Отправить тестовое уведомление' })).toBeDisabled();
});

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
  await expect(page.getByText('Нет запросов', { exact: true })).toBeVisible();
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

test('keeps server errors compact and reveals complete details on demand', async ({ page }) => {
  await connect(page);
  const message = `Failed to load plugin old-plugin@latest: ${'C:/very-long-module-path/'.repeat(30)}missing`;
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: { type: 'session.error', properties: { error: { data: { message } } } },
  });
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  expect((await alert.boundingBox())!.height).toBeLessThan(160);
  await alert.getByRole('button', { name: 'Подробнее' }).click();
  await expect(page.getByRole('dialog')).toContainText(message);
});

test('shows streamed reasoning when supplied and reports cancellation once in Russian', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await expect(page.getByText('Предлагаемая структура', { exact: true })).toBeVisible();
  const part = {
    id: 'prt_reason',
    messageID: 'msg_answer',
    sessionID: 'ses_panel',
    type: 'reasoning',
    text: 'Проверю зависимости.',
    time: { start: Date.now() },
  };
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: { type: 'message.part.updated', properties: { part } },
  });
  const reasoning = page.locator('.reasoning-block');
  await expect(reasoning).toHaveAttribute('open', '');
  await expect(reasoning).toContainText(part.text);
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: {
      type: 'message.part.delta',
      properties: {
        sessionID: part.sessionID,
        messageID: part.messageID,
        partID: part.id,
        field: 'text',
        delta: ' Затем выполню проверку.',
      },
    },
  });
  await expect(reasoning).toContainText('Затем выполню проверку.');
  const history = await (await page.request.get('http://127.0.0.1:4097/session/ses_panel/message')).json();
  const error = { name: 'MessageAbortedError', data: { message: 'The operation was aborted.' } };
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: { type: 'message.updated', properties: { info: { ...history[1].info, error } } },
  });
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: { type: 'session.error', properties: { sessionID: 'ses_panel', error } },
  });
  await expect(page.getByText('Генерация отменена', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('The operation was aborted.', { exact: true })).toHaveCount(0);
});

test('prepares a phone photo, retains it after a failed send, and uploads it on retry', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  const photo = await sharp(randomBytes(1200 * 800 * 3), { raw: { width: 1200, height: 800, channels: 3 } })
    .png()
    .toBuffer();
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'Фото.png', mimeType: 'image/png', buffer: photo });
  await expect(page.locator('.composer-attachments')).toContainText('Фото.jpg');
  await page.getByLabel('Промпт для OpenCode').fill('Проверь вложение');
  await page.route(
    '**/prompt_async?*',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Временная ошибка загрузки' }),
      }),
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Отправить промпт' }).click();
  await expect(page.getByRole('alert')).toContainText('Временная ошибка загрузки');
  await expect(page.locator('.composer-attachments')).toContainText('Фото.jpg');
  await expect(page.getByLabel('Промпт для OpenCode')).toHaveValue('Проверь вложение');
  await page.getByRole('button', { name: 'Скрыть сообщение' }).click();
  await page.getByRole('button', { name: 'Отправить промпт' }).click();
  await expect(page.locator('.composer-attachments')).toHaveCount(0);
  const state = await (await page.request.get('http://127.0.0.1:4097/__test/state')).json();
  expect(state.prompts).toHaveLength(1);
  const attachment = state.prompts[0].parts.find((part: { type: string }) => part.type === 'file');
  expect(attachment.mime).toBe('image/jpeg');
  expect(attachment.filename).toBe('Фото.jpg');
  expect(attachment.url).toMatch(/^data:image\/jpeg;base64,/);
  expect(attachment.url.length).toBeLessThan(1_500_000);
});

test('keeps input scale and chat width stable across keyboard-sized viewports and dismisses focus outside fields', async ({
  page,
}) => {
  await connect(page);
  const search = page.getByLabel('Поиск сессий');
  await search.fill('Панель');
  expect(
    await search.evaluate((input) => parseFloat(getComputedStyle(input).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await page.getByRole('heading', { name: /Сессии/ }).click();
  await expect(search).not.toBeFocused();
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  const original = page.viewportSize()!;
  const input = page.getByLabel('Промпт для OpenCode');
  for (const height of [440, original.height, 330, original.height]) {
    await input.fill('Проверка клавиатуры');
    await page.setViewportSize({ width: original.width, height });
    await expect(page.getByRole('button', { name: 'Отправить промпт' })).toBeInViewport();
    await expect
      .poll(() => page.locator('.app-chat').evaluate((element) => element.getBoundingClientRect().height))
      .toBe(height);
    expect(
      await input.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
      true,
    );
    await page.locator('.chat-heading h1').click();
    await expect(input).not.toBeFocused();
  }
  await tab(page, 'Настройки');
  await page.setViewportSize({ width: 320, height: original.height });
  await expect(page.getByRole('combobox', { name: 'Чтение файлов', exact: true })).toBeVisible();
  const sizes = await page
    .locator('input:visible, textarea:visible, select:visible')
    .evaluateAll((fields) => fields.map((field) => parseFloat(getComputedStyle(field).fontSize)));
  expect(sizes.length).toBeGreaterThan(0);
  expect(sizes.every((size) => size >= 16)).toBe(true);
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
