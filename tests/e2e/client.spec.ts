import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import type { MessageEntry, Session } from '../../src/types';

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

test('keeps a healthy stream quiet without periodic workspace polling', async ({ page }) => {
  await connect(page);
  await expect(page.getByRole('button', { name: 'Обновить сессии' })).toBeEnabled();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-connection-state', 'live');
  const requests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(project|provider|session\/status|experimental\/session)(\?|$)/.test(request.url()))
      requests.push(request.url());
  });
  await page.clock.install();
  await page.clock.runFor(31_000);
  expect(requests).toEqual([]);
  await expect(page.getByText('Обновляем…', { exact: true })).toHaveCount(0);
  await expect(page.locator('.pull-refresh')).toHaveCount(0);
});

test('recovers reordered message events and ignores duplicate source event IDs', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await expect(page.getByText('Предлагаемая структура', { exact: true })).toBeVisible();
  const properties = {
    sessionID: 'ses_panel',
    messageID: 'msg_reordered',
    partID: 'prt_reordered',
    field: 'text',
    delta: 'Текст из переставленных событий.',
  };
  const event = { type: 'message.part.delta', properties, id: 'evt_duplicate_check', emitOnly: true };
  await page.request.post('http://127.0.0.1:4097/__test/event', { data: event });
  await page.request.post('http://127.0.0.1:4097/__test/event', { data: event });
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: {
      emitOnly: true,
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'prt_reordered',
          messageID: 'msg_reordered',
          sessionID: 'ses_panel',
          type: 'text',
          text: '',
        },
      },
    },
  });
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: {
      emitOnly: true,
      type: 'message.updated',
      properties: {
        info: {
          id: 'msg_reordered',
          sessionID: 'ses_panel',
          role: 'user',
          time: { created: Date.now() },
          agent: 'build',
          model: { providerID: 'p', modelID: 'm' },
        },
      },
    },
  });
  await expect(page.locator('[data-message-id="msg_reordered"] .message-parts')).toHaveText(
    'Текст из переставленных событий.',
  );
});

test('keeps fetched message parts when the header arrives during initial hydration', async ({ page }) => {
  await connect(page);
  let release!: () => void;
  let snapshotReady!: (messages: MessageEntry[]) => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<MessageEntry[]>((resolve) => {
    snapshotReady = resolve;
  });
  await page.route(
    '**/api/session/ses_panel/message?*',
    async (route) => {
      const response = await route.fetch();
      snapshotReady(await response.json());
      await gate;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  const snapshot = await ready;
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: {
      type: 'message.updated',
      properties: { info: snapshot.find((entry) => entry.info.id === 'msg_answer')!.info },
    },
  });
  await expect(page.locator('[data-message-id="msg_answer"]')).toHaveCount(1);
  release();
  await expect(page.getByText('Предлагаемая структура', { exact: true })).toBeVisible();
});

test('reconciles a delta arriving before its first history snapshot without duplicating it', async ({
  page,
}) => {
  await connect(page);
  let release!: () => void;
  let snapshotReady!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    snapshotReady = resolve;
  });
  await page.route(
    '**/api/session/ses_panel/message?*',
    async (route) => {
      const response = await route.fetch();
      snapshotReady();
      await gate;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await ready;
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: {
      type: 'message.part.delta',
      properties: {
        sessionID: 'ses_panel',
        messageID: 'msg_answer',
        partID: 'prt_end',
        field: 'text',
        delta: '\n\nДельта перед историей.',
      },
    },
  });
  // A following event provides a visible fence: both events have reached the client before releasing HTTP.
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: { type: 'session.status', properties: { sessionID: 'ses_panel', status: { type: 'busy' } } },
  });
  await expect(page.locator('.chat-busy')).toBeVisible();
  release();
  await expect(page.locator('.chat-scroll')).toContainText('Дельта перед историей.');
  expect((await page.locator('.chat-scroll').innerText()).split('Дельта перед историей.').length - 1).toBe(1);
});

test('keeps session rows and reading position stable across events and navigation', async ({ page }) => {
  await connect(page);
  await expect(page.getByRole('button', { name: 'Обновить сессии' })).toBeEnabled();
  const order = await page.locator('.session-title').allTextContents();
  const target = page.locator('.session-row').last();
  await target.scrollIntoViewIfNeeded();
  const top = await page.evaluate(() => window.scrollY);
  const sessions: Session[] = await (
    await page.request.get('http://127.0.0.1:4097/experimental/session')
  ).json();
  const changed = sessions.find((item) => item.id === 'ses_docs')!;
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: {
      type: 'session.updated',
      properties: { info: { ...changed, time: { ...changed.time, updated: Date.now() + 1000 } } },
    },
  });
  await expect(page.locator('.session-row').filter({ hasText: changed.title })).toContainText('сейчас');
  expect(await page.locator('.session-title').allTextContents()).toEqual(order);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - top)).toBeLessThan(4);
  await target.click();
  await page.getByRole('button', { name: 'Назад к сессиям' }).click();
  expect(await page.locator('.session-title').allTextContents()).toEqual(order);
  await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - top)).toBeLessThan(4);
});

test('restores chat reading position after tabs and reopening a session', async ({ page }) => {
  await connect(page);
  await page.request.post('http://127.0.0.1:4097/__test/history');
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await expect(page.locator('.message')).toHaveCount(100);
  const scroll = page.locator('.chat-scroll');
  await scroll.evaluate((element) => {
    element.scrollTop = 320;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(page.getByRole('button', { name: 'К последнему' })).toBeVisible();
  const top = await scroll.evaluate((element) => element.scrollTop);
  await page.getByRole('button', { name: 'Задачи', exact: true }).click();
  await page.getByRole('button', { name: 'Диалог', exact: true }).click();
  await expect
    .poll(async () => Math.abs((await scroll.evaluate((element) => element.scrollTop)) - top))
    .toBeLessThan(4);
  await page.getByRole('button', { name: 'Назад к сессиям' }).click();
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await expect
    .poll(async () => Math.abs((await scroll.evaluate((element) => element.scrollTop)) - top))
    .toBeLessThan(4);
});

test('hides repeated empty reasoning but shows text when it arrives later', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await expect(page.getByText('Предлагаемая структура', { exact: true })).toBeVisible();
  for (let index = 0; index < 5; index++)
    await page.request.post('http://127.0.0.1:4097/__test/event', {
      data: {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'reasoning',
            id: `empty_${index}`,
            messageID: 'msg_answer',
            sessionID: 'ses_panel',
            text: '',
            time: { start: 1, end: 2 },
          },
        },
      },
    });
  await expect(page.locator('.reasoning-availability')).toHaveCount(1);
  await expect(page.locator('.reasoning-block')).toHaveCount(0);
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: {
      type: 'message.part.delta',
      properties: {
        sessionID: 'ses_panel',
        messageID: 'msg_answer',
        partID: 'empty_0',
        field: 'text',
        delta: 'Краткое объяснение от провайдера.',
      },
    },
  });
  await expect(page.locator('.reasoning-block')).toHaveCount(1);
  await expect(page.locator('.reasoning-block')).toContainText('Краткое объяснение от провайдера.');
});

test('recovers a dropped event stream and reconciles text without duplicate deltas', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await expect(page.getByText('Предлагаемая структура', { exact: true })).toBeVisible();
  await page.request.post('http://127.0.0.1:4097/__test/disconnect');
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: {
      type: 'message.part.delta',
      properties: {
        sessionID: 'ses_panel',
        messageID: 'msg_answer',
        partID: 'prt_end',
        field: 'text',
        delta: '\n\nПосле восстановления связи.',
      },
    },
  });
  await expect(page.locator('.app-shell')).toHaveAttribute('data-connection-state', 'live');
  await expect(page.locator('.chat-scroll')).toContainText('После восстановления связи.');
  await expect
    .poll(
      async () =>
        (await page.locator('.chat-scroll').innerText()).split('После восстановления связи.').length - 1,
    )
    .toBe(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('opens sessions when a secondary endpoint fails and updates tasks directly from events', async ({
  page,
}) => {
  await page.route('**/api/provider*', (route) =>
    route.fulfill({ status: 503, json: { error: 'Provider list unavailable' } }),
  );
  await connect(page);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-connection-state', 'live');
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await page.getByRole('button', { name: 'Задачи', exact: true }).click();
  await expect(page.getByText('Подключить интерфейс управления', { exact: true })).toBeVisible();
  let fetches = 0;
  page.on('request', (request) => {
    if (request.url().includes('/todo?')) fetches++;
  });
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: {
      type: 'todo.updated',
      properties: {
        sessionID: 'ses_panel',
        todos: [{ content: 'Задача обновлена событием', status: 'completed', priority: 'high' }],
      },
    },
  });
  await expect(page.getByText('Задача обновлена событием', { exact: true })).toBeVisible();
  expect(fetches).toBe(0);
  await expect(page.getByText('Подключить интерфейс управления', { exact: true })).toHaveCount(0);
});

test('resynchronizes missed messages when only the bridge upstream reconnects', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await expect(page.getByText('Предлагаемая структура', { exact: true })).toBeVisible();
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: { type: 'occ.upstream', properties: { online: false } },
  });
  await expect(page.locator('.app-shell')).toHaveAttribute('data-connection-state', 'reconnecting');
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: {
      silent: true,
      type: 'message.part.delta',
      properties: {
        sessionID: 'ses_panel',
        messageID: 'msg_answer',
        partID: 'prt_end',
        field: 'text',
        delta: '\n\nСообщение после восстановления upstream.',
      },
    },
  });
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: { type: 'occ.upstream', properties: { online: true } },
  });
  await expect(page.locator('.app-shell')).toHaveAttribute('data-connection-state', 'live');
  await expect(page.locator('.chat-scroll')).toContainText('Сообщение после восстановления upstream.');
});

test('preserves project filters and separates archived sessions and subtasks', async ({ page }) => {
  await connect(page);
  await page.request.post('http://127.0.0.1:4097/__test/agents');
  const child = page.locator('.session-row').filter({ hasText: 'Аудит модулей' });
  await expect(child).toHaveCount(0);
  await page.getByLabel('С подзадачами', { exact: true }).check();
  await expect(child).toBeVisible();
  await page.getByLabel('С подзадачами', { exact: true }).uncheck();
  await page.getByLabel('Фильтр по проекту').selectOption('C:/coding/emberdeck');
  await page.getByLabel('Поиск сессий').fill('  архитектура   ПАНЕЛЬ ');
  await expect(page.locator('.session-row')).toHaveCount(1);
  await page.locator('.session-row').click();
  await page.getByRole('button', { name: 'Назад к сессиям', exact: true }).click();
  await expect(page.getByLabel('Поиск сессий')).toHaveValue('  архитектура   ПАНЕЛЬ ');
  await expect(page.getByLabel('Фильтр по проекту')).toHaveValue('C:/coding/emberdeck');
  await page.locator('.session-row').click();
  await page.getByRole('button', { name: 'Действия с сессией' }).click();
  await page.getByRole('button', { name: 'Архивировать сессию', exact: true }).click();
  await expect(page.locator('.session-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Архив', exact: true }).click();
  await expect(page.locator('.session-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Обновить сессии' }).click();
  await page.locator('.session-row').click();
  await expect(page.getByLabel('Промпт для OpenCode')).toHaveCount(0);
  await page.getByRole('button', { name: 'Действия с сессией' }).click();
  await page.getByRole('button', { name: 'Восстановить сессию', exact: true }).click();
  await expect(page.getByLabel('Промпт для OpenCode')).toBeVisible();
});

test('retains attachments across tabs and sessions and clears a send completed off-screen', async ({
  page,
}) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'document.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') });
  await page.getByLabel('Промпт для OpenCode').fill('Черновик с документом');
  await page.getByRole('button', { name: 'Задачи', exact: true }).click();
  await page.getByRole('button', { name: 'Диалог', exact: true }).click();
  await expect(page.locator('.composer-attachments')).toContainText('document.pdf');
  await page.getByRole('button', { name: 'Назад к сессиям', exact: true }).click();
  await page.getByRole('button', { name: /OAuth и управление/ }).click();
  await expect(page.locator('.composer-attachments')).toHaveCount(0);
  await page.getByRole('button', { name: 'Назад к сессиям', exact: true }).click();
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await expect(page.getByLabel('Промпт для OpenCode')).toHaveValue('Черновик с документом');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/prompt_async?*', async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Отправить промпт' }).click();
  await page.getByRole('button', { name: 'Назад к сессиям', exact: true }).click();
  release();
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await expect(page.getByLabel('Промпт для OpenCode')).toHaveValue('');
  await expect(page.locator('.composer-attachments')).toHaveCount(0);
  const state = await (await page.request.get('http://127.0.0.1:4097/__test/state')).json();
  expect(state.prompts).toHaveLength(1);
});

test('searches loaded messages and tool output without changing the draft', async ({ page }, info) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await page.getByLabel('Промпт для OpenCode').fill('Продолжить после поиска');
  await page.getByRole('button', { name: 'Поиск по диалогу', exact: true }).click();
  await page.getByLabel('Поиск в загруженной истории').fill('10 passed');
  await page.getByRole('button', { name: 'Следующее совпадение' }).click();
  await expect(page.locator('.message-highlighted')).toContainText('10 passed');
  await expect(page.locator('.message-highlighted .tool-block')).toHaveAttribute('open', '');
  await expect(page.locator('.chat-search').getByRole('status')).toHaveText('1 / 1');
  await page.screenshot({ path: info.outputPath('chat-search.png') });
  await page.getByRole('button', { name: 'Закрыть поиск' }).click();
  await expect(page.getByLabel('Промпт для OpenCode')).toHaveValue('Продолжить после поиска');
  await expect(page.locator('.message-highlighted')).toHaveCount(0);
});

test('does not overwrite a live delta with a delayed history response', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await expect(page.getByText('Предлагаемая структура', { exact: true })).toBeVisible();
  let release!: () => void;
  let snapshotReady!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    snapshotReady = resolve;
  });
  await page.route(
    '**/api/session/ses_panel/message?*',
    async (route) => {
      const response = await route.fetch();
      snapshotReady();
      await gate;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: { type: 'session.idle', properties: { sessionID: 'ses_panel' } },
  });
  await ready;
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: {
      type: 'message.part.delta',
      properties: {
        sessionID: 'ses_panel',
        messageID: 'msg_answer',
        partID: 'prt_end',
        field: 'text',
        delta: '\n\nТекст во время загрузки.',
      },
    },
  });
  await expect(page.locator('.chat-scroll')).toContainText('Текст во время загрузки.');
  const response = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/ses_panel/message'),
  );
  release();
  await response;
  await expect(page.locator('.chat-scroll')).toContainText('Текст во время загрузки.');
});

test('keeps expanded history after resync and preserves the visible message when prepending', async ({
  page,
}) => {
  await connect(page);
  await page.request.post('http://127.0.0.1:4097/__test/history');
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await expect(page.locator('.message')).toHaveCount(100);
  const scroller = page.locator('.chat-scroll');
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  const anchor = page.locator('[data-message-id="msg_history_120"]');
  const top = (await anchor.boundingBox())!.y;
  await page.getByRole('button', { name: 'Загрузить более ранние сообщения' }).click();
  await expect(page.locator('.message')).toHaveCount(200);
  expect(Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThan(4);
  const response = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/ses_panel/message'),
  );
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: { type: 'session.idle', properties: { sessionID: 'ses_panel' } },
  });
  expect(new URL((await response).url()).searchParams.get('limit')).toBe('200');
  await expect(page.locator('.message')).toHaveCount(200);
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await page.getByRole('button', { name: 'Загрузить более ранние сообщения' }).click();
  await expect(page.locator('.message')).toHaveCount(220);
  await expect(page.getByRole('button', { name: 'Загрузить более ранние сообщения' })).toHaveCount(0);
});

test('searches files remotely and cancels a file read when navigating back', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await page.getByRole('button', { name: 'Файлы', exact: true }).click();
  await page.getByLabel('Поиск файлов в проекте').fill('events');
  await expect(page.locator('.file-list')).toContainText('src/modules/servers/events.ts');
  await page.getByLabel('Поиск файлов в проекте').fill('not-a-file');
  await expect(page.getByRole('heading', { name: 'Файлы не найдены' })).toBeVisible();
  await page.getByLabel('Поиск файлов в проекте').fill('README');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/file/content?*', async (route) => {
    await gate;
    await route.fulfill({ json: { type: 'text', content: 'STALE FILE CONTENT' } });
  });
  await page
    .locator('.file-list')
    .getByRole('button', { name: /README/ })
    .click();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  release();
  await expect(page.getByLabel('Поиск файлов в проекте')).toHaveValue('README');
  await expect(page.locator('.file-list')).toContainText('README.md');
  await expect(page.getByText('STALE FILE CONTENT', { exact: true })).toHaveCount(0);
});

test('filters requests without losing an answer in progress', async ({ page }) => {
  await connect(page);
  await tab(page, 'Запросы');
  await page.getByRole('radio', { name: /Redis/ }).check();
  await page.getByRole('button', { name: 'Доступ', exact: true }).click();
  await expect(page.getByRole('radio', { name: /Redis/ })).not.toBeVisible();
  await page.getByRole('button', { name: 'Вопросы', exact: true }).click();
  await expect(page.getByRole('radio', { name: /Redis/ })).toBeChecked();
  await page.getByLabel('Поиск запросов').fill('does not exist');
  await expect(page.getByRole('heading', { name: 'Запросы не найдены' })).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await expect(page.getByRole('radio', { name: /Redis/ })).toBeChecked();
});

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
  await expect(task).toContainText('Ожидает результат');
  const entries: MessageEntry[] = await (
    await page.request.get('http://127.0.0.1:4097/session/ses_panel/message')
  ).json();
  const call = entries.flatMap((entry) => entry.parts).find((part) => part.id === 'prt_task')!;
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: {
      type: 'message.part.updated',
      properties: {
        part: {
          ...call,
          state: {
            status: 'completed',
            input: { description: 'Аудит модулей', subagent_type: 'explore' },
            title: 'Аудит модулей',
            metadata: { sessionId: 'ses_child' },
            output: 'task_id: ses_child\n<task_result>Аудит завершён.</task_result>',
            time: { start: 1, end: 2 },
          },
        },
      },
    },
  });
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: { type: 'session.status', properties: { sessionID: 'ses_child', status: { type: 'busy' } } },
  });
  await expect(task).toContainText('Завершена');
  await page.getByText('Агенты · 1', { exact: true }).click();
  await page.getByRole('button', { name: /Аудит модулей \(@explore subagent\).*В работе/ }).click();
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
