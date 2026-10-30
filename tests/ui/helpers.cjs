const { test: base, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const test = base.extend({
  appServer: async ({}, use) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'capital-tracker-ui-'));
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const url = `http://127.0.0.1:${port}`;
    let server;
    let log = '';
    const stop = async () => {
      if (server && server.exitCode === null) {
        const exited = new Promise((resolve) => server.once('exit', resolve));
        server.kill('SIGTERM');
        await exited;
      }
    };
    const start = async () => {
      server = spawn(process.env.CAPITAL_TRACKER_TEST_BINARY, [
        '--no-browser',
        '--data-dir',
        dir,
        '--port',
        String(port),
      ]);
      server.stdout.on('data', (data) => {
        log += data;
      });
      server.stderr.on('data', (data) => {
        log += data;
      });
      for (let i = 0; i < 100; i++) {
        if (server.exitCode !== null) throw new Error(`Server exited: ${log}`);
        try {
          if ((await fetch(url + '/api/meta')).ok) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Server did not start: ${log}`);
    };
    try {
      await start();
      await use({
        url,
        restart: async () => {
          await stop();
          await start();
        },
      });
    } finally {
      await stop();
      await rm(dir, { recursive: true, force: true });
    }
  },
  app: async ({ appServer }, use) => {
    await use(appServer.url);
  },
  restartApp: async ({ appServer }, use) => {
    await use(appServer.restart);
  },
});

async function open(page, app) {
  await page.goto(app);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}
async function nav(page, name) {
  if (
    (await page.locator('#mobileMenu').isVisible()) &&
    !(await page
      .locator('#sidebar')
      .evaluate((el) => el.classList.contains('show')))
  ) {
    await page.locator('#mobileMenu').click();
  }
  await page
    .locator('#navigation')
    .getByRole('button', { name, exact: true })
    .click();
  const ready = {
    Accounts: '#addAccountForm',
    'Monthly balances': '.status-block',
    Settings: '#themeSelect',
    Dashboard: '#pageContent .grid-summary, #pageContent .empty',
  };
  await expect(
    page
      .locator(ready[name])
      .first()
      .or(page.locator('#confirmDialog[open]'))
      .first(),
  ).toBeVisible();
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

async function createGroup(page, name) {
  await page.locator('[data-action="groupCreate"]').click();
  await editDialog(page, name);
  await expect(accountGroup(page, name)).toBeVisible();
}
function row(page, name) {
  return page.locator('[data-account-row]').filter({
    has: page.locator('.account-main strong').filter({ hasText: name }),
  });
}
async function expectMembers(page, group, names) {
  await expect(
    accountGroup(page, group).locator(
      '[data-account-row] .account-main strong',
    ),
  ).toHaveText(names.map((name) => new RegExp('^' + name + ' ')));
}
async function drag(
  page,
  source,
  target,
  after = false,
  endpoint = '/api/accounts/assignments',
) {
  const box = await target.boundingBox();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith(endpoint) && r.request().method() === 'PUT',
  );
  await source.dragTo(target, {
    sourcePosition: { x: 90, y: 20 },
    targetPosition: {
      x: 100,
      y: Math.max(2, box.height * (after ? 0.75 : 0.25)),
    },
  });
  const response = await saved;
  return response;
}
async function saveBalances(page, month, values, rates = {}) {
  await setMonth(page, month);
  for (const [id, value] of Object.entries(values))
    await page.locator(`[data-balance="${id}"]`).fill(value);
  for (const [currency, value] of Object.entries(rates))
    await page.locator(`[data-rate="${currency}"]`).fill(value);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/months/' + month) &&
      response.request().method() === 'PUT',
  );
  await page.locator('[data-action="saveMonth"]').click();
  expect((await saved).ok()).toBe(true);
  await expect(page.locator('[data-action="saveMonth"]')).toBeEnabled();
  await expect(page.locator('#toast')).toContainText('Month saved.');
}
module.exports = {
  test,
  expect,
  open,
  nav,
  createAccount,
  editDialog,
  action,
  accountGroup,
  setMonth,
  createGroup,
  row,
  expectMembers,
  drag,
  saveBalances,
};
