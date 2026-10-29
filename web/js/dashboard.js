import { state } from './state.js';
import { api } from './api.js';
import { t } from './messages.js';
import { escapeHTML, monthLabel, money, percentBP } from './format.js';
import { $, emptyStart, statusPill } from './ui.js';
function cellFor(d, account) {
  const active = d.accounts.some((a) => a.id === account.id);
  if (!active)
    return `<span class="td-muted" title="${t('notActive')}">·</span>`;
  const b = d.balances.find((x) => x.account_id === account.id);
  return b
    ? money(b.amount_minor, account.currency)
    : `<span class="td-muted" title="${t('notEntered')}">—</span>`;
}
function renderTable(d) {
  const cols = d.columns;
  const headers = cols
    .map(
      (x) =>
        `<th class="${x.month === state.month ? 'selected-col' : ''}"><button data-action="selectColumn" data-month="${x.month}">${escapeHTML(monthLabel(x.month, true))}</button></th>`,
    )
    .join('');
  const rows = d.accounts
    .map(
      (account) =>
        `<tr><td><span>${escapeHTML(account.name)}</span><span class="currency-tag">${account.currency}</span></td>${cols.map((c) => `<td class="${c.month === state.month ? 'selected-col' : ''}">${cellFor(c, account)}</td>`).join('')}</tr>`,
    )
    .join('');
  const totals = cols
    .map(
      (c) =>
        `<td class="${c.month === state.month ? 'selected-col' : ''}">${c.complete ? money(c.total_eur_minor) : `<span class="td-muted">${t('incomplete')}</span>`}</td>`,
    )
    .join('');
  return `<div class="table-scroll"><table><thead><tr><th>${t('account')}</th>${headers}</tr></thead><tbody>${rows}<tr class="table-total"><td>${t('totalEUR')}</td>${totals}</tr></tbody></table></div><p class="footer-note">${t('displayedOriginal')} · ${t('exactTotal')}</p>`;
}
function monthIndex(s) {
  const [year, month] = s.split('-').map(Number);
  return year * 12 + month - 1;
}
function chart(history) {
  const valid = history.filter((p) => p.complete && p.total_eur_minor != null);
  if (valid.length === 0)
    return `<div class="empty">${t('historyEmpty')}</div>`;
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
    return `<line class="gridline" x1="${pad.left}" x2="${W - pad.right}" y1="${yFor(v)}" y2="${yFor(v)}"/><text x="${pad.left - 11}" y="${yFor(v) + 4}" text-anchor="end">${new Intl.NumberFormat('en-US', { style: 'decimal', notation: 'compact', maximumFractionDigits: 1 }).format(v)} €</text>`;
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
        `<circle class="chart-dot" cx="${xFor(p.month)}" cy="${yFor(Number(p.total_eur_minor) / 100)}" r="5" tabindex="0" role="img" aria-label="${escapeHTML(monthLabel(p.month))}: ${escapeHTML(money(p.total_eur_minor))}" data-chart-index="${history.indexOf(p)}"/>`,
    )
    .join('');
  return `<div class="chart-wrap"><svg class="history-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('history')}">${lines}${paths}${dots}${xLabels}</svg></div><p class="footer-note">${t('chartNote')}</p>`;
}
async function renderDashboard() {
  const d = await api(
    '/dashboard?month=' +
      encodeURIComponent(state.month) +
      '&columns=' +
      state.columnCount,
  );
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
  const subtotal = m.complete ? money(m.total_eur_minor) : '—';
  const change =
    delta != null
      ? `${BigInt(delta) > 0n ? '+' : ''}${money(delta)}${d.change_percent_bp != null ? ` (${BigInt(d.change_percent_bp) > 0n ? '+' : ''}${percentBP(d.change_percent_bp)})` : ''}`
      : '—';
  if (d.accounts.length === 0) {
    $('#pageContent').innerHTML = emptyStart();
    return;
  }
  $('#pageContent').innerHTML =
    `<div class="grid-summary"><article class="card metric"><p class="overline">${t('totalNetWorth')}</p><div class="metric-value">${subtotal}</div>${statusPill(m)} <span class="subtle">${escapeHTML(monthLabel(state.month))}</span></article><article class="card metric"><p class="overline">${t('monthlyChange')}</p><div class="metric-value metric-secondary ${changeColor}">${change}</div><p class="subtle">${delta != null ? t('comparedLastMonth') : t('noPrevious')}</p></article></div><section class="card panel"><div class="panel-heading"><h2>${t('history')}</h2><span class="subtle">${t('historyRange')}</span></div>${chart(state.history)}</section><section class="card panel"><div class="panel-heading"><h2>${t('monthlyOverview')}</h2><div class="overview-actions"><label for="columnCount">${t('showMonths')}</label><select id="columnCount" class="btn"><option>6</option><option>12</option><option>24</option><option>60</option><option>120</option></select><button class="btn btn-small" data-page="monthly">${t('editMonth')}</button></div></div>${renderTable(d)}</section>`;
  $('#columnCount').value = String(state.columnCount);
}

export { renderDashboard };
