import { state } from './state.js';
import { api } from './api.js';
import { t } from './messages.js';
import {
  escapeHTML,
  monthLabel,
  money,
  moneyHTML,
  percentBP,
} from './format.js';
import { $, emptyStart, statusPill } from './ui.js';
function monthIndex(s) {
  const [year, month] = s.split('-').map(Number);
  return year * 12 + month - 1;
}
function chart(history, source = 'capital') {
  const valid = history.filter((p) => p.complete && p.total_eur_minor != null);
  if (valid.length === 0)
    return `<div class="empty">${t(source === 'expense' ? 'expenseEmpty' : source === 'income' ? 'incomeEmpty' : 'historyEmpty')}</div>`;
  const W = 860,
    H = 266,
    pad = { left: 88, right: 20, top: 18, bottom: 40 },
    innerW = W - pad.left - pad.right,
    innerH = H - pad.top - pad.bottom;
  const first = monthIndex(history[0].month),
    last = monthIndex(history[history.length - 1].month);
  const range = Math.max(1, last - first);
  const values = valid.map((p) => Number(p.total_eur_minor) / 100);
  let min = Math.min(...values),
    max = Math.max(...values);
  const spread = Math.max(1, max - min);
  min -= spread * 0.14;
  max += spread * 0.14;
  const yFor = (v) => pad.top + ((max - v) / (max - min)) * innerH;
  const xFor = (m) => pad.left + ((monthIndex(m) - first) / range) * innerW;
  const lines = Array.from({ length: 5 }, (_, i) => {
    const v = max - ((max - min) * i) / 4;
    return `<line class="gridline" x1="${pad.left}" x2="${W - pad.right}" y1="${yFor(v)}" y2="${yFor(v)}"/><text class="money-axis" x="${pad.left - 11}" y="${yFor(v) + 4}" text-anchor="end">${new Intl.NumberFormat('en-US', { style: 'decimal', notation: 'compact', maximumFractionDigits: 1 }).format(v)} €</text>`;
  }).join('');
  let paths = '',
    previous = null;
  for (const p of history) {
    if (p.complete && p.total_eur_minor != null) {
      const x = xFor(p.month),
        y = yFor(Number(p.total_eur_minor) / 100);
      if (previous && monthIndex(p.month) - monthIndex(previous.month) === 1) {
        paths += `<path class="curve" d="M${xFor(previous.month)},${yFor(Number(previous.total_eur_minor) / 100)} L${x},${y}"/>`;
      }
      previous = p;
    } else previous = null;
  }
  const step = Math.max(1, Math.ceil(history.length / 7));
  const xLabels = history
    .filter((_, i) => i % step === 0 || i === history.length - 1)
    .map(
      (p) =>
        `<text x="${xFor(p.month)}" y="${H - 13}" text-anchor="middle">${escapeHTML(monthLabel(p.month, true))}</text>`,
    )
    .join('');
  const dots = valid
    .map(
      (p, i) =>
        `<circle class="chart-dot" cx="${xFor(p.month)}" cy="${yFor(Number(p.total_eur_minor) / 100)}" r="5" tabindex="0" role="img" aria-label="${escapeHTML(monthLabel(p.month))}${document.documentElement.dataset.hideAmounts === 'true' ? '' : ': ' + escapeHTML(money(p.total_eur_minor))}" data-chart-source="${source}" data-chart-index="${history.indexOf(p)}"/>`,
    )
    .join('');
  return `<div class="chart-wrap"><svg class="history-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t(source === 'expense' ? 'expenseHistory' : source === 'income' ? 'incomeHistory' : 'history')}">${lines}${paths}${dots}${xLabels}</svg></div><p class="footer-note">${t('chartNote')}</p>`;
}
async function renderDashboard() {
  const d = await api('/dashboard?month=' + encodeURIComponent(state.month));
  state.dashboard = d;
  const m = d.month;
  const delta = d.change_minor;
  const changeColor =
    delta == null
      ? 'neutral'
      : BigInt(delta) < 0n
        ? 'negative'
        : BigInt(delta) > 0n
          ? 'positive'
          : 'neutral';
  const subtotal = m.complete ? moneyHTML(m.total_eur_minor) : '—';
  const change =
    delta != null
      ? `${moneyHTML(delta, 'EUR', BigInt(delta) > 0n ? '+' : '')}${d.change_percent_bp != null ? ` (${BigInt(d.change_percent_bp) > 0n ? '+' : ''}${percentBP(d.change_percent_bp)})` : ''}`
      : '—';
  const comparison =
    delta != null
      ? `${t('comparedLastMonth')}: ${escapeHTML(monthLabel(d.previous.month))} · ${moneyHTML(d.previous.total_eur_minor)}`
      : t('noPrevious');
  if (d.accounts.length === 0) {
    $('#pageContent').innerHTML = emptyStart();
    return;
  }
  $('#pageContent').innerHTML =
    `<div class="grid-summary"><article class="card metric"><p class="overline">${t('totalNetWorth')}</p><div class="metric-value">${subtotal}</div>${statusPill(m)} <span class="subtle">${escapeHTML(monthLabel(state.month))}</span></article><article class="card metric"><p class="overline">${t('monthlyChange')}</p><div class="metric-value metric-secondary ${changeColor}">${change}</div><p class="subtle">${comparison}</p></article></div><section class="card panel"><div class="panel-heading"><h2>${t('history')}</h2><span class="subtle">${t('historyRange')}</span></div>${chart(state.history)}</section>`;
}

export { renderDashboard, chart };
