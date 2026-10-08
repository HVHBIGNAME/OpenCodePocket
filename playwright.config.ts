import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.OCC_E2E_PORT ?? 1420);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 40_000,
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    {
      name: 'android-compact',
      use: { ...devices['Pixel 7'], viewport: { width: 360, height: 800 }, browserName: 'chromium' },
    },
    { name: 'android-layout', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'ios-webkit', use: { ...devices['iPhone 14'], browserName: 'webkit' } },
  ],
  webServer: [
    {
      command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npx tsx tests/fixtures/server.ts',
      url: 'http://127.0.0.1:4142/healthz',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
