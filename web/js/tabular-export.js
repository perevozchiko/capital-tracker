// Read-only spreadsheet exports built from the application's JSON snapshot.
// CSV is a flat table; XLSX additionally supports live cross-sheet formulas.
// No third-party libraries, external services, or browser permissions required.

const utf8 = new TextEncoder();
const RATE_SCALE = 100000000n;

function decimal(value, places) {
  const n = BigInt(value);
  const factor = 10n ** BigInt(places);
  const abs = n < 0n ? -n : n;
  const whole = abs / factor;
  const fraction = (abs % factor).toString().padStart(places, '0');
  return (n < 0n ? '-' : '') + whole + (places ? '.' + fraction : '');
}

function eurMinor(amountMinor, rateScaled) {
  const numerator = BigInt(amountMinor) * RATE_SCALE;
  const denominator = BigInt(rateScaled);
  if (denominator <= 0n) return null;
  const abs = numerator < 0n ? -numerator : numerator;
  const rounded = (abs * 2n + denominator) / (2n * denominator);
  return (numerator < 0n ? -rounded : rounded).toString();
}

function rowsFromSnapshot(snapshot) {
  const accounts = new Map(snapshot.accounts.map((a) => [a.id, a]));
  const groups = new Map(snapshot.groups.map((g) => [g.id, g.name]));
  const rates = new Map(
    snapshot.rates.map((r) => [r.month + '|' + r.currency, r.rate_scaled]),
  );
  const balances = snapshot.balances.map((balance) => {
    const account = accounts.get(balance.account_id);
    if (!account) throw new Error('Export contains an unknown account');
    const rate =
      account.currency === 'EUR'
        ? RATE_SCALE.toString()
        : rates.get(balance.month + '|' + account.currency);
    const converted = rate ? eurMinor(balance.amount_minor, rate) : null;
    return {
      month: balance.month,
      accountID: account.id,
      account: account.name,
      group: account.group_id == null ? '' : groups.get(account.group_id) || '',
      currency: account.currency,
      amount: decimal(balance.amount_minor, 2),
      rate: rate ? decimal(rate, 8) : '',
      eur: converted == null ? '' : decimal(converted, 2),
    };
  });
  const rateRows = snapshot.rates.map((rate) => ({
    month: rate.month,
    currency: rate.currency,
    rate: decimal(rate.rate_scaled, 8),
  }));
  return { balances, rateRows };
}

function csvText(value) {
  let text = String(value ?? '');
  // Spreadsheet viewers can execute untrusted text beginning with a formula
  // trigger. Prefix such account/group names with an apostrophe.
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function csvNumber(value) {
  return value === '' || value == null ? '' : String(value);
}

export function buildCSV(snapshot) {
  const { balances } = rowsFromSnapshot(snapshot);
  const lines = [
    'month,account_id,account,group,currency,balance,rate_per_eur,eur_equivalent',
  ];
  for (const row of balances) {
    lines.push(
      [
        csvText(row.month),
        csvNumber(row.accountID),
        csvText(row.account),
        csvText(row.group),
        csvText(row.currency),
        csvNumber(row.amount),
        csvNumber(row.rate),
        csvNumber(row.eur),
      ].join(','),
    );
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

function xml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(column) {
  let out = '';
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  }
  return out;
}

function cell(reference, entry) {
  if (entry == null) return '';
  const style = entry.style == null ? '' : ' s="' + entry.style + '"';
  if (entry.formula != null) {
    const cached = entry.cached == null ? '' : String(entry.cached);
    return (
      '<c r="' +
      reference +
      '"' +
      style +
      '><f>' +
      xml(entry.formula) +
      '</f><v>' +
      xml(cached) +
      '</v></c>'
    );
  }
  if (entry.number != null) {
    return (
      '<c r="' +
      reference +
      '"' +
      style +
      '><v>' +
      xml(entry.number) +
      '</v></c>'
    );
  }
  return (
    '<c r="' +
    reference +
    '"' +
    style +
    ' t="inlineStr"><is><t xml:space="preserve">' +
    xml(entry.text ?? '') +
    '</t></is></c>'
  );
}

function worksheet(headers, rows, widths) {
  if (rows.length >= 1048576) throw new Error('Excel row limit exceeded');
  let result =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<cols>' +
    widths
      .map(
        (w, index) =>
          '<col min="' +
          (index + 1) +
          '" max="' +
          (index + 1) +
          '" width="' +
          w +
          '" customWidth="1"/>',
      )
      .join('') +
    '</cols>' +
    '<sheetData><row r="1">' +
    headers
      .map((heading, index) =>
        cell(columnName(index + 1) + '1', { text: heading, style: 1 }),
      )
      .join('') +
    '</row>';
  rows.forEach((entries, index) => {
    const number = index + 2;
    result +=
      '<row r="' +
      number +
      '">' +
      entries
        .map((entry, column) => cell(columnName(column + 1) + number, entry))
        .join('') +
      '</row>';
  });
  const lastRow = rows.length + 1;
  result +=
    '</sheetData><autoFilter ref="A1:' +
    columnName(headers.length) +
    lastRow +
    '"/></worksheet>';
  return result;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// XLSX is a ZIP of XML files. STORE mode avoids a dependency on JSZip.
function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [filename, contents] of Object.entries(files)) {
    const name = utf8.encode(filename);
    const payload = utf8.encode(contents);
    if (payload.length > 0xffffffff || offset > 0xffffffff) {
      throw new Error('Spreadsheet exceeds ZIP size limit');
    }
    const checksum = crc32(payload);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, payload.length, true);
    localView.setUint32(22, payload.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, payload);

    const directory = new Uint8Array(46 + name.length);
    const view = new DataView(directory.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint32(16, checksum, true);
    view.setUint32(20, payload.length, true);
    view.setUint32(24, payload.length, true);
    view.setUint16(28, name.length, true);
    view.setUint32(42, offset, true);
    directory.set(name, 46);
    central.push(directory);
    offset += local.length + payload.length;
  }
  const directorySize = central.reduce((sum, part) => sum + part.length, 0);
  if (offset + directorySize > 0xffffffff || central.length > 65535) {
    throw new Error('Spreadsheet exceeds ZIP limit');
  }
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, central.length, true);
  view.setUint16(10, central.length, true);
  view.setUint32(12, directorySize, true);
  view.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function buildExcel(snapshot) {
  const { balances, rateRows } = rowsFromSnapshot(snapshot);
  const rateEnd = Math.max(2, rateRows.length + 1);
  const range = (column) =>
    'Rates!$' + column + '$2:$' + column + '$' + rateEnd;
  const entries = balances.map((entry, index) => {
    const row = index + 2;
    const f =
      'IF(D' +
      row +
      '="EUR",1,IF(COUNTIFS(' +
      range('A') +
      ',A' +
      row +
      ',' +
      range('B') +
      ',D' +
      row +
      ')=0,"",SUMIFS(' +
      range('C') +
      ',' +
      range('A') +
      ',A' +
      row +
      ',' +
      range('B') +
      ',D' +
      row +
      ')))';
    const eurFormula = 'IF(F' + row + '="","",E' + row + '/F' + row + ')';
    return [
      { text: entry.month },
      { text: entry.account },
      { text: entry.group },
      { text: entry.currency },
      { number: entry.amount, style: 2 },
      { formula: f, cached: entry.rate || null, style: 3 },
      {
        formula: eurFormula,
        cached: entry.rate ? Number(entry.amount) / Number(entry.rate) : null,
        style: 2,
      },
    ];
  });
  const rateEntries = rateRows.map((entry) => [
    { text: entry.month },
    { text: entry.currency },
    { number: entry.rate, style: 3 },
  ]);
  const sheets = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Balances" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Rates" sheetId="2" r:id="rId2"/></sheets>' +
      '<calcPr calcId="0" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
    'xl/styles.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/>' +
      '<numFmt numFmtId="165" formatCode="0.00000000"/></numFmts>' +
      '<fonts count="2"><font><sz val="11"/><name val="Aptos"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF263647"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="1" borderId="0" applyFill="1" applyFont="1"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml': worksheet(
      [
        'Month',
        'Account',
        'Group',
        'Currency',
        'Balance',
        'Rate per EUR',
        'EUR equivalent',
      ],
      entries,
      [14, 30, 24, 13, 20, 20, 22],
    ),
    'xl/worksheets/sheet2.xml': worksheet(
      ['Month', 'Currency', 'Currency per 1 EUR'],
      rateEntries,
      [16, 16, 25],
    ),
  };
  return zip(sheets);
}
