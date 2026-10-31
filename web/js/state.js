const state = {
  page: 'dashboard',
  renderID: 0,
  month: new Date().toLocaleDateString('sv-SE').slice(0, 7),
  accounts: [],
  months: [],
  history: [],
  incomeHistory: [],
  expenseHistory: [],
  recurringExpenseHistory: [],
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

// Late responses must not replace a newer screen or clear its unsaved edits.
export function captureView() {
  const { page, month, renderID } = state;
  return () =>
    state.page === page && state.month === month && state.renderID === renderID;
}
