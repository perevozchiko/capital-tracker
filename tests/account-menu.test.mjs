import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = ['account-actions', 'accounts']
  .map((name) =>
    readFileSync(new URL(`../web/js/${name}.js`, import.meta.url), 'utf8'),
  )
  .join('\n');
const css = readFileSync(
  new URL('../web/css/app.css', import.meta.url),
  'utf8',
);
test('account and group actions are inside overflow menus', () => {
  assert.match(js, /class="account-actions-menu"/);
  assert.match(js, /class="action-menu-content"/);
  // Archived accounts are bucketed under the Archive group, never their old one.
  assert.match(js, /account\.archived_from_month\s*\?\s*'archive'/);
  assert.match(css, /\.account-group:has\(\.account-actions-menu\[open\]\)/);
});
test('dropping active account into archive opens archive editor', () => {
  assert.match(js, /panel\.dataset\.groupId\s*===\s*'archive'/);
  assert.match(js, /showAccountEditor\('archive',\s*account\)/);
});
