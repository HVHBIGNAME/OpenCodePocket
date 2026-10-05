import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

async function connect(page: Page) {
  await page.request.post('http://127.0.0.1:4097/__test/reset');
  const pair = await (await page.request.get('http://127.0.0.1:4097/__test/pair')).json() as { link: string };
  await page.goto('/');
  await page.getByRole('button', { name: 'Подключить компьютер', exact: true }).click();
  await page.getByLabel('Ссылка подключения').fill(pair.link);
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'DESKTOP-1337' })).toBeVisible();
  await expect(page.getByText('Панель управления — новая архитектура', { exact: true })).toBeVisible();
}

test('pairs through the actual bridge, resumes a session, streams prompts and reads changes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await expect(page.getByText('Предлагаемая структура', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Изменения', exact: false }).filter({ hasText: 'Изменения' }).first().click();
  await expect(page.getByText('src/modules/servers/events.ts')).toBeVisible();
  await page.getByRole('button', { name: 'Задачи', exact: true }).click();
  await expect(page.getByText('Подключить интерфейс управления', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Файлы', exact: true }).click();
  await page.getByRole('button', { name: /README.md/ }).click();
  await expect(page.getByText('Your servers, under control.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Диалог', exact: true }).click();
  await page.getByLabel('Промпт для OpenCode').fill('Добавь интеграционные тесты для событий.');
  await page.getByRole('button', { name: 'Отправить промпт' }).click();
  await expect(page.getByText('Готово. Изменения применены, проверка пройдена.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Промпт для OpenCode')).toHaveValue('');
  const state = await (await page.request.get('http://127.0.0.1:4097/__test/state')).json();
  expect(state.prompts).toHaveLength(1);
  expect(state.prompts[0]).toMatchObject({ sessionID: 'ses_panel', directory: 'C:/coding/emberdeck', model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' } });
  expect(errors).toEqual([]);
});

test('answers multi-part questions and approves permissions exactly once', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: 'Входящие и уведомления' }).click();
  await page.getByRole('radio', { name: /Redis/ }).check();
  await page.getByRole('checkbox', { name: /OAuth/ }).check();
  await page.getByRole('checkbox', { name: /Passkeys/ }).check();
  await page.getByRole('button', { name: 'Отправить ответ' }).click();
  await expect(page.getByText('Где храним пользовательские сессии?', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Разрешить', exact: true }).click();
  await expect(page.getByText('Можно выдохнуть', { exact: true })).toBeVisible();
  const state = await (await page.request.get('http://127.0.0.1:4097/__test/state')).json();
  expect(state.replies).toEqual([{ kind: 'question', id: 'que_auth', answers: [['Redis'], ['OAuth', 'Passkeys']] }, { kind: 'permission', id: 'per_build', reply: 'once' }]);
});

test('switches model and agent, changes server permissions and saves provider keys', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: /Модели на связи/ }).click();
  const card = page.locator('.model-card').filter({ has: page.getByRole('heading', { name: 'GPT-5.4', exact: true }) });
  await card.getByRole('button', { name: 'Выбрать', exact: true }).click();
  await page.getByRole('button', { name: 'По умолчанию', exact: true }).click();
  await page.getByRole('button', { name: 'Провайдер', exact: true }).click();
  await page.getByLabel('API-ключ', { exact: true }).fill('test-only-never-a-real-key');
  await page.getByRole('button', { name: 'Подключить', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const settings = page.getByRole('button', { name: 'Настройки', exact: true });
  await settings.filter({ visible: true }).click();
  await page.getByRole('button', { name: /Автопилот/ }).click();
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const state = await (await page.request.get('http://127.0.0.1:4097/__test/state')).json();
  expect(state.config.model).toBe('openai/gpt-5.4'); expect(state.config.permission).toBe('allow');
  expect(state.providerKeys).toContain('anthropic');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/test-only-never-a-real-key|Bearer/);
});

test('responsive design, navigation and release screenshots', async ({ page }, info) => {
  await connect(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.screenshot({ path: `artifacts/screenshots/${info.project.name}-overview.png`, fullPage: false });
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await expect(page.getByText('Предлагаемая структура', { exact: true })).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/${info.project.name}-chat.png`, fullPage: false });
  await page.getByRole('button', { name: 'Входящие и уведомления' }).click();
  await expect(page.getByText('Где храним пользовательские сессии?', { exact: true })).toBeVisible();
  await page.screenshot({ path: `artifacts/screenshots/${info.project.name}-inbox.png`, fullPage: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
