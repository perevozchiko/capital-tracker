import { t } from './messages.js';
import { state } from './state.js';
async function api(path, options = {}) {
  const preview = state.snapshotID && !path.startsWith('/auth/');
  if (preview && options.method && options.method !== 'GET') {
    throw new Error(t('backup_read_only'));
  }
  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(preview ? { 'X-Capital-Tracker-Snapshot': state.snapshotID } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.method && options.method !== 'GET'
        ? { 'X-Capital-Tracker': '1' }
        : {}),
      ...options.headers,
    },
  });
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) {
    location.reload();
    throw new Error(t('unauthorized'));
  }
  if (!res.ok) {
    const error = data.error || {};
    const failure = new Error(
      (error.reason && t('reason_' + error.reason)) ||
        (error.field && t('field_' + error.field)) ||
        t(error.code) ||
        t('error'),
    );
    failure.status = res.status;
    throw failure;
  }
  return data;
}
const request = (path, method, payload) =>
  api(path, { method, body: JSON.stringify(payload) });

export { api, request };
