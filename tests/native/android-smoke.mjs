import { chromium, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const sdk = process.env.ANDROID_HOME;
const adb = sdk ? join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb';
const serial = process.argv[2] ?? 'emulator-5554';
if (!serial.startsWith('emulator-'))
  throw new Error('This smoke test only runs on an Android emulator, never a physical device.');
const pkg = 'dev.hvhbigname.occ';
function device(...args) {
  const result = spawnSync(adb, ['-s', serial, ...args], {
    encoding: 'utf8',
    timeout: 20000,
    windowsHide: true,
  });
  const waitingForProcess =
    args[0] === 'shell' && args[1] === 'pidof' && result.status === 1 && !result.stderr;
  if (result.status !== 0 && !waitingForProcess)
    throw new Error(result.stderr || result.stdout || result.error?.message || 'adb failed');
  return result.stdout.trim();
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function connectWebView() {
  for (let i = 0; i < 30; i++) {
    const pid = device('shell', 'pidof', pkg).split(' ')[0];
    if (pid) {
      try {
        device('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
        const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
        const page = browser.contexts()[0]?.pages()[0];
        if (page) {
          await page.waitForSelector('.app-shell', { timeout: 20000 });
          return { browser, page };
        }
        await browser.close();
      } catch (error) {
        if (i === 29) throw error;
      }
    }
    await wait(1000);
  }
  throw new Error('No debuggable OCC WebView. Install the debug APK and keep the emulator running.');
}
async function api(path, body) {
  const response = await fetch(
    `http://127.0.0.1:4097${path}`,
    body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : undefined,
  );
  if (!response.ok)
    throw new Error(`Start the fixture first: npx tsx tests/fixtures/server.ts (HTTP ${response.status})`);
  return response.json();
}

async function captureScreen(filename) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await mkdir('artifacts/screenshots', { recursive: true });
  const image = spawnSync(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], {
    timeout: 20000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (image.status !== 0) throw new Error('Android screenshot failed');
  await writeFile(join('artifacts/screenshots', filename), image.stdout);
}

device('shell', 'run-as', pkg, 'id');
device('reverse', 'tcp:4142', 'tcp:4142');
await api('/__test/reset', {});
device('shell', 'am', 'force-stop', pkg);
device('shell', 'pm', 'clear', pkg);
device('shell', 'am', 'start', '-n', `${pkg}/.MainActivity`);
let { browser, page } = await connectWebView();
const pair = await api('/__test/pair');
await page.getByRole('button', { name: 'Подключить компьютер', exact: true }).click();
await page.getByLabel('Ссылка подключения').fill(pair.link);
await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
await page.getByRole('button', { name: 'Подключение: DESKTOP-1337' }).waitFor({ timeout: 20000 });
await expect(page.getByRole('dialog')).toHaveCount(0);
await expect(page.getByRole('heading', { name: /^Сессии/ })).toBeVisible();
console.log('PASS native HTTP pairing and session synchronization');
await captureScreen('android-native-sessions.png');

const secret = `OCC_NATIVE_QA_${Date.now()}_секрет_`.repeat(40);
const restored = await page.evaluate(async (value) => {
  const native = window.Capacitor;
  await native.nativePromise('PocketNative', 'writeSecure', { key: 'occ.qa', value });
  return native.nativePromise('PocketNative', 'readSecure', { key: 'occ.qa' });
}, secret);
assert.equal(restored.value, secret);
const encrypted = device('shell', 'run-as', pkg, 'cat', 'shared_prefs/occ_vault.xml');
assert(!encrypted.includes(secret.slice(0, 30)) && encrypted.includes('v1:'));
console.log('PASS Keystore AES-GCM round-trip, long Unicode data, encrypted disk representation');

await page.getByRole('button', { name: /Панель управления — новая архитектура/ }).click();
await page.getByLabel('Промпт для OpenCode').fill('Проверь Android-клиент через нативный транспорт.');
await page.evaluate(() => window.Capacitor.nativePromise('Keyboard', 'show'));
await expect(page.locator('body')).toHaveClass(/keyboard-open/, { timeout: 10000 });
await expect(page.getByRole('button', { name: 'Отправить промпт' })).toBeInViewport();
console.log('PASS native keyboard opens and keeps the send action visible');
await captureScreen('android-native-keyboard.png');
await page.getByRole('button', { name: 'Отправить промпт' }).click();
await page
  .getByText('Готово. Изменения применены, проверка пройдена.', { exact: true })
  .waitFor({ timeout: 20000 });
await expect(page.locator('body')).not.toHaveClass(/keyboard-open/, { timeout: 10000 });
console.log('PASS prompt delivery and native SSE updates');

const sdkVersion = Number(device('shell', 'getprop', 'ro.build.version.sdk'));
if (sdkVersion >= 33) device('shell', 'pm', 'grant', pkg, 'android.permission.POST_NOTIFICATIONS');
await page.getByRole('button', { name: 'Назад к сессиям' }).click();
await page
  .getByRole('navigation', { name: 'Главная навигация' })
  .getByRole('button', { name: 'Настройки', exact: true })
  .click();
const notificationToggle = page.getByRole('switch', { name: /Уведомления/ });
await notificationToggle.click();
await expect(notificationToggle).toBeChecked({ timeout: 10000 });
await wait(1500);
device('shell', 'input', 'keyevent', 'KEYCODE_HOME');
await api('/__test/event', {
  type: 'question.asked',
  properties: {
    id: `que_native_${Date.now()}`,
    sessionID: 'ses_panel',
    questions: [
      {
        header: 'Native QA',
        question: 'Фоновая доставка работает?',
        options: [{ label: 'Да', description: 'Проверено эмулятором' }],
      },
    ],
  },
});
let hash = 0;
for (const character of 'ses_panelquestion') hash = (hash * 31 + character.charCodeAt(0)) | 0;
const notificationId = hash & 0x7fffffff;
let found = false;
for (let i = 0; i < 15; i++) {
  const notifications = device('shell', 'cmd', 'notification', 'list');
  if (notifications.includes(`|${pkg}|${notificationId}|`)) {
    found = true;
    break;
  }
  await wait(1000);
}
assert(found, 'Request notification was not delivered while the app was backgrounded');
console.log(
  'PASS Android foreground service delivers a request notification while the app is in the background',
);

device('shell', 'am', 'start', '-n', `${pkg}/.MainActivity`);
await wait(800);
await captureScreen('android-native.png');
await browser.close();
device('shell', 'am', 'force-stop', pkg);
device('shell', 'am', 'start', '-n', `${pkg}/.MainActivity`);
({ browser, page } = await connectWebView());
await page.getByRole('button', { name: 'Подключение: DESKTOP-1337' }).waitFor({ timeout: 20000 });
console.log('PASS saved connection restores after a full process restart');
await browser.close();
device('shell', 'am', 'force-stop', pkg);
device('forward', '--remove', 'tcp:9223');
device('reverse', '--remove', 'tcp:4142');
console.log(
  'Android native smoke: all assertions passed. Speech recognition quality requires device audio and a language pack.',
);
