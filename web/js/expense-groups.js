import { createEntryGroups } from './entry-groups.js';

const groups = createEntryGroups({
  prefix: 'expense',
  row: 'expense-row',
  groupClass: 'expense-group',
  form: 'expenseForm',
  ids: 'expenseGroup',
  messages: {
    dropHere: 'expenseDropHere',
    single: 'expenseSingle',
    count: 'expenseCount',
    deleteWarning: 'expenseDeleteGroupWarning',
  },
});

export const renderExpenseGroups = groups.render;
export const expenseGroupDialog = groups.dialog;
export const refreshExpenseGroups = groups.refresh;
export const readExpenseGroups = groups.read;
export const bindExpenseGroups = groups.bind;
