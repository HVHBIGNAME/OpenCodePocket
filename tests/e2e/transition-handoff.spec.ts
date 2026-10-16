import { test, expect, connect, settlePages, type Page } from './fixtures';

type Sample = { page: string; offset: number; visible: boolean };

async function observeHandoffs(page: Page) {
  await page.evaluate(() => {
    const samples: Sample[] = [];
    Reflect.set(window, 'handoffSamples', samples);
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      const slider = this.matches('.page-slider-track');
      if (!slider && !this.matches('.deck-panel[data-preview="true"]')) return animation;
      const cancel = animation.cancel.bind(animation);
      animation.cancel = () => {
        const finished = animation.playState === 'finished';
        const panel = slider
          ? (this.querySelector('.slider-panel[data-preview="true"]') ??
            this.querySelector('.slider-panel[data-active="true"]'))
          : this;
        const viewport = panel?.closest('.page-deck, .page-slider');
        cancel();
        if (finished && panel?.isConnected && viewport) {
          samples.push({
            page: panel.getAttribute('data-page-key') ?? 'chat-tab',
            offset: panel.getBoundingClientRect().x - viewport.getBoundingClientRect().x,
            visible: getComputedStyle(panel).visibility === 'visible',
          });
        }
      };
      return animation;
    };
  });
}

async function expectStableHandoffs(page: Page, minimum: number) {
  const samples = await page.evaluate(() => Reflect.get(window, 'handoffSamples') as Sample[]);
  expect(samples.length).toBeGreaterThanOrEqual(minimum);
  expect(samples.filter((sample) => Math.abs(sample.offset) > 1 || !sample.visible)).toEqual([]);
}

test('keeps incoming app and settings pages in place when finished animations are removed', async ({
  page,
}) => {
  await connect(page);
  await settlePages(page);
  await observeHandoffs(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await settlePages(page);
  await page.getByRole('button', { name: 'Назад к сессиям', exact: true }).click();
  await settlePages(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Настройки', exact: true }).click();
  await settlePages(page);
  await page.getByRole('button', { name: 'Оформление', exact: true }).click();
  await settlePages(page);
  await expectStableHandoffs(page, 4);
});

test('keeps the selected chat tab in place when the track animation is removed', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
  await settlePages(page);
  await observeHandoffs(page);
  for (const name of ['Файлы', 'Задачи', 'Диалог', 'Изменения', 'Диалог']) {
    await page.locator('.chat-tabs').getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.page-slider')).toHaveAttribute(
      'data-index',
      String(['Диалог', 'Изменения', 'Задачи', 'Файлы'].indexOf(name)),
    );
    await settlePages(page);
  }
  await expectStableHandoffs(page, 5);
});
