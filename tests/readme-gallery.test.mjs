import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const readme = readFileSync(new URL('README.md', root), 'utf8');
const gallery = readFileSync(
  new URL('docs/screenshots/README.md', root),
  'utf8',
);
const prefix =
  'https://raw.githubusercontent.com/perevozchiko/capital-tracker/master/docs/screenshots/';

test('README screenshots are linked to full-resolution originals', () => {
  for (const name of ['dashboard.png', 'monthly-balances.png', 'accounts.png']) {
    const file = `docs/screenshots/${name}`;
    assert.ok(existsSync(new URL(file, root)), `Missing screenshot: ${file}`);
    assert.ok(readme.includes(`src="${file}"`), `Missing image: ${file}`);
    assert.ok(
      readme.includes(`href="${prefix}${name}"`),
      `Screenshot does not link to full-size original: ${name}`,
    );
    assert.ok(gallery.includes(`src="${name}"`));
    assert.ok(gallery.includes(`href="${prefix}${name}"`));
  }
});

test('README offers working GitHub navigation and collapsible explanations', () => {
  for (const id of ['screenshots', 'quick-start', 'downloads', 'documentation']) {
    assert.ok(readme.includes(`href="#${id}"`), `Missing navigation: ${id}`);
  }
  assert.ok((readme.match(/<details>/g) || []).length >= 2);
  assert.ok((readme.match(/<\/details>/g) || []).length >= 2);
});
