import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRateDecimal, differenceMinor } from '../web/js/numbers.js';

test('comma and dot are always decimal separators', () => {
  for (const [value, expected] of [
    ['1,085', '1.085'],
    ['1.085', '1.085'],
    ['0,925', '0.925'],
    ['117,200', '117.200'],
    ['117.200', '117.200'],
    ['1 234,56789', '1234.56789'],
    ['117,20', '117.20'],
  ]) {
    assert.equal(parseRateDecimal(value), expected, value);
  }
  assert.equal(parseRateDecimal(''), null);
});

test('invalid FX input is rejected without float arithmetic', () => {
  for (const input of [
    '0',
    '-1',
    '1,123456789',
    '1.2.3',
    '1,2,3',
    '1,000 000',
    '1 23',
    '1e3',
    'NaN',
    '100000001',
  ]) {
    assert.throws(() => parseRateDecimal(input), undefined, input);
  }
});

test('balance difference requires both months and uses exact minor units', () => {
  assert.equal(differenceMinor('12345', '12000'), '345');
  assert.equal(differenceMinor('0', '100'), '-100');
  assert.equal(differenceMinor('0', '0'), '0');
  assert.equal(
    differenceMinor('9000000000000000', '-9000000000000000'),
    '18000000000000000',
  );
  assert.equal(differenceMinor(null, '500'), null);
  assert.equal(differenceMinor('500', null), null);
});

test('rate parser handles exact boundaries and Unicode grouping', () => {
  for (const [input, expected] of [
    ['0.00000001', '0.00000001'],
    ['100000000', '100000000'],
    ['  1\u00a0234\u202f567,12345678  ', '1234567.12345678'],
    ['0001.00000001', '0001.00000001'],
    ['   ', null],
  ])
    assert.equal(parseRateDecimal(input), expected, input);
  for (const input of [
    '0.00000000',
    '100000000.00000001',
    '.1',
    '1.',
    '+1',
    '1  000',
    '1234 567',
    '1\t000',
  ]) {
    assert.throws(() => parseRateDecimal(input), undefined, input);
  }
});

test('balance differences retain sign and exactness at large values', () => {
  for (const [a, b, expected] of [
    ['-100', '-300', '200'],
    ['-300', '-100', '-200'],
    ['9007199254740993', '9007199254740992', '1'],
    ['-9007199254740993', '9007199254740992', '-18014398509481985'],
  ])
    assert.equal(differenceMinor(a, b), expected);
  assert.equal(differenceMinor(undefined, '0'), null);
});
