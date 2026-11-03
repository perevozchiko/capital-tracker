import { api, request } from './api.js';
import { state } from './state.js';
import { escapeHTML } from './format.js';
import { $, confirmClean } from './ui.js';
import { t } from './messages.js';

const pendingKey = 'capital-update-pending';
let snapshot = null;
let busy = false;
let timer;
let message = '';
let monitoringMessage = '';
let disconnected = false;
const stages = {
  queued: 'Queued',
  build: 'Building release',
  test: 'Running tests',
  backup: 'Creating backup',
  sqlite_check: 'Checking SQLite',
  switch: 'Switching application',
  health_check: 'Checking application health',
  rollback: 'Restoring previous version and database',
};
const results = {
  succeeded: 'Update completed.',
  rolled_back:
    'Update failed. The previous version and database were restored.',
  failed: 'Update failed before switching the application.',
  recovery_required:
    'The update result could not be verified. Check the host updater before trying again.',
};
function pendingInfo() {
  try {
    return JSON.parse(localStorage.getItem(pendingKey) || 'null');
  } catch {
    return null;
  }
}
function remember(value) {
  try {
    if (value) {
      if (pendingInfo()?.id !== value)
        localStorage.setItem(
          pendingKey,
          JSON.stringify({ id: value, since: Date.now() }),
        );
    } else localStorage.removeItem(pendingKey);
  } catch {}
}
export function updatePending() {
  return !!pendingInfo();
}
function canUpdate() {
  const target = snapshot?.release?.version;
  const current = state.settings.version;
  if (!target || !current) return false;
  const a = target.split('.').map(Number);
  const b = current.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return current.includes('-');
}
export function renderUpdatePanel() {
  const panel = $('#appUpdates');
  if (!panel) return;
  const op = snapshot?.operation;
  const running = op?.status === 'running';
  const blocked = op?.status === 'recovery_required';
  let detail = message || monitoringMessage;
  if (disconnected)
    detail = updatePending()
      ? 'Reconnecting to the application. The host update continues.'
      : t('update_unavailable');
  if (!detail && running) detail = stages[op.stage] || 'Updating application';
  if (
    !detail &&
    op?.status === 'succeeded' &&
    state.settings.version === op.target_version
  )
    detail = `Update completed. Version v${op.target_version} confirmed.`;
  if (!detail && op) detail = results[op.status] || '';
  panel.innerHTML = `<p>Current version: v${escapeHTML(state.settings.version)}</p>
    <p>Available stable version: ${snapshot?.release ? 'v' + escapeHTML(snapshot.release.version) : 'Not checked'}</p>
    <p class="caption">Updates start only when you click Update.</p>
    ${snapshot?.enabled === false ? '<p class="caption">Host update agent is not configured. Updates are unavailable.</p>' : ''}
    <div class="data-tools">
      <button type="button" class="btn" data-action="checkUpdate" ${!snapshot?.enabled || busy || running || blocked ? 'disabled' : ''}>Check for updates</button>
      <button type="button" class="btn btn-primary" data-action="startUpdate" ${!snapshot?.enabled || busy || running || blocked || !canUpdate() ? 'disabled' : ''}>Update</button>
    </div>
    <p role="status" aria-live="polite">${escapeHTML(detail)}</p>
    ${op ? `<ol>${(op.stages || []).map((stage) => `<li>${escapeHTML(stages[stage] || stage)}</li>`).join('')}</ol>` : ''}`;
}
async function freshAssets() {
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('capital-tracker-'))
        .map((key) => caches.delete(key)),
    );
  }
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.race([
      Promise.all(registrations.map((reg) => reg.update().catch(() => {}))),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(monitorUpdates, 2000);
}
export async function monitorUpdates() {
  clearTimeout(timer);
  try {
    snapshot = await api('/update/status', {
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    disconnected = false;
    monitoringMessage = '';
    const op = snapshot.operation;
    const pending = pendingInfo();
    if (
      op?.status === 'running' ||
      (op && [op.id, op.request_id].includes(pending?.id))
    )
      message = '';
    if (op?.status === 'running') remember(op.id);
    if (op && ['running', 'succeeded', 'rolled_back'].includes(op.status)) {
      const meta = await api('/meta', {
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      });
      if (
        meta.version !== state.settings.version ||
        meta.commit !== state.buildCommit
      ) {
        if (state.dirty) {
          monitoringMessage =
            'The application restarted. Save your changes to reconnect.';
          schedule();
          return;
        }
        remember(op.id);
        try {
          await freshAssets();
        } catch {
          // Storage restrictions must not prevent fetching the new application.
        }
        location.reload();
        return;
      }
      if (op.status === 'succeeded' && meta.version !== op.target_version) {
        monitoringMessage =
          'Waiting for the updated application version to respond.';
        schedule();
        return;
      }
    }
    if (op && op.status !== 'running') remember('');
    if (!op && pending && Date.now() - pending.since > 60000) {
      remember('');
      message ||=
        'No host update operation was accepted. Check the agent and try again.';
    }
    if (op?.status === 'running' || (updatePending() && !op)) schedule();
  } catch {
    disconnected = true;
    if (updatePending() || snapshot?.operation?.status === 'running')
      schedule();
  } finally {
    renderUpdatePanel();
  }
}
export async function checkUpdate() {
  if (busy) return;
  busy = true;
  message = 'Checking the latest stable GitHub Release…';
  renderUpdatePanel();
  try {
    snapshot = await request('/update/check', 'POST', {});
    message = canUpdate()
      ? ''
      : 'You are using the latest stable version or a newer version.';
  } catch (error) {
    message = error.message;
  } finally {
    busy = false;
    if (snapshot?.operation?.status === 'running') await monitorUpdates();
    else renderUpdatePanel();
  }
}
export async function startUpdate() {
  if (
    busy ||
    !snapshot?.enabled ||
    !canUpdate() ||
    ['running', 'recovery_required'].includes(snapshot?.operation?.status)
  )
    return;
  busy = true;
  renderUpdatePanel();
  try {
    if (!(await confirmClean())) return;
    // Record before sending: a lost response must be recovered by status, never
    // by automatically repeating POST /start.
    const requestID = crypto.randomUUID();
    remember(requestID);
    message = 'Starting update…';
    const response = await request('/update/start', 'POST', {
      target_version: snapshot.release.version,
      request_id: requestID,
    });
    snapshot = response;
    message = '';
  } catch (error) {
    message = error.message;
    if ([400, 409].includes(error.status)) remember('');
  } finally {
    busy = false;
    await monitorUpdates();
  }
}

window.addEventListener('storage', (event) => {
  if (event.key === pendingKey) void monitorUpdates();
});
