import { state } from './state.js';
import { api, request } from './api.js';
import { $, confirmClean } from './ui.js';

export async function checkLogin() {
  const status = await api('/auth/status');
  state.authEnabled = status.enabled;
  $('#logoutButton').hidden = !status.enabled;
  if (status.authenticated) return true;
  location.replace('/');
  return false;
}

export async function logout() {
  if (!(await confirmClean())) return;
  await request('/auth/logout', 'POST', {});
  location.reload();
}
