import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) =>
  readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const lock = JSON.parse(read('package-lock.json'));
const version = lock.packages['node_modules/@playwright/test'].version;

for (const file of ['ci.yml', 'release.yml']) {
  const workflow = read('.github/workflows/' + file);
  test(`${file} bundles the browsers for the locked Playwright version`, () => {
    const images = [...workflow.matchAll(/^\s+image:\s*(\S+)$/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(images, [
      `mcr.microsoft.com/playwright:v${version}-noble`,
    ]);
    assert.equal(
      lock.packages['node_modules/playwright-core'].version,
      version,
    );
    assert.doesNotMatch(workflow, /playwright install|apt-get/);
    assert.match(
      workflow,
      /git config --global --add safe\.directory "\$GITHUB_WORKSPACE"/,
    );
    assert.match(
      workflow,
      /timeout-minutes: 1\n\s+run: node scripts\/check-playwright-browsers\.mjs/,
    );
    assert.match(workflow, /timeout-minutes: 25\n\s+run: npm run test:ui/);
  });
}
