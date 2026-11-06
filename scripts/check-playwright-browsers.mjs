import { chromium, webkit } from '@playwright/test';

// Fail before the full suite if the image and locked Playwright package diverge,
// or the browser executables and their native libraries cannot run.
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    console.log(`${engine.name()} ${browser.version()} is ready`);
  } finally {
    await browser.close();
  }
}
