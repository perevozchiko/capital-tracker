const {
  test,
  expect,
  open,
  nav,
  createAccount,
  createGroup,
  accountGroup,
  setMonth,
  editDialog,
} = require('./helpers.cjs');

async function setup(page, app, screen) {
  await open(page, app);
  await nav(page, 'Accounts');
  for (const name of ['Savings', 'Empty']) await createGroup(page, name);
  await page.locator('#accountGroup').selectOption({ label: 'Savings' });
  await createAccount(page, 'Bank');
  await createAccount(page, 'Cash');
  if (screen !== 'Accounts') await nav(page, screen);
}
async function expectAll(page, closed) {
  const buttons = page.locator('.group-toggle');
  await expect(buttons.first()).toBeVisible();
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);
  await expect(page.locator('.account-group.is-collapsed')).toHaveCount(
    closed ? count : 0,
  );
  for (const button of await buttons.all())
    await expect(button).toHaveAttribute('aria-expanded', String(!closed));
}
for (const screen of ['Accounts', 'Monthly balances']) {
  for (const group of ['Savings', 'Empty', 'Ungrouped', 'Archive']) {
    test(`${screen}: collapse and expand ${group} persists across reload`, async ({
      page,
      app,
    }) => {
      await setup(page, app, screen);
      const panel = accountGroup(page, group);
      const toggle = panel.locator('.group-toggle');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(panel.locator('.account-group-body')).toBeHidden();
      await page.reload();
      await nav(page, screen);
      await expect(panel).toHaveClass(/is-collapsed/);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(panel.locator('.account-group-body')).toBeVisible();
    });
  }
  test(`${screen}: collapse all and expand all from mixed state are idempotent`, async ({
    page,
    app,
  }) => {
    await setup(page, app, screen);
    await accountGroup(page, 'Savings').locator('.group-toggle').click();
    for (let i = 0; i < 2; i++) {
      await page
        .getByRole('button', { name: 'Collapse all', exact: true })
        .click();
      await expectAll(page, true);
    }
    await page.reload();
    await nav(page, screen);
    await expectAll(page, true);
    for (let i = 0; i < 2; i++) {
      await page
        .getByRole('button', { name: 'Expand all', exact: true })
        .click();
      await expectAll(page, false);
    }
    await page.reload();
    await nav(page, screen);
    await expectAll(page, false);
  });
  test(`${screen}: bulk controls work with no accounts or user groups`, async ({
    page,
    app,
  }) => {
    await open(page, app);
    await nav(page, screen);
    await page
      .getByRole('button', { name: 'Collapse all', exact: true })
      .click();
    await expectAll(page, true);
    await page.getByRole('button', { name: 'Expand all', exact: true }).click();
    await expectAll(page, false);
  });
}
for (const source of ['Accounts', 'Monthly balances']) {
  test(`bulk state is shared from ${source} to the other screen and survives application restart`, async ({
    page,
    app,
    restartApp,
  }) => {
    await setup(page, app, source);
    const destination = source === 'Accounts' ? 'Monthly balances' : 'Accounts';
    await page
      .getByRole('button', { name: 'Collapse all', exact: true })
      .click();
    await nav(page, destination);
    await expectAll(page, true);
    await restartApp();
    await page.reload();
    await nav(page, destination);
    await expectAll(page, true);
    await page.getByRole('button', { name: 'Expand all', exact: true }).click();
    await nav(page, source);
    await expectAll(page, false);
  });
}
test('bulk collapse preserves unsaved balances, rates and selected month', async ({
  page,
  app,
}) => {
  await setup(page, app, 'Accounts');
  await createAccount(page, 'Dollars', 'USD');
  await nav(page, 'Monthly balances');
  await setMonth(page, '2025-01');
  await page.locator('[data-balance="1"]').fill('10');
  await page.locator('[data-balance="2"]').fill('20');
  await page.locator('[data-balance="3"]').fill('110');
  await page.locator('[data-rate="USD"]').fill('1.1');
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await expect(page.locator('#confirmDialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await expect(page.locator('[data-balance="3"]')).toHaveValue('110');
  await expect(page.locator('[data-rate="USD"]')).toHaveValue('1.1');
  await expect(page.locator('.month-picker')).toHaveValue('2025-01');
  await page.locator('[data-action="saveMonth"]').click();
  await expect(page.locator('.status-block')).toContainText('€130.00');
});
test('collapsed group can be renamed and newly created groups start expanded', async ({
  page,
  app,
}) => {
  await setup(page, app, 'Accounts');
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  const group = accountGroup(page, 'Savings');
  await group.locator('.group-controls summary').click();
  await group.locator('[data-action="groupRename"]').click();
  await editDialog(page, 'Renamed');
  await expect(accountGroup(page, 'Renamed')).toHaveClass(/is-collapsed/);
  await createGroup(page, 'New');
  await expect(accountGroup(page, 'New')).not.toHaveClass(/is-collapsed/);
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await expectAll(page, true);
});
