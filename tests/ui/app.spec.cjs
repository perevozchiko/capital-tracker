const { test: base, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const test = base.extend({
  app: async ({}, use) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'capital-tracker-ui-'));
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const url = `http://127.0.0.1:${port}`;
    const server = spawn(process.env.CAPITAL_TRACKER_TEST_BINARY, [
      '--no-browser',
      '--data-dir',
      dir,
      '--port',
      String(port),
    ]);
    let log = '';
    server.stdout.on('data', (data) => {
      log += data;
    });
    server.stderr.on('data', (data) => {
      log += data;
    });
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (server.exitCode !== null) throw new Error(`Server exited: ${log}`);
        try {
          if ((await fetch(url + '/api/meta')).ok) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!ready) throw new Error(`Server did not start: ${log}`);
      await use(url);
    } finally {
      if (server.exitCode === null) {
        const exited = new Promise((resolve) => server.once('exit', resolve));
        server.kill('SIGTERM');
        await exited;
      }
      await rm(dir, { recursive: true, force: true });
    }
  },
});

async function open(page, app) {
  await page.goto(app);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}
async function nav(page, name) {
  await page
    .locator('#navigation')
    .getByRole('button', { name, exact: true })
    .click();
}
async function createAccount(page, name, currency = 'EUR', start = '2025-01') {
  await page.locator('#accountName').fill(name);
  await page.locator('#accountCurrency').selectOption(currency);
  await page.locator('#accountStart').fill(start);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.locator('.account-row').filter({ hasText: name }),
  ).toBeVisible();
}
async function editDialog(page, value) {
  await page.locator('#editValue').fill(value);
  await page.locator('#confirmEdit').click();
  await expect(page.locator('#accountDialog')).not.toBeVisible();
}
async function action(page, name, actionName) {
  const row = page.locator('.account-row').filter({ hasText: name });
  const menu = row.locator('details.account-actions-menu');
  await expect(row).toBeVisible();
  await menu.locator('summary').click();
  await expect(menu).toHaveAttribute('open', '');
  await menu.locator(`[data-action="${actionName}"]`).click();
}

// Find a group by its actual heading, not by text in its account move dropdowns.
function accountGroup(page, name) {
  return page.locator('.account-group').filter({
    has: page
      .locator('.account-group-head .group-caption > strong')
      .getByText(name, { exact: true }),
  });
}
async function setMonth(page, month) {
  await page.locator('.month-picker').fill(month);
}

test('navigation and appearance persist across reload', async ({
  page,
  app,
}) => {
  await open(page, app);
  await expect(page.getByText('Welcome to Capital Tracker')).toBeVisible();
  await nav(page, 'Settings');
  await page.locator('#themeSelect').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#languageSelect')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await nav(page, 'Accounts');
  await expect(page.locator('#addAccountForm')).toBeVisible();
});

test('account groups, menus, reordering, archive and restore', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await page.locator('[data-action="groupCreate"]').click();
  await editDialog(page, 'Savings');
  await createAccount(page, 'Wallet');
  await action(page, 'Wallet', 'rename');
  await editDialog(page, 'Cash');
  const row = page.locator('.account-row').filter({ hasText: 'Cash' });
  await row.locator('summary').click();
  await row.locator('[data-move-account]').selectOption({ label: 'Savings' });
  // Waiting on the heading avoids a false positive from the 'Savings'
  // option still present in the ungrouped account's move dropdown.
  const savingsRows = accountGroup(page, 'Savings').locator('.account-row');
  await expect(savingsRows).toContainText('Cash');
  const ungroupedRows = page.locator('[data-group-id=""] .account-row');
  await expect(ungroupedRows).toHaveCount(0);
  await action(page, 'Cash', 'currency');
  await page.locator('#editValue').selectOption('USD');
  await page.locator('#confirmEdit').click();
  await expect(page.locator('#accountDialog')).not.toBeVisible();
  await expect(
    page.locator('.account-row').filter({ hasText: 'Cash' }),
  ).toContainText('USD');
  await action(page, 'Cash', 'archive');
  await editDialog(page, '2025-03');
  await expect(
    page.locator('[data-group-id="archive"] .account-row'),
  ).toContainText('Cash');
  await action(page, 'Cash', 'restore');
  await editDialog(page, '2025-04');
  await expect(
    page.locator('[data-group-id="archive"] .account-row'),
  ).toHaveCount(0);
});

test('monthly balances, rate loading, previous month and dashboard totals', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Euro');
  await createAccount(page, 'Dollars', 'USD');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await page.locator('[data-balance="1"]').fill('100.00');
  await page.locator('[data-balance="2"]').fill('110.00');
  await page.route('**/api/exchange-rates?*', (route) =>
    route.fulfill({ json: { date: '2025-01-31', rates: { USD: '1.1' } } }),
  );
  await page.locator('[data-action="loadRates"]').click();
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.1');
  await expect(page.locator('#rateLoadStatus')).toContainText('2025-01-31');
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('Complete');
  await nav(page, 'Dashboard');
  await expect(page.locator('.metric').first()).toContainText('200.00');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-02');
  await page.locator('[data-action="copyPrevious"][data-id="1"]').click();
  await expect(page.locator('[data-balance="1"]')).toHaveValue('100.00');
  await expect(page.locator('[data-balance-change="1"]')).toContainText('0.00');
});

test('unsaved edits prompt and invalid amounts remain editable', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Wallet');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await page.locator('[data-balance="1"]').fill('bad');
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('[data-balance="1"]')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await nav(page, 'Accounts');
  await expect(page.locator('#confirmDialog')).toBeVisible();
  await page.locator('#confirmCancel').click();
  await expect(page.locator('[data-balance="1"]')).toHaveValue('bad');
  await nav(page, 'Accounts');
  await page.locator('#confirmAccept').click();
  await expect(page.locator('#addAccountForm')).toBeVisible();
});

test('export, clear data with confirmation, and import restore data', async ({
  page,
  app,
}, testInfo) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Wallet');
  await nav(page, 'Settings');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="exportJSON"]').click();
  const download = await downloadPromise;
  const file = testInfo.outputPath('backup.json');
  await download.saveAs(file);
  await page.locator('[data-action="clearAllData"]').click();
  await expect(page.locator('#clearDataAccept')).toBeDisabled();
  await page.locator('#clearDataPhrase').fill('DELETE');
  await page.locator('#clearDataAccept').click();
  await expect(page.getByText('Welcome to Capital Tracker')).toBeVisible();
  await nav(page, 'Settings');
  await page.locator('#jsonFileInput').setInputFiles(file);
  await expect(page.locator('#confirmDialog')).toBeVisible();
  await page.locator('#confirmAccept').click();
  await expect(page.locator('#toast')).toContainText(
    'JSON data imported successfully',
  );
  await nav(page, 'Accounts');
  await expect(page.locator('.account-row')).toContainText('Wallet');
});

test('mobile menu and navigation are usable', async ({ page, app }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, app);
  await page.locator('#mobileMenu').click();
  await nav(page, 'Accounts');
  await expect(page.locator('#addAccountForm')).toBeVisible();
  await page.locator('#mobileMenu').click();
  await nav(page, 'Settings');
  await expect(page.locator('#themeSelect')).toBeVisible();
});

test('group controls reorder, collapse, rename and delete without deleting accounts', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  for (const name of ['First', 'Second']) {
    await page.locator('[data-action="groupCreate"]').click();
    await editDialog(page, name);
  }
  await createAccount(page, 'Wallet');
  let row = page.locator('.account-row').filter({ hasText: 'Wallet' });
  await row.locator('summary').click();
  await row.locator('[data-move-account]').selectOption({ label: 'First' });
  const first = accountGroup(page, 'First');
  await expect(
    first.locator('.account-row').filter({ hasText: 'Wallet' }),
  ).toBeVisible();
  await first.locator('[data-action="toggleGroup"]').click();
  await expect(first.locator('.account-row')).not.toBeVisible();
  await first.locator('[data-action="toggleGroup"]').click();
  await first.locator('.group-controls summary').click();
  await first.locator('[data-action="groupRename"]').click();
  await editDialog(page, 'Renamed');
  const second = page
    .locator('.account-group')
    .filter({ has: page.locator('.group-caption', { hasText: 'Second' }) });
  await second.locator('summary').click();
  await second.locator('[data-action="groupUp"]').click();
  await expect(
    page.locator('.account-group .group-caption strong').first(),
  ).toHaveText('Second');
  const renamed = page
    .locator('.account-group')
    .filter({ has: page.locator('.group-caption', { hasText: 'Renamed' }) });
  await renamed.locator('.group-controls summary').click();
  await renamed.locator('[data-action="groupDelete"]').click();
  await page.locator('#confirmAccept').click();
  await expect(
    page.locator('.group-caption').filter({ hasText: 'Renamed' }),
  ).toHaveCount(0);
  await expect(
    page
      .locator('.account-group')
      .filter({ has: page.locator('.group-caption', { hasText: 'Ungrouped' }) })
      .locator('.account-row'),
  ).toContainText('Wallet');
});

test('account history, delete confirmation and monthly deletion', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Wallet');
  await createAccount(page, 'Unused', 'EUR', '2025-03');
  await action(page, 'Unused', 'delete');
  await page.locator('#confirmCancel').click();
  await expect(
    page.locator('.account-row').filter({ hasText: 'Unused' }),
  ).toBeVisible();
  await action(page, 'Unused', 'delete');
  await page.locator('#confirmAccept').click();
  await expect(
    page.locator('.account-row').filter({ hasText: 'Unused' }),
  ).toHaveCount(0);
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await page.locator('[data-balance="1"]').fill('123.45');
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('Complete');
  await nav(page, 'Accounts');
  await action(page, 'Wallet', 'history');
  await expect(page.locator('#pageContent')).toContainText('123.45');
  await nav(page, 'Monthly balances');
  await page.locator('[data-action="deleteMonth"]').click();
  await page.locator('#confirmCancel').click();
  await expect(page.locator('[data-balance="1"]')).toHaveValue('123.45');
  await page.locator('[data-action="deleteMonth"]').click();
  await page.locator('#confirmAccept').click();
  await expect(page.locator('#toast')).toContainText('Month deleted');
  await setMonth(page, '2025-01');
  await expect(page.locator('[data-balance="1"]')).toHaveValue('');
});

test('rate loading preserves entered rates and reports network errors', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Dollars', 'USD');
  await createAccount(page, 'Dinars', 'RSD');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await page.locator('[data-rate="USD"]').fill('1.25');
  await page.route('**/api/exchange-rates?*', (route) =>
    route.fulfill({
      json: { date: '2025-01-31', rates: { USD: '1.1', RSD: '117.2' } },
    }),
  );
  await page.locator('[data-action="loadRates"]').click();
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.25');
  await expect(page.locator('[data-rate="RSD"]')).toHaveValue('117.2');
  await page.unroute('**/api/exchange-rates?*');
  await page.route('**/api/exchange-rates?*', (route) =>
    route.fulfill({
      status: 502,
      json: { error: { code: 'rates_unavailable' } },
    }),
  );
  await page.locator('[data-action="loadRates"]').click();
  await expect(page.locator('#rateLoadStatus')).toContainText(
    'Could not load rates',
  );
  await expect(page.locator('[data-rate="RSD"]')).toHaveValue('117.2');
});

test('invalid JSON import is rejected and current data remains', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Wallet');
  await nav(page, 'Settings');
  await page.locator('#jsonFileInput').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{broken'),
  });
  await expect(page.locator('#toast')).toContainText('not a supported');
  await nav(page, 'Accounts');
  await expect(page.locator('.account-row')).toContainText('Wallet');
});

test('dragging accounts and group headers changes their order', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  for (const name of ['First', 'Second']) {
    await page.locator('[data-action="groupCreate"]').click();
    await editDialog(page, name);
  }
  await createAccount(page, 'Wallet');
  const first = page
    .locator('.account-group')
    .filter({ has: page.locator('.group-caption', { hasText: 'First' }) });
  await page
    .locator('.account-row')
    .filter({ hasText: 'Wallet' })
    .dragTo(first.locator('.account-group-head'));
  await expect(first.locator('.account-row')).toContainText('Wallet');
  const second = page
    .locator('.account-group')
    .filter({ has: page.locator('.group-caption', { hasText: 'Second' }) });
  await second
    .locator('.account-group-head')
    .dragTo(first.locator('.account-group-head'), {
      targetPosition: { x: 30, y: 5 },
    });
  await expect(
    page.locator('.account-group .group-caption strong').first(),
  ).toHaveText('Second');
});

test('rate loading does not overwrite edits made while the request is pending', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Dollars', 'USD');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/exchange-rates?*', async (route) => {
    await wait;
    await route.fulfill({
      json: { date: '2025-01-31', rates: { USD: '1.1' } },
    });
  });
  await page.locator('[data-action="loadRates"]').click();
  await page.locator('[data-rate="USD"]').fill('1.25');
  release();
  await expect(page.locator('#rateLoadStatus')).toContainText('filled 0');
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.25');
});

test('saving waits for a pending rate load so loaded values are not lost', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Dollars', 'USD');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await page.locator('[data-balance="1"]').fill('110');
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/exchange-rates?*', async (route) => {
    await wait;
    await route.fulfill({
      json: { date: '2025-01-31', rates: { USD: '1.1' } },
    });
  });
  await page.locator('[data-action="loadRates"]').click();
  await expect(page.locator('[data-action="saveMonth"]')).toBeDisabled();
  release();
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.1');
  await expect(page.locator('[data-action="saveMonth"]')).toBeEnabled();
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('Complete');
  await page.reload();
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.1');
});

test('partial months, zero balances and clearing saved fields update completeness', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Euro');
  await createAccount(page, 'Dollars', 'USD');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await page.locator('[data-balance="1"]').fill('0');
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('Incomplete');
  await expect(page.locator('[data-balance="1"]')).toHaveValue('0.00');
  await page.locator('[data-balance="2"]').fill('-110');
  await page.locator('[data-rate="USD"]').fill('1.1');
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('Complete');
  await page.locator('[data-rate="USD"]').fill('');
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText(
    'Missing exchange rates',
  );
  await page.reload();
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('');
  await expect(page.locator('[data-balance="2"]')).toHaveValue('-110.00');
});

test('recorded history prevents currency changes, deletion and retroactive archive', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Wallet');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await page.locator('[data-balance="1"]').fill('5');
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('Complete');
  await nav(page, 'Accounts');
  await action(page, 'Wallet', 'currency');
  await page.locator('#editValue').selectOption('USD');
  await page.locator('#confirmEdit').click();
  await expect(page.locator('#toast')).toContainText(
    'currency can no longer be changed',
  );
  await page.locator('#cancelEdit').click();
  await action(page, 'Wallet', 'delete');
  await page.locator('#confirmAccept').click();
  await expect(page.locator('#toast')).toContainText(
    'Deleting it would change historical totals',
  );
  await action(page, 'Wallet', 'archive');
  await page.locator('#editValue').fill('2025-01');
  await page.locator('#confirmEdit').click();
  await expect(page.locator('#accountDialog')).toBeVisible();
  await page.locator('#cancelEdit').click();
  await expect(page.locator('.account-row')).toContainText('Wallet');
});

test('month navigation offers to keep or discard unsaved changes', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Wallet');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await page.locator('[data-balance="1"]').fill('10');
  await page.locator('[data-action="monthNext"]').click();
  await page.locator('#confirmCancel').click();
  await expect(page.locator('.month-picker')).toHaveValue('2025-01');
  await expect(page.locator('[data-balance="1"]')).toHaveValue('10');
  await page.locator('[data-action="monthNext"]').click();
  await page.locator('#confirmAccept').click();
  await expect(page.locator('.month-picker')).toHaveValue('2025-02');
  await expect(page.locator('[data-balance="1"]')).toHaveValue('');
});

test('typed clear confirmation requires exact phrase and cancel preserves data', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Wallet');
  await nav(page, 'Settings');
  await page.locator('[data-action="clearAllData"]').click();
  await page.locator('#clearDataPhrase').fill('delete');
  await expect(page.locator('#clearDataAccept')).toBeDisabled();
  await page.locator('#clearDataPhrase').fill('DELETE ');
  await expect(page.locator('#clearDataAccept')).toBeDisabled();
  await page.locator('#clearDataCancel').click();
  await nav(page, 'Accounts');
  await expect(page.locator('.account-row')).toContainText('Wallet');
});

test('comma decimal input survives reload with English formatting', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Dollars', 'USD');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await page.locator('[data-balance="1"]').fill('110,25');
  await page.locator('[data-rate="USD"]').fill('1,1');
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('Complete');
  await page.reload();
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.1');
  await expect(page.locator('[data-balance="1"]')).toHaveValue('110.25');
});

test('rate load stays unavailable while a month save is pending', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Dollars', 'USD');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await page.locator('[data-balance="1"]').fill('110');
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/months/2025-01', async (route) => {
    if (route.request().method() === 'PUT') await wait;
    await route.continue();
  });
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('[data-action="loadRates"]')).toBeDisabled();
  await expect(page.locator('[data-action="saveMonth"]')).toBeDisabled();
  release();
  await expect(page.locator('[data-action="loadRates"]')).toBeEnabled();
  await expect(page.locator('.status-block')).toContainText('Incomplete');
});

test('invalid rates are rejected and can be corrected', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Dollars', 'USD');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await page.locator('[data-balance="1"]').fill('100');
  for (const value of ['0', '-1', '1.123456789', 'abc']) {
    await page.locator('[data-rate="USD"]').fill(value);
    await page.locator('[data-action="saveMonth"]').click();
    await expect(page.locator('[data-rate="USD"]')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  }
  await page.locator('[data-rate="USD"]').fill('1.25');
  await expect(page.locator('[data-rate="USD"]')).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('Complete');
});

test('legacy language preferences still render an English interface', async ({
  page,
  app,
}) => {
  const response = await fetch(app + '/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Capital-Tracker': '1' },
    body: JSON.stringify({ language: 'ru', theme: 'dark' }),
  });
  expect(response.ok).toBeTruthy();
  await open(page, app);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await nav(page, 'Settings');
  await expect(page.locator('#languageSelect')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('monthly change compares each selected month with its immediate predecessor', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Euro', 'EUR', '2026-10');
  await nav(page, 'Monthly balances');
  for (const [month, balance] of [
    ['2026-10', '621.00'],
    ['2026-11', '50000.00'],
    ['2026-12', '51221.80'],
    ['2027-01', '51000.00'],
  ]) {
    await setMonth(page, month);
    await page.locator('[data-balance="1"]').fill(balance);
    await page.locator('[data-action="saveMonth"]').click();
    await expect(page.locator('.status-block')).toContainText('Complete');
  }
  await nav(page, 'Dashboard');
  const change = page.locator('.metric').nth(1);
  await expect(change).toContainText('-€221.80 (-0.43%)');
  await expect(change).toContainText('December 2026 · €51,221.80');
  await setMonth(page, '2026-12');
  await expect(change).toContainText('+€1,221.80 (+2.44%)');
  await expect(change).toContainText('November 2026 · €50,000.00');
  await setMonth(page, '2026-11');
  await expect(change).toContainText('+€49,379.00 (+7951.53%)');
  await expect(change).toContainText('October 2026 · €621.00');
  await setMonth(page, '2026-10');
  await expect(change).toContainText('Previous month is incomplete or missing');
  await expect(change.locator('.metric-value')).toHaveText('—');
});

test('monthly change handles zero, debt, unchanged totals and missing months', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Euro', 'EUR', '2025-01');
  await nav(page, 'Monthly balances');
  for (const [month, balance] of [
    ['2025-01', '0'],
    ['2025-02', '100'],
    ['2025-03', '100'],
    ['2025-04', '-100'],
    ['2025-05', '-50'],
    ['2025-07', '200'],
  ]) {
    await setMonth(page, month);
    await page.locator('[data-balance="1"]').fill(balance);
    await page.locator('[data-action="saveMonth"]').click();
    await expect(page.locator('.status-block')).toContainText('Complete');
  }
  await nav(page, 'Dashboard');
  const change = page.locator('.metric').nth(1);
  for (const [month, value, comparison] of [
    ['2025-02', '+€100.00', 'January 2025 · €0.00'],
    ['2025-03', '€0.00 (0.00%)', 'February 2025 · €100.00'],
    ['2025-04', '-€200.00 (-200.00%)', 'March 2025 · €100.00'],
    ['2025-05', '+€50.00 (+50.00%)', 'April 2025 · -€100.00'],
    ['2025-06', '—', 'Previous month is incomplete or missing'],
    ['2025-07', '—', 'Previous month is incomplete or missing'],
  ]) {
    await setMonth(page, month);
    await expect(change.locator('.metric-value')).toHaveText(value);
    await expect(change).toContainText(comparison);
  }
  await setMonth(page, '2025-05');
  await page.reload();
  await expect(page.locator('.month-picker')).toHaveValue('2025-07');
  await setMonth(page, '2025-05');
  await expect(change.locator('.metric-value')).toHaveText('+€50.00 (+50.00%)');
});
