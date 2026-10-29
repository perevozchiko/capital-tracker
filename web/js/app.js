import { state } from './state.js';
import { api, request } from './api.js';
import { t } from './messages.js';
import {
  escapeHTML,
  monthLabel,
  nextMonth,
  money,
  minorToInput,
} from './format.js';
import { $, notify, themeApply } from './ui.js';
import { showConfirm } from './dialogs.js';
import { navigate, setMonth, render, refresh, mutation } from './router.js';
import { updateBalanceDifference } from './monthly.js';
import { exportJSON, importJSON, clearAllData } from './data-actions.js';
import { loadRates, saveMonth } from './monthly-actions.js';
import {
  saveAssignments,
  orderedAssignments,
  groupAction,
  accountAction,
  submitAccountEdit,
  bindAccountDragAndDrop,
  moveAccountIn,
} from './account-actions.js';

bindAccountDragAndDrop();

window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => {
    if (state.settings.theme === 'system') themeApply();
  });
window.addEventListener('beforeunload', (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
document.addEventListener('click', async (e) => {
  const node = e.target.closest('[data-page],[data-action]');
  if (!node) return;
  const page = node.dataset.page;
  if (page) {
    await navigate(page);
    return;
  }
  const action = node.dataset.action,
    id = Number(node.dataset.id);
  try {
    if (action === 'monthPrev') await setMonth(nextMonth(state.month, -1));
    else if (action === 'monthNext') await setMonth(nextMonth(state.month, 1));
    else if (action === 'selectColumn') await setMonth(node.dataset.month);
    else if (action === 'focusAdd') {
      $('#accountName')?.focus();
    } else if (action === 'toggleGroup' || action?.startsWith('group'))
      await groupAction(
        action,
        Number(node.dataset.groupId),
        node.dataset.groupKey,
      );
    else if (action === 'exportJSON') await exportJSON();
    else if (action === 'importJSON') $('#jsonFileInput')?.click();
    else if (action === 'clearAllData') await clearAllData();
    else if (action === 'copyPrevious') {
      const input = document.querySelector(`[data-balance="${id}"]`);
      if (!input || input.dataset.previousMinor === '') return;
      input.value = minorToInput(input.dataset.previousMinor);
      input.classList.remove('invalid');
      input.removeAttribute('aria-invalid');
      state.dirty = true;
      updateBalanceDifference(input);
      input.focus();
    } else if (action === 'loadRates') await loadRates(node);
    else if (action === 'saveMonth') await saveMonth();
    else if (action === 'deleteMonth') {
      if (
        !state.monthData?.exists ||
        !(await showConfirm({
          title: t('deleteMonth'),
          message: t('confirmDeleteMonth'),
          confirmLabel: t('delete'),
          cancelLabel: t('cancel'),
          danger: true,
        }))
      )
        return;
      await request('/months/' + state.month, 'DELETE', { confirm: true });
      await refresh();
      state.month = state.months.at(-1)?.month || state.month;
      await render();
      notify(t('monthDeleted'));
    } else if (id) await accountAction(action, id);
  } catch (err) {
    notify(err.message || t('error'), true);
  }
});
document.addEventListener('submit', async (e) => {
  if (e.target.id === 'editAccountForm') {
    e.preventDefault();
    await submitAccountEdit(e.target);
    return;
  }
  if (e.target.id !== 'addAccountForm') return;
  e.preventDefault();
  const form = e.target;
  await mutation(async () => {
    await request('/accounts', 'POST', {
      name: form.elements.name.value,
      currency: form.elements.currency.value,
      start_month: form.elements.start.value,
      group_id: form.elements.group.value
        ? Number(form.elements.group.value)
        : null,
    });
    notify(t('accountCreated'));
  });
});
document.addEventListener('input', (e) => {
  if (e.target.matches('.editor-input')) {
    state.dirty = true;
    e.target.classList.remove('invalid');
    e.target.removeAttribute('aria-invalid');
    if (e.target.matches('[data-balance]')) updateBalanceDifference(e.target);
  }
});
document.addEventListener('change', async (e) => {
  if (e.target.id === 'jsonFileInput') {
    const file = e.target.files?.[0];
    e.target.value = '';
    await importJSON(file);
    return;
  }
  if (e.target.matches('[data-move-account]')) {
    const id = Number(e.target.dataset.moveAccount),
      group = e.target.value ? Number(e.target.value) : null;
    try {
      const items = moveAccountIn(orderedAssignments(), id, group);
      if (items) await saveAssignments(items);
    } catch (err) {
      notify(err.message || t('error'), true);
      await render();
    }
    return;
  }
  if (e.target.classList.contains('month-picker')) {
    const changed = await setMonth(e.target.value);
    if (!changed && e.target.isConnected) e.target.value = state.month;
    return;
  }
  if (e.target.id === 'columnCount') {
    state.columnCount = Number(e.target.value);
    await render();
    return;
  }
  if (e.target.id === 'themeSelect') {
    const language = 'en';
    const theme = e.target.value;
    try {
      state.settings = await request('/settings', 'PATCH', { language, theme });
      themeApply();
      await render();
    } catch (err) {
      notify(err.message, true);
      await render();
    }
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const opened = document.querySelector('.account-actions-menu[open]');
  if (opened) {
    e.preventDefault();
    opened.open = false;
    opened.querySelector('summary')?.focus();
  }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.account-actions-menu'))
    document
      .querySelectorAll('.account-actions-menu[open]')
      .forEach((m) => (m.open = false));
  else if (e.target.closest('.action-menu-content button'))
    e.target.closest('.account-actions-menu').open = false;
});
$('#cancelEdit').addEventListener('click', () => $('#accountDialog').close());
$('#accountDialog').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});
$('#mobileMenu').addEventListener('click', () =>
  $('#sidebar').classList.toggle('show'),
);
function pointTooltip(node, event) {
  const p = state.history[Number(node.dataset.chartIndex)];
  if (!p) return;
  const tooltip = $('#chartTooltip');
  tooltip.textContent = `${monthLabel(p.month)} · ${money(p.total_eur_minor)}`;
  tooltip.hidden = false;
  const rect = node.getBoundingClientRect();
  const clientX = event?.clientX || rect.left + rect.width / 2;
  const clientY = event?.clientY || rect.top;
  tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - 200, clientX - 80))}px`;
  tooltip.style.top = `${Math.max(8, clientY - 45)}px`;
}
document.addEventListener('pointerover', (e) => {
  const n = e.target.closest('[data-chart-index]');
  if (n) pointTooltip(n, e);
});
document.addEventListener('pointermove', (e) => {
  const n = e.target.closest('[data-chart-index]');
  if (n) pointTooltip(n, e);
});
document.addEventListener('pointerout', (e) => {
  if (e.target.closest('[data-chart-index]')) $('#chartTooltip').hidden = true;
});
document.addEventListener('focusin', (e) => {
  if (e.target.matches('[data-chart-index]')) pointTooltip(e.target);
});
document.addEventListener('focusout', (e) => {
  if (e.target.matches('[data-chart-index]')) $('#chartTooltip').hidden = true;
});
async function boot() {
  try {
    const [settings, metadata] = await Promise.all([
      api('/settings'),
      api('/meta'),
    ]);
    state.settings = settings;
    state.buildCommit = metadata.commit || 'unknown';
    themeApply();
    await refresh();
    const lastComplete = state.history.filter((x) => x.complete).at(-1);
    if (lastComplete) state.month = lastComplete.month;
    else if (state.months.length)
      state.month = state.months[state.months.length - 1].month;
    await render();
    if ('serviceWorker' in navigator)
      navigator.serviceWorker.register('/sw.js').catch(() => {});
  } catch (e) {
    $('#pageContent').innerHTML =
      `<div class="card empty"><h2>${t('error')}</h2><p>${escapeHTML(e.message)}</p><button class="btn" id="retryBtn">${t('retry')}</button></div>`;
    $('#retryBtn')?.addEventListener('click', boot);
  }
}
boot();
