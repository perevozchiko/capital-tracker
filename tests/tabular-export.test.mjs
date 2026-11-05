import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCSV, buildExcel } from '../web/js/tabular-export.js';

const snapshot = {
  accounts: [
    { id: 1, name: '=Evil account', currency: 'RSD', group_id: 7 },
    { id: 2, name: 'Cash & more', currency: 'EUR', group_id: null },
  ],
  groups: [{ id: 7, name: 'Savings <local>' }],
  rates: [
    { month: '2026-01', currency: 'RSD', rate_scaled: '11720000000' },
    { month: '2026-02', currency: 'RSD', rate_scaled: '11850000000' },
  ],
  balances: [
    { account_id: 1, month: '2026-01', amount_minor: '12345' },
    { account_id: 2, month: '2026-01', amount_minor: '-125' },
    { account_id: 1, month: '2026-02', amount_minor: '23700' },
    { account_id: 1, month: '2026-03', amount_minor: '10000' },
  ],
};

function zipEntries(bytes) {
  const data = Buffer.from(bytes);
  const entries = new Map();
  let offset = 0;
  while (offset < data.length && data.readUInt32LE(offset) === 0x04034b50) {
    const size = data.readUInt32LE(offset + 18);
    const length = data.readUInt16LE(offset + 26);
    const extra = data.readUInt16LE(offset + 28);
    const filename = data
      .subarray(offset + 30, offset + 30 + length)
      .toString('utf8');
    const start = offset + 30 + length + extra;
    entries.set(filename, data.subarray(start, start + size).toString('utf8'));
    offset = start + size;
  }
  assert.equal(
    data.readUInt32LE(offset),
    0x02014b50,
    'ZIP has a central directory',
  );
  return entries;
}

test('CSV exports exact balances and historical rates without executing names', () => {
  const text = buildCSV(snapshot);
  assert.ok(text.startsWith('\uFEFFmonth,account_id,'));
  assert.match(
    text,
    /"2026-01",1,"'=Evil account","Savings <local>","RSD",123\.45,117\.20000000,1\.05/,
  );
  assert.match(
    text,
    /"2026-01",2,"Cash & more","","EUR",-1\.25,1\.00000000,-1\.25/,
  );
  assert.match(
    text,
    /"2026-02",1,"'=Evil account","Savings <local>","RSD",237\.00,118\.50000000,2\.00/,
  );
  assert.match(
    text,
    /"2026-03",1,"'=Evil account","Savings <local>","RSD",100\.00,,/,
  );
});

test('Excel workbook has separate Rates sheet and linked formulas', async () => {
  const blob = buildExcel(snapshot);
  assert.equal(
    blob.type,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  const parts = zipEntries(await blob.arrayBuffer());
  assert.equal(parts.size, 7);
  assert.match(parts.get('xl/workbook.xml'), /sheet name="Balances"/);
  assert.match(parts.get('xl/workbook.xml'), /sheet name="Rates"/);
  assert.match(parts.get('xl/workbook.xml'), /fullCalcOnLoad="1"/);
  const balances = parts.get('xl/worksheets/sheet1.xml');
  const rates = parts.get('xl/worksheets/sheet2.xml');
  assert.match(balances, /COUNTIFS\(Rates!\$A\$2:\$A\$3/);
  assert.match(balances, /SUMIFS\(Rates!\$C\$2:\$C\$3/);
  assert.match(balances, /E2\/F2/);
  assert.match(balances, /E5\/F5/);
  assert.match(balances, /&apos;|&amp;|&lt;/);
  assert.match(rates, /117\.20000000/);
  assert.match(rates, /118\.50000000/);
  assert.doesNotMatch(rates, /2026-03/);
});

test('Empty export still produces a valid two-sheet workbook', async () => {
  const empty = { accounts: [], groups: [], rates: [], balances: [] };
  const parts = zipEntries(await buildExcel(empty).arrayBuffer());
  assert.match(parts.get('xl/worksheets/sheet1.xml'), /Month/);
  assert.match(parts.get('xl/worksheets/sheet2.xml'), /Currency per 1 EUR/);
});
