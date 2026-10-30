import { state } from './state.js';
import { api, request } from './api.js';
import { t } from './messages.js';
import {
  escapeHTML,
  minorToInput,
  moneyHTML,
  parseMoney,
  parseRate,
} from './format.js';
import { $, notify, applyAmountVisibility } from './ui.js';
import { chart } from './dashboard.js';
import { showConfirm } from './dialogs.js';
import { incomeTotal as expenseTotal } from './income-math.js';

let rowSequence = 0;
let monthRates = new Map();

function syncExpenseRates() {
  const container = $('#expenseRateFields');
  for (const input of container.querySelectorAll('[data-expense-rate]')) {
    monthRates.set(input.dataset.expenseRate, input.value);
  }
  const used = new Set(
    [...document.querySelectorAll('[data-expense-currency]')]
      .map((input) => input.value)
      .filter((currency) => currency !== 'EUR'),
  );
  for (const label of container.querySelectorAll('[data-expense-rate-label]')) {
    if (!used.has(label.dataset.expenseRateLabel)) label.remove();
  }
  for (const currency of state.currencies.filter((currency) =>
    used.has(currency),
  )) {
    if (container.querySelector(`[data-expense-rate="${currency}"]`)) continue;
    container.insertAdjacentHTML(
      'beforeend',
      `<label data-expense-rate-label="${currency}" for="expense-rate-${currency}"><span>1 EUR = … ${currency}</span><input id="expense-rate-${currency}" class="editor-input" data-expense-rate="${currency}" inputmode="decimal" value="${escapeHTML(monthRates.get(currency) || '')}"></label>`,
    );
  }
  $('#expenseRates').hidden = used.size === 0;
}
function expenseRow(entry = {}) {
  const id = ++rowSequence;
  const currency = entry.currency || 'EUR';
  return `<div class="income-row" data-expense-row>
    <label for="expense-name-${id}">${t('expenseName')}<input id="expense-name-${id}" class="editor-input" data-expense-name maxlength="100" value="${escapeHTML(entry.name || '')}" placeholder="${t('expenseNamePlaceholder')}"></label>
    <label for="expense-amount-${id}">${t('expenseAmount')}<input id="expense-amount-${id}" class="editor-input" data-expense type="text" inputmode="decimal" autocomplete="off" value="${escapeHTML(minorToInput(entry.amount_minor))}"></label>
    <label for="expense-currency-${id}">${t('currency')}<select id="expense-currency-${id}" class="editor-input" data-expense-currency>${state.currencies.map((c) => `<option ${c === currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <div class="income-equivalent"><span class="subtle">${t('totalEUR')}</span><strong data-expense-eur>—</strong></div>
    <button class="btn btn-icon" type="button" data-action="removeExpenseRow" aria-label="${t('removeExpense')}">×</button>
  </div>`;
}

async function renderExpenses() {
  state.expenseHistory = await api('/expenses');
  const month = state.expenseHistory.find((m) => m.month === state.month);
  monthRates = new Map();
  for (const entry of month?.entries || []) {
    const previous = monthRates.get(entry.currency);
    monthRates.set(
      entry.currency,
      previous == null || previous === entry.rate ? entry.rate : '',
    );
  }
  $('#pageContent').innerHTML =
    `<section class="card panel"><div class="panel-heading"><h2>${t('expenseEditor')}</h2></div><p class="subtle">${t('expenseHelp')}</p><form id="expenseForm"><div class="income-fields">${(month?.entries || []).map(expenseRow).join('')}</div><button class="btn" type="button" data-action="addExpenseRow"><span aria-hidden="true">+</span> ${t('addExpense')}</button><aside id="expenseRates" class="income-rates" hidden><h3>${t('rates')}</h3><p class="subtle">${t('expenseSharedRatesHelp')}</p><div id="expenseRateFields" class="income-rate-fields"></div><button class="btn" type="button" data-action="loadExpenseRates">${t('loadRates')}</button><p id="expenseRateStatus" class="subtle" role="status"></p></aside><div class="income-total"><span>${t('monthlyExpenseTotal')}</span><strong id="expenseTotal">${moneyHTML(month?.total_eur_minor || '0')}</strong></div><div class="income-actions"><button class="btn btn-primary" type="submit">${t('saveExpense')}</button><button class="btn btn-danger" type="button" data-action="deleteExpense" ${month ? '' : 'disabled'}>${t('deleteExpense')}</button></div></form></section><section class="card panel"><div class="panel-heading"><h2>${t('expenseHistory')}</h2><span class="subtle">${t('historyRange')}</span></div>${chart(state.expenseHistory, 'expense')}</section>`;
  syncExpenseRates();
  updateExpenseTotals();
  applyAmountVisibility();
}

function readRow(row) {
  const amount = parseMoney(row.querySelector('[data-expense]').value);
  if (amount == null || BigInt(amount) < 0n)
    throw new Error(t('expenseNonnegative'));
  const currency = row.querySelector('[data-expense-currency]').value;
  const rate =
    currency === 'EUR'
      ? '1'
      : parseRate($(`[data-expense-rate="${currency}"]`).value);
  if (!rate) throw new Error(t('invalidRate'));
  return {
    month: state.month,
    name: row.querySelector('[data-expense-name]').value.trim(),
    currency,
    amount_minor: amount,
    rate,
  };
}

function updateExpenseTotals() {
  const form = $('#expenseForm');
  if (!form) return;
  const entries = [];
  let complete = true;
  for (const row of form.querySelectorAll('[data-expense-row]')) {
    try {
      const entry = readRow(row);
      row.querySelector('[data-expense-eur]').innerHTML = moneyHTML(
        expenseTotal([entry]),
      );
      entries.push(entry);
    } catch {
      row.querySelector('[data-expense-eur]').textContent = '—';
      complete = false;
    }
  }
  $('#expenseTotal').innerHTML = complete
    ? moneyHTML(expenseTotal(entries))
    : '—';
}

function addExpenseRow() {
  $('#expenseForm .income-fields').insertAdjacentHTML(
    'beforeend',
    expenseRow(),
  );
  state.dirty = true;
  syncExpenseRates();
  updateExpenseTotals();
  applyAmountVisibility();
  $('#expenseForm [data-expense-row]:last-child [data-expense-name]').focus();
}
function removeExpenseRow(button) {
  button.closest('[data-expense-row]').remove();
  syncExpenseRates();
  state.dirty = true;
  updateExpenseTotals();
}

document.addEventListener('input', (event) => {
  if (event.target.closest('#expenseForm')) updateExpenseTotals();
});
document.addEventListener('change', (event) => {
  if (!event.target.matches('[data-expense-currency]')) return;
  syncExpenseRates();
  state.dirty = true;
  updateExpenseTotals();
});

async function saveExpense(form) {
  const entries = [];
  for (const row of form.querySelectorAll('[data-expense-row]')) {
    try {
      const entry = readRow(row);
      if (!entry.name) throw new Error(t('field_name'));
      entries.push(entry);
    } catch (error) {
      notify(error.message, true);
      return;
    }
  }
  const buttons = [...form.querySelectorAll('button')];
  const disabled = buttons.map((button) => button.disabled);
  buttons.forEach((button) => (button.disabled = true));
  try {
    await request('/expenses/' + state.month, 'PUT', { entries });
    state.dirty = false;
    await renderExpenses();
    notify(t('expenseSaved'));
  } finally {
    buttons.forEach((button, i) => {
      if (button.isConnected) button.disabled = disabled[i];
    });
  }
}

async function deleteExpense() {
  if (
    !(await showConfirm({
      title: t('deleteExpense'),
      message: t('confirmDeleteExpense'),
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
      danger: true,
    }))
  )
    return;
  await request('/expenses/' + state.month, 'PUT', { entries: [] });
  state.dirty = false;
  await renderExpenses();
  notify(t('expenseDeleted'));
}

async function loadExpenseRates(button) {
  const month = state.month;
  const inputs = [...document.querySelectorAll('[data-expense-rate]')];
  if (!inputs.length) return;
  const initial = new Map(inputs.map((input) => [input, input.value]));
  button.disabled = true;
  const saveButton = $('#expenseForm [type="submit"]');
  saveButton.disabled = true;
  const status = $('#expenseRateStatus');
  status.textContent = t('loading');
  try {
    const result = await api(
      '/exchange-rates?month=' + encodeURIComponent(month),
      { cache: 'no-store' },
    );
    if (!button.isConnected || state.month !== month) return;
    let count = 0;
    for (const input of inputs) {
      const rate = result.rates[input.dataset.expenseRate];
      if (input.isConnected && rate && input.value === initial.get(input)) {
        input.value = rate;
        count++;
      }
    }
    if (count) state.dirty = true;
    updateExpenseTotals();
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
  renderExpenses,
  saveExpense,
  deleteExpense,
  loadExpenseRates,
  addExpenseRow,
  removeExpenseRow,
};
