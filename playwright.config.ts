import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 40_000,
  use: { baseURL: 'http://127.0.0.1:1420', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
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
    { command: 'npm run dev', url: 'http://127.0.0.1:1420', reuseExistingServer: !process.env.CI },
    {
      command: 'npx tsx tests/fixtures/server.ts',
      url: 'http://127.0.0.1:4142/healthz',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
