import { state, collapsedGroups } from './state.js';
import { api } from './api.js';
import { t } from './messages.js';
import { differenceMinor } from './numbers.js';
import {
  escapeHTML,
  monthLabel,
  moneyHTML,
  nextMonth,
  minorToInput,
  rateText,
  pluralAccounts,
  parseMoney,
} from './format.js';
import { $, statusPill, groupVisibilityButtons } from './ui.js';
function updateBalanceDifference(input) {
  const node = document.querySelector(
    `[data-balance-change="${input.dataset.balance}"]`,
  );
  if (!node) return;
  let current = null;
  try {
    current = parseMoney(input.value);
  } catch {}
  const delta = differenceMinor(current, input.dataset.previousMinor || null);
  const n = delta === null ? null : BigInt(delta);
  node.className =
    'balance-change ' +
    (n === null
      ? 'neutral'
      : n > 0n
        ? 'positive'
        : n < 0n
          ? 'negative'
          : 'neutral');
  node.innerHTML =
    n === null
      ? '—'
      : moneyHTML(delta, input.dataset.currency, n > 0n ? '+' : '');
}
async function renderMonthly() {
  const previousMonth = nextMonth(state.month, -1);
  const [d, previous, groupData] = await Promise.all([
    api('/months/' + state.month),
    previousMonth >= '1900-01'
      ? api('/months/' + previousMonth)
      : Promise.resolve(null),
    api('/groups?month=' + encodeURIComponent(state.month) + '&view=monthly'),
  ]);
  state.monthData = d;
  const accounts = d.editable_accounts || d.accounts;
  const balances = new Map(
    d.balances.map((b) => [b.account_id, b.amount_minor]),
  );
  const previousBalances = new Map(
    (previous?.balances || []).map((b) => [b.account_id, b.amount_minor]),
  );
  const rates = new Map(d.rates.map((r) => [r.currency, r.rate]));
  const currencies = [...new Set(accounts.map((a) => a.currency))]
    .filter((c) => c !== 'EUR')
    .sort();
  const balanceRow = (a) => {
    const last = previousBalances.get(a.id);
    return `<div class='editor-row balance-row'>
   <label for='b-${a.id}'>${escapeHTML(a.name)}<small>${a.currency}</small></label>
   <div class='balance-cell balance-previous'><span class='balance-field-label' title='${escapeHTML(monthLabel(previousMonth))}'>${t('previousBalance')}</span><strong>${last == null ? '—' : moneyHTML(last, a.currency)}</strong></div>
   <div class='balance-cell balance-current'><span class='balance-field-label'>${t('currentBalance')}</span><input type='${document.documentElement.dataset.hideAmounts === 'true' ? 'password' : 'text'}' class='editor-input' id='b-${a.id}' data-balance='${a.id}' data-currency='${a.currency}' data-previous-minor='${last ?? ''}' inputmode='decimal' autocomplete='off' placeholder='${t('enterBalance')}' value='${escapeHTML(minorToInput(balances.get(a.id)))}'></div>
   <div class='balance-cell balance-difference'><span class='balance-field-label'>${t('balanceDifference')}</span><strong class='balance-change neutral' data-balance-change='${a.id}'>—</strong></div>
   <button type='button' class='btn btn-small balance-use-previous' data-action='copyPrevious' data-id='${a.id}' aria-label='${escapeHTML(t('usePrevious') + ' — ' + a.name)}' ${last == null ? 'disabled' : ''}>${t('usePrevious')}</button>
  </div>`;
  };
  // Organization and order are shared with Accounts. No drag, edit or action menu here.
  const groupSection = (group, id) => {
    const members = accounts.filter((a) => (a.group_id ?? null) === id);
    const key = id === null ? 'ungrouped' : 'g-' + id;
    const closed = collapsedGroups.has(key);
    const total =
      group.total_eur_minor == null ? '—' : moneyHTML(group.total_eur_minor);
    const totalNote =
      members.length && group.total_eur_minor == null
        ? ' · ' + t('incomplete')
        : '';
    return `<section class='account-group monthly-group ${closed ? 'is-collapsed' : ''}'>
   <div class='account-group-head'>
    <button type='button' class='group-toggle' data-action='toggleGroup' data-group-key='${key}' aria-expanded='${!closed}' aria-label='${t('toggleGroup')}'>${closed ? '▸' : '▾'}</button>
    <div class='group-caption'><strong>${escapeHTML(id === null ? t('ungrouped') : group.name)}</strong><small>${pluralAccounts(members.length)}</small></div>
    <div class='group-total'><strong>${total}</strong><small>${t('groupTotalEUR')} · ${escapeHTML(monthLabel(state.month, true))}${totalNote}</small></div>
   </div>
   <div class='account-group-body'>${members.length ? members.map(balanceRow).join('') : `<p class='group-empty'>${t('noActiveAccounts')}</p>`}</div>
  </section>`;
  };
  const rows =
    groupData.groups.map((g) => groupSection(g, g.id)).join('') +
    groupSection(groupData.ungrouped, null);
  const exchangeRows = currencies
    .map(
      (c) =>
        `<div class='editor-row'><label for='r-${c}'>EUR → ${c}<small>${t('rateMeaning')} ${c}</small></label><input class='editor-input' id='r-${c}' data-rate='${c}' ${rates.has(c) ? 'readonly' : ''} inputmode='decimal' autocomplete='off' placeholder='${t('enterRate')}' value='${escapeHTML(rateText(rates.get(c) || ''))}'></div>`,
    )
    .join('');
  const missing = d.complete
    ? t('complete')
    : [
        d.missing_balances.length
          ? t('missingBalances') + ': ' + d.missing_balances.length
          : '',
        d.missing_rates.length
          ? t('missingRates') + ': ' + d.missing_rates.join(', ')
          : '',
      ]
        .filter(Boolean)
        .join(' · ') || t('totalProvisional');
  $('#pageContent').innerHTML =
    `<div class='status-block'><div class='panel-heading status-heading'><strong>${t('status')}</strong>${statusPill(d)}</div><p class='inline-status'>${missing}</p>${d.complete ? `<div class='metric-value metric-secondary'>${moneyHTML(d.total_eur_minor)}</div>` : ''}</div><div class='editor-grid'><section class='card panel'><div class='panel-heading'><h2>${t('balance')}</h2><div class='overview-actions'><span class='subtle'>${escapeHTML(monthLabel(state.month))}</span>${groupVisibilityButtons()}</div></div><p class='caption'>${t('balancesNote')}</p>${rows}</section><section class='card panel'><div class='panel-heading'><h2>${t('rates')}</h2><span class='subtle'>EUR = 1</span></div><p class='caption'>${t('ratesNote')}</p>${currencies.length ? `<button type='button' class='btn btn-small' data-action='loadRates' ${currencies.every((c) => rates.has(c)) ? 'disabled' : ''}>${t('loadRates')}</button><p class='caption' id='rateLoadStatus' aria-live='polite'></p>` : ''}<div class='editor-list'>${exchangeRows || `<p class='muted'>EUR = 1</p>`}</div><p class='footer-note'>${t('rateFormatHelp')}</p></section></div><div class='editor-footer'><p class='subtle'>${t('exactTotal')}</p><div class='overview-actions'><button class='btn btn-danger' data-action='deleteMonth' ${d.exists ? '' : 'disabled'}>${t('deleteMonth')}</button><button class='btn btn-primary' data-action='saveMonth' ${accounts.length ? '' : 'disabled'}>${t('saveMonth')}</button></div></div>`;
  document.querySelectorAll('[data-balance]').forEach(updateBalanceDifference);
  state.dirty = false;
}

export { renderMonthly, updateBalanceDifference };
