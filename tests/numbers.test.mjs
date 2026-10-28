import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRateDecimal } from '../web/js/numbers.js';

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
