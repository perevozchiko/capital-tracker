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
  for (const input of ['0', '-1', '1,123456789', '1.2.3', '1,2,3',
                       '1,000 000', '1 23', '1e3', 'NaN', '100000001']) {
    assert.throws(() => parseRateDecimal(input), undefined, input);
  }
});

test('balance difference requires both months and uses exact minor units', () => {
  assert.equal(differenceMinor('12345', '12000'), '345');
  assert.equal(differenceMinor('0', '100'), '-100');
  assert.equal(differenceMinor('0', '0'), '0');
  assert.equal(differenceMinor('9000000000000000', '-9000000000000000'), '18000000000000000');
  assert.equal(differenceMinor(null, '500'), null);
  assert.equal(differenceMinor('500', null), null);
});
