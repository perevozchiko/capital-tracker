// Local calendar month as YYYY-MM (sv-SE formats dates as ISO).
const currentMonth = () => new Date().toLocaleDateString('sv-SE').slice(0, 7);
const state = {
  snapshotID:
    new URLSearchParams(globalThis.location?.search || '').get('backup') || '',
  snapshot: null,
  page: 'dashboard',
  renderID: 0,
  month: currentMonth(),
  accounts: [],
  months: [],
  history: [],
  incomeHistory: [],
  expenseHistory: [],
  recurringExpenseHistory: [],
  settings: { language: 'en', theme: 'dark', version: '' },
  buildCommit: 'unknown',
  instanceLabel: '',
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

export { state, collapsedGroups, currentMonth };

// Late responses must not replace a newer screen or clear its unsaved edits.
export function captureView() {
  const { page, month, renderID } = state;
  return () =>
    state.page === page && state.month === month && state.renderID === renderID;
}
