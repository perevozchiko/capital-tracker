import { captureView, state } from './state.js';
import { api, request } from './api.js';
import { t } from './messages.js';
import { escapeHTML, moneyHTML, parseMoney, parseRate } from './format.js';
import { $, notify, applyAmountVisibility } from './ui.js';
import { chart } from './chart.js';
import { showConfirm } from './dialogs.js';
import { editEntry } from './entry-editor.js';
import { incomeTotal as expenseTotal } from './income-math.js';
import {
  renderExpenseGroups,
  expenseGroupDialog,
  refreshExpenseGroups,
  readExpenseGroups,
  bindExpenseGroups,
} from './expense-groups.js';

bindExpenseGroups(updateExpenseTotals);

let monthRates = new Map();

function syncExpenseRates() {
  const container = $('#expenseRateFields');
  for (const input of container.querySelectorAll('[data-expense-rate]')) {
    monthRates.set(input.dataset.expenseRate, input.value);
  }
  const used = new Set(
    [...document.querySelectorAll('[data-expense-row]')]
      .map((row) => row.dataset.currency)
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
function expenseRow(entry) {
  return `<div class="account-row income-list-row" data-expense-row draggable="true" data-name="${escapeHTML(entry.name)}" data-currency="${escapeHTML(entry.currency)}" data-amount-minor="${escapeHTML(entry.amount_minor)}">
    <div class="account-main income-list-main"><span class="drag-handle" title="${t('expenseDrag')}" aria-hidden="true">⠿</span><strong data-expense-name>${escapeHTML(entry.name)}</strong><span class="currency-tag">${escapeHTML(entry.currency)}</span></div>
    <div class="account-balance"><strong data-expense-amount>${moneyHTML(entry.amount_minor, entry.currency)}</strong><small>${t('expenseAmount')}</small></div>
    <div class="account-balance"><strong data-expense-eur>—</strong><small>${t('totalEUR')}</small></div>
    <div class="recurring-row-actions"><button class="btn btn-icon" type="button" data-action="editExpenseRow" aria-label="${t('editExpense')}" title="${t('editExpense')}">✎</button><details class="account-actions-menu" name="expense-actions"><summary aria-label="${t('expenseActions')}">⋮</summary><div class="action-menu-content"><label class="menu-move-label">${t('moveToGroup')}<select data-expense-move aria-label="${t('moveToGroup')}"></select></label><button type="button" data-expense-action="rowUp">${t('reorderUp')}</button><button type="button" data-expense-action="rowDown">${t('reorderDown')}</button></div></details><button class="btn btn-icon" type="button" data-action="removeExpenseRow" aria-label="${t('removeExpense')}">×</button></div>
  </div>`;
}

async function renderExpenses() {
  const isCurrentView = captureView();
  const history = await api('/expenses');
  if (!isCurrentView()) return;
  state.expenseHistory = history;
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
    `<section class="card panel"><h2>${t('addExpense')}</h2><p class="caption">${t('expenseAddHelp')}</p><form id="addExpenseForm" class="form-row">
 <div class="field"><label for="expenseName">${t('expenseName')}</label><input id="expenseName" name="name" maxlength="100" required placeholder="${t('expenseNamePlaceholder')}"></div>
 <div class="field"><label for="expenseAmount">${t('expenseAmount')}</label><input id="expenseAmount" name="amount" data-expense type="text" inputmode="decimal" autocomplete="off" required></div>
 <div class="field"><label for="expenseCurrency">${t('currency')}</label><select id="expenseCurrency" name="currency">${state.currencies.map((c) => `<option ${c === 'EUR' ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
 <div class="field"><label for="expenseGroup">${t('group')}</label><select id="expenseGroup" name="group"></select></div>
 <button class="btn btn-primary" type="submit">${t('addExpense')}</button></form></section>
 <section class="card panel"><div class="panel-heading"><h2>${t('expenseEditor')}</h2><button type="button" class="btn btn-small btn-primary" data-expense-action="create">+ ${t('createGroup')}</button></div><p class="subtle">${t('expenseHelp')}</p><p class="caption">${t('expenseGroupsHelp')}</p><form id="expenseForm"><p id="expenseListEmpty" class="caption" ${month?.entries?.length ? 'hidden' : ''}>${t('expenseListEmpty')}</p><div class="income-fields">${renderExpenseGroups(month?.entries || [], month?.groups || [], expenseRow)}</div><aside id="expenseRates" class="income-rates" hidden><h3>${t('rates')}</h3><p class="subtle">${t('expenseSharedRatesHelp')}</p><div id="expenseRateFields" class="income-rate-fields"></div><button class="btn" type="button" data-action="loadExpenseRates">${t('loadRates')}</button><p id="expenseRateStatus" class="subtle" role="status"></p></aside><div class="income-total"><span>${t('monthlyExpenseTotal')}</span><strong id="expenseTotal">${moneyHTML(month?.total_eur_minor || '0')}</strong></div><div class="income-actions"><button class="btn btn-primary" type="submit">${t('saveExpense')}</button><button class="btn btn-danger" type="button" data-action="deleteExpense" ${month ? '' : 'disabled'}>${t('deleteExpense')}</button></div></form></section><section class="card panel"><div class="panel-heading"><h2>${t('expenseHistory')}</h2></div>${chart(state.expenseHistory, 'expense')}</section>${expenseGroupDialog()}`;
  refreshExpenseGroups();
  syncExpenseRates();
  updateExpenseTotals();
  applyAmountVisibility();
}

function readRow(row) {
  const amount = row.dataset.amountMinor;
  const currency = row.dataset.currency;
  const rate =
    currency === 'EUR'
      ? '1'
      : parseRate($(`[data-expense-rate="${currency}"]`).value);
  if (!rate) throw new Error(t('invalidRate'));
  return {
    month: state.month,
    name: row.dataset.name,
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
  for (const group of form.querySelectorAll('[data-expense-group]')) {
    try {
      const members = [...group.querySelectorAll('[data-expense-row]')].map(
        readRow,
      );
      group.querySelector('[data-expense-group-total]').innerHTML = moneyHTML(
        expenseTotal(members),
      );
    } catch {
      group.querySelector('[data-expense-group-total]').textContent = '—';
    }
  }
}

function addExpenseRow(form) {
  const name = form.elements.name.value.trim();
  if (!name) throw new Error(t('field_name'));
  const amount = parseMoney(form.elements.amount.value);
  if (amount == null || BigInt(amount) < 0n)
    throw new Error(t('expenseNonnegative'));
  const group = [...document.querySelectorAll('[data-expense-group]')].find(
    (group) =>
      group.getAttribute('data-expense-group') === form.elements.group.value,
  );
  group.querySelector('[data-expense-group-empty]').insertAdjacentHTML(
    'beforebegin',
    expenseRow({
      name,
      amount_minor: amount,
      currency: form.elements.currency.value,
    }),
  );
  $('#expenseListEmpty').hidden = true;
  state.dirty = true;
  refreshExpenseGroups();
  syncExpenseRates();
  updateExpenseTotals();
  applyAmountVisibility();
  const selectedGroup = form.elements.group.value;
  form.reset();
  form.elements.group.value = selectedGroup;
  form.elements.name.focus();
}
function editExpenseRow(button) {
  editEntry(button, 'expense', updateExpenseTotals);
}

function removeExpenseRow(button) {
  button.closest('[data-expense-row]').remove();
  refreshExpenseGroups();
  $('#expenseListEmpty').hidden = !!$('#expenseForm [data-expense-row]');
  syncExpenseRates();
  state.dirty = true;
  updateExpenseTotals();
}

document.addEventListener('input', (event) => {
  if (event.target.closest('#expenseForm')) updateExpenseTotals();
});

async function saveExpense(form) {
  const isCurrentView = captureView();
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
  const buttons = [
    ...form.querySelectorAll('button'),
    ...document.querySelectorAll('#addExpenseForm button'),
  ];
  const disabled = buttons.map((button) => button.disabled);
  buttons.forEach((button) => (button.disabled = true));
  const addForm = $('#addExpenseForm');
  form.inert = true;
  addForm.inert = true;
  try {
    await request('/expenses/' + state.month, 'PUT', {
      entries,
      groups: readExpenseGroups(),
    });
    if (!isCurrentView()) return;
    state.dirty = false;
    await renderExpenses();
    notify(t('expenseSaved'));
  } finally {
    form.inert = false;
    addForm.inert = false;
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
  await request('/expenses/' + state.month, 'DELETE');
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
  editExpenseRow,
};
