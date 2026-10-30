import { state, collapsedGroups } from './state.js';
import { api } from './api.js';
import { t } from './messages.js';
import { $, notify, confirmClean, themeApply } from './ui.js';
import { showConfirm, showTypedConfirm } from './dialogs.js';
import { render, refresh } from './router.js';

async function exportJSON() {
  try {
    const snapshot = await api('/data/export');
    const file = new Blob([JSON.stringify(snapshot, null, 2) + '\n'], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download =
      'capital-tracker-' +
      new Date().toISOString().replace(/[:.]/g, '-') +
      '.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(t('jsonExported'));
  } catch (err) {
    notify(err.message || t('error'), true);
  }
}
async function importJSON(file) {
  if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error(t('json_too_large'));
    const body = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error(t('invalidJSONFile'));
    }
    if (
      parsed?.format !== 'capital-tracker' ||
      ![1, 2, 3, 4].includes(parsed.schema_version) ||
      !Array.isArray(parsed.accounts) ||
      !Array.isArray(parsed.months)
    ) {
      throw new Error(t('invalidJSONFile'));
    }
    if (!(await confirmClean())) return;
    const approved = await showConfirm({
      title: t('confirmImportTitle'),
      message: t('confirmImportMessage')
        .replace('{accounts}', String(parsed.accounts.length))
        .replace('{months}', String(parsed.months.length)),
      confirmLabel: t('importJSON'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (!approved) return;
    await api('/data/import', {
      method: 'POST',
      headers: { 'X-Capital-Tracker-Import': 'replace' },
      body,
    });
    state.settings = await api('/settings');
    themeApply();
    collapsedGroups.clear();
    try {
      localStorage.removeItem('capital-collapsed-groups');
    } catch {}
    await refresh();
    state.month =
      state.history.filter((p) => p.complete).at(-1)?.month ||
      state.months.at(-1)?.month ||
      new Date().toLocaleDateString('sv-SE').slice(0, 7);
    state.dirty = false;
    await render();
    notify(t('jsonImported'));
  } catch (err) {
    notify(err.message || t('error'), true);
  }
}

async function clearAllData() {
  if (!(await confirmClean())) return;
  const phrase = t('clearDataPhrase');
  const approved = await showTypedConfirm({
    title: t('clearDataTitle'),
    message: t('clearDataWarning'),
    prompt: t('clearDataPrompt').replace('{phrase}', phrase),
    phrase,
    confirmLabel: t('clearAllData'),
    cancelLabel: t('cancel'),
  });
  if (!approved) return;
  await api('/data/clear', {
    method: 'POST',
    headers: { 'X-Capital-Tracker-Clear': 'DELETE' },
    body: JSON.stringify({ confirm: 'DELETE' }),
  });
  state.settings = await api('/settings');
  themeApply();
  collapsedGroups.clear();
  try {
    localStorage.removeItem('capital-collapsed-groups');
  } catch {}
  await refresh();
  state.page = 'dashboard';
  state.month = new Date().toLocaleDateString('sv-SE').slice(0, 7);
  state.monthData = null;
  state.dashboard = null;
  state.dirty = false;
  state.selectedAccount = null;
  await render();
  notify(t('dataCleared'));
}

export { exportJSON, importJSON, clearAllData };
