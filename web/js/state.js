const state = {
  page: 'dashboard',
  month: new Date().toLocaleDateString('sv-SE').slice(0, 7),
  accounts: [],
  months: [],
  history: [],
  incomeHistory: [],
  settings: { language: 'en', theme: 'dark', version: '' },
  buildCommit: 'unknown',
  currencies: [],
  monthData: null,
  dashboard: null,
  dirty: false,
  selectedAccount: null,
};
const collapsedGroups = new Set(
  (() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem('capital-collapsed-groups') || '[]',
      );
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  })(),
);

export { state, collapsedGroups };
