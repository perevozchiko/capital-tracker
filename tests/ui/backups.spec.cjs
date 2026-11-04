const { readFile } = require('node:fs/promises');
const {
  test,
  expect,
  open,
  nav,
  createAccount,
  saveBalances,
} = require('./helpers.cjs');

for (const width of [390, 1280]) {
  test(`backup preview and return keep current data safe at ${width}px`, async ({
    page,
    app,
    restartApp,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, app);
    await nav(page, 'Accounts');
    await createAccount(page, 'Main bank', 'EUR', '2026-01');
    const account = (
      await (await page.request.get(app + '/api/accounts')).json()
    )[0];
    await nav(page, 'Monthly balances');
    await saveBalances(page, '2026-01', { [account.id]: '100' });
    await nav(page, 'Settings');
    await expect(
      page.locator('.backup-row').filter({ hasText: 'Automatic' }),
    ).toHaveCount(1);
    const originalStatus = await (
      await page.request.get(app + '/api/backups')
    ).json();
    await page
      .getByRole('button', { name: 'Back up now', exact: true })
      .click();
    const manual = page.locator('.backup-row').filter({ hasText: 'Manual' });
    await expect(manual).toHaveCount(1);
    const backupID = await manual
      .locator('[data-action="previewBackup"]')
      .getAttribute('data-backup-id');
    await nav(page, 'Monthly balances');
    await saveBalances(page, '2026-01', { [account.id]: '200' });

    const currentTab = await page.context().newPage();
    await open(currentTab, app);
    await nav(currentTab, 'Monthly balances');
    await expect(currentTab.locator('[data-balance]')).toHaveValue('200.00');

    await nav(page, 'Settings');
    await manual.getByRole('button', { name: 'View', exact: true }).click();
    await expect(page.locator('#backupBanner')).toContainText(
      'Archive · read only',
    );
    await expect(page).toHaveURL(new RegExp('backup='));
    await page.reload();
    await expect(page.locator('#backupBanner')).toBeVisible();
    await nav(page, 'Monthly balances');
    await expect(page.locator('[data-balance]')).toHaveValue('100.00');
    await expect(page.locator('[data-balance]')).toBeDisabled();
    await expect(page.locator('[data-action="saveMonth"]')).toBeDisabled();
    await nav(page, 'Accounts');
    await expect(page.locator('#addAccountForm')).not.toBeVisible();
    await expect(page.locator('[draggable="true"]')).toHaveCount(0);
    for (const [screen, selector] of [
      ['Income', '#incomeForm button[type="submit"]'],
      ['Major expenses', '#expenseForm button[type="submit"]'],
      ['Recurring expenses', '#recurringExpenseForm button[type="submit"]'],
    ]) {
      await nav(page, screen);
      await expect(page.locator(selector)).toBeDisabled();
    }
    await nav(page, 'Settings');
    await expect(page.locator('#themeSelect')).toBeDisabled();
    await expect(page.locator('[data-action="importJSON"]')).toBeDisabled();
    await expect(page.locator('[data-action="clearAllData"]')).toBeDisabled();
    const downloaded = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Export JSON', exact: true })
      .click();
    const document = JSON.parse(
      await readFile(await (await downloaded).path(), 'utf8'),
    );
    expect(document.balances[0].amount_minor).toBe('10000');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await currentTab.reload();
    await nav(currentTab, 'Monthly balances');
    await expect(currentTab.locator('[data-balance]')).toHaveValue('200.00');
    await expect(currentTab.locator('[data-balance]')).toBeEnabled();
    await page
      .getByRole('button', { name: 'Return to current data', exact: true })
      .click();
    await expect(page.locator('#backupBanner')).not.toBeVisible();
    await nav(page, 'Monthly balances');
    await expect(page.locator('[data-balance]')).toHaveValue('200.00');
    await expect(page.locator('[data-balance]')).toBeEnabled();
    await restartApp();
    await page.reload();
    await nav(page, 'Settings');
    const status = await (await page.request.get(app + '/api/backups')).json();
    expect(status.next_at).toBe(originalStatus.next_at);
    expect(status.backups).toHaveLength(2);
    expect(status.backups.some((backup) => backup.id === backupID)).toBe(true);
    await currentTab.close();
  });
}

test('restore can be cancelled and undone using the recovery copy', async ({
  page,
  app,
}) => {
  await open(page, app);
  await nav(page, 'Accounts');
  await createAccount(page, 'Original bank', 'EUR', '2026-01');
  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Back up now', exact: true }).click();
  const manual = page.locator('.backup-row').filter({ hasText: 'Manual' });
  await expect(manual).toHaveCount(1);
  const account = (
    await (await page.request.get(app + '/api/accounts')).json()
  )[0];
  const changed = await page.request.patch(
    app + '/api/accounts/' + account.id,
    {
      headers: { 'X-Capital-Tracker': '1' },
      data: { name: 'Current bank' },
    },
  );
  expect(changed.ok()).toBe(true);
  await manual.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.locator('#confirmDialog')).toContainText('recovery copy');
  await page.locator('#confirmCancel').click();
  expect(
    (await (await page.request.get(app + '/api/accounts')).json())[0].name,
  ).toBe('Current bank');
  await manual.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.locator('#confirmAccept').click();
  await expect(
    page.getByRole('heading', { name: 'Dashboard', exact: true }),
  ).toBeVisible();
  await nav(page, 'Accounts');
  await expect(page.locator('.account-row')).toContainText('Original bank');
  await nav(page, 'Settings');
  const recovery = page
    .locator('.backup-row')
    .filter({ hasText: 'Current data saved before restore' });
  await expect(recovery).toHaveCount(1);
  await recovery.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.locator('#confirmAccept').click();
  await expect(
    page.getByRole('heading', { name: 'Dashboard', exact: true }),
  ).toBeVisible();
  await nav(page, 'Accounts');
  await expect(page.locator('.account-row')).toContainText('Current bank');
});

test('missing archive shows an error and offers a return to current data', async ({
  page,
  app,
}) => {
  await page.goto(app + '/?backup=20000101T000000.000000000Z-manual.db');
  await expect(page.locator('#pageContent')).toContainText(
    'This backup is no longer available',
  );
  await page
    .getByRole('button', { name: 'Return to current data', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Dashboard', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#backupBanner')).not.toBeVisible();
});
