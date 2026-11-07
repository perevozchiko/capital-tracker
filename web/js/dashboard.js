import { captureView, state } from './state.js';
import { api } from './api.js';
import { t } from './messages.js';
import {
  escapeHTML,
  monthLabel,
  moneyHTML,
  percentBP,
  nextMonth,
} from './format.js';
import { $, emptyStart, statusPill } from './ui.js';
import { chart } from './chart.js';

// Family money at the end of each month: not investment performance or spending.
// Money values must use moneyHTML so the global privacy toggle keeps working.
async function renderDashboard() {
  const isCurrentView = captureView();
  const [d, groupData, incomes, expenses, recurring] = await Promise.all([
    // The chart uses state.history, so this page only needs the selected
    // month. Avoid calculating the otherwise unused default 12 columns.
    api(
      '/dashboard?month=' + encodeURIComponent(state.month) + '&columns=1',
    ),
    api('/groups?month=' + encodeURIComponent(state.month)).catch(() => null),
    api('/incomes'),
    api('/expenses'),
    api('/recurring-expenses'),
  ]);
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

  const flows = [
    { page: 'incomes', label: 'navIncomes', history: incomes, icon: '↗' },
    { page: 'expenses', label: 'navExpenses', history: expenses, icon: '↘' },
    {
      page: 'recurringExpenses',
      label: 'navRecurringExpenses',
      history: recurring,
      icon: '↻',
    },
  ].map((flow) => ({
    ...flow,
    current: flow.history.find((p) => p.month === state.month),
    previous: flow.history.find((p) => p.month === nextMonth(state.month, -1)),
  }));
  const sections = [
    { page: 'monthly', label: 'navMonthly', saved: m.complete },
    ...flows.map((flow) => ({ ...flow, saved: !!flow.current })),
  ];
  const completed = sections.filter((section) => section.saved).length;
  const allComplete = completed === sections.length;
  const nextSection = sections.find((section) => !section.saved) || sections[0];

  $('#pageContent').innerHTML = `
    ${d.accounts.length === 0 ? emptyStart() : ''}
    <section class="grid-summary family-summary" aria-label="${t('familyTotalBalance')}">
      <article class="card metric family-total">
        <p class="overline">${t('familyTotalBalance')}</p>
        <div class="metric-value">${balance}</div>
        <div class="family-total-month">${statusPill({ complete: allComplete })}<span class="subtle">${escapeHTML(monthLabel(state.month))}</span></div>
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
    <section class="dashboard-flows" aria-label="${t('selectedMonth')} · EUR">
      ${flows.map(flowCard).join('')}
    </section>
    <section class="card panel month-review" aria-label="${t('status')}">
      <div class="panel-heading"><h2>${allComplete ? t('monthComplete') : t('monthIncomplete')}</h2><span class="pill ${allComplete ? 'good' : 'bad'}">${t('reviewProgress').replace('{count}', completed)}</span></div>
      <p class="subtle">${t(allComplete ? 'monthReviewedHelp' : 'monthReviewHelp')}</p>
      <div class="month-review-sections">${sections.map((section) => `<button type="button" class="month-review-item" data-page="${section.page}"><span class="review-indicator ${section.saved ? 'positive' : 'neutral'}" aria-hidden="true">${section.saved ? '✓' : '○'}</span><span>${t(section.label)}</span><span class="pill ${section.saved ? 'good' : 'bad'}">${t(section.saved ? 'reviewSaved' : 'reviewNeeded')}</span></button>`).join('')}</div>
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
      <div class="family-next-icon" aria-hidden="true">${allComplete ? '✓' : '!'}</div>
      <div><strong>${allComplete ? t('monthComplete') : t('monthIncomplete')}</strong>
        <p class="subtle">${t(allComplete ? 'monthReviewedHelp' : 'monthReviewHelp')}</p></div>
      <button class="btn btn-primary" type="button" data-page="${nextSection.page}">${t(nextSection.label)} →</button>
    </section>`;
}

function flowCard(flow) {
  const current = flow.current;
  const previous = flow.previous;
  let comparison = t('flowNoPrevious');
  let color = 'neutral';
  if (current && previous) {
    const value = BigInt(current.total_eur_minor);
    const old = BigInt(previous.total_eur_minor);
    const delta = value - old;
    const sign = delta > 0n ? '+' : '';
    const improved = flow.page === 'incomes' ? delta > 0n : delta < 0n;
    color = delta === 0n ? 'neutral' : improved ? 'positive' : 'negative';
    const magnitude = delta < 0n ? -delta : delta;
    const bp = old
      ? ((magnitude * 10000n + old / 2n) / old) * (delta < 0n ? -1n : 1n)
      : null;
    comparison = `${delta > 0n ? '↑' : delta < 0n ? '↓' : '→'} ${moneyHTML(delta, 'EUR', sign)}${bp != null ? ` <span>(${bp > 0n ? '+' : ''}${percentBP(bp.toString())})</span>` : ''}`;
    if (!old)
      comparison += `<span class="subtle flow-zero-note">${t(value ? 'flowFromZero' : 'flowUnchangedZero')}</span>`;
  }
  return `<button type="button" class="card metric dashboard-flow" data-page="${flow.page}">
    <span class="flow-heading"><span class="flow-icon" aria-hidden="true">${flow.icon}</span><span>${t(flow.label)}</span><span aria-hidden="true">→</span></span>
    <strong class="flow-total">${current ? moneyHTML(current.total_eur_minor) : '—'}</strong>
    <span class="flow-change ${color}">${current ? comparison : t('flowNotSaved')}</span>
    <span class="subtle flow-period">${escapeHTML(monthLabel(state.month))}${current && previous ? ` · ${t('comparedLastMonth')} ${escapeHTML(monthLabel(previous.month, true))}` : ''}</span>
  </button>`;
}

export { renderDashboard };
