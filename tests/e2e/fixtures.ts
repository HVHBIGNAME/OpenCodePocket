import { test as base, expect, type Page } from '@playwright/test';
import { APP_VERSION } from '../../shared/protocol';
export { expect, type Page, type Locator } from '@playwright/test';
export const releaseAPI = 'https://api.github.com/repos/HVHBIGNAME/OpenCodePocket/releases/latest';
export function release(version: string) {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    body: 'Проверенные улучшения приложения.',
    assets: ['android.apk', 'ios-unsigned.ipa'].map((suffix) => ({
      name: `OpenCodePocket-${version}-${suffix}`,
      state: 'uploaded',
      browser_download_url: `https://github.com/HVHBIGNAME/OpenCodePocket/releases/download/v${version}/OpenCodePocket-${version}-${suffix}`,
    })),
  };
}
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(releaseAPI, (route) => route.fulfill({ json: release(APP_VERSION) }));
    await use(page);
  },
});

export async function connect(page: Page) {
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

export async function settlePages(page: Page) {
  await expect(page.locator('[data-page-transition]')).toHaveCount(0);
}
