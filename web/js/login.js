const form = document.querySelector('#loginForm');
const error = document.querySelector('#loginError');
const twoFactorStep = document.querySelector('#twoFactorStep');
const code = document.querySelector('#loginCode');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  error.textContent = '';
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Capital-Tracker': '1' },
      body: JSON.stringify({
        username: form.elements.username.value,
        password: form.elements.password.value,
        remember: form.elements.remember.checked,
        code: code.value,
        trust_device: form.elements.trustDevice.checked,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (
        data.error?.code === 'two_factor_required' ||
        data.error?.code === 'invalid_two_factor_code'
      ) {
        twoFactorStep.hidden = false;
        code.required = true;
        code.value = '';
        button.textContent = 'Confirm and sign in';
        code.focus();
        if (data.error.code === 'invalid_two_factor_code')
          error.textContent =
            'Invalid or already used code. Try the next code from your authenticator app.';
        return;
      }
      error.textContent =
        response.status === 401
          ? 'Incorrect username or password.'
          : response.status === 429
            ? 'Too many sign-in attempts. Try again in a minute.'
            : 'Unable to sign in. Please try again.';
      return;
    }
    // Keep the submitted fields intact until navigation so password managers
    // can offer to save them and provide Face ID/Touch ID AutoFill next time.
    location.replace('/');
  } catch {
    error.textContent =
      'Unable to connect. Check your connection and try again.';
  } finally {
    button.disabled = false;
  }
});

// Replace earlier workers and remove cached application pages before sign-in.
if ('serviceWorker' in navigator)
  navigator.serviceWorker.register('/sw.js').catch(() => {});

window.addEventListener('pageshow', async (event) => {
  if (event.persisted) location.reload();
});

// A test instance announces itself before sign-in; /api/meta is public.
fetch('/api/meta', { cache: 'no-store' })
  .then((response) => (response.ok ? response.json() : {}))
  .then((meta) => {
    if (!meta.label) return;
    const marker = document.querySelector('#instanceLabel');
    marker.textContent = meta.label;
    marker.hidden = false;
    document.title = `[${meta.label}] ${document.title}`;
  })
  .catch(() => {});
