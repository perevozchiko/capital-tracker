// Exact, locale-tolerant input parser. No floating-point conversion.
export function parseRateDecimal(raw) {
  let value = raw.trim().replace(/\u00a0|\u202f/g, ' ');
  if (!value) return null;
  // Grouping is accepted with spaces only. Both ',' and '.' are decimal
  // separators even for three decimal digits (1,085 = 1.085).
  if (value.includes(' ')) {
    if (!/^\d{1,3}(?: \d{3})+(?:[.,]\d{1,8})?$/.test(value)) {
      throw new Error('invalid rate');
    }
    value = value.replaceAll(' ', '');
  }
  if (!/^\d+(?:[.,]\d{1,8})?$/.test(value)) {
    throw new Error('invalid rate');
  }
  const result = value.replace(',', '.');
  const [whole, fraction = ''] = result.split('.');
  const fixed = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0') || '0');
  if (fixed <= 0n || fixed > 10000000000000000n) {
    throw new Error('rate outside supported range');
  }
  return result;
}
