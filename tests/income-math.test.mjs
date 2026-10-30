import test from 'node:test';
import assert from 'node:assert/strict';
import { incomeTotal } from '../web/js/income-math.js';
test('income equivalents and monthly total use exact rates and round once', () => {
  assert.equal(
    incomeTotal([{ amount_minor: '10000000', rate: '117.2' }]),
    '85324',
  );
  assert.equal(
    incomeTotal([
      { amount_minor: '10000000', rate: '117.2' },
      { amount_minor: '10000', rate: '1' },
    ]),
    '95324',
  );
  assert.equal(
    incomeTotal([
      { amount_minor: '1', rate: '2' },
      { amount_minor: '1', rate: '2' },
    ]),
    '1',
  );
  assert.equal(
    incomeTotal([{ amount_minor: '9000000000000000', rate: '0.00000001' }]),
    '900000000000000000000000',
  );
  assert.equal(incomeTotal([]), '0');
  assert.equal(incomeTotal([{ amount_minor: '0', rate: '117.2' }]), '0');
});
