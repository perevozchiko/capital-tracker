import { captureView, state } from './state.js';
import { api, request } from './api.js';
import { t } from './messages.js';
import { escapeHTML, moneyHTML, parseMoney, parseRate } from './format.js';
import { $, notify, applyAmountVisibility } from './ui.js';
import { chart } from './dashboard.js';
import { showConfirm } from './dialogs.js';
import { incomeTotal as recurringExpenseTotal } from './income-math.js';

let monthRates = new Map();

function syncRecurringExpenseRates() {
  const container = $('#recurringExpenseRateFields');
  for (const input of container.querySelectorAll(
    '[data-recurring-expense-rate]',
  )) {
    monthRates.set(input.dataset.recurringExpenseRate, input.value);
  }
  const used = new Set(
    [...document.querySelectorAll('[data-recurring-expense-row]')]
      .map((row) => row.dataset.currency)
      .filter((currency) => currency !== 'EUR'),
  );
  for (const label of container.querySelectorAll(
    '[data-recurring-expense-rate-label]',
  )) {
    if (!used.has(label.dataset.recurringExpenseRateLabel)) label.remove();
  }
  for (const currency of state.currencies.filter((currency) =>
    used.has(currency),
  )) {
    if (container.querySelector(`[data-recurring-expense-rate="${currency}"]`))
      continue;
    container.insertAdjacentHTML(
      'beforeend',
      `<label data-recurring-expense-rate-label="${currency}" for="recurringExpense-rate-${currency}"><span>1 EUR = … ${currency}</span><input id="recurringExpense-rate-${currency}" class="editor-input" data-recurring-expense-rate="${currency}" inputmode="decimal" value="${escapeHTML(monthRates.get(currency) || '')}"></label>`,
    );
  }
  $('#recurringExpenseRates').hidden = used.size === 0;
}
function recurringExpenseRow(entry) {
  return `<div class="account-row income-list-row" data-recurring-expense-row data-name="${escapeHTML(entry.name)}" data-currency="${escapeHTML(entry.currency)}" data-amount-minor="${escapeHTML(entry.amount_minor)}">
    <div class="account-main income-list-main"><strong data-recurring-expense-name>${escapeHTML(entry.name)}</strong><span class="currency-tag">${escapeHTML(entry.currency)}</span></div>
    <div class="account-balance"><strong data-recurring-expense-amount>${moneyHTML(entry.amount_minor, entry.currency)}</strong><small>${t('recurringExpenseAmount')}</small></div>
    <div class="account-balance"><strong data-recurring-expense-eur>—</strong><small>${t('totalEUR')}</small></div>
    <button class="btn btn-icon" type="button" data-action="removeRecurringExpenseRow" aria-label="${t('removeRecurringExpense')}">×</button>
  </div>`;
}

async function renderRecurringExpenses() {
  const isCurrentView = captureView();
  const history = await api('/recurring-expenses');
  if (!isCurrentView()) return;
  const month = await api('/recurring-expenses/' + state.month);
  if (!isCurrentView()) return;
  state.recurringExpenseHistory = history;
  monthRates = new Map();
  for (const entry of month?.entries || []) {
    const previous = monthRates.get(entry.currency);
    monthRates.set(
      entry.currency,
      previous == null || previous === entry.rate ? entry.rate : '',
    );
  }
  $('#pageContent').innerHTML =
    `<section class="card panel"><h2>${t('addRecurringExpense')}</h2><p class="caption">${t('recurringExpenseAddHelp')}</p><form id="addRecurringExpenseForm" class="form-row">
 <div class="field"><label for="recurringExpenseName">${t('recurringExpenseName')}</label><input id="recurringExpenseName" name="name" maxlength="100" required placeholder="${t('recurringExpenseNamePlaceholder')}"></div>
 <div class="field"><label for="recurringExpenseAmount">${t('recurringExpenseAmount')}</label><input id="recurringExpenseAmount" name="amount" data-recurring-expense type="text" inputmode="decimal" autocomplete="off" required></div>
 <div class="field"><label for="recurringExpenseCurrency">${t('currency')}</label><select id="recurringExpenseCurrency" name="currency">${state.currencies.map((c) => `<option ${c === 'EUR' ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
 <button class="btn btn-primary" type="submit">${t('addRecurringExpense')}</button></form></section>
 <section class="card panel"><div class="panel-heading"><h2>${t('recurringExpenseEditor')}</h2></div><p class="subtle">${t('recurringExpenseHelp')}</p>${month.inherited_from ? `<p class="caption">${t('recurringExpenseInherited').replace('{month}', escapeHTML(month.inherited_from))}</p>` : ''}<form id="recurringExpenseForm"><p id="recurringExpenseListEmpty" class="caption" ${month?.entries?.length ? 'hidden' : ''}>${t('recurringExpenseListEmpty')}</p><div class="income-fields">${(month?.entries || []).map(recurringExpenseRow).join('')}</div><aside id="recurringExpenseRates" class="income-rates" hidden><h3>${t('rates')}</h3><p class="subtle">${t('recurringExpenseSharedRatesHelp')}</p><div id="recurringExpenseRateFields" class="income-rate-fields"></div><button class="btn" type="button" data-action="loadRecurringExpenseRates">${t('loadRates')}</button><p id="recurringExpenseRateStatus" class="subtle" role="status"></p></aside><div class="income-total"><span>${t('monthlyRecurringExpenseTotal')}</span><strong id="recurringExpenseTotal">${moneyHTML(month?.total_eur_minor || '0')}</strong></div><div class="income-actions"><button class="btn btn-primary" type="submit">${t('saveRecurringExpense')}</button><button class="btn btn-danger" type="button" data-action="deleteRecurringExpense" ${month.entries.length ? '' : 'disabled'}>${t('deleteRecurringExpense')}</button></div></form></section><section class="card panel"><div class="panel-heading"><h2>${t('recurringExpenseHistory')}</h2><span class="subtle">${t('historyRange')}</span></div>${chart(state.recurringExpenseHistory, 'recurringExpense')}</section>`;
  syncRecurringExpenseRates();
  updateRecurringExpenseTotals();
  applyAmountVisibility();
}

function readRow(row) {
  const amount = row.dataset.amountMinor;
  const currency = row.dataset.currency;
  const rate =
    currency === 'EUR'
      ? '1'
      : parseRate($(`[data-recurring-expense-rate="${currency}"]`).value);
  if (!rate) throw new Error(t('invalidRate'));
  return {
    month: state.month,
    name: row.dataset.name,
    currency,
    amount_minor: amount,
    rate,
  };
}

function updateRecurringExpenseTotals() {
  const form = $('#recurringExpenseForm');
  if (!form) return;
  const entries = [];
  let complete = true;
  for (const row of form.querySelectorAll('[data-recurring-expense-row]')) {
    try {
      const entry = readRow(row);
      row.querySelector('[data-recurring-expense-eur]').innerHTML = moneyHTML(
        recurringExpenseTotal([entry]),
      );
      entries.push(entry);
    } catch {
      row.querySelector('[data-recurring-expense-eur]').textContent = '—';
      complete = false;
    }
  }
  $('#recurringExpenseTotal').innerHTML = complete
    ? moneyHTML(recurringExpenseTotal(entries))
    : '—';
}

function addRecurringExpenseRow(form) {
  const name = form.elements.name.value.trim();
  if (!name) throw new Error(t('field_name'));
  const amount = parseMoney(form.elements.amount.value);
  if (amount == null || BigInt(amount) < 0n)
    throw new Error(t('recurringExpenseNonnegative'));
  $('#recurringExpenseForm .income-fields').insertAdjacentHTML(
    'beforeend',
    recurringExpenseRow({
      name,
      amount_minor: amount,
      currency: form.elements.currency.value,
    }),
  );
  $('#recurringExpenseListEmpty').hidden = true;
  state.dirty = true;
  syncRecurringExpenseRates();
  updateRecurringExpenseTotals();
  applyAmountVisibility();
  form.reset();
  form.elements.name.focus();
}
function removeRecurringExpenseRow(button) {
  button.closest('[data-recurring-expense-row]').remove();
  $('#recurringExpenseListEmpty').hidden = !!$(
    '#recurringExpenseForm [data-recurring-expense-row]',
  );
  syncRecurringExpenseRates();
  state.dirty = true;
  updateRecurringExpenseTotals();
}

document.addEventListener('input', (event) => {
  if (event.target.closest('#recurringExpenseForm'))
    updateRecurringExpenseTotals();
});

async function saveRecurringExpense(form) {
  const isCurrentView = captureView();
  const entries = [];
  for (const row of form.querySelectorAll('[data-recurring-expense-row]')) {
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
    ...document.querySelectorAll('#addRecurringExpenseForm button'),
  ];
  const disabled = buttons.map((button) => button.disabled);
  buttons.forEach((button) => (button.disabled = true));
  const addForm = $('#addRecurringExpenseForm');
  form.inert = true;
  addForm.inert = true;
  try {
    await request('/recurring-expenses/' + state.month, 'PUT', { entries });
    if (!isCurrentView()) return;
    state.dirty = false;
    await renderRecurringExpenses();
    notify(t('recurringExpenseSaved'));
  } finally {
    form.inert = false;
    addForm.inert = false;
    buttons.forEach((button, i) => {
      if (button.isConnected) button.disabled = disabled[i];
    });
  }
}

async function deleteRecurringExpense() {
  if (
    !(await showConfirm({
      title: t('deleteRecurringExpense'),
      message: t('confirmDeleteRecurringExpense'),
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
      danger: true,
    }))
  )
    return;
  await request('/recurring-expenses/' + state.month, 'PUT', { entries: [] });
  state.dirty = false;
  await renderRecurringExpenses();
  notify(t('recurringExpenseDeleted'));
}

async function loadRecurringExpenseRates(button) {
  const month = state.month;
  const inputs = [
    ...document.querySelectorAll('[data-recurring-expense-rate]'),
  ];
  if (!inputs.length) return;
  const initial = new Map(inputs.map((input) => [input, input.value]));
  button.disabled = true;
  const saveButton = $('#recurringExpenseForm [type="submit"]');
  saveButton.disabled = true;
  const status = $('#recurringExpenseRateStatus');
  status.textContent = t('loading');
  try {
    const result = await api(
      '/exchange-rates?month=' + encodeURIComponent(month),
      { cache: 'no-store' },
    );
    if (!button.isConnected || state.month !== month) return;
    let count = 0;
    for (const input of inputs) {
      const rate = result.rates[input.dataset.recurringExpenseRate];
      if (input.isConnected && rate && input.value === initial.get(input)) {
        input.value = rate;
        count++;
      }
    }
    if (count) state.dirty = true;
    updateRecurringExpenseTotals();
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
  renderRecurringExpenses,
  saveRecurringExpense,
  deleteRecurringExpense,
  loadRecurringExpenseRates,
  addRecurringExpenseRow,
  removeRecurringExpenseRow,
};
