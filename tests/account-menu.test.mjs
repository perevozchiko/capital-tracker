import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../web/js/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../web/css/app.css',import.meta.url),'utf8');
test('account and group actions are inside overflow menus',()=>{
 assert.match(js,/class="account-actions-menu"/);
 assert.match(js,/class="action-menu-content"/);
 assert.match(js,/id==='archive'\?!!a\.archived_from_month/);
 assert.match(css,/\.account-group:has\(\.account-actions-menu\[open\]\)/);
});
test('dropping active account into archive opens archive editor',()=>{
 assert.match(js,/panel\.dataset\.groupId==='archive'/);
 assert.match(js,/showAccountEditor\('archive',account\)/);
});
