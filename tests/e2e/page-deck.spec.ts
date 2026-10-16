import { test, expect, connect, settlePages, type Page, type Locator } from './fixtures';

const deck = (page: Page, name: string) => page.locator(`[data-page-deck="${name}"]`);

async function hold(page: Page) {
  await page.evaluate(() => {
    if (!Reflect.get(window, 'deckAnimationPatched')) {
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        const animation = animate.call(this, keyframes, options);
        if (this.matches('.deck-panel') && Reflect.get(window, 'holdDeckAnimations')) {
          animation.pause();
          animation.currentTime = 0;
        }
        return animation;
      };
      Reflect.set(window, 'deckAnimationPatched', true);
    }
    Reflect.set(window, 'holdDeckAnimations', true);
  });
}

async function halfway(target: Locator) {
  await expect(target.locator(':scope > .deck-panel')).toHaveCount(2);
  await expect
    .poll(() =>
      target.evaluate((element) => [...element.children].flatMap((node) => node.getAnimations()).length),
    )
    .toBe(2);
  await target.evaluate(async (element) => {
    for (const animation of [...element.children].flatMap((node) => node.getAnimations())) {
      animation.currentTime = Number(animation.effect!.getTiming().duration) / 2;
    }
    await new Promise(requestAnimationFrame);
  });
  const [source, destination] = await target.locator(':scope > .deck-panel').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, right: rect.right, width: rect.width };
    }),
  );
  expect(Math.abs(source!.x)).toBeGreaterThan(1);
  expect(Math.abs(source!.x)).toBeLessThan(source!.width);
  expect(Math.abs(destination!.x)).toBeGreaterThan(1);
  expect(Math.abs(destination!.x)).toBeLessThan(destination!.width);
  expect(Math.abs(source!.x - destination!.x)).toBeCloseTo(source!.width, 0);
}

async function finish(page: Page) {
  await page.evaluate(() => {
    Reflect.set(window, 'holdDeckAnimations', false);
    for (const node of document.querySelectorAll('.deck-panel'))
      for (const animation of node.getAnimations()) animation.finish();
  });
  await settlePages(page);
}

async function touch(target: Locator, type: string, dx = 0) {
  await target.evaluate(
    (element, { type, dx }) => {
      const box = element.getBoundingClientRect();
      const touch = { identifier: 15, target: element, clientX: box.x + 12 + dx, clientY: box.y + 25 };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : [touch] },
        changedTouches: { value: [touch] },
      });
      element.dispatchEvent(event);
    },
    { type, dx },
  );
}

test('slides complete session pages with distinct headers and keeps the outgoing DOM until the end', async ({
  page,
}, info) => {
  await connect(page);
  const app = deck(page, 'app');
  const sessionOrder = await page.locator('.session-title').allTextContents();
  await app.locator(':scope > .deck-panel').evaluate((element) => Reflect.set(window, 'oldPage', element));
  await hold(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await halfway(app);
  const source = app.locator(':scope > .deck-panel').first();
  const destination = app.locator(':scope > .deck-panel').last();
  expect(await source.evaluate((element) => element === Reflect.get(window, 'oldPage'))).toBe(true);
  await expect(source.locator('h1')).toHaveText(/Сессии/);
  expect(await source.locator('.session-title').allTextContents()).toEqual(sessionOrder);
  await expect(destination.locator('.chat-heading h1')).toHaveText('Панель управления — новая архитектура');
  await expect(destination.locator('textarea')).toBeDisabled();
  await page.screenshot({ path: info.outputPath('session-push-halfway.png') });
  await finish(page);
  await expect(app.locator(':scope > .deck-panel')).toHaveCount(1);
  await expect(page.getByLabel('Промпт для OpenCode')).toBeEnabled();
  await hold(page);
  await page.getByRole('button', { name: 'Назад к сессиям', exact: true }).click();
  await halfway(app);
  await expect(app.locator(':scope > .deck-panel').first().locator('.chat-heading h1')).toHaveText(
    'Панель управления — новая архитектура',
  );
  await expect(app.locator(':scope > .deck-panel').last().locator('h1')).toHaveText(/Сессии/);
  expect(
    await app.locator(':scope > .deck-panel').last().locator('.session-title').allTextContents(),
  ).toEqual(sessionOrder);
  await finish(page);
  await expect(app).toHaveAttribute('data-current-page', 'sessions');
});

test('keeps the parent session visible while opening an agent session', async ({ page }) => {
  await connect(page);
  await page.request.post('http://127.0.0.1:4097/__test/agents');
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await settlePages(page);
  await hold(page);
  await page.getByRole('button', { name: 'Открыть диалог агента', exact: true }).click();
  await halfway(deck(page, 'app'));
  const pages = deck(page, 'app').locator(':scope > .deck-panel');
  await expect(pages.first().locator('.chat-heading h1')).toHaveText('Панель управления — новая архитектура');
  await expect(pages.last().locator('.chat-heading h1')).toHaveText('Аудит модулей (@explore subagent)');
  await finish(page);
});

test('moves the actual settings page and restores a cancelled edge gesture', async ({ page }, info) => {
  await connect(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Настройки', exact: true }).click();
  await settlePages(page);
  await hold(page);
  await page.getByRole('button', { name: 'Оформление', exact: true }).click();
  const settings = deck(page, 'settings');
  await halfway(settings);
  await expect(settings.locator(':scope > .deck-panel').first().locator('.settings-menu-row')).toHaveCount(9);
  await expect(settings.locator(':scope > .deck-panel').last().locator('h1')).toHaveText('Оформление');
  await finish(page);
  await touch(settings, 'touchstart');
  await touch(settings, 'touchmove', 120);
  const source = settings.locator(':scope > .deck-panel').first();
  expect((await source.boundingBox())!.x).toBeCloseTo(120, 0);
  await expect(settings.locator(':scope > .deck-panel').last().locator('.settings-menu-row')).toHaveCount(9);
  await page.screenshot({ path: info.outputPath('settings-back-drag.png') });
  await touch(settings, 'touchcancel', 120);
  await settlePages(page);
  await expect(settings).toHaveAttribute('data-current-page', 'appearance');
  await expect(page.getByRole('button', { name: 'Тема: Mercury', exact: true })).toBeEnabled();
});

test('slides the file browser itself rather than a replacement back preview', async ({ page }, info) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await settlePages(page);
  await page.getByRole('button', { name: 'Файлы', exact: true }).click();
  await settlePages(page);
  await hold(page);
  await page
    .locator('.file-list')
    .getByRole('button', { name: /README/ })
    .click();
  const files = deck(page, 'files');
  await halfway(files);
  await expect(files.locator(':scope > .deck-panel').first().locator('.file-list')).toContainText('README');
  await expect(files.locator(':scope > .deck-panel').last()).toContainText('Your servers, under control.');
  await page.screenshot({ path: info.outputPath('file-push-halfway.png') });
  await finish(page);
  await hold(page);
  await page.getByRole('button', { name: 'Назад к файлам', exact: true }).click();
  await halfway(files);
  await expect(files.locator(':scope > .deck-panel').first()).toContainText('Your servers, under control.');
  await expect(files.locator(':scope > .deck-panel').last().locator('.file-list')).toContainText('README');
  await finish(page);
});

test('changes model pages inside one stationary bottom sheet and supports returning', async ({
  page,
}, info) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await settlePages(page);
  await page.getByRole('button', { name: 'Модель и режим сессии' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
    Reflect.set(window, 'modelSheet', element);
  });
  const bounds = (await sheet.boundingBox())!;
  await hold(page);
  await sheet.getByRole('button', { name: /Выбрать другую модель/ }).click();
  await halfway(deck(page, 'session-options'));
  expect(await sheet.evaluate((element) => element === Reflect.get(window, 'modelSheet'))).toBe(true);
  const nextBounds = (await sheet.boundingBox())!;
  expect(nextBounds.y).toBeCloseTo(bounds.y, 0);
  expect(nextBounds.height).toBeCloseTo(bounds.height, 0);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('model-sheet-halfway.png') });
  await finish(page);
  await sheet.getByRole('button', { name: 'Назад к режиму сессии' }).click();
  await settlePages(page);
  await expect(sheet.getByRole('heading', { name: 'Как будем работать?' })).toBeVisible();
});

test('queues the latest navigation without replacing either moving page', async ({ page }) => {
  await connect(page);
  await hold(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Настройки', exact: true }).click();
  const app = deck(page, 'app');
  await halfway(app);
  await app
    .locator(':scope > .deck-panel')
    .first()
    .locator('.mobile-nav button[aria-label="Модели"]')
    .dispatchEvent('click');
  await expect(app).toHaveAttribute('data-target-page', 'settings');
  await expect(app.locator(':scope > .deck-panel').last().locator('.settings-page h1')).toHaveText(
    'Настройки',
  );
  await finish(page);
  await expect(app).toHaveAttribute('data-current-page', 'models');
  await expect(page.getByRole('heading', { name: 'Модели', exact: true })).toBeVisible();
});

test('dismisses and reopens the shared sheet through every close path without losing the draft', async ({
  page,
}) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await settlePages(page);
  const input = page.getByLabel('Промпт для OpenCode');
  await input.fill('Черновик после закрытия панели');
  for (const method of ['close', 'done', 'model', 'escape', 'cancel', 'backdrop', 'handle', 'swipe']) {
    await page.getByRole('button', { name: 'Модель и режим сессии' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await sheet.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    if (method === 'model' || method === 'escape' || method === 'cancel') {
      await sheet.getByRole('button', { name: /Выбрать другую модель/ }).click();
      await settlePages(page);
    }
    if (method === 'close') await sheet.getByRole('button', { name: 'Закрыть', exact: true }).click();
    else if (method === 'done') await sheet.getByRole('button', { name: 'Готово', exact: true }).click();
    else if (method === 'model') await sheet.getByRole('button', { name: /Claude Sonnet/ }).click();
    else if (method === 'escape' || method === 'cancel') {
      const dismiss = () =>
        method === 'escape' ? page.keyboard.press('Escape') : sheet.dispatchEvent('cancel');
      await dismiss();
      await settlePages(page);
      await expect(sheet.getByRole('heading', { name: 'Как будем работать?' })).toBeVisible();
      await dismiss();
    } else if (method === 'backdrop') await page.mouse.click(5, 5);
    else if (method === 'handle')
      await sheet.getByRole('button', { name: 'Закрыть панель', exact: true }).click();
    else
      await sheet.locator('.modal-handle').evaluate((element) => {
        const box = element.getBoundingClientRect();
        for (const [type, dy] of [
          ['touchstart', 0],
          ['touchmove', 160],
          ['touchend', 180],
        ] as const) {
          const point = {
            identifier: 16,
            target: element,
            clientX: box.x + box.width / 2,
            clientY: box.y + 5 + dy,
          };
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, {
            touches: { value: type === 'touchend' ? [] : [point] },
            changedTouches: { value: [point] },
          });
          element.dispatchEvent(event);
        }
      });
    await expect(page.locator('dialog'), method).toHaveCount(0);
    await expect(input).toHaveValue('Черновик после закрытия панели');
    await expect(input).toBeEnabled();
  }
});

test('keeps the current screen in place until a lazy page is ready', async ({ page }) => {
  await connect(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/src/pages/Models.tsx*', async (route) => {
    await pending;
    await route.continue();
  });
  await hold(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Модели', exact: true }).click();
  const app = deck(page, 'app');
  await expect(app).toHaveAttribute('data-target-page', 'models');
  const source = app.locator(':scope > .deck-panel').first();
  expect((await source.boundingBox())!.x).toBe(0);
  await expect(source.locator('.session-feed')).toBeVisible();
  expect(await source.evaluate((element) => element.getAnimations().length)).toBe(0);
  release();
  await halfway(app);
  await finish(page);
  await expect(page.getByRole('heading', { name: 'Модели', exact: true })).toBeVisible();
});

test('settles page navigation correctly with reduced motion', async ({ page }) => {
  await connect(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('navigation').getByRole('button', { name: 'Настройки', exact: true }).click();
  await settlePages(page);
  await expect(deck(page, 'app')).toHaveAttribute('data-current-page', 'settings');
  await page.getByRole('button', { name: 'Оформление', exact: true }).click();
  await settlePages(page);
  await expect(deck(page, 'settings')).toHaveAttribute('data-current-page', 'appearance');
  await page.getByRole('button', { name: 'Назад к настройкам', exact: true }).click();
  await settlePages(page);
  await expect(deck(page, 'settings')).toHaveAttribute('data-current-page', 'index');
  expect(
    await page.evaluate(
      () => [...document.querySelectorAll('.deck-panel')].flatMap((node) => node.getAnimations()).length,
    ),
  ).toBe(0);
});
