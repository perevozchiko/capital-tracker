import { captureView, state } from './state.js';
import { api } from './api.js';
import { t } from './messages.js';
import { escapeHTML, monthLabel, nextMonth } from './format.js';
import { $ } from './ui.js';

let savedRates = [];
let period = 'all';
const rateLabel = (quote) => `1 EUR = ${quote.rate} ${quote.currency}`;

function rateChart(quotes, currency) {
  const end = quotes.at(-1).month;
  const from =
    period === 'all' ? quotes[0].month : nextMonth(end, 1 - Number(period));
  const visible = quotes.filter((quote) => quote.month >= from);
  const index = (month) =>
    Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1;
  const first = index(from),
    span = index(end) - first;
  const W = Math.max(360, $('#pageContent').clientWidth - 52),
    H = 300,
    left = 70,
    right = 25,
    top = 20,
    bottom = 40;
  const values = visible.map((quote) => Number(quote.rate));
  const low = Math.min(...values),
    high = Math.max(...values);
  const margin = Math.max(high - low, high * 0.02) * 0.2;
  const min = Math.max(0, low - margin),
    max = high + margin;
  const x = (month) =>
    left + (span ? (index(month) - first) / span : 0.5) * (W - left - right);
  const y = (rate) =>
    top + ((max - Number(rate)) / (max - min)) * (H - top - bottom);
  const formatter = new Intl.NumberFormat('en-US', {
    maximumSignificantDigits: 5,
  });
  const grid = Array.from({ length: 5 }, (_, i) => {
    const value = min + ((max - min) * i) / 4;
    return `<line class="gridline" x1="${left}" x2="${W - right}" y1="${y(value)}" y2="${y(value)}"/><text x="${left - 10}" y="${y(value) + 4}" text-anchor="end">${formatter.format(value)}</text>`;
  }).join('');
  const line = visible
    .map((quote, i) => `${i ? 'L' : 'M'}${x(quote.month)},${y(quote.rate)}`)
    .join(' ');
  const paths = `<g class="fx-series">${visible.length > 1 ? `<path d="${line}"/>` : ''}${visible
    .map((quote) => {
      const label = escapeHTML(
        `${monthLabel(quote.month)} · ${rateLabel(quote)}`,
      );
      return `<circle cx="${x(quote.month)}" cy="${y(quote.rate)}" r="5" tabindex="0" role="img" data-fx-quote="${label}" aria-label="${label}"><title>${label}</title></circle>`;
    })
    .join('')}</g>`;
  const labelCount = Math.min(W < 550 ? 3 : 6, span + 1);
  const labels = Array.from({ length: labelCount }, (_, i) => {
    const month = nextMonth(
      from,
      labelCount === 1 ? 0 : Math.round((span * i) / (labelCount - 1)),
    );
    return `<text x="${x(month)}" y="${H - 10}" text-anchor="${labelCount === 1 ? 'middle' : i === 0 ? 'start' : i === labelCount - 1 ? 'end' : 'middle'}">${escapeHTML(monthLabel(month, true))}</text>`;
  }).join('');
  const multiple =
    new Set(visible.map((quote) => quote.month)).size < visible.length;
  return `<svg class="fx-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="EUR / ${currency}">${grid}${paths}${labels}</svg>${multiple ? `<p class="subtle">${t('fxMultipleQuotes')}</p>` : ''}`;
}

function drawFXRates() {
  $('#chartTooltip').hidden = true;

  const currencies = [...new Set(savedRates.map((quote) => quote.currency))];
  $('#pageContent').innerHTML =
    `<section class="card panel fx-intro"><h2>${t('navFXRates')}</h2><p class="subtle">${t('fxHelp')}</p><p class="fx-base">${t('fxBase')}</p><div class="fx-controls"><div class="field"><label for="fxPeriod">${t('chartPeriod')}</label><select id="fxPeriod">${[
      ['all', 'chartAll'],
      ['12', 'chartYear'],
      ['6', 'chartSixMonths'],
    ]
      .map(
        ([key, label]) =>
          `<option value="${key}" ${period === key ? 'selected' : ''}>${t(label)}</option>`,
      )
      .join('')}</select></div></div></section><div class="fx-grid">${currencies
      .map((currency) => {
        const quotes = savedRates.filter(
          (quote) => quote.currency === currency,
        );
        const latest = quotes.at(-1);
        const selected = quotes.filter((quote) => quote.month === state.month);
        const latestQuotes = quotes.filter(
          (quote) => quote.month === latest.month,
        );
        return `<section class="card panel fx-card" data-fx-currency="${currency}"><div class="panel-heading"><h2>EUR / ${currency}</h2><span class="currency-tag">${currency}</span></div><div class="fx-latest"><span class="subtle">${t('fxLatest')} · ${escapeHTML(monthLabel(latest.month))}</span>${latestQuotes.map((quote) => `<span><strong>${escapeHTML(rateLabel(quote))}</strong></span>`).join('')}</div>${rateChart(quotes, currency)}<h3 class="fx-month-heading">${t('fxSavedQuotes').replace('{month}', escapeHTML(monthLabel(state.month)))}</h3><ul class="fx-quotes">${selected.length ? selected.map((quote) => `<li><strong>${escapeHTML(rateLabel(quote))}</strong></li>`).join('') : `<li class="subtle">${t('fxNoMonthQuotes')}</li>`}</ul></section>`;
      })
      .join(
        '',
      )}</div>${currencies.length ? '' : `<div class="card empty">${t('fxEmpty')}</div>`}`;
}

async function renderFXRates() {
  const isCurrentView = captureView();
  const rates = await api('/exchange-rates/history');
  if (!isCurrentView()) return;
  savedRates = [
    ...new Map(
      rates.map((quote) => [
        JSON.stringify([quote.currency, quote.month, quote.rate]),
        quote,
      ]),
    ).values(),
  ].sort(
    (a, b) =>
      a.currency.localeCompare(b.currency) ||
      a.month.localeCompare(b.month) ||
      Number(a.rate) - Number(b.rate),
  );
  drawFXRates();
}

document.addEventListener('change', (event) => {
  if (event.target.id !== 'fxPeriod') return;
  period = event.target.value;
  drawFXRates();
  $('#fxPeriod').focus({ preventScroll: true });
});

function showQuote(node) {
  const tooltip = $('#chartTooltip');
  tooltip.textContent = node.dataset.fxQuote;
  tooltip.hidden = false;
  const rect = node.getBoundingClientRect();
  const bounds = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(innerWidth - bounds.width - 8, rect.left - 80))}px`;
  tooltip.style.top = `${Math.max(8, rect.top - bounds.height - 8)}px`;
}
for (const event of ['pointerover', 'focusin', 'click']) {
  document.addEventListener(event, (e) => {
    const node = e.target.closest('[data-fx-quote]');
    if (node) showQuote(node);
    else if (event === 'click' && state.page === 'fxRates')
      $('#chartTooltip').hidden = true;
  });
}
for (const event of ['pointerout', 'focusout']) {
  document.addEventListener(event, (e) => {
    if (e.target.closest('[data-fx-quote]')) $('#chartTooltip').hidden = true;
  });
}

export { renderFXRates };
