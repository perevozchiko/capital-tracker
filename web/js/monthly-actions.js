import { state } from './state.js';
import { api, request } from './api.js';
import { t } from './messages.js';
import { rateText, parseMoney, parseRate } from './format.js';
import { $, notify } from './ui.js';
import { render, refresh } from './router.js';

async function loadRates(button) {
  const month = state.month;
  const inputs = [...document.querySelectorAll('[data-rate]')];
  const initial = new Map(inputs.map((input) => [input, input.value]));
  const saveButton = $('[data-action="saveMonth"]');
  button.disabled = true;
  if (saveButton) saveButton.disabled = true;
  const status = $('#rateLoadStatus');
  status.textContent = t('loading');
  try {
    const result = await api(
      '/exchange-rates?month=' + encodeURIComponent(month),
      { cache: 'no-store' },
    );
    if (
      state.page !== 'monthly' ||
      state.month !== month ||
      !button.isConnected
    )
      return;
    let count = 0;
    for (const input of inputs) {
      const rate = result.rates[input.dataset.rate];
      if (
        input.isConnected &&
        input.value === initial.get(input) &&
        !input.value.trim() &&
        rate
      ) {
        input.value = rateText(rate);
        input.classList.remove('invalid');
        input.removeAttribute('aria-invalid');
        count++;
      }
    }
    if (count) state.dirty = true;
    status.textContent = t('ratesLoaded')
      .replace('{date}', result.date)
      .replace('{count}', count);
  } catch (err) {
    if (button.isConnected) status.textContent = t('ratesLoadFailed');
  } finally {
    if (button.isConnected) button.disabled = false;
    if (saveButton?.isConnected) saveButton.disabled = false;
  }
}
async function saveMonth() {
  const inputs = [...document.querySelectorAll('[data-balance],[data-rate]')];
  const balances = [],
    rates = [];
  let bad = false;
  for (const el of inputs) {
    el.classList.remove('invalid');
    try {
      if (el.dataset.balance) {
        const v = parseMoney(el.value);
        if (v != null)
          balances.push({
            account_id: Number(el.dataset.balance),
            amount_minor: v,
          });
      }
      if (el.dataset.rate) {
        const v = parseRate(el.value);
        if (v != null) rates.push({ currency: el.dataset.rate, rate: v });
      }
    } catch (e) {
      el.classList.add('invalid');
      el.setAttribute('aria-invalid', 'true');
      notify(e.message, true);
      bad = true;
    }
  }
  if (bad) return;
  const buttons = [
    ...document.querySelectorAll(
      '[data-action="saveMonth"],[data-action="loadRates"]',
    ),
  ];
  buttons.forEach((button) => (button.disabled = true));
  try {
    await request('/months/' + state.month, 'PUT', { balances, rates });
    state.dirty = false;
    await refresh();
    await render();
    notify(t(state.monthData?.complete ? 'saved' : 'savedIncomplete'));
  } catch (e) {
    notify(t('endpointError') + ' ' + e.message, true);
  } finally {
    buttons.forEach((button) => {
      if (button.isConnected) button.disabled = false;
    });
  }
}

export { loadRates, saveMonth };
