const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/ui',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  reporter: 'list',
  use: { browserName: 'chromium', headless: true, trace: 'retain-on-failure', serviceWorkers: 'block' },
});
