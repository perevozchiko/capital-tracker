const form = document.querySelector('#loginForm');
const error = document.querySelector('#loginError');

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
      }),
    });
    if (!response.ok) {
      error.textContent =
        response.status === 401
          ? 'Incorrect username or password.'
          : response.status === 429
            ? 'Too many sign-in attempts. Try again in a minute.'
            : 'Unable to sign in. Please try again.';
      return;
    }
    form.elements.password.value = '';
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
