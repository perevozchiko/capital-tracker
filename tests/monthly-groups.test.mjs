import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../web/js/monthly.js', import.meta.url),
  'utf8',
);
const start = source.indexOf('async function renderMonthly(');
const end = source.indexOf('\nexport {', start);
assert.ok(start >= 0 && end > start, 'renderMonthly exists');
const fn = source.slice(start, end);

function setup(active) {
  const state = { month: '2026-09', dirty: true, monthData: null };
  const content = { innerHTML: '' },
    calls = [];
  const data = {
    accounts: active
      ? [
          {
            id: 1,
            name: 'Savings',
            currency: 'EUR',
            group_id: 1,
            archived_from_month: null,
          },
          {
            id: 2,
            name: 'Cash',
            currency: 'EUR',
            group_id: null,
            archived_from_month: null,
          },
          {
            id: 3,
            name: 'Former USD',
            currency: 'USD',
            group_id: 2,
            archived_from_month: '2026-10',
          },
          {
            id: 4,
            name: 'Investments',
            currency: 'EUR',
            group_id: 2,
            archived_from_month: null,
          },
        ]
      : [],
    balances: [
      { account_id: 1, amount_minor: '15000' },
      { account_id: 2, amount_minor: '3000' },
      { account_id: 3, amount_minor: '20000' },
      { account_id: 4, amount_minor: '12000' },
    ],
    rates: [{ currency: 'USD', rate: '1.17' }],
    complete: true,
    exists: true,
    total_eur_minor: '50000',
    missing_balances: [],
    missing_rates: [],
  };
  const groups = {
    groups: [
      { id: 2, name: 'Investments', total_eur_minor: '32000' },
      { id: 1, name: 'Savings & cash', total_eur_minor: '15000' },
      { id: 3, name: 'Empty', total_eur_minor: null },
    ],
    ungrouped: { total_eur_minor: '3000' },
    archive: { total_eur_minor: '20000' },
  };
  const api = async (path) => {
    calls.push(path);
    if (path === '/months/2026-09') return data;
    if (path === '/months/2026-08')
      return { balances: [{ account_id: 1, amount_minor: '10000' }] };
    if (path === '/groups?month=2026-09&view=monthly') return groups;
    throw Error('Unexpected API request ' + path);
  };
  const escapeHTML = (v) =>
    String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  const render = new Function(
    'state',
    'api',
    'nextMonth',
    't',
    'monthLabel',
    'moneyHTML',
    'escapeHTML',
    'minorToInput',
    'rateText',
    'pluralAccounts',
    'collapsedGroups',
    '$',
    'statusPill',
    'document',
    'updateBalanceDifference',
    'groupVisibilityButtons',
    fn + '\nreturn renderMonthly;',
  )(
    state,
    api,
    () => '2026-08',
    (k) => k,
    (v) => String(v),
    (v) => 'EUR ' + v,
    escapeHTML,
    (v) => String(v ?? ''),
    (v) => String(v),
    (n) => n + ' accounts',
    new Set(['g-2']),
    () => content,
    (d) => (d.complete ? 'Complete' : 'Incomplete'),
    { documentElement: { dataset: {} }, querySelectorAll: () => [] },
    () => {},
    () => '',
  );
  return { state, content, calls, render, data };
}

test('historically active archived accounts stay in their assigned group or Ungrouped', async () => {
  for (const groupID of [2, null]) {
    const ui = setup(true);
    ui.data.accounts.find((a) => a.id === 3).group_id = groupID;
    await ui.render();
    const key = groupID === null ? 'ungrouped' : 'g-2';
    const section = ui.content.innerHTML
      .split("<section class='account-group")
      .find((html) => html.includes(`data-group-key='${key}'`));
    assert.match(section, /Former USD/);
    assert.match(section, /data-balance='3'/);
    assert.doesNotMatch(ui.content.innerHTML, /data-group-key='archive'/);
  }
});

test('monthly balances display groups in Accounts order, without organizational controls', async () => {
  const ui = setup(true);
  await ui.render();
  const html = ui.content.innerHTML;
  assert.deepEqual(ui.calls, [
    '/months/2026-09',
    '/months/2026-08',
    '/groups?month=2026-09&view=monthly',
  ]);
  assert.ok(
    html.indexOf('Investments</strong>') <
      html.indexOf('Savings &amp; cash</strong>'),
  );
  assert.match(html, /data-group-key='g-2' aria-expanded='false'/);
  assert.match(html, /monthly-group is-collapsed/);
  assert.match(html, /data-group-key='ungrouped'/);
  assert.doesNotMatch(html, /data-group-key='archive'|archiveGroup/);
  assert.match(html, /Former USD/);
  assert.match(html, /EUR 32000/);
  assert.equal((html.match(/data-balance='\d+'/g) || []).length, 4);
  assert.doesNotMatch(
    html,
    /draggable=|data-group-row=|data-account-row=|action-menu-content/,
  );
  assert.equal(ui.state.dirty, false);
});

test('empty groups still render, while no active accounts have no balance inputs', async () => {
  const ui = setup(false);
  await ui.render();
  const html = ui.content.innerHTML;
  assert.match(html, /Empty/);
  assert.doesNotMatch(html, /data-group-key='archive'|archiveGroup/);
  assert.match(html, /noActiveAccounts/);
  assert.doesNotMatch(html, /data-balance='\d+'/);
  assert.match(html, /data-action='saveMonth' disabled/);
});
