import { t } from './messages.js';
import { state } from './state.js';

// Several screens ask for the same data while a render is still in flight
// (for example, quick consecutive tab changes). Share that one request, but
// never keep a finished response: data can change in another tab or on
// another device, and every navigation must show what the server has now.
const inFlight = new Map();

function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const shareable =
    method === 'GET' &&
    options.cache !== 'no-store' &&
    !path.startsWith('/auth/');
  const key = state.snapshotID + ':' + path;
  if (shareable && inFlight.has(key)) return inFlight.get(key);
  // A read that started before a write must not answer readers after it.
  if (method !== 'GET') inFlight.clear();

  const pending = fetchAPI(path, options, method);
  if (shareable) {
    inFlight.set(key, pending);
    const done = () => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    };
    pending.then(done, done);
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
