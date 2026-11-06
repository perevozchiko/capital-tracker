const { test, expect, open, nav, setMonth } = require('./helpers.cjs');

const sections = [
  { pageName: 'Income', kind: 'income', endpoint: 'incomes' },
  { pageName: 'Major expenses', kind: 'expense', endpoint: 'expenses' },
  {
    pageName: 'Recurring expenses',
    kind: 'recurringExpense',
    endpoint: 'recurring-expenses',
  },
];
const attribute = (kind) =>
  kind.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());

async function seed(page, app, section) {
  const months =
    section.kind === 'recurringExpense'
      ? ['2026-01']
      : ['2026-10', '2026-11', '2026-12'];
  for (const month of months) {
    const entries = ['Original', 'Unchanged'].map((name) => ({
      month,
      name,
      currency: 'USD',
      amount_minor: '11000',
      rate: '1.1',
    }));
    const response = await page.request.put(
      `${app}/api/${section.endpoint}/${month}`,
      {
        headers: { 'X-Capital-Tracker': '1' },
        data: {
          entries,
          ...(section.kind === 'recurringExpense'
            ? { groups: [{ name: 'Home', entry_positions: [0, 1] }] }
            : {}),
        },
      },
    );
    expect(response.ok()).toBe(true);
  }
}

async function edit(page, kind) {
  const row = page.locator(`[data-${attribute(kind)}-row]`).first();
  const action = `edit${kind[0].toUpperCase()}${kind.slice(1)}Row`;
  await row.locator(`[data-action="${action}"]`).click();
  await expect(page.locator('#entryEditDialog')).toBeVisible();
  return page.locator('#entryEditDialog');
}

async function save(page, section) {
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/${section.endpoint}/2026-11`) &&
      response.request().method() === 'PUT',
  );
  await page.locator(`#${section.kind}Form [type="submit"]`).click();
  expect((await saved).ok()).toBe(true);
  await expect(
    page.locator(`#${section.kind}Form [type="submit"]`),
  ).toBeEnabled();
}

for (const section of sections) {
  const { kind, pageName, endpoint } = section;
  const attr = attribute(kind);
  for (const width of [320, 1280]) {
    test(`${kind} edits preserve month boundaries and survive restart at ${width}px`, async ({
      page,
      app,
      restartApp,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await seed(page, app, section);
      await open(page, app);
      await nav(page, pageName);
      await setMonth(page, '2026-11');
      const before = await (
        await page.request.get(`${app}/api/data/export`)
      ).json();
      const dialog = await edit(page, kind);
      await expect(dialog.locator('[name="name"]')).toHaveValue('Original');
      await expect(dialog.locator('[name="amount"]')).toHaveValue('110.00');
      await expect(dialog.locator('#entryEditHelp')).toContainText(
        'November 2026',
      );
      await dialog
        .locator('[name="name"]')
        .fill('  Новое <название> & "тест"  ');
      await dialog.locator('[name="amount"]').fill('220,55');
      await dialog
        .getByRole('button', { name: 'Confirm', exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      const rows = page.locator(`[data-${attr}-row]`);
      await expect(rows.first().locator(`[data-${attr}-name]`)).toHaveText(
        'Новое <название> & "тест"',
      );
      await expect(rows.first().locator(`[data-${attr}-amount]`)).toHaveText(
        '$220.55',
      );
      await expect(rows.first().locator(`[data-${attr}-eur]`)).toHaveText(
        '€200.50',
      );
      await expect(page.locator(`#${kind}Total`)).toHaveText('€300.50');
      await expect(rows.nth(1).locator(`[data-${attr}-name]`)).toHaveText(
        'Unchanged',
      );
      if (kind === 'recurringExpense') {
        await expect(
          page.locator(
            '[data-recurring-group="1"] [data-recurring-group-total]',
          ),
        ).toHaveText('€300.50');
      }
      // Editing the draft does not write any month until Save is pressed.
      expect(
        await (await page.request.get(`${app}/api/data/export`)).json(),
      ).toEqual({ ...before, exported_at: expect.any(String) });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await save(page, section);
      const after = await (
        await page.request.get(`${app}/api/data/export`)
      ).json();
      const collection =
        kind === 'recurringExpense' ? 'recurring_expenses' : endpoint;
      expect(
        after[collection].filter((entry) => entry.month < '2026-11'),
      ).toEqual(before[collection].filter((entry) => entry.month < '2026-11'));
      await restartApp();
      await page.reload();
      await nav(page, pageName);
      await setMonth(page, '2026-11');
      await expect(rows.first().locator(`[data-${attr}-name]`)).toHaveText(
        'Новое <название> & "тест"',
      );
      await expect(page.locator(`#${kind}Total`)).toHaveText('€300.50');
      await setMonth(page, '2026-10');
      await expect(rows.first().locator(`[data-${attr}-name]`)).toHaveText(
        'Original',
      );
      await expect(rows.first().locator(`[data-${attr}-amount]`)).toHaveText(
        '$110.00',
      );
      await setMonth(page, '2026-12');
      await expect(rows.first().locator(`[data-${attr}-name]`)).toHaveText(
        kind === 'recurringExpense' ? 'Новое <название> & "тест"' : 'Original',
      );
      await expect(rows.first().locator(`[data-${attr}-amount]`)).toHaveText(
        kind === 'recurringExpense' ? '$220.55' : '$110.00',
      );
      await setMonth(page, '2027-01');
      if (kind === 'recurringExpense') {
        await expect(rows.first().locator(`[data-${attr}-amount]`)).toHaveText(
          '$220.55',
        );
      } else {
        await expect(rows).toHaveCount(0);
        expect(
          after[endpoint].filter((entry) => entry.month === '2026-12'),
        ).toEqual(
          before[endpoint].filter((entry) => entry.month === '2026-12'),
        );
      }
    });
  }

  test(`${kind} editing supports cancellation, validation and unsaved-change protection`, async ({
    page,
    app,
  }) => {
    await seed(page, app, section);
    await open(page, app);
    await nav(page, pageName);
    await setMonth(page, '2026-11');
    const before = await (
      await page.request.get(`${app}/api/data/export`)
    ).json();
    let dialog = await edit(page, kind);
    await dialog.locator('[name="name"]').fill('Cancelled');
    await dialog.locator('[name="amount"]').fill('999');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const row = page.locator(`[data-${attr}-row]`).first();
    await expect(row.locator(`[data-${attr}-name]`)).toHaveText('Original');
    await expect(row.locator(`[data-${attr}-amount]`)).toHaveText('$110.00');
    // Cancellation must leave the page clean.
    await nav(page, 'Dashboard');
    await expect(page.locator('#confirmDialog')).not.toBeVisible();
    await nav(page, pageName);
    dialog = await edit(page, kind);
    await dialog.locator('[name="name"]').fill('   ');
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(dialog.locator('[name="name"]')).toHaveJSProperty(
      'validationMessage',
      'Please enter a name.',
    );
    await dialog.locator('[name="name"]').fill('Updated');
    for (const value of ['-1', 'abc', '1.001', '90000000000000.01']) {
      await dialog.locator('[name="amount"]').fill(value);
      await dialog
        .getByRole('button', { name: 'Confirm', exact: true })
        .click();
      await expect(dialog).toBeVisible();
      expect(
        await dialog
          .locator('[name="amount"]')
          .evaluate((input) => input.validity.valid),
      ).toBe(false);
      await expect(row.locator(`[data-${attr}-name]`)).toHaveText('Original');
    }
    await dialog.locator('[name="amount"]').fill('0');
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(row.locator(`[data-${attr}-amount]`)).toHaveText('$0.00');
    await expect(page.locator(`#${kind}Total`)).toHaveText('€100.00');
    await nav(page, 'Dashboard');
    await expect(page.locator('#confirmDialog')).toBeVisible();
    await page.locator('#confirmCancel').click();
    await expect(row.locator(`[data-${attr}-name]`)).toHaveText('Updated');
    expect(
      await (await page.request.get(`${app}/api/data/export`)).json(),
    ).toEqual({ ...before, exported_at: expect.any(String) });
    await save(page, section);
    dialog = await edit(page, kind);
    await dialog.locator('[name="name"]').fill('Escaped');
    await dialog.locator('[name="name"]').press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(row.locator(`[data-${attr}-name]`)).toHaveText('Updated');
  });
}
