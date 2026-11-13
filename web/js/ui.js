import { state } from './state.js';
import { t } from './messages.js';
import { escapeHTML, monthLabel, money } from './format.js';
import { showConfirm } from './dialogs.js';

const $ = (selector) => document.querySelector(selector);
// Only the phone tab bar uses pictograms; the sidebar is plain text.
const icons = {
  dashboard:
    '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1Z"/>',
  monthly:
    '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  incomes:
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8m-3.5-3.5L12 16l3.5-3.5"/>',
  expenses:
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 16V8m-3.5 3.5L12 8l3.5 3.5"/>',
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
};
// The screens used every month sit in the phone tab bar; the rest stay in the drawer.
const mobileTabs = [
  ['dashboard', 'familyHome'],
  ['monthly', 'familyMonthly'],
  ['incomes', 'navIncomes'],
  ['expenses', 'familyExpenses'],
];
function notify(message, failed = false) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('visible');
  element.classList.toggle('toast-error', failed);
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => element.classList.remove('visible'), 3500);
}
function themeApply() {
  const choice = state.settings.theme;
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme =
    choice === 'system' ? (dark ? 'dark' : 'light') : choice;
  try {
    localStorage.setItem('capital-appearance', choice);
  } catch {}
}
async function confirmClean() {
  if (!state.dirty) return true;
  const discard = await showConfirm({
    title: t('discardChanges'),
    message: t('unsaved'),
    confirmLabel: t('discard'),
    cancelLabel: t('keepEditing'),
    danger: true,
  });
  if (!discard) return false;
  state.dirty = false;
  return true;
}
function monthControls() {
  return `<div class="toolbar"><div class="month-switch"><button class="btn btn-icon" type="button" data-action="monthPrev" aria-label="${t('earlier')}">‹</button><label>${escapeHTML(monthLabel(state.month))}</label><button class="btn btn-icon" type="button" data-action="monthNext" aria-label="${t('later')}">›</button></div><button class="btn" type="button" data-action="monthCurrent">${t('currentMonth')}</button><input class="btn month-picker" type="month" value="${state.month}" min="1900-01" max="2200-12" aria-label="${t('goToMonth')}"></div>`;
}
function statusPill(d) {
  return `<span class="pill ${d.complete ? 'good' : 'bad'}">${d.complete ? t('complete') : t('incomplete')}</span>`;
}
function renderNav() {
  const routes = [
    ['dashboard', 'navDashboard'],
    ['accounts', 'navAccounts'],
    ['monthly', 'navMonthly'],
    ['incomes', 'navIncomes'],
    ['expenses', 'navExpenses'],
    ['recurringExpenses', 'navRecurringExpenses'],
    ['fxRates', 'navFXRates'],
    ['settings', 'navSettings'],
  ];
  $('#navigation').innerHTML = routes
    .map(
      ([key, label]) =>
        `<button class="nav-item ${state.page === key ? 'active' : ''}" data-page="${key}" ${state.page === key ? 'aria-current="page"' : ''}>${t(label)}</button>`,
    )
    .join('');
  const onTab = mobileTabs.some(([key]) => key === state.page);
  $('#mobileBottomNav').innerHTML =
    mobileTabs
      .map(
        ([key, label]) =>
          `<button type="button" class="mobile-bottom-item ${state.page === key ? 'active' : ''}" data-page="${key}" ${state.page === key ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${icons[key]}</svg><span>${t(label)}</span></button>`,
      )
      .join('') +
    `<button type="button" class="mobile-bottom-item ${onTab ? '' : 'active'}" data-action="mobileMore" aria-label="${t('familyMore')}"><svg viewBox="0 0 24 24" aria-hidden="true">${icons.more}</svg><span>${t('familyMore')}</span></button>`;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(
      el.dataset.i18n === 'localOnly' && state.authEnabled
        ? 'privateServer'
        : el.dataset.i18n,
    );
  });
}
function applyAmountVisibility() {
  const hidden = document.documentElement.dataset.hideAmounts === 'true';
  const button = $('#amountVisibility');
  button.setAttribute('aria-pressed', String(hidden));
  button.setAttribute('aria-label', t(hidden ? 'showAmounts' : 'hideAmounts'));
  button.title = t(hidden ? 'showAmounts' : 'hideAmounts');
  document
    .querySelectorAll(
      '[data-balance],[data-income],[data-expense],[data-recurring-expense]',
    )
    .forEach((input) => {
      input.type = hidden ? 'password' : 'text';
    });
  document.querySelectorAll('[data-chart-index]').forEach((node) => {
    const point = (
      node.dataset.chartSource === 'income'
        ? state.incomeHistory
        : node.dataset.chartSource === 'expense'
          ? state.expenseHistory
          : node.dataset.chartSource === 'recurringExpense'
            ? state.recurringExpenseHistory
            : state.history
    )[Number(node.dataset.chartIndex)];
    if (point)
      node.setAttribute(
        'aria-label',
        monthLabel(point.month) +
          (hidden ? '' : ': ' + money(point.total_eur_minor)) +
          (node.dataset.chartDecreased === 'true'
            ? ' · ' + t('chartDecrease')
            : ''),
      );
  });
  $('#chartTooltip').hidden = true;
}
function toggleAmountVisibility() {
  const hidden = document.documentElement.dataset.hideAmounts !== 'true';
  document.documentElement.dataset.hideAmounts = String(hidden);
  applyAmountVisibility();
}
function renderHeader() {
  applyAmountVisibility();
  const names = {
    dashboard: 'navDashboard',
    accounts: 'navAccounts',
    monthly: 'navMonthly',
    incomes: 'navIncomes',
    expenses: 'navExpenses',
    recurringExpenses: 'navRecurringExpenses',
    fxRates: 'navFXRates',
    settings: 'navSettings',
  };
  $('#pageHeading').textContent = t(names[state.page]);
  $('#sectionEyebrow').textContent = t('appName');
  $('#headerActions').innerHTML = [
    'dashboard',
    'monthly',
    'incomes',
    'expenses',
    'recurringExpenses',
    'fxRates',
  ].includes(state.page)
    ? monthControls()
    : state.page === 'accounts'
      ? `${monthControls()}<button class="btn btn-primary" data-action="focusAdd">+ ${t('addAccount')}</button>`
      : '';
  document.documentElement.lang = 'en';
  document.title = `${t(names[state.page])} · Capital Tracker`;
}
function groupVisibilityButtons() {
  return `<button type="button" class="btn btn-small" data-action="groupCollapseAll">${t('collapseAllGroups')}</button><button type="button" class="btn btn-small" data-action="groupExpandAll">${t('expandAllGroups')}</button>`;
}
function emptyStart() {
  return `<div class="card empty"><h2>${t('welcome')}</h2><p>${t('welcomeBody')}</p><button type="button" class="btn btn-primary" data-page="accounts">+ ${t('addAccount')}</button></div>`;
}

export {
  $,
  notify,
  themeApply,
  toggleAmountVisibility,
  applyAmountVisibility,
  confirmClean,
  statusPill,
  renderNav,
  renderHeader,
  emptyStart,
  groupVisibilityButtons,
};
