import { state } from './state.js';
import { api, request } from './api.js';
import { $, confirmClean } from './ui.js';

export async function checkLogin(onLogin) {
  const status = await api('/auth/status');
  state.authEnabled = status.enabled;
  $('#logoutButton').hidden = !status.enabled;
  document.body.classList.toggle('signed-out', !status.authenticated);
  if (status.authenticated) return true;
  $('#pageContent').innerHTML =
    `<section class="card panel login-panel"><h1>Capital Tracker</h1><p>Sign in to your finances</p><form id="loginForm"><div class="field"><label for="loginUsername">Username</label><input id="loginUsername" name="username" autocomplete="username" maxlength="100" required></div><div class="field"><label for="loginPassword">Password</label><input id="loginPassword" name="password" type="password" autocomplete="current-password" required></div><p id="loginError" role="alert"></p><button class="btn btn-primary" type="submit">Sign in</button></form></section>`;
  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    button.disabled = true;
    $('#loginError').textContent = '';
    try {
      await request('/auth/login', 'POST', {
        username: form.elements.username.value,
        password: form.elements.password.value,
      });
      form.elements.password.value = '';
      await onLogin();
    } catch (error) {
      $('#loginError').textContent = error.message;
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  return false;
}

export async function logout() {
  if (!(await confirmClean())) return;
  await request('/auth/logout', 'POST', {});
  location.reload();
}
