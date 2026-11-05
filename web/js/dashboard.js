import { captureView, state } from './state.js';
import { api } from './api.js';
import { t } from './messages.js';
import { escapeHTML, monthLabel, moneyHTML, percentBP } from './format.js';
import { $, emptyStart, statusPill } from './ui.js';
import { chart } from './chart.js';

// Family money at the end of each month: not investment performance or spending.
// Money values must use moneyHTML so the global privacy toggle keeps working.
async function renderDashboard() {
  const isCurrentView = captureView();
  const [d, groupData] = await Promise.all([
    api('/dashboard?month=' + encodeURIComponent(state.month)),
    api('/groups?month=' + encodeURIComponent(state.month)).catch(() => null),
  ]);
  if (!isCurrentView()) return;
  state.dashboard = d;
  if (d.accounts.length === 0) {
    $('#pageContent').innerHTML = emptyStart();
    return;
  }

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
  const balance = m.complete ? moneyHTML(m.total_eur_minor) : '—';
  const previousBalance = d.previous?.complete
    ? moneyHTML(d.previous.total_eur_minor)
    : '—';
  const change =
    delta != null
      ? `${moneyHTML(delta, 'EUR', BigInt(delta) > 0n ? '+' : '')}${d.change_percent_bp != null ? ` (${BigInt(d.change_percent_bp) > 0n ? '+' : ''}${percentBP(d.change_percent_bp)})` : ''}`
      : '—';
  const comparison =
    delta != null
      ? `${t('comparedLastMonth')}: ${escapeHTML(monthLabel(d.previous.month))} · ${previousBalance}`
      : t('noPrevious');

  const groups = groupData
    ? [
        ...(groupData.groups || []),
        ...(state.accounts.some(
          (a) => !a.archived_from_month && a.group_id == null,
        )
          ? [{ ...groupData.ungrouped, name: t('ungrouped') }]
          : []),
      ]
    : [];
  const groupCards = groups
    .map(
      (
        g,
        i,
      ) => `<button type="button" class="family-group-card family-group-${i % 3}" data-page="accounts">
        <span class="family-group-title"><span class="family-group-icon" aria-hidden="true">${['▤', '◈', '▦'][i % 3]}</span><span>${escapeHTML(g.name)}</span></span>
        <strong class="family-group-value">${g.total_eur_minor == null ? '—' : moneyHTML(g.total_eur_minor)}</strong>
        <span class="family-group-note">${t('groupTotalEUR')}</span>
      </button>`,
    )
    .join('');

  $('#pageContent').innerHTML = `
    <section class="grid-summary family-summary" aria-label="${t('familyTotalBalance')}">
      <article class="card metric family-total">
        <p class="overline">${t('familyTotalBalance')}</p>
        <div class="metric-value">${balance}</div>
        <div class="family-total-month">${statusPill(m)}<span class="subtle">${escapeHTML(monthLabel(state.month))}</span></div>
        <div class="family-past">
          <div><span>${t('previousMonthBalance')}</span><strong>${previousBalance}</strong></div>
          <div><span>${t('currentMonthBalance')}</span><strong>${balance}</strong></div>
        </div>
      </article>
      <article class="card metric family-change">
        <p class="overline">${t('monthlyChange')}</p>
        <div class="metric-value metric-secondary ${changeColor}">${change}</div>
        <p class="subtle">${comparison}</p>
        <p class="family-explainer">${t('changeExplainer')}</p>
      </article>
    </section>
    <section class="card panel family-history">
      <div class="panel-heading"><h2>${t('familyHistory')}</h2><span class="subtle">${t('balanceTrend')}</span></div>
      ${chart(state.history)}
    </section>
    ${
      groupCards
        ? `<section class="family-group-section">
      <div class="panel-heading"><h2>${t('moneyByGroup')}</h2><button class="btn btn-small" type="button" data-page="accounts">${t('navAccounts')} →</button></div>
      <div class="family-group-grid">${groupCards}</div>
    </section>`
        : ''
    }
    <section class="family-next-step">
      <div class="family-next-icon" aria-hidden="true">${m.complete ? '✓' : '!'}</div>
      <div><strong>${m.complete ? t('monthComplete') : t('monthIncomplete')}</strong>
        <p class="subtle">${m.complete ? t('allBalancesRecorded') : t('updateBalancesHelp')}</p></div>
      <button class="btn btn-primary" type="button" data-page="monthly">${t('updateBalances')} →</button>
    </section>`;
}

export { renderDashboard };
