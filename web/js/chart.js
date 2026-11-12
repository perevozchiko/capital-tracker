import { t } from './messages.js';
import { escapeHTML, monthLabel, nextMonth, money } from './format.js';

// Presentation preferences stay in this tab; chart controls never save data.
const selections = new Map();
const histories = new Map();
const presets = [
  ['6', 'chartSixMonths'],
  ['12', 'chartYear'],
  ['36', 'chartThreeYears'],
  ['all', 'chartAll'],
  ['custom', 'chartCustom'],
];

function monthIndex(month) {
  const [year, value] = month.split('-').map(Number);
  return year * 12 + value - 1;
}

function axisStep(value) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return (
    [1, 2, 2.5, 5, 10].find((step) => step * magnitude >= value) * magnitude
  );
}

function rangeFor(history, selection) {
  const end =
    history.at(-1)?.month || new Date().toLocaleDateString('sv-SE').slice(0, 7);
  if (selection.period === 'custom')
    return { from: selection.from, to: selection.to };
  return {
    from:
      selection.period === 'all'
        ? history[0]?.month || end
        : nextMonth(end, 1 - Number(selection.period)) < '1900-01'
          ? '1900-01'
          : nextMonth(end, 1 - Number(selection.period)),
    to: end,
  };
}

function chartSVG(history, source, range) {
  let previous = null;
  const visible = history
    .map((point, index) => {
      const complete = point.complete && point.total_eur_minor != null;
      const decreased =
        complete &&
        previous != null &&
        BigInt(point.total_eur_minor) < BigInt(previous.total_eur_minor);
      if (complete) previous = point;
      return { ...point, index, decreased };
    })
    .filter((point) => point.month >= range.from && point.month <= range.to);
  const valid = visible.filter((p) => p.complete && p.total_eur_minor != null);
  if (!valid.length)
    return `<div class="empty chart-empty" role="status">${t('chartRangeEmpty')}</div>`;

  const narrow = window.matchMedia('(max-width: 540px)').matches;
  const W = narrow ? 420 : 860,
    H = 300,
    pad = { left: 88, right: 30, top: 24, bottom: 42 },
    innerW = W - pad.left - pad.right,
    innerH = H - pad.top - pad.bottom;
  const first = monthIndex(range.from),
    span = monthIndex(range.to) - first;
  const values = valid.map((p) => Number(p.total_eur_minor) / 100);
  let min = Math.min(...values),
    max = Math.max(...values);
  const spread = Math.max(
    1,
    max - min,
    Math.max(Math.abs(min), Math.abs(max)) * 0.01,
  );
  min -= spread * 0.16;
  max += spread * 0.16;
  let step = axisStep((max - min) / 4);
  while (Math.floor(min / step) * step + step * 4 < max)
    step = axisStep(step * 1.01);
  min = Math.floor(min / step) * step;
  max = min + step * 4;
  const xFor = (month) =>
    pad.left + (span ? (monthIndex(month) - first) / span : 0.5) * innerW;
  const yFor = (value) => pad.top + ((max - value) / (max - min)) * innerH;
  const baseline = H - pad.bottom;
  const formatter = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 3,
  });
  const grid = Array.from({ length: 5 }, (_, i) => {
    const value = max - ((max - min) * i) / 4;
    const y = yFor(value);
    return `<line class="gridline" x1="${pad.left}" x2="${W - pad.right}" y1="${y}" y2="${y}"/><text class="money-axis" x="${pad.left - 14}" y="${y + 4}" text-anchor="end">${formatter.format(value)} €</text>`;
  }).join('');

  // Connect recorded values across missing or incomplete calendar months.
  const line = valid
    .map(
      (p, i) =>
        `${i ? 'L' : 'M'}${xFor(p.month)},${yFor(Number(p.total_eur_minor) / 100)}`,
    )
    .join(' ');
  const gradientID = `chart-fill-${source}`;
  const paths =
    valid.length > 1
      ? `<path class="chart-area" fill="url(#${gradientID})" d="${line} L${xFor(valid.at(-1).month)},${baseline} L${xFor(valid[0].month)},${baseline} Z"/><path class="curve" d="${line}"/>`
      : '';
  // Evenly spaced calendar labels remain legible for long and sparse histories.
  const labelCount = Math.min(narrow ? 3 : 6, span + 1);
  const labels = Array.from({ length: labelCount }, (_, i) => {
    const offset =
      labelCount === 1 ? 0 : Math.round((span * i) / (labelCount - 1));
    const month = nextMonth(range.from, offset);
    return `<text class="chart-month-label" x="${xFor(month)}" y="${H - 12}" text-anchor="${labelCount === 1 ? 'middle' : i === 0 ? 'start' : i === labelCount - 1 ? 'end' : 'middle'}">${escapeHTML(monthLabel(month, true))}</text>`;
  }).join('');
  const dots = valid
    .map(
      (p) =>
        `<circle class="chart-dot${p.decreased ? ' chart-dot-decreased' : ''}" cx="${xFor(p.month)}" cy="${yFor(Number(p.total_eur_minor) / 100)}" r="${p.decreased ? 5.5 : 4.5}" tabindex="0" role="img" aria-label="${escapeHTML(monthLabel(p.month))}${document.documentElement.dataset.hideAmounts === 'true' ? '' : ': ' + escapeHTML(money(p.total_eur_minor))}${p.decreased ? ' · ' + t('chartDecrease') : ''}" data-chart-source="${source}" data-chart-index="${p.index}" data-chart-decreased="${p.decreased}"/>`,
    )
    .join('');
  const title = t(
    source === 'recurringExpense'
      ? 'recurringExpenseHistory'
      : source === 'expense'
        ? 'expenseHistory'
        : source === 'income'
          ? 'incomeHistory'
          : 'history',
  );
  return `<div class="chart-wrap"><svg class="history-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}"><defs><linearGradient id="${gradientID}" x1="0" y1="0" x2="0" y2="1"><stop class="chart-gradient-top" offset="0%"/><stop class="chart-gradient-bottom" offset="100%"/></linearGradient></defs>${grid}${paths}${dots}${labels}</svg></div>${valid.some((p) => p.decreased) ? `<p class="chart-decrease-legend"><span aria-hidden="true"></span>${t('chartDecrease')}</p>` : ''}<p class="footer-note">${t('chartNote')}</p>`;
}

function chart(history, source = 'capital') {
  histories.set(source, history);
  // Rendering every historical SVG point is needlessly expensive on a phone.
  // The full history remains available through the explicit “All” control.
  const selection = selections.get(source) || {
    period: window.matchMedia('(max-width: 540px)').matches ? '36' : 'all',
  };
  const range = rangeFor(history, selection);
  const from = selection.from || range.from;
  const to = selection.to || range.to;
  const controls = presets
    .map(
      ([period, label]) =>
        `<button class="chart-period" type="button" data-chart-period="${period}" aria-pressed="${selection.period === period}">${t(label)}</button>`,
    )
    .join('');
  return `<div class="history-chart" data-history-chart="${source}"><div class="chart-toolbar"><div class="chart-periods" role="group" aria-label="${t('chartPeriod')}">${controls}</div><span class="chart-range subtle">${escapeHTML(monthLabel(range.from, true))} – ${escapeHTML(monthLabel(range.to, true))}</span></div><form class="chart-custom-range" ${selection.period === 'custom' ? '' : 'hidden'}><div class="field"><label for="chart-${source}-from">${t('chartFrom')}</label><input id="chart-${source}-from" name="from" type="month" min="1900-01" max="2200-12" value="${from}" required></div><div class="field"><label for="chart-${source}-to">${t('chartTo')}</label><input id="chart-${source}-to" name="to" type="month" min="1900-01" max="2200-12" value="${to}" required></div><button type="submit" class="btn btn-small">${t('chartApply')}</button></form>${chartSVG(history, source, range)}</div>`;
}

function redraw(container, selection, focusPeriod) {
  const source = container.dataset.historyChart;
  selections.set(source, selection);
  document.querySelector('#chartTooltip').hidden = true;
  container.outerHTML = chart(histories.get(source), source);
  if (focusPeriod)
    document
      .querySelector(
        `[data-history-chart="${source}"] [data-chart-period="${focusPeriod}"]`,
      )
      ?.focus({ preventScroll: true });
}

function bindChartControls() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-chart-period]');
    if (!button) return;
    const container = button.closest('[data-history-chart]');
    const source = container.dataset.historyChart;
    const old = selections.get(source) || { period: 'all' };
    const range = rangeFor(histories.get(source), old);
    redraw(
      container,
      button.dataset.chartPeriod === 'custom'
        ? {
            ...old,
            period: 'custom',
            from: old.from || range.from,
            to: old.to || range.to,
          }
        : { ...old, period: button.dataset.chartPeriod },
      button.dataset.chartPeriod,
    );
  });
  document.addEventListener('input', (event) => {
    if (event.target.closest('.chart-custom-range'))
      event.target.form.elements.to.setCustomValidity('');
  });
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!form.matches('.chart-custom-range')) return;
    event.preventDefault();
    const from = form.elements.from.value,
      to = form.elements.to.value;
    form.elements.to.setCustomValidity(from > to ? t('chartInvalidRange') : '');
    if (!form.reportValidity()) return;
    redraw(
      form.closest('[data-history-chart]'),
      { period: 'custom', from, to },
      'custom',
    );
  });
}

export { chart, bindChartControls };
