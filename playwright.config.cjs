const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/ui',
  outputDir: process.env.CAPITAL_TRACKER_TEST_OUTPUT || 'test-results',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  reporter: 'list',
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    {
      name: 'iphone',
      testMatch: ['**/browser-compat.spec.cjs', '**/auth.spec.cjs'],
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'android',
      testMatch: ['**/browser-compat.spec.cjs', '**/auth.spec.cjs'],
      use: { ...devices['Pixel 7'] },
    },
  ],
  use: {
    headless: true,
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
});
