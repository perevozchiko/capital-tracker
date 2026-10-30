import test from 'node:test';
import assert from 'node:assert/strict';
import {
  money,
  moneyHTML,
  parseMoney,
  percentBP,
  minorToInput,
} from '../web/js/format.js';

test('English money display preserves cents beyond JavaScript safe integers', () => {
  assert.equal(money('9007199254740993'), '€90,071,992,547,409.93');
  assert.equal(money('-1'), '-€0.01');
  assert.equal(money('0'), '€0.00');
  assert.equal(money(null), '—');
  assert.equal(percentBP('-123'), '-1.23%');
});

test('balance input preserves unknown, zero, decimal commas and exact boundaries', () => {
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('0'), '0');
  assert.equal(parseMoney('-1 234,56'), '-123456');
  assert.equal(parseMoney('90 000 000 000 000.00'), '9000000000000000');
  for (const value of [
    '90000000000000.01',
    '-90000000000000.01',
    '1.001',
    '1,000.00',
    '1e3',
  ]) {
    assert.throws(() => parseMoney(value));
  }
  assert.equal(minorToInput('-9000000000000000'), '-90000000000000.00');
});

test('privacy markup preserves exact amounts, signs and unknown balances', () => {
  const wrap = (text) =>
    `<span class="money-value"><span class="money-text">${text}</span></span>`;
  assert.equal(moneyHTML('9007199254740993'), wrap('€90,071,992,547,409.93'));
  assert.equal(moneyHTML('-1', 'USD'), wrap('-$0.01'));
  assert.equal(moneyHTML('0'), wrap('€0.00'));
  assert.equal(moneyHTML('1200', 'EUR', '+'), wrap('+€12.00'));
  assert.equal(moneyHTML(null), '—');
});

test('privacy markup escapes text before inserting it into the page', () => {
  assert.equal(
    moneyHTML('100', 'EUR', '<img src=x onerror=alert(1)>'),
    '<span class="money-value"><span class="money-text">&lt;img src=x onerror=alert(1)&gt;€1.00</span></span>',
  );
});
