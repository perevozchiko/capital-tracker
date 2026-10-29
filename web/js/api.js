import { t } from './messages.js';
async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.method && options.method !== 'GET'
        ? { 'X-Capital-Tracker': '1' }
        : {}),
      ...options.headers,
    },
  });
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = data.error || {};
    throw new Error(
      (error.reason && t('reason_' + error.reason)) ||
        (error.field && t('field_' + error.field)) ||
        t(error.code) ||
        t('error'),
    );
  }
  return data;
}
const request = (path, method, payload) =>
  api(path, { method, body: JSON.stringify(payload) });

export { api, request };
