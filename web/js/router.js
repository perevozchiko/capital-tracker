import { state } from './state.js';
import { api } from './api.js';
import { t } from './messages.js';
import { validMonth } from './format.js';
import { $, notify, confirmClean, renderNav, renderHeader } from './ui.js';
import { renderDashboard } from './dashboard.js';
import { renderAccounts } from './accounts.js';
import { renderMonthly } from './monthly.js';
import { renderIncomes } from './incomes.js';
import { renderExpenses } from './expenses.js';
import { renderSettings } from './settings.js';

async function navigate(page) {
  if (!(await confirmClean())) return;
  state.page = page;
  state.selectedAccount = null;
  render().catch((e) => notify(e.message, true));
  $('#sidebar').classList.remove('show');
}
async function setMonth(month) {
  if (!validMonth(month)) {
    notify(t('monthLimit'), true);
    return false;
  }
  if (!(await confirmClean())) return false;
  state.month = month;
  await render();
  return true;
}
async function render() {
  renderNav();
  renderHeader();
  if (state.page === 'dashboard') await renderDashboard();
  else if (state.page === 'accounts') await renderAccounts();
  else if (state.page === 'monthly') await renderMonthly();
  else if (state.page === 'incomes') await renderIncomes();
  else if (state.page === 'expenses') await renderExpenses();
  else renderSettings();
}
async function refresh() {
  const [accounts, months, history, currencies] = await Promise.all([
    api('/accounts'),
    api('/months'),
    api('/capital/history'),
    api('/currencies'),
  ]);
  state.accounts = accounts;
  state.months = months;
  state.history = history.points;
  state.currencies = currencies.currencies;
}
async function mutation(done) {
  try {
    await done();
    await refresh();
    await render();
  } catch (e) {
    notify(e.message || t('error'), true);
  }
}

export { navigate, setMonth, render, refresh, mutation };
