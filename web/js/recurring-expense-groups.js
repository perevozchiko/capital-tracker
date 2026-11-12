import { createEntryGroups } from './entry-groups.js';

const groups = createEntryGroups({
  prefix: 'recurring',
  row: 'recurring-expense-row',
  groupClass: 'recurring-expense-group',
  form: 'recurringExpenseForm',
  ids: 'recurringExpenseGroup',
  messages: {
    dropHere: 'recurringExpenseDropHere',
    single: 'recurringExpenseSingle',
    count: 'recurringExpenseCount',
    deleteWarning: 'recurringExpenseDeleteGroupWarning',
  },
});

export const renderRecurringExpenseGroups = groups.render;
export const recurringExpenseGroupDialog = groups.dialog;
export const refreshRecurringExpenseGroups = groups.refresh;
export const readRecurringExpenseGroups = groups.read;
export const bindRecurringExpenseGroups = groups.bind;
