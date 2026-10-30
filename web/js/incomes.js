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
import { incomeTotal } from './income-math.js';

let rowSequence = 0;
function incomeRow(entry = {}) {
  const id = ++rowSequence;
  const currency = entry.currency || 'EUR';
  return `<div class="income-row" data-income-row>
    <label for="income-name-${id}">${t('incomeName')}<input id="income-name-${id}" class="editor-input" data-income-name maxlength="100" value="${escapeHTML(entry.name || '')}" placeholder="${t('incomeNamePlaceholder')}"></label>
    <label for="income-amount-${id}">${t('incomeAmount')}<input id="income-amount-${id}" class="editor-input" data-income type="text" inputmode="decimal" autocomplete="off" value="${escapeHTML(minorToInput(entry.amount_minor))}"></label>
    <label for="income-currency-${id}">${t('currency')}<select id="income-currency-${id}" class="editor-input" data-income-currency>${state.currencies.map((c) => `<option ${c === currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <label for="income-rate-${id}" data-income-rate-label ${currency === 'EUR' ? 'hidden' : ''}><span>1 EUR = <span data-rate-currency>${currency}</span></span><input id="income-rate-${id}" class="editor-input" data-income-rate inputmode="decimal" value="${escapeHTML(currency === 'EUR' ? '1' : entry.rate || '')}"></label>
    <div class="income-equivalent"><span class="subtle">${t('totalEUR')}</span><strong data-income-eur>—</strong></div>
    <button class="btn btn-icon" type="button" data-action="removeIncomeRow" aria-label="${t('removeIncome')}">×</button>
  </div>`;
}

async function renderIncomes() {
  state.incomeHistory = await api('/incomes');
  const month = state.incomeHistory.find((m) => m.month === state.month);
  $('#pageContent').innerHTML =
    `<section class="card panel"><div class="panel-heading"><h2>${t('incomeEditor')}</h2></div><p class="subtle">${t('incomeHelp')}</p><form id="incomeForm"><div class="income-fields">${(month?.entries || []).map(incomeRow).join('')}</div><button class="btn" type="button" data-action="addIncomeRow"><span aria-hidden="true">+</span> ${t('addIncome')}</button><div class="income-total"><span>${t('monthlyIncomeTotal')}</span><strong id="incomeTotal">${moneyHTML(month?.total_eur_minor || '0')}</strong></div><div class="income-actions"><button class="btn btn-primary" type="submit">${t('saveIncome')}</button><button class="btn" type="button" data-action="loadIncomeRates">${t('loadRates')}</button><button class="btn btn-danger" type="button" data-action="deleteIncome" ${month ? '' : 'disabled'}>${t('deleteIncome')}</button></div><p id="incomeRateStatus" class="subtle" role="status"></p></form></section><section class="card panel"><div class="panel-heading"><h2>${t('incomeHistory')}</h2><span class="subtle">${t('historyRange')}</span></div>${chart(state.incomeHistory, 'income')}</section>`;
  updateIncomeTotals();
  applyAmountVisibility();
}

function readRow(row) {
  const amount = parseMoney(row.querySelector('[data-income]').value);
  if (amount == null || BigInt(amount) < 0n)
    throw new Error(t('incomeNonnegative'));
  const currency = row.querySelector('[data-income-currency]').value;
  const rate =
    currency === 'EUR'
      ? '1'
      : parseRate(row.querySelector('[data-income-rate]').value);
  if (!rate) throw new Error(t('invalidRate'));
  return {
    month: state.month,
    name: row.querySelector('[data-income-name]').value.trim(),
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

function addIncomeRow() {
  $('#incomeForm .income-fields').insertAdjacentHTML('beforeend', incomeRow());
  state.dirty = true;
  updateIncomeTotals();
  applyAmountVisibility();
  $('#incomeForm [data-income-row]:last-child [data-income-name]').focus();
}
function removeIncomeRow(button) {
  button.closest('[data-income-row]').remove();
  state.dirty = true;
  updateIncomeTotals();
}

document.addEventListener('input', (event) => {
  if (event.target.closest('#incomeForm')) updateIncomeTotals();
});
document.addEventListener('change', (event) => {
  if (!event.target.matches('[data-income-currency]')) return;
  const row = event.target.closest('[data-income-row]');
  const currency = event.target.value;
  row.querySelector('[data-income-rate-label]').hidden = currency === 'EUR';
  row.querySelector('[data-rate-currency]').textContent = currency;
  row.querySelector('[data-income-rate]').value = currency === 'EUR' ? '1' : '';
  state.dirty = true;
  updateIncomeTotals();
});

async function saveIncome(form) {
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
  const buttons = [...form.querySelectorAll('button')];
  const disabled = buttons.map((button) => button.disabled);
  buttons.forEach((button) => (button.disabled = true));
  try {
    await request('/incomes/' + state.month, 'PUT', { entries });
    state.dirty = false;
    await renderIncomes();
    notify(t('incomeSaved'));
  } finally {
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
  const inputs = [...document.querySelectorAll('[data-income-rate]')].filter(
    (input) =>
      input.closest('[data-income-row]').querySelector('[data-income-currency]')
        .value !== 'EUR',
  );
  if (!inputs.length) return;
  const initial = new Map(
    inputs.map((input) => [
      input,
      {
        value: input.value,
        currency: input
          .closest('[data-income-row]')
          .querySelector('[data-income-currency]').value,
      },
    ]),
  );
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
      const previous = initial.get(input);
      const currency = input
        .closest('[data-income-row]')
        .querySelector('[data-income-currency]').value;
      const rate = result.rates[currency];
      if (
        input.isConnected &&
        rate &&
        currency === previous.currency &&
        input.value === previous.value
      ) {
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
