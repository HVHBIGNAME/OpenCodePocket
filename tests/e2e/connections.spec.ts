import { test, expect, connect, settlePages, type Page } from './fixtures';
import type { Connection } from '../../src/types';

async function savedConnections(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/lib/native.ts';
    const { vaultRead } = await import(path);
    return (await vaultRead('occ.connections')) as Connection[];
  });
}

async function openConnections(page: Page, name = 'DESKTOP-1337') {
  await page.getByRole('button', { name: `Подключение: ${name}`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Подключения', exact: true })).toBeVisible();
}

async function edit(page: Page, name = 'DESKTOP-1337') {
  await page.getByRole('button', { name: `Изменить ${name}`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Изменить компьютер', exact: true })).toBeVisible();
}

test('updates an active bridge address and name without pairing again or losing its draft', async ({
  page,
}) => {
  await connect(page);
  const [original] = await savedConnections(page);
  let pairRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/occ/pair') pairRequests++;
  });
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await settlePages(page);
  await page.getByLabel('Промпт для OpenCode').fill('Черновик до смены IP');
  await page.getByRole('button', { name: 'Назад к сессиям', exact: true }).click();
  await settlePages(page);
  await openConnections(page);
  await edit(page);
  await expect(page.getByLabel('Адрес сервера', { exact: true })).toHaveValue(original!.url);
  await page.getByLabel('Название компьютера').fill('  Рабочий ПК  ');
  await page.getByLabel('Адрес сервера', { exact: true }).fill('http://localhost:4142/');
  const events = page.waitForRequest('http://localhost:4142/occ/events');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await events).headers().authorization).toBe(`Bearer ${original!.credential}`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Подключение: Рабочий ПК' })).toBeVisible();
  expect(await savedConnections(page)).toEqual([
    { ...original, name: 'Рабочий ПК', url: 'http://localhost:4142' },
  ]);
  expect(pairRequests).toBe(0);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await settlePages(page);
  await expect(page.getByLabel('Промпт для OpenCode')).toHaveValue('Черновик до смены IP');
});

test('edits inactive computers independently and retains direct-server credentials and project', async ({
  page,
}) => {
  await connect(page);
  for (const host of ['127.0.0.1', 'localhost']) {
    await page.route(`http://${host}:4097/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/event')) {
        await route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' });
      } else {
        const response = await route.fetch();
        await route.fulfill({ response });
      }
    });
  }
  await openConnections(page);
  await page.getByRole('button', { name: 'Добавить компьютер', exact: true }).click();
  await page.getByRole('button', { name: 'Свой сервер', exact: true }).click();
  await page.getByLabel('Адрес OpenCode').fill('http://127.0.0.1:4097');
  await page.getByLabel('Название', { exact: true }).fill('Прямой сервер');
  await page.getByLabel('Логин', { exact: true }).fill('operator');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
  await page.getByText('Папка проекта', { exact: true }).click();
  await page.getByLabel('Путь на компьютере').fill('C:/coding/emberdeck');
  await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Панель управления — новая архитектура/ })).toBeVisible();
  const original = await savedConnections(page);
  const inactive = original.find((connection) => connection.mode === 'bridge')!;
  const active = original.find((connection) => connection.mode === 'direct')!;
  let inactiveRequests = 0;
  await page.route('https://renamed.example.test/**', async (route) => {
    inactiveRequests++;
    await route.abort();
  });
  await openConnections(page, active.name);
  await edit(page, inactive.name);
  await page.getByLabel('Адрес сервера', { exact: true }).fill('https://renamed.example.test/pocket/');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Подключения', exact: true })).toBeVisible();
  expect(await savedConnections(page)).toEqual([
    { ...inactive, url: 'https://renamed.example.test/pocket' },
    active,
  ]);
  expect(inactiveRequests).toBe(0);
  expect(
    await page.evaluate(async () => {
      const path = '/src/lib/native.ts';
      return (await import(path)).vaultRead('occ.lastConnection');
    }),
  ).toBe(active.id);
  await edit(page, active.name);
  await page.getByLabel('Адрес сервера', { exact: true }).fill('http://localhost:4097');
  const health = page.waitForRequest((request) =>
    request.url().startsWith('http://localhost:4097/global/health'),
  );
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const request = await health;
  expect(request.headers().authorization).toBe(
    `Basic ${Buffer.from('operator:fixture-password').toString('base64')}`,
  );
  expect(new URL(request.url()).searchParams.get('directory')).toBe(active.directory);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Панель управления — новая архитектура/ })).toBeVisible();
  expect((await savedConnections(page)).find((connection) => connection.id === active.id)).toEqual({
    ...active,
    url: 'http://localhost:4097',
  });
});

test('rejects invalid addresses and cancels edits without changing the saved computer on a small screen', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await connect(page);
  const original = await savedConnections(page);
  await openConnections(page);
  expect(
    await page
      .locator('.saved-connections')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath('saved-computer-320.png') });
  await edit(page);
  for (const url of ['ftp://192.168.1.20', 'http://example.com', 'https://example.com/?token=wrong']) {
    await page.getByLabel('Адрес сервера', { exact: true }).fill(url);
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect(await savedConnections(page)).toEqual(original);
  }
  await page.getByLabel('Название компьютера').fill('Не сохранять');
  await page.getByLabel('Адрес сервера', { exact: true }).fill('http://192.168.1.20:4242');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('edit-computer-320.png') });
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await edit(page);
  await expect(page.getByLabel('Название компьютера')).toHaveValue(original[0]!.name);
  await expect(page.getByLabel('Адрес сервера', { exact: true })).toHaveValue(original[0]!.url);
  expect(await savedConnections(page)).toEqual(original);
});

test('saves an offline address and lets the user correct it without another pairing', async ({ page }) => {
  await connect(page);
  const [original] = await savedConnections(page);
  const offline = 'http://127.0.0.1:59998';
  await page.route(`${offline}/**`, (route) => route.abort());
  await openConnections(page);
  await edit(page);
  await page.getByLabel('Адрес сервера', { exact: true }).fill(offline);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await savedConnections(page)).toEqual([{ ...original, url: offline }]);
  await openConnections(page);
  await edit(page);
  await expect(page.getByLabel('Адрес сервера', { exact: true })).toHaveValue(offline);
  await page.getByLabel('Адрес сервера', { exact: true }).fill(original!.url);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Панель управления — новая архитектура/ })).toBeVisible();
  expect(await savedConnections(page)).toEqual([original]);
});
