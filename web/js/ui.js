import { state } from './state.js';
import { t } from './messages.js';
import { escapeHTML, monthLabel, money } from './format.js';
import { showConfirm } from './dialogs.js';

const $ = (selector) => document.querySelector(selector);
const icons = {
  dashboard:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  accounts:
    '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>',
  monthly:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 15h3"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.2-1.7l2-1.5-2-3.5-2.4 1A7 7 0 0 0 14 5l-.4-2.5h-4L9.2 5a7 7 0 0 0-2.4 1.3l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 3.4l-2 1.5 2 3.5 2.4-1A7 7 0 0 0 9.2 19l.4 2.5h4L14 19a7 7 0 0 0 2.4-1.3l2.4 1 2-3.5-2-1.5A7 7 0 0 0 19 12Z"/>',
};
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
  return `<div class="toolbar"><div class="month-switch"><button class="btn btn-icon" type="button" data-action="monthPrev" aria-label="${t('earlier')}">‹</button><label>${escapeHTML(monthLabel(state.month))}</label><button class="btn btn-icon" type="button" data-action="monthNext" aria-label="${t('later')}">›</button></div><input class="btn month-picker" type="month" value="${state.month}" min="1900-01" max="2200-12" aria-label="${t('goToMonth')}"></div>`;
}
function statusPill(d) {
  return `<span class="pill ${d.complete ? 'good' : 'bad'}">${d.complete ? t('complete') : t('incomplete')}</span>`;
}
function renderNav() {
  const routes = [
    ['dashboard', 'navDashboard'],
    ['accounts', 'navAccounts'],
    ['monthly', 'navMonthly'],
    ['settings', 'navSettings'],
  ];
  $('#navigation').innerHTML = routes
    .map(
      ([key, label]) =>
        `<button class="nav-item ${state.page === key ? 'active' : ''}" data-page="${key}"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[key]}</svg><span>${t(label)}</span></button>`,
    )
    .join('');
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
}
function applyAmountVisibility() {
  const hidden = document.documentElement.dataset.hideAmounts === 'true';
  const button = $('#amountVisibility');
  button.setAttribute('aria-pressed', String(hidden));
  button.setAttribute('aria-label', t(hidden ? 'showAmounts' : 'hideAmounts'));
  button.title = t(hidden ? 'showAmounts' : 'hideAmounts');
  document.querySelectorAll('[data-balance]').forEach((input) => {
    input.type = hidden ? 'password' : 'text';
  });
  document.querySelectorAll('[data-chart-index]').forEach((node) => {
    const point = state.history[Number(node.dataset.chartIndex)];
    if (point)
      node.setAttribute(
        'aria-label',
        monthLabel(point.month) +
          (hidden ? '' : ': ' + money(point.total_eur_minor)),
      );
  });
  $('#chartTooltip').hidden = true;
}
function toggleAmountVisibility() {
  const hidden = document.documentElement.dataset.hideAmounts !== 'true';
  document.documentElement.dataset.hideAmounts = String(hidden);
  try {
    localStorage.setItem('capital-hide-amounts', String(hidden));
  } catch {}
  applyAmountVisibility();
}
function renderHeader() {
  applyAmountVisibility();
  const names = {
    dashboard: 'navDashboard',
    accounts: 'navAccounts',
    monthly: 'navMonthly',
    settings: 'navSettings',
  };
  $('#pageHeading').textContent = t(names[state.page]);
  $('#sectionEyebrow').textContent = t('appName');
  $('#headerActions').innerHTML = ['dashboard', 'monthly'].includes(state.page)
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
  return `<div class="card empty"><div class="welcome-symbol">◈</div><h2>${t('welcome')}</h2><p>${t('welcomeBody')}</p><button type="button" class="btn btn-primary" data-page="accounts">+ ${t('addAccount')}</button></div>`;
}

export {
  $,
  notify,
  themeApply,
  toggleAmountVisibility,
  confirmClean,
  statusPill,
  renderNav,
  renderHeader,
  emptyStart,
  groupVisibilityButtons,
};
