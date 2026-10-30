const {
  test,
  expect,
  open,
  nav,
  createAccount,
  createGroup,
  accountGroup,
  row,
  expectMembers,
  drag,
  saveBalances,
} = require('./helpers.cjs');

async function setup(page, app) {
  await page.setViewportSize({ width: 1440, height: 1800 });
  await open(page, app);
  await nav(page, 'Accounts');
  for (const group of ['Alpha', 'Beta', 'Empty'])
    await createGroup(page, group);
  for (const [name, group] of [
    ['A1', 'Alpha'],
    ['A2', 'Alpha'],
    ['A3', 'Alpha'],
    ['B1', 'Beta'],
    ['B2', 'Beta'],
    ['U1', 'Ungrouped'],
  ]) {
    await page.locator('#accountGroup').selectOption({ label: group });
    await createAccount(page, name);
  }
}
const header = (page, group) =>
  accountGroup(page, group).locator('.account-group-head');
async function groupOrder(page, names) {
  await expect(
    page.locator(
      '.account-group-head[draggable="true"] .group-caption > strong',
    ),
  ).toHaveText(names);
}

for (const scenario of [
  {
    source: 'Alpha',
    target: 'Empty',
    after: true,
    want: ['Beta', 'Empty', 'Alpha'],
  },
  {
    source: 'Empty',
    target: 'Alpha',
    after: false,
    want: ['Empty', 'Alpha', 'Beta'],
  },
  {
    source: 'Alpha',
    target: 'Beta',
    after: true,
    want: ['Beta', 'Alpha', 'Empty'],
  },
  {
    source: 'Beta',
    target: 'Alpha',
    after: false,
    want: ['Beta', 'Alpha', 'Empty'],
  },
  {
    source: 'Empty',
    target: 'Beta',
    after: false,
    want: ['Alpha', 'Empty', 'Beta'],
  },
  {
    source: 'Beta',
    target: 'Empty',
    after: true,
    want: ['Alpha', 'Empty', 'Beta'],
  },
]) {
  test(`drag group ${scenario.source} ${scenario.after ? 'after' : 'before'} ${scenario.target}`, async ({
    page,
    app,
  }) => {
    await setup(page, app);
    await drag(
      page,
      header(page, scenario.source),
      header(page, scenario.target),
      scenario.after,
      '/api/groups/reorder',
    );
    await groupOrder(page, scenario.want);
    await expectMembers(page, 'Alpha', ['A1', 'A2', 'A3']);
    await expectMembers(page, 'Beta', ['B1', 'B2']);
    await page.reload();
    await nav(page, 'Accounts');
    await groupOrder(page, scenario.want);
  });
}
for (const scenario of [
  { source: 'A1', target: 'A3', after: true, want: ['A2', 'A3', 'A1'] },
  { source: 'A3', target: 'A1', after: false, want: ['A3', 'A1', 'A2'] },
  { source: 'A1', target: 'A2', after: true, want: ['A2', 'A1', 'A3'] },
  { source: 'A3', target: 'A2', after: false, want: ['A1', 'A3', 'A2'] },
  { source: 'A2', target: 'A1', after: false, want: ['A2', 'A1', 'A3'] },
  { source: 'A2', target: 'A3', after: true, want: ['A1', 'A3', 'A2'] },
]) {
  test(`drag account inside group ${scenario.source} ${scenario.after ? 'after' : 'before'} ${scenario.target}`, async ({
    page,
    app,
  }) => {
    await setup(page, app);
    await drag(
      page,
      row(page, scenario.source),
      row(page, scenario.target),
      scenario.after,
    );
    await expectMembers(page, 'Alpha', scenario.want);
    await expectMembers(page, 'Beta', ['B1', 'B2']);
    await page.reload();
    await nav(page, 'Accounts');
    await expectMembers(page, 'Alpha', scenario.want);
  });
}
for (const scenario of [
  { group: 'Beta', target: 'B1', after: false, want: ['A1', 'B1', 'B2'] },
  { group: 'Beta', target: 'B1', after: true, want: ['B1', 'A1', 'B2'] },
  { group: 'Beta', target: 'B2', after: true, want: ['B1', 'B2', 'A1'] },
  { group: 'Beta', want: ['B1', 'B2', 'A1'] },
  { group: 'Empty', want: ['A1'] },
  { group: 'Ungrouped', want: ['U1', 'A1'] },
]) {
  test(`drag between groups into ${scenario.group} ${scenario.target || 'header'} ${scenario.after ? 'after' : 'before'}`, async ({
    page,
    app,
  }) => {
    await setup(page, app);
    await drag(
      page,
      row(page, 'A1'),
      scenario.target
        ? row(page, scenario.target)
        : header(page, scenario.group),
      scenario.after,
    );
    await expectMembers(page, 'Alpha', ['A2', 'A3']);
    await expectMembers(page, scenario.group, scenario.want);
    await page.reload();
    await nav(page, 'Accounts');
    await expectMembers(page, scenario.group, scenario.want);
  });
}
for (const target of ['Alpha', 'Empty']) {
  test(`drag from Ungrouped into ${target}`, async ({ page, app }) => {
    await setup(page, app);
    await drag(page, row(page, 'U1'), header(page, target));
    await expectMembers(page, 'Ungrouped', []);
    await expectMembers(
      page,
      target,
      target === 'Alpha' ? ['A1', 'A2', 'A3', 'U1'] : ['U1'],
    );
  });
}
for (const target of ['Beta', 'Empty', 'Ungrouped']) {
  test(`drag into collapsed ${target} keeps membership and collapsed state`, async ({
    page,
    app,
  }) => {
    await setup(page, app);
    await accountGroup(page, target).locator('.group-toggle').click();
    await drag(page, row(page, 'A1'), header(page, target));
    await expect(accountGroup(page, target)).toHaveClass(/is-collapsed/);
    await accountGroup(page, target).locator('.group-toggle').click();
    const expected =
      target === 'Beta'
        ? ['B1', 'B2', 'A1']
        : target === 'Ungrouped'
          ? ['U1', 'A1']
          : ['A1'];
    await expectMembers(page, target, expected);
  });
}
for (const kind of ['account', 'group']) {
  test(`failed ${kind} drag preserves order and can retry`, async ({
    page,
    app,
  }) => {
    await setup(page, app);
    const endpoint =
      kind === 'group' ? '/api/groups/reorder' : '/api/accounts/assignments';
    await page.route('**' + endpoint, (route) =>
      route.fulfill({
        status: 500,
        json: { error: { code: 'internal_error' } },
      }),
    );
    const source = () =>
      kind === 'group' ? header(page, 'Alpha') : row(page, 'A1');
    const target = () =>
      kind === 'group' ? header(page, 'Empty') : header(page, 'Beta');
    expect(
      (await drag(page, source(), target(), true, endpoint)).status(),
    ).toBe(500);
    await expect(page.locator('#toast')).toContainText(
      'Database or server error',
    );
    await groupOrder(page, ['Alpha', 'Beta', 'Empty']);
    await expectMembers(page, 'Alpha', ['A1', 'A2', 'A3']);
    await expectMembers(page, 'Beta', ['B1', 'B2']);
    await page.unroute('**' + endpoint);
    await drag(page, source(), target(), true, endpoint);
    if (kind === 'group') await groupOrder(page, ['Beta', 'Empty', 'Alpha']);
    else await expectMembers(page, 'Beta', ['B1', 'B2', 'A1']);
  });
}

for (const group of ['Ungrouped', 'Archive']) {
  test(`user group cannot be reordered onto virtual ${group}`, async ({
    page,
    app,
  }) => {
    await setup(page, app);
    let writes = 0;
    page.on('request', (request) => {
      if (
        request.url().endsWith('/api/groups/reorder') &&
        request.method() === 'PUT'
      )
        writes++;
    });
    await header(page, 'Alpha').dragTo(header(page, group), {
      sourcePosition: { x: 90, y: 20 },
      targetPosition: { x: 100, y: 20 },
    });
    await groupOrder(page, ['Alpha', 'Beta', 'Empty']);
    expect(writes).toBe(0);
    await expect(page.locator('.dragging,.drag-over')).toHaveCount(0);
  });
}
for (const approved of [false, true]) {
  test(`drag into Archive ${approved ? 'accepts archive and disables further dragging' : 'can be cancelled without moving the account'}`, async ({
    page,
    app,
  }) => {
    await setup(page, app);
    await nav(page, 'Monthly balances');
    await saveBalances(page, '2025-01', {
      1: '0',
      2: '0',
      3: '0',
      4: '0',
      5: '0',
      6: '0',
    });
    await nav(page, 'Accounts');
    await row(page, 'A1').dragTo(header(page, 'Archive'), {
      sourcePosition: { x: 90, y: 20 },
      targetPosition: { x: 100, y: 20 },
    });
    await expect(page.locator('#accountDialog')).toBeVisible();
    if (!approved) {
      await page.locator('#cancelEdit').click();
      await expectMembers(page, 'Alpha', ['A1', 'A2', 'A3']);
      await expectMembers(page, 'Archive', []);
    } else {
      await page.locator('#editValue').fill('2025-02');
      await page.locator('#confirmEdit').click();
      await expect(page.locator('#accountDialog')).not.toBeVisible();
      await expectMembers(page, 'Archive', ['A1']);
      await expect(row(page, 'A1')).toHaveAttribute('draggable', 'false');
      await expectMembers(page, 'Alpha', ['A2', 'A3']);
      await page.reload();
      await nav(page, 'Accounts');
      await expectMembers(page, 'Archive', ['A1']);
    }
  });
}

test('group can be dragged across a scroll boundary in a regular desktop viewport', async ({
  page,
  app,
}) => {
  await setup(page, app);
  await page.setViewportSize({ width: 1280, height: 720 });
  const source = header(page, 'Alpha');
  const target = header(page, 'Empty');
  await source.hover({ position: { x: 90, y: 20 } });
  const origin = await source.boundingBox();
  await page.mouse.down();
  await page.mouse.move(origin.x + 105, origin.y + 25, { steps: 5 });
  await target.scrollIntoViewIfNeeded();
  await target.hover({ position: { x: 100, y: 20 } });
  await target.hover({ position: { x: 105, y: 25 } });
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/groups/reorder') && r.request().method() === 'PUT',
    { timeout: 5000 },
  );
  await page.mouse.up();
  expect((await saved).ok()).toBe(true);
  await groupOrder(page, ['Beta', 'Alpha', 'Empty']);
});
