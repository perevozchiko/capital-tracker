// Use the saved preference before painting; default to dark for new users.
try {
  const saved = localStorage.getItem('capital-appearance');
  const appearance =
    saved === 'light' || saved === 'dark'
      ? saved
      : saved === 'system'
        ? matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : 'dark';
  document.documentElement.dataset.theme = appearance;
} catch {
  document.documentElement.dataset.theme = 'dark';
}
