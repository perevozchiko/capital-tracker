const {
  test,
  expect,
  open,
  nav,
  createAccount,
  createGroup,
  accountGroup,
  saveBalances,
  setMonth,
  action,
} = require('./helpers.cjs');
test.use({ screenshot: 'on' });

async function assertLayout(page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
  const problems = await page.evaluate(() => {
    const issues = [];
    const visible = (el) => el.getClientRects().length > 0;
    for (const el of document.querySelectorAll(
      '.metric-value,.group-total strong,.group-caption strong,.balance-previous strong,.balance-change,.account-balance strong,.account-main strong',
    )) {
      if (!visible(el)) continue;
      if (el.scrollWidth > el.clientWidth + 1)
        issues.push(
          `${el.className || el.tagName}: text overflows ${el.scrollWidth}/${el.clientWidth}`,
        );
      const range = document.createRange();
      // Measure the actual text: nested privacy spans add overlapping range
      // rectangles on the same line and must not count as line wrapping.
      range.selectNodeContents(el.querySelector('.money-text') || el);
      if (
        el.matches(
          '.group-total strong,.balance-previous strong,.balance-change,.account-balance strong',
        ) &&
        range.getClientRects().length > 1
      ) {
        issues.push(`${el.textContent}: monetary value wraps across lines`);
      }
      const rect = range.getBoundingClientRect();
      const panel = el.closest(
        '.account-main,.balance-cell,.card,.account-group,.editor-row',
      );
      if (panel) {
        const bounds = panel.getBoundingClientRect();
        if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
          issues.push(`${el.textContent}: outside containing panel`);
      }
    }
    for (const input of document.querySelectorAll('[data-balance]')) {
      if (!visible(input)) continue;
      const style = getComputedStyle(input);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      context.font = style.font;
      const needed = context.measureText(input.value).width;
      const available =
        input.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      if (needed > available + 1)
        issues.push(
          `balance input clips ${input.value}: ${needed}/${available}`,
        );
    }
    for (const header of document.querySelectorAll('.account-group-head')) {
      const caption = header.querySelector('.group-caption');
      const total = header.querySelector('.group-total');
      if (!caption || !total) continue;
      const a = caption.getBoundingClientRect(),
        b = total.getBoundingClientRect();
      if (
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
      )
        issues.push('group name overlaps total');
    }
    return issues;
  });
  expect(problems).toEqual([]);
}

async function assertCellReadable(cell) {
  await cell.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      cell.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const rect = range.getBoundingClientRect();
        const container = element
          .closest('.table-scroll')
          .getBoundingClientRect();
        if (rect.left < container.left || rect.right > container.right)
          return false;
        return [rect.left + 1, rect.right - 1].every((x) =>
          element.contains(
            document.elementFromPoint(x, rect.top + rect.height / 2),
          ),
        );
      }),
    )
    .toBe(true);
}

for (const width of [320, 360, 390, 430, 844, 932]) {
  for (const currency of ['EUR', 'USD', 'RSD', 'RUB', 'TRY']) {
    test(`mobile ${width}px: 10 million ${currency} stays readable on every financial screen`, async ({
      page,
      app,
    }, testInfo) => {
      await page.setViewportSize({ width, height: width > 720 ? 430 : 844 });
      await open(page, app);
      await nav(page, 'Accounts');
      await createGroup(page, 'Long-term savings and investment accounts');
      await page
        .locator('#accountGroup')
        .selectOption({ label: 'Long-term savings and investment accounts' });
      await createAccount(
        page,
        'Primary savings account with a long readable name',
        currency,
      );
      await nav(page, 'Monthly balances');
      const rates = currency === 'EUR' ? {} : { [currency]: '1' };
      await saveBalances(page, '2025-01', { 1: '1' }, rates);
      await saveBalances(page, '2025-02', { 1: '10000000' }, rates);
      await expect(page.locator('[data-balance="1"]')).toHaveValue(
        '10000000.00',
      );
      await assertLayout(page);
      await page.screenshot({
        path: testInfo.outputPath('monthly-10-million.png'),
        fullPage: true,
        animations: 'disabled',
      });
      await nav(page, 'Accounts');
      await expect(
        accountGroup(page, 'Long-term savings and investment accounts').locator(
          '.group-total strong',
        ),
      ).toHaveText('€10,000,000.00');
      await expect(page.locator('.account-balance .money-text')).toBeVisible();
      await expect(page.locator('.account-balance strong')).toContainText(
        '10,000,000.00',
      );
      await assertLayout(page);
      await page.screenshot({
        path: testInfo.outputPath('accounts-10-million.png'),
        fullPage: true,
        animations: 'disabled',
      });
      await action(
        page,
        'Primary savings account with a long readable name',
        'history',
      );
      await expect(page.locator('tbody')).toContainText('10,000,000.00');
      await assertCellReadable(
        page.locator('tbody tr').last().locator('td').last(),
      );
      await assertLayout(page);
      await nav(page, 'Dashboard');
      await expect(page.locator('.metric').first()).toContainText(
        '€10,000,000.00',
      );
      await expect(page.locator('.metric').nth(1)).toContainText(
        '+€9,999,999.00',
      );
      await assertLayout(page);
      await expect(page.locator('.history-svg')).toBeVisible();
      await expect(page.locator('#pageContent table')).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath('dashboard-10-million.png'),
        fullPage: true,
        animations: 'disabled',
      });
    });
  }
}
for (const currency of ['EUR', 'USD', 'RSD', 'RUB', 'TRY']) {
  for (const value of ['-10000000.99', '10000000.99']) {
    test(`mobile 320px: ${value} ${currency} with cents and previous-month difference`, async ({
      page,
      app,
    }, testInfo) => {
      await page.setViewportSize({ width: 320, height: 740 });
      await open(page, app);
      await nav(page, 'Accounts');
      await createAccount(page, 'Account', currency);
      await nav(page, 'Monthly balances');
      const rates = currency === 'EUR' ? {} : { [currency]: '1' };
      await saveBalances(page, '2025-01', { 1: value }, rates);
      await saveBalances(page, '2025-02', { 1: '0' }, rates);
      await expect(page.locator('.balance-previous strong')).toContainText(
        '10,000,000.99',
      );
      await expect(page.locator('.balance-change')).toContainText(
        '10,000,000.99',
      );
      await assertLayout(page);
      await page.locator('[data-action="copyPrevious"]').click();
      await expect(page.locator('[data-balance="1"]')).toHaveValue(value);
      await assertLayout(page);
      await page.screenshot({
        path: testInfo.outputPath('mobile-large-balance.png'),
        fullPage: true,
        animations: 'disabled',
      });
    });
  }
}
