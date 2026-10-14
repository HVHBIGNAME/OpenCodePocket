import { expect, test, release, releaseAPI } from './fixtures';

test('announces newer releases, keeps dismissal across reloads, and recovers after a failed manual check', async ({
  page,
}) => {
  let requests = 0;
  await page.route(releaseAPI, (route) => {
    requests++;
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({ json: release('99.0.0') });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Доступна версия 99.0.0' }).click();
  const dialog = page.getByRole('dialog', { name: 'Обновление Pocket' });
  await expect(dialog.getByRole('link', { name: 'Скачать APK' })).toHaveAttribute(
    'href',
    /OpenCodePocket-99\.0\.0-android\.apk$/,
  );
  await expect(dialog.getByRole('link', { name: 'Скачать IPA' })).toHaveAttribute(
    'href',
    /OpenCodePocket-99\.0\.0-ios-unsigned\.ipa$/,
  );
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Скрыть уведомление об обновлении' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Подключить компьютер', exact: true })).toBeVisible();
  await expect(page.locator('.update-notice')).toHaveCount(0);
  expect(requests).toBe(1);
  await page.getByRole('navigation').getByRole('button', { name: 'Настройки' }).click();
  const settings = page.getByRole('region', { name: 'Обновления приложения' });
  await expect(settings).toContainText('Вышла новая версия 99.0.0');
  await page.route(releaseAPI, (route) => route.fulfill({ status: 429, json: {} }), { times: 1 });
  await settings.getByRole('button', { name: 'Проверить обновления' }).click();
  await expect(settings.getByRole('alert')).toContainText('GitHub временно ограничил');
  await expect(settings.getByRole('link', { name: 'Скачать APK' })).toBeVisible();
  await settings.getByRole('button', { name: 'Проверить обновления' }).click();
  await expect(settings.getByRole('alert')).toHaveCount(0);
  expect(requests).toBe(2);
});
