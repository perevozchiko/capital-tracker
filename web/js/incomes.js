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

async function renderIncomes() {
  state.incomeHistory = await api('/incomes');
  const month = state.incomeHistory.find((m) => m.month === state.month);
  const entries = new Map(
    (month?.entries || []).map((entry) => [entry.currency, entry]),
  );
  $('#pageContent').innerHTML =
    `<section class="card panel"><div class="panel-heading"><h2>${t('incomeEditor')}</h2><span id="incomeTotal">${moneyHTML(month?.total_eur_minor)}</span></div><p class="subtle">${t('incomeHelp')}</p><form id="incomeForm"><div class="income-fields">${state.currencies
      .map((currency) => {
        const entry = entries.get(currency);
        return `<div class="income-row"><label for="income-${currency}">${t('incomeAmount')} · ${currency}</label><input id="income-${currency}" class="editor-input" data-income="${currency}" type="text" inputmode="decimal" autocomplete="off" value="${escapeHTML(minorToInput(entry?.amount_minor))}" placeholder="${t('notEntered')}">${currency === 'EUR' ? `<span class="subtle">1 EUR = 1 EUR</span>` : `<label for="income-rate-${currency}">1 EUR = <input id="income-rate-${currency}" class="editor-input" data-income-rate="${currency}" type="text" inputmode="decimal" autocomplete="off" value="${escapeHTML(entry?.rate || '')}" aria-label="${t('enterRate')} ${currency}"> ${currency}</label>`}</div>`;
      })
      .join(
        '',
      )}</div><div class="income-actions"><button class="btn btn-primary" type="submit">${t('saveIncome')}</button><button class="btn" type="button" data-action="loadIncomeRates">${t('loadRates')}</button><button class="btn btn-danger" type="button" data-action="deleteIncome" ${month ? '' : 'disabled'}>${t('deleteIncome')}</button></div><p id="incomeRateStatus" class="subtle" role="status"></p></form></section><section class="card panel"><div class="panel-heading"><h2>${t('incomeHistory')}</h2><span class="subtle">${t('historyRange')}</span></div>${chart(state.incomeHistory, 'income')}</section>`;
  applyAmountVisibility();
}

async function saveIncome(form) {
  const entries = [];
  let bad = false;
  for (const input of form.querySelectorAll('[data-income]')) {
    const currency = input.dataset.income;
    const rateInput = form.querySelector(`[data-income-rate="${currency}"]`);
    for (const el of [input, rateInput].filter(Boolean)) {
      el.classList.remove('invalid');
      el.removeAttribute('aria-invalid');
    }
    let field = input;
    try {
      const amount = parseMoney(input.value);
      if (amount == null) continue;
      if (BigInt(amount) < 0n) throw new Error(t('incomeNonnegative'));
      field = rateInput || input;
      const rate = currency === 'EUR' ? '1' : parseRate(rateInput.value);
      if (!rate) throw new Error(t('invalidRate'));
      entries.push({
        month: state.month,
        currency,
        amount_minor: amount,
        rate,
      });
    } catch (error) {
      field.classList.add('invalid');
      field.setAttribute('aria-invalid', 'true');
      if (!bad) {
        field.focus();
        notify(error.message, true);
      }
      bad = true;
    }
  }
  if (bad) return;
  const buttons = [...form.querySelectorAll('button')];
  const disabled = buttons.map((button) => button.disabled);
  buttons.forEach((button) => (button.disabled = true));
  try {
    await request('/incomes/' + state.month, 'PUT', { entries });
    state.dirty = false;
    await renderIncomes();
    notify(t('incomeSaved'));
  } finally {
    buttons.forEach((button, index) => {
      if (button.isConnected) button.disabled = disabled[index];
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
      if (rate && input.value === initial.get(input)) {
        input.value = rate;
        input.classList.remove('invalid');
        input.removeAttribute('aria-invalid');
        count++;
      }
    }
    if (count) state.dirty = true;
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

export { renderIncomes, saveIncome, deleteIncome, loadIncomeRates };
