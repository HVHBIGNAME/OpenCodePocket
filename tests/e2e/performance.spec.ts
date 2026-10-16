import { test, expect, connect, settlePages } from './fixtures';

test.beforeEach(async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await settlePages(page);
  await expect(page.getByText('Предлагаемая структура', { exact: true })).toBeVisible();
});

test('coalesces streamed text, retains every token, and leaves the transcript idle afterwards', async ({
  page,
}, info) => {
  await page.locator('[data-message-id="msg_answer"] .message-parts').evaluate((element) => {
    Reflect.set(window, 'textRenders', 0);
    new MutationObserver(() =>
      Reflect.set(window, 'textRenders', Reflect.get(window, 'textRenders') + 1),
    ).observe(element, { subtree: true, childList: true, characterData: true });
  });
  await page.request.post('http://127.0.0.1:4097/__test/stream-burst');
  const text = page.locator('[data-message-id="msg_answer"] .message-parts');
  await expect(text).toContainText('PERF59');
  const content = await text.innerText();
  expect(content).toContain(Array.from({ length: 60 }, (_, i) => `PERF${i}`).join(' '));
  const count = await page.evaluate(() => Reflect.get(window, 'textRenders') as number);
  expect(count).toBeLessThan(40);
  expect(count).toBeGreaterThan(0);
  await info.attach('render-count', {
    body: JSON.stringify({ tokens: 60, transcriptUpdates: count }),
    contentType: 'application/json',
  });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => Reflect.get(window, 'textRenders'))).toBe(count);
});

test('does not create collapsed tool bodies until requested', async ({ page }) => {
  const tool = page.locator('.tool-block').filter({ has: page.locator('summary', { hasText: 'bash' }) });
  await expect(tool.locator('.tool-body')).toHaveCount(0);
  await tool.locator('summary').click();
  await expect(tool.locator('.tool-body')).toBeVisible();
  await expect(tool.locator('.tool-body')).toContainText('Параметры');
  await tool.locator('summary').click();
  await expect(tool.locator('.tool-body')).toHaveCount(0);
});

test('does not remeasure native glass for unrelated transcript mutations', async ({ page }) => {
  await page.emulateMedia({ contrast: 'no-preference' });
  await page.evaluate(async () => {
    const media = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      media(query === '(prefers-reduced-transparency: reduce)' ? '(max-width: 0px)' : query);
    const appearancePath = '/src/lib/appearance.ts';
    const glassPath = '/src/lib/glass.ts';
    const { setAppearance } = await import(appearancePath);
    const { installGlassHandling } = await import(glassPath);
    await setAppearance({ theme: 'mercury', nativeGlass: true });
    Reflect.set(
      window,
      'cleanupGlass',
      installGlassHandling(true, {
        appearanceCapabilities: async () => ({
          nativeGlass: true,
          reduceTransparency: false,
          reduceMotion: false,
          lowPower: false,
        }),
        setGlassAppearance: async ({ enabled }: { enabled: boolean }) => ({ enabled }),
        setGlassRegions: async ({ regions }: { regions: { id: string }[] }) => ({
          ids: regions.map((region) => region.id),
        }),
        addListener: async () => ({ remove: async () => undefined }),
      }),
    );
  });
  await expect(page.locator('[data-pocket-glass="model"]')).toHaveAttribute('data-native-control', 'true');
  const measurements = await page.evaluate(async () => {
    const original = Element.prototype.getBoundingClientRect;
    let measured = 0;
    Element.prototype.getBoundingClientRect = function () {
      if (this.matches('[data-pocket-glass]')) measured++;
      return original.call(this);
    };
    const text = document.createElement('span');
    document.querySelector('.message-parts')!.append(text);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      measured = 0;
      for (let i = 0; i < 20; i++) {
        text.textContent = `Текст ${i}`;
        text.style.color = i % 2 ? 'red' : 'blue';
        await new Promise(requestAnimationFrame);
      }
      return measured;
    } finally {
      Element.prototype.getBoundingClientRect = original;
      text.remove();
      Reflect.get(window, 'cleanupGlass')();
    }
  });
  expect(measurements).toBe(0);
});

test('suspends background browser streaming and reconciles history on return', async ({ page }) => {
  const streams: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/occ/events')) streams.push(request.url());
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.install();
  await page.clock.runFor(65000);
  expect(streams).toHaveLength(0);
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: {
      silent: true,
      type: 'message.part.delta',
      properties: {
        sessionID: 'ses_panel',
        messageID: 'msg_answer',
        partID: 'prt_answer',
        field: 'text',
        delta: ' Изменение в фоне.',
      },
    },
  });
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('[data-message-id="msg_answer"]')).toContainText('Изменение в фоне.');
  expect(streams).toHaveLength(1);
});

test('shows context usage and compacts from the interface without changing the draft', async ({ page }) => {
  const input = page.getByLabel('Промпт для OpenCode');
  await input.fill('Мой следующий вопрос');
  await page.locator('.context-summary > summary').click();
  await expect(page.locator('.context-details')).toContainText('токенов');
  await page.getByRole('button', { name: 'Сжать контекст', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Контекст сессии сжат');
  await expect(input).toHaveValue('Мой следующий вопрос');
  const state = await (await page.request.get('http://127.0.0.1:4097/__test/state')).json();
  expect(state.commandRequests).toEqual([
    expect.objectContaining({ action: 'summarize', sessionID: 'ses_panel', auto: false }),
  ]);
  await page.request.post('http://127.0.0.1:4097/__test/event', {
    data: { type: 'session.status', properties: { sessionID: 'ses_panel', status: { type: 'busy' } } },
  });
  await expect(page.getByRole('button', { name: 'Сжать контекст', exact: true })).toBeDisabled();
});
