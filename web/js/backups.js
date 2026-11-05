import { state } from './state.js';
import { api } from './api.js';
import { t } from './messages.js';
import { escapeHTML } from './format.js';
import { $, notify, confirmClean } from './ui.js';
import { showConfirm } from './dialogs.js';

let busy = false;
const dateLabel = (value) => new Date(value).toLocaleString();
const previewActions = new Set([
  'exitBackup',
  'previewBackup',
  'reloadBackups',
  'exportJSON',
  'exportCSV',
  'exportExcel',
  'logout',
  'toggleAmounts',
  'monthPrev',
  'monthNext',
  'monthCurrent',
  'history',
  'toggleGroup',
  'groupCollapseAll',
  'groupExpandAll',
  'recurringGroupToggle',
]);

export const backupActionAllowed = (action) => previewActions.has(action);

export async function loadBackupPreview() {
  if (!state.snapshotID) return;
  const status = await api('/backups');
  state.snapshot = status.backups.find(
    (backup) => backup.id === state.snapshotID,
  );
  if (!state.snapshot) throw new Error(t('backup_not_found'));
  applyBackupPreview();
}

export function applyBackupPreview() {
  if (!state.snapshotID) return;
  const banner = $('#backupBanner');
  banner.hidden = false;
  banner.innerHTML = `<div><strong>${t('backupPreview')}${state.snapshot ? ' · ' + escapeHTML(dateLabel(state.snapshot.created_at)) : ''}</strong><p>${t('backupPreviewHelp')}</p></div><button type="button" class="btn btn-primary" data-action="exitBackup">${t('returnToCurrent')}</button>`;
  document
    .querySelectorAll(
      '#pageContent input, #pageContent select, #pageContent button, #headerActions button',
    )
    .forEach((control) => {
      if (control.closest('.history-chart') || control.matches('.month-picker'))
        return;
      if (
        control.matches('[data-action]') &&
        backupActionAllowed(control.dataset.action)
      )
        return;
      control.disabled = true;
      control.title = t('backup_read_only');
    });
  document
    .querySelectorAll('[draggable="true"]')
    .forEach((node) => (node.draggable = false));
  document
    .querySelectorAll(
      '#addAccountForm, #addIncomeForm, #addExpenseForm, #addRecurringExpenseForm',
    )
    .forEach((form) => {
      form.closest('section').hidden = true;
    });
}

export async function renderBackupPanel() {
  const panel = $('#backupPanel');
  if (!panel) return;
  try {
    const status = await api('/backups');
    if ($('#backupPanel') !== panel) return;
    const next = status.next_at ? dateLabel(status.next_at) : t('backupSoon');
    panel.innerHTML = `<div class="panel-heading"><h2>${t('backups')}</h2><span class="pill">${status.backups.length} / ${status.limit}</span></div>
      <p class="caption">${t('backupsHelp')}</p>
      <p class="caption">${t('nextBackup')}: ${escapeHTML(next)}</p>
      <p class="caption">${t('backupOfflineHelp')}</p>
      ${status.last_error ? `<p class="backup-error" role="alert">${t('backup_failed')}</p>` : ''}
      <div class="data-tools"><button type="button" class="btn btn-primary" data-action="createBackup" ${state.snapshotID || busy ? 'disabled' : ''}>${t('createBackup')}</button><button type="button" class="btn" data-action="reloadBackups">${t('refreshBackups')}</button></div>
      ${state.snapshotID ? `<p class="caption">${t('backupRestoreFromCurrent')}</p>` : ''}
      <div class="backup-list" role="list" aria-label="${t('backups')}">${status.backups.length ? status.backups.map((backup) => `<div class="backup-row" role="listitem"><div><strong><time datetime="${escapeHTML(backup.created_at)}">${escapeHTML(dateLabel(backup.created_at))}</time></strong><p class="caption">${t('backupKind_' + backup.kind)} · ${Math.max(1, Math.ceil(backup.size / 1024)).toLocaleString()} KiB${backup.id === state.snapshotID ? ' · ' + t('backupViewing') : ''}</p></div><div class="data-tools"><button type="button" class="btn btn-small" data-action="previewBackup" data-backup-id="${escapeHTML(backup.id)}" ${backup.id === state.snapshotID ? 'disabled' : ''}>${t('viewBackup')}</button>${state.snapshotID ? '' : `<button type="button" class="btn btn-small" data-action="restoreBackup" data-backup-id="${escapeHTML(backup.id)}">${t('restoreBackup')}</button>`}</div></div>`).join('') : `<p class="caption">${t('backupsEmpty')}</p>`}</div>`;
    applyBackupPreview();
  } catch (error) {
    if ($('#backupPanel') !== panel) return;
    panel.innerHTML = `<h2>${t('backups')}</h2><p role="alert">${escapeHTML(error.message)}</p><button type="button" class="btn" data-action="reloadBackups">${t('retry')}</button>`;
  }
}

export async function createBackup(button) {
  if (busy || state.snapshotID) return;
  busy = true;
  button.disabled = true;
  try {
    await api('/backups', { method: 'POST' });
    notify(t('backupCreated'));
  } finally {
    busy = false;
    await renderBackupPanel();
  }
}

export async function previewBackup(id) {
  if (busy || !(await confirmClean())) return;
  location.assign('/?backup=' + encodeURIComponent(id));
}

export async function restoreBackup(id, button) {
  if (busy || state.snapshotID || !(await confirmClean())) return;
  busy = true;
  try {
    const status = await api('/backups');
    const backup = status.backups.find((item) => item.id === id);
    if (!backup) throw new Error(t('backup_not_found'));
    if (
      !(await showConfirm({
        title: t('restoreBackup'),
        message: t('restoreBackupConfirm').replace(
          '{date}',
          dateLabel(backup.created_at),
        ),
        confirmLabel: t('restoreBackup'),
        cancelLabel: t('cancel'),
        danger: true,
      }))
    )
      return;
    button.disabled = true;
    await api('/backups/' + encodeURIComponent(id) + '/restore', {
      method: 'POST',
      headers: { 'X-Capital-Tracker-Restore': 'replace' },
    });
    location.assign('/?restored=1');
  } finally {
    busy = false;
    if (button.isConnected) button.disabled = false;
  }
}
