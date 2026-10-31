import { captureView, state } from './state.js';
import { api, request } from './api.js';
import { t } from './messages.js';
import { escapeHTML, moneyHTML, parseMoney, parseRate } from './format.js';
import { $, notify, applyAmountVisibility } from './ui.js';
import { chart } from './dashboard.js';
import { showConfirm } from './dialogs.js';
import { incomeTotal } from './income-math.js';

let monthRates = new Map();

function syncIncomeRates() {
  const container = $('#incomeRateFields');
  for (const input of container.querySelectorAll('[data-income-rate]')) {
    monthRates.set(input.dataset.incomeRate, input.value);
  }
  const used = new Set(
    [...document.querySelectorAll('[data-income-row]')]
      .map((row) => row.dataset.currency)
      .filter((currency) => currency !== 'EUR'),
  );
  for (const label of container.querySelectorAll('[data-income-rate-label]')) {
    if (!used.has(label.dataset.incomeRateLabel)) label.remove();
  }
  for (const currency of state.currencies.filter((currency) =>
    used.has(currency),
  )) {
    if (container.querySelector(`[data-income-rate="${currency}"]`)) continue;
    container.insertAdjacentHTML(
      'beforeend',
      `<label data-income-rate-label="${currency}" for="income-rate-${currency}"><span>1 EUR = … ${currency}</span><input id="income-rate-${currency}" class="editor-input" data-income-rate="${currency}" inputmode="decimal" value="${escapeHTML(monthRates.get(currency) || '')}"></label>`,
    );
  }
  $('#incomeRates').hidden = used.size === 0;
}
function incomeRow(entry) {
  return `<div class="account-row income-list-row" data-income-row data-name="${escapeHTML(entry.name)}" data-currency="${escapeHTML(entry.currency)}" data-amount-minor="${escapeHTML(entry.amount_minor)}">
    <div class="account-main income-list-main"><strong data-income-name>${escapeHTML(entry.name)}</strong><span class="currency-tag">${escapeHTML(entry.currency)}</span></div>
    <div class="account-balance"><strong data-income-amount>${moneyHTML(entry.amount_minor, entry.currency)}</strong><small>${t('incomeAmount')}</small></div>
    <div class="account-balance"><strong data-income-eur>—</strong><small>${t('totalEUR')}</small></div>
    <button class="btn btn-icon" type="button" data-action="removeIncomeRow" aria-label="${t('removeIncome')}">×</button>
  </div>`;
}

async function renderIncomes() {
  const isCurrentView = captureView();
  const history = await api('/incomes');
  if (!isCurrentView()) return;
  state.incomeHistory = history;
  const month = state.incomeHistory.find((m) => m.month === state.month);
  monthRates = new Map();
  for (const entry of month?.entries || []) {
    const previous = monthRates.get(entry.currency);
    monthRates.set(
      entry.currency,
      previous == null || previous === entry.rate ? entry.rate : '',
    );
  }
  $('#pageContent').innerHTML =
    `<section class="card panel"><h2>${t('addIncome')}</h2><p class="caption">${t('incomeAddHelp')}</p><form id="addIncomeForm" class="form-row">
 <div class="field"><label for="incomeName">${t('incomeName')}</label><input id="incomeName" name="name" maxlength="100" required placeholder="${t('incomeNamePlaceholder')}"></div>
 <div class="field"><label for="incomeAmount">${t('incomeAmount')}</label><input id="incomeAmount" name="amount" data-income type="text" inputmode="decimal" autocomplete="off" required></div>
 <div class="field"><label for="incomeCurrency">${t('currency')}</label><select id="incomeCurrency" name="currency">${state.currencies.map((c) => `<option ${c === 'EUR' ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
 <button class="btn btn-primary" type="submit">${t('addIncome')}</button></form></section>
 <section class="card panel"><div class="panel-heading"><h2>${t('incomeEditor')}</h2></div><p class="subtle">${t('incomeHelp')}</p><form id="incomeForm"><p id="incomeListEmpty" class="caption" ${month?.entries?.length ? 'hidden' : ''}>${t('incomeListEmpty')}</p><div class="income-fields">${(month?.entries || []).map(incomeRow).join('')}</div><aside id="incomeRates" class="income-rates" hidden><h3>${t('rates')}</h3><p class="subtle">${t('incomeSharedRatesHelp')}</p><div id="incomeRateFields" class="income-rate-fields"></div><button class="btn" type="button" data-action="loadIncomeRates">${t('loadRates')}</button><p id="incomeRateStatus" class="subtle" role="status"></p></aside><div class="income-total"><span>${t('monthlyIncomeTotal')}</span><strong id="incomeTotal">${moneyHTML(month?.total_eur_minor || '0')}</strong></div><div class="income-actions"><button class="btn btn-primary" type="submit">${t('saveIncome')}</button><button class="btn btn-danger" type="button" data-action="deleteIncome" ${month ? '' : 'disabled'}>${t('deleteIncome')}</button></div></form></section><section class="card panel"><div class="panel-heading"><h2>${t('incomeHistory')}</h2><span class="subtle">${t('historyRange')}</span></div>${chart(state.incomeHistory, 'income')}</section>`;
  syncIncomeRates();
  updateIncomeTotals();
  applyAmountVisibility();
}

function readRow(row) {
  const amount = row.dataset.amountMinor;
  const currency = row.dataset.currency;
  const rate =
    currency === 'EUR'
      ? '1'
      : parseRate($(`[data-income-rate="${currency}"]`).value);
  if (!rate) throw new Error(t('invalidRate'));
  return {
    month: state.month,
    name: row.dataset.name,
    currency,
    amount_minor: amount,
    rate,
  };
}

function updateIncomeTotals() {
  const form = $('#incomeForm');
  if (!form) return;
  const entries = [];
  let complete = true;
  for (const row of form.querySelectorAll('[data-income-row]')) {
    try {
      const entry = readRow(row);
      row.querySelector('[data-income-eur]').innerHTML = moneyHTML(
        incomeTotal([entry]),
      );
      entries.push(entry);
    } catch {
      row.querySelector('[data-income-eur]').textContent = '—';
      complete = false;
    }
  }
  $('#incomeTotal').innerHTML = complete
    ? moneyHTML(incomeTotal(entries))
    : '—';
}

function addIncomeRow(form) {
  const name = form.elements.name.value.trim();
  if (!name) throw new Error(t('field_name'));
  const amount = parseMoney(form.elements.amount.value);
  if (amount == null || BigInt(amount) < 0n)
    throw new Error(t('incomeNonnegative'));
  $('#incomeForm .income-fields').insertAdjacentHTML(
    'beforeend',
    incomeRow({
      name,
      amount_minor: amount,
      currency: form.elements.currency.value,
    }),
  );
  $('#incomeListEmpty').hidden = true;
  state.dirty = true;
  syncIncomeRates();
  updateIncomeTotals();
  applyAmountVisibility();
  form.reset();
  form.elements.name.focus();
}
function removeIncomeRow(button) {
  button.closest('[data-income-row]').remove();
  $('#incomeListEmpty').hidden = !!$('#incomeForm [data-income-row]');
  syncIncomeRates();
  state.dirty = true;
  updateIncomeTotals();
}

document.addEventListener('input', (event) => {
  if (event.target.closest('#incomeForm')) updateIncomeTotals();
});

async function saveIncome(form) {
  const isCurrentView = captureView();
  const entries = [];
  for (const row of form.querySelectorAll('[data-income-row]')) {
    try {
      const entry = readRow(row);
      if (!entry.name) throw new Error(t('field_name'));
      entries.push(entry);
    } catch (error) {
      notify(error.message, true);
      return;
    }
  }
  const buttons = [
    ...form.querySelectorAll('button'),
    ...document.querySelectorAll('#addIncomeForm button'),
  ];
  const disabled = buttons.map((button) => button.disabled);
  buttons.forEach((button) => (button.disabled = true));
  const addForm = $('#addIncomeForm');
  form.inert = true;
  addForm.inert = true;
  try {
    await request('/incomes/' + state.month, 'PUT', { entries });
    if (!isCurrentView()) return;
    state.dirty = false;
    await renderIncomes();
    notify(t('incomeSaved'));
  } finally {
    form.inert = false;
    addForm.inert = false;
    buttons.forEach((button, i) => {
      if (button.isConnected) button.disabled = disabled[i];
    });
  }
}

async function deleteIncome() {
  if (
    !(await showConfirm({
      title: t('deleteIncome'),
      message: t('confirmDeleteIncome'),
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
      danger: true,
    }))
  )
    return;
  await request('/incomes/' + state.month, 'PUT', { entries: [] });
  state.dirty = false;
  await renderIncomes();
  notify(t('incomeDeleted'));
}

async function loadIncomeRates(button) {
  const month = state.month;
  const inputs = [...document.querySelectorAll('[data-income-rate]')];
  if (!inputs.length) return;
  const initial = new Map(inputs.map((input) => [input, input.value]));
  button.disabled = true;
  const saveButton = $('#incomeForm [type="submit"]');
  saveButton.disabled = true;
  const status = $('#incomeRateStatus');
  status.textContent = t('loading');
  try {
    const result = await api(
      '/exchange-rates?month=' + encodeURIComponent(month),
      { cache: 'no-store' },
    );
    if (!button.isConnected || state.month !== month) return;
    let count = 0;
    for (const input of inputs) {
      const rate = result.rates[input.dataset.incomeRate];
      if (input.isConnected && rate && input.value === initial.get(input)) {
        input.value = rate;
        count++;
      }
    }
    if (count) state.dirty = true;
    updateIncomeTotals();
    status.textContent = t('ratesLoaded')
      .replace('{date}', result.date)
      .replace('{count}', count);
  } catch {
    if (status.isConnected) status.textContent = t('ratesLoadFailed');
  } finally {
    if (button.isConnected) button.disabled = false;
    if (saveButton.isConnected) saveButton.disabled = false;
  }
}

export {
  renderIncomes,
  saveIncome,
  deleteIncome,
  loadIncomeRates,
  addIncomeRow,
  removeIncomeRow,
};
