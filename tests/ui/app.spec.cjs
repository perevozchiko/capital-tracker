const {
  test,
  expect,
  open,
  nav,
  createAccount,
  editDialog,
  action,
  accountGroup,
  setMonth,
} = require('./helpers.cjs');

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
  await expect(page.locator('.history-svg')).toBeVisible();
  await expect(page.locator('.chart-dot')).toHaveAttribute(
    'aria-label',
    'January 2025: €200.00',
  );
  await expect(page.locator('#pageContent table')).toHaveCount(0);
  await expect(page.locator('#columnCount')).toHaveCount(0);
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
  await page.locator('[data-rate="RSD"]').fill('');
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
  await expect(page.locator('[data-rate="RSD"]')).toHaveValue('');
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
  await expect(page.locator('[data-rate="USD"]')).toHaveAttribute(
    'readonly',
    '',
  );
  await page.locator('[data-balance="2"]').fill('');
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('Missing balances');
  await page.reload();
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.1');
  await expect(page.locator('[data-balance="2"]')).toHaveValue('');
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

test('account and group edits persist, cancellation preserves data and group deletion preserves balances', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await page.locator('[data-action="groupCreate"]').click();
  await page.locator('#editValue').fill('Cancelled group');
  await page.locator('#cancelEdit').click();
  await expect(accountGroup(page, 'Cancelled group')).toHaveCount(0);
  for (const name of ['Savings', 'Other']) {
    await page.locator('[data-action="groupCreate"]').click();
    await editDialog(page, name);
  }
  // A duplicate name is rejected while preserving the existing groups.
  await page.locator('[data-action="groupCreate"]').click();
  await page.locator('#editValue').fill('savings');
  await page.locator('#confirmEdit').click();
  await expect(page.locator('#toast')).toContainText('already exists');
  await expect(page.locator('#accountDialog')).toBeVisible();
  await page.locator('#cancelEdit').click();
  await expect(page.locator('[data-action="groupRename"]')).toHaveCount(2);
  await page.locator('#accountGroup').selectOption({ label: 'Savings' });
  await createAccount(page, 'Bank');
  await expect(
    accountGroup(page, 'Savings').locator('.account-row'),
  ).toContainText('Bank');
  await action(page, 'Bank', 'rename');
  await page.locator('#editValue').fill('Cancelled rename');
  await page.locator('#cancelEdit').click();
  await expect(page.locator('.account-row')).toContainText('Bank');
  await action(page, 'Bank', 'rename');
  await editDialog(page, 'Renamed bank');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await page.locator('[data-balance="1"]').fill('123.45');
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('Complete');
  await nav(page, 'Accounts');
  const savings = accountGroup(page, 'Savings');
  await savings.locator('.group-controls summary').click();
  await savings.locator('[data-action="groupRename"]').click();
  await page.locator('#editValue').fill('Other');
  await page.locator('#confirmEdit').click();
  await expect(page.locator('#toast')).toContainText('already exists');
  await page.locator('#editValue').fill('Emergency');
  await page.locator('#confirmEdit').click();
  await expect(page.locator('#accountDialog')).not.toBeVisible();
  await page.reload();
  await nav(page, 'Accounts');
  const emergency = accountGroup(page, 'Emergency');
  await expect(emergency.locator('.account-row')).toContainText('Renamed bank');
  await emergency.locator('.group-controls summary').click();
  await emergency.locator('[data-action="groupDelete"]').click();
  await page.locator('#confirmCancel').click();
  await expect(emergency).toBeVisible();
  await emergency.locator('.group-controls summary').click();
  await emergency.locator('[data-action="groupDelete"]').click();
  await page.locator('#confirmAccept').click();
  await expect(emergency).toHaveCount(0);
  await expect(
    accountGroup(page, 'Ungrouped').locator('.account-row'),
  ).toContainText('Renamed bank');
  await page.reload();
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await expect(page.locator('[data-balance="1"]')).toHaveValue('123.45');
  await nav(page, 'Dashboard');
  await expect(page.locator('.metric').first()).toContainText('€123.45');
});

test('exchange rates load only on demand and are persisted only by saving the month', async ({
  page,
  app,
}) => {
  let rateRequests = 0;
  await page.route('**/api/exchange-rates*', (route) => {
    rateRequests++;
    return route.fulfill({
      json: { date: '2026-10-29', rates: { USD: '1.1', RSD: '117.2' } },
    });
  });
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Dollars', 'USD');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await page.locator('[data-balance="1"]').fill('110');
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('Incomplete');
  expect(rateRequests).toBe(0);
  await page.locator('[data-action="loadRates"]').click();
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.1');
  await expect(page.locator('#rateLoadStatus')).toContainText('2026-10-29');
  expect(rateRequests).toBe(1);
  // Loading must not change the stored observation until Save month is pressed.
  const stored = await page.request.get(app + '/api/months/2025-01');
  expect((await stored.json()).rates).toEqual([]);
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('Complete');
  await page.reload();
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.1');
  expect(rateRequests).toBe(1);
});

test('a pending rate quote cannot change another month after navigation', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Dollars', 'USD');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/exchange-rates*', async (route) => {
    await pending;
    await route.fulfill({
      json: { date: '2026-10-29', rates: { USD: '1.1' } },
    });
  });
  const requested = page.waitForRequest('**/api/exchange-rates*');
  await page.locator('[data-action="loadRates"]').click();
  await requested;
  await setMonth(page, '2025-02');
  const response = page.waitForResponse('**/api/exchange-rates*');
  release();
  await response;
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('');
  await expect(page.locator('#rateLoadStatus')).toHaveText('');
  await expect(page.locator('[data-action="loadRates"]')).toBeEnabled();
  await expect(page.locator('[data-action="saveMonth"]')).toBeEnabled();
});

test('loaded quotes remain frozen across later provider quotes, saves, reload and export', async ({
  page,
  app,
}) => {
  let quote = { USD: '1.1', RSD: '117.2', RUB: '100', TRY: '40' };
  let requests = 0;
  await page.route('**/api/exchange-rates*', (route) => {
    requests++;
    return route.fulfill({ json: { date: '2026-10-29', rates: quote } });
  });
  await open(page, app);
  await nav(page, 'Accounts');
  for (const currency of Object.keys(quote)) {
    await createAccount(page, currency, currency);
  }
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  for (const [id, balance] of [
    [1, '110'],
    [2, '11720'],
    [3, '10000'],
    [4, '4000'],
  ]) {
    await page.locator(`[data-balance="${id}"]`).fill(balance);
  }
  await page.locator('[data-action="loadRates"]').click();
  const original = { ...quote };
  for (const [currency, rate] of Object.entries(original)) {
    await expect(page.locator(`[data-rate="${currency}"]`)).toHaveValue(rate);
  }
  // The provider changes BEFORE Save. The editor must save the quote it loaded.
  quote = { USD: '2.2', RSD: '234.4', RUB: '200', TRY: '80' };
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('€400.00');
  expect(requests).toBe(1);
  await setMonth(page, '2025-02');
  for (const [id, balance] of [
    [1, '110'],
    [2, '11720'],
    [3, '10000'],
    [4, '4000'],
  ]) {
    await page.locator(`[data-balance="${id}"]`).fill(balance);
  }
  await page.locator('[data-action="loadRates"]').click();
  for (const [currency, rate] of Object.entries(quote)) {
    await expect(page.locator(`[data-rate="${currency}"]`)).toHaveValue(rate);
  }
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('€200.00');
  await nav(page, 'Dashboard');
  await expect(page.locator('.metric').nth(1)).toContainText(
    '-€200.00 (-50.00%)',
  );
  await page.reload();
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  for (const [currency, rate] of Object.entries(original)) {
    await expect(page.locator(`[data-rate="${currency}"]`)).toHaveValue(rate);
  }
  // Saved rates are fixed; changing a balance preserves the original quote.
  await expect(page.locator('[data-action="loadRates"]')).toBeDisabled();
  await page.locator('[data-balance="1"]').fill('220');
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('€500.00');
  const january = await (
    await page.request.get(app + '/api/months/2025-01')
  ).json();
  expect(
    Object.fromEntries(january.rates.map((r) => [r.currency, r.rate])),
  ).toEqual(original);
  const february = await (
    await page.request.get(app + '/api/months/2025-02')
  ).json();
  expect(february.total_eur_minor).toBe('20000');
  expect(
    Object.fromEntries(february.rates.map((r) => [r.currency, r.rate])),
  ).toEqual(quote);
  const exported = await (
    await page.request.get(app + '/api/data/export')
  ).json();
  expect(
    Object.fromEntries(
      exported.rates
        .filter((r) => r.month === '2025-01')
        .map((r) => [r.currency, r.rate_scaled]),
    ),
  ).toEqual({
    USD: '110000000',
    RSD: '11720000000',
    RUB: '10000000000',
    TRY: '4000000000',
  });
  expect(requests).toBe(2);
});

test('partial quotes and provider errors preserve entered values and allow retry', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Dollars', 'USD');
  await createAccount(page, 'Dinars', 'RSD');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await page.locator('[data-balance="1"]').fill('110');
  await page.locator('[data-balance="2"]').fill('11720');
  let response = { json: { date: '2026-10-29', rates: { USD: '1.1' } } };
  await page.route('**/api/exchange-rates*', (route) =>
    route.fulfill(response),
  );
  await page.locator('[data-action="loadRates"]').click();
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.1');
  await expect(page.locator('[data-rate="RSD"]')).toHaveValue('');
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('Incomplete');
  response = { status: 502, json: { error: { code: 'rates_unavailable' } } };
  await page.locator('[data-action="loadRates"]').click();
  await expect(page.locator('#rateLoadStatus')).toContainText(
    'Could not load rates',
  );
  await expect(page.locator('[data-action="loadRates"]')).toBeEnabled();
  await expect(page.locator('[data-action="saveMonth"]')).toBeEnabled();
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.1');
  response = {
    json: { date: '2026-10-29', rates: { USD: '2.2', RSD: '117.2' } },
  };
  await page.locator('[data-action="loadRates"]').click();
  await expect(page.locator('[data-rate="RSD"]')).toHaveValue('117.2');
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.1');
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('€200.00');
  await page.reload();
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.1');
  await expect(page.locator('[data-rate="RSD"]')).toHaveValue('117.2');
});

test('live provider quotes load through the real API and persist exactly in historical months', async ({
  page,
  app,
}) => {
  test.skip(
    process.env.CAPITAL_TRACKER_LIVE_RATES !== '1',
    'Enable CAPITAL_TRACKER_LIVE_RATES=1 to contact the real currency provider.',
  );
  await open(page, app);
  await nav(page, 'Accounts');
  const currencies = ['USD', 'RSD', 'RUB', 'TRY'];
  for (const currency of currencies) {
    await createAccount(page, currency, currency);
  }
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  for (let id = 1; id <= currencies.length; id++) {
    await page.locator(`[data-balance="${id}"]`).fill('100');
  }
  // No route interception: browser -> application -> public provider -> SQLite.
  const response = page.waitForResponse('**/api/exchange-rates*');
  await page
    .getByRole('button', { name: 'Load latest exchange rates', exact: true })
    .click();
  const loaded = await response;
  expect(loaded.status()).toBe(200);
  const quote = await loaded.json();
  expect(quote.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.locator('#rateLoadStatus')).toContainText(quote.date);
  for (const currency of currencies) {
    expect(quote.rates[currency]).toMatch(/^\d+(\.\d{1,8})?$/);
    await expect(page.locator(`[data-rate="${currency}"]`)).toHaveValue(
      quote.rates[currency],
    );
  }
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('Complete');
  const saved = await (
    await page.request.get(app + '/api/months/2025-01')
  ).json();
  expect(
    Object.fromEntries(saved.rates.map((r) => [r.currency, r.rate])),
  ).toEqual(quote.rates);
  await page.reload();
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  for (const currency of currencies) {
    await expect(page.locator(`[data-rate="${currency}"]`)).toHaveValue(
      quote.rates[currency],
    );
  }
  await nav(page, 'Dashboard');
  const history = await (
    await page.request.get(app + '/api/capital/history')
  ).json();
  expect(history.points).toContainEqual({
    month: '2025-01',
    complete: true,
    total_eur_minor: saved.total_eur_minor,
  });
  console.log(
    `Live FX quote ${quote.date}: all four currencies loaded and preserved in January 2025.`,
  );
});

test('failed save can retry the exact loaded eight-decimal quote without fetching again', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Dollars', 'USD');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await page.locator('[data-balance="1"]').fill('112.35');
  let loads = 0;
  await page.route('**/api/exchange-rates*', (route) => {
    loads++;
    return route.fulfill({
      json: { date: '2026-10-29', rates: { USD: '1.12345679' } },
    });
  });
  await page.locator('[data-action="loadRates"]').click();
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.12345679');
  let saves = 0;
  await page.route('**/api/months/2025-01', (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    saves++;
    expect(route.request().postDataJSON().rates).toEqual([
      { currency: 'USD', rate: '1.12345679' },
    ]);
    if (saves === 1) {
      return route.fulfill({
        status: 500,
        json: { error: { code: 'internal_error' } },
      });
    }
    return route.continue();
  });
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('#toast')).toContainText('Unable to save');
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.12345679');
  await expect(page.locator('[data-action="saveMonth"]')).toBeEnabled();
  const failed = await (
    await page.request.get(app + '/api/months/2025-01')
  ).json();
  expect(failed.exists).toBe(false);
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('Complete');
  const saved = await (
    await page.request.get(app + '/api/months/2025-01')
  ).json();
  expect(saved.rates).toEqual([{ currency: 'USD', rate: '1.12345679' }]);
  expect(saved.total_eur_minor).toBe('10000');
  expect(loads).toBe(1);
  expect(saves).toBe(2);
});

test('EUR-only months do not request external quotes and preserve recorded zero', async ({
  page,
  app,
}) => {
  let requests = 0;
  await page.route('**/api/exchange-rates*', (route) => {
    requests++;
    return route.abort();
  });
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Euro');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await expect(page.locator('[data-action="loadRates"]')).toHaveCount(0);
  await page.locator('[data-balance="1"]').fill('0');
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('Complete');
  await nav(page, 'Dashboard');
  await expect(page.locator('.metric').first()).toContainText('€0.00');
  await page.reload();
  expect(requests).toBe(0);
});
