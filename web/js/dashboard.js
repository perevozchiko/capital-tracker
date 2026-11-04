import { captureView, state } from './state.js';
import { api } from './api.js';
import { t } from './messages.js';
import { escapeHTML, monthLabel, moneyHTML, percentBP } from './format.js';
import { $, emptyStart, statusPill } from './ui.js';
import { chart } from './chart.js';
async function renderDashboard() {
  const isCurrentView = captureView();
  const d = await api('/dashboard?month=' + encodeURIComponent(state.month));
  if (!isCurrentView()) return;
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
    `<div class="grid-summary"><article class="card metric"><p class="overline">${t('totalNetWorth')}</p><div class="metric-value">${subtotal}</div>${statusPill(m)} <span class="subtle">${escapeHTML(monthLabel(state.month))}</span></article><article class="card metric"><p class="overline">${t('monthlyChange')}</p><div class="metric-value metric-secondary ${changeColor}">${change}</div><p class="subtle">${comparison}</p></article></div><section class="card panel"><div class="panel-heading"><h2>${t('history')}</h2></div>${chart(state.history)}</section>`;
}

export { renderDashboard };
