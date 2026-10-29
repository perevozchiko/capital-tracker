import { parseRateDecimal } from './numbers.js';
import { t } from './messages.js';
const escapeHTML = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const monthDate = (m) => new Date(`${m}-01T12:00:00`);
function monthLabel(month, short = false) {
  if (!month || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) return month;
  return new Intl.DateTimeFormat('en-US', {
    month: short ? 'short' : 'long',
    year: 'numeric',
  }).format(monthDate(month));
}
function nextMonth(m, shift) {
  const [y, mm] = m.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mm - 1 + shift, 1));
  return dt.toISOString().slice(0, 7);
}
function validMonth(m) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(m) && m >= '1900-01' && m <= '2200-12';
}
// Format all values using BigInt. Number is never used for financial display.
function money(minor, currency = 'EUR') {
  if (minor == null) return '—';
  const v = BigInt(minor),
    neg = v < 0n,
    abs = neg ? -v : v;
  const whole = new Intl.NumberFormat('en-US', {
    useGrouping: true,
    maximumFractionDigits: 0,
  }).format(abs / 100n);
  const frac = String(abs % 100n).padStart(2, '0');
  const parts = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'symbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(neg ? -0.01 : 0.01);
  return parts
    .map((p) =>
      p.type === 'integer'
        ? whole
        : p.type === 'fraction'
          ? frac
          : p.type === 'group'
            ? ''
            : p.value,
    )
    .join('');
}
function rateText(v) {
  return String(v ?? '');
}
function minorToInput(v) {
  if (v == null) return '';
  const n = BigInt(v),
    a = n < 0n ? -n : n;
  return (
    (n < 0n ? '-' : '') + a / 100n + '.' + String(a % 100n).padStart(2, '0')
  );
}
function parseMoney(input) {
  const raw = input.trim().replace(/\u00a0|\u202f/g, ' ');
  if (!raw) return null;
  let text = raw;
  if (text.includes(' ')) {
    if (!/^-?\d{1,3}(?: \d{3})+(?:[.,]\d{1,2})?$/.test(text))
      throw new Error(t('invalidAmount'));
    text = text.replaceAll(' ', '');
  }
  if (!/^-?\d+(?:[.,]\d{1,2})?$/.test(text))
    throw new Error(t('invalidAmount'));
  let sign = 1n;
  if (text.startsWith('-')) {
    sign = -1n;
    text = text.slice(1);
  }
  const [whole, frac = ''] = text.replace(',', '.').split('.');
  const out =
    sign * (BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0') || '0'));
  if (out > 9000000000000000n || out < -9000000000000000n)
    throw new Error(t('invalidAmount'));
  return String(out);
}
function parseRate(raw) {
  try {
    return parseRateDecimal(raw);
  } catch {
    throw new Error(t('invalidRate'));
  }
}
function percentBP(bp) {
  if (bp == null) return '—';
  const x = BigInt(bp),
    n = x < 0n ? -x : x;
  return (
    (x < 0n ? '-' : '') +
    n / 100n +
    '.' +
    String(n % 100n).padStart(2, '0') +
    '%'
  );
}
function pluralAccounts(count) {
  return `${count} ${count === 1 ? 'account' : 'accounts'}`;
}

export {
  escapeHTML,
  monthLabel,
  nextMonth,
  validMonth,
  money,
  rateText,
  minorToInput,
  parseMoney,
  parseRate,
  percentBP,
  pluralAccounts,
};
