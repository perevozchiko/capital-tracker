import { t } from './messages.js';
import { state } from './state.js';

// Screens often need the same immutable data (for example, returning to a
// tab or rendering while another render is in flight). Keep it in memory for
// this page only: starting a write invalidates the whole cache, so a saved
// balance or account change is visible immediately everywhere.
const readCache = new Map();

function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const cacheable =
    method === 'GET' &&
    options.cache !== 'no-store' &&
    !path.startsWith('/auth/');
  const cacheKey = state.snapshotID + ':' + path;
  if (cacheable && readCache.has(cacheKey)) return readCache.get(cacheKey);
  if (method !== 'GET') readCache.clear();

  const pending = fetchAPI(path, options, method);
  if (cacheable) {
    // Cache the promise as well as its value. This coalesces requests made by
    // quick consecutive tab changes instead of starting duplicate fetches.
    readCache.set(cacheKey, pending);
    pending.catch(() => readCache.delete(cacheKey));
  }
  return pending;
}

async function fetchAPI(path, options, method) {
  const preview = state.snapshotID && !path.startsWith('/auth/');
  if (preview && method !== 'GET') {
    throw new Error(t('backup_read_only'));
  }
  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(preview ? { 'X-Capital-Tracker-Snapshot': state.snapshotID } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-Capital-Tracker': '1' } : {}),
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
