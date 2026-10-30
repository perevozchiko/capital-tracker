// Sum exact converted amounts before rounding once to EUR cents.
export function incomeTotal(entries) {
  let numerator = 0n,
    denominator = 1n;
  const gcd = (a, b) => {
    while (b) [a, b] = [b, a % b];
    return a;
  };
  for (const entry of entries) {
    const [whole, fraction = ''] = entry.rate.split('.');
    const rate = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'));
    if (rate <= 0n) throw new Error('Invalid exchange rate');
    const amount = BigInt(entry.amount_minor) * 100000000n;
    numerator = numerator * rate + amount * denominator;
    denominator *= rate;
    const factor = gcd(numerator, denominator);
    numerator /= factor;
    denominator /= factor;
  }
  return ((numerator * 2n + denominator) / (denominator * 2n)).toString();
}
