// Apply the cached appearance before painting; the server remains the source of truth.
try {
  const saved = localStorage.getItem('capital-appearance');
  const appearance = saved === 'dark' || saved === 'light'
    ? saved : (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = appearance;
} catch { /* Storage may be disabled. The system theme is used. */ }
