import { state } from './state.js';
import { t } from './messages.js';
import {
  escapeHTML,
  minorToInput,
  moneyHTML,
  monthLabel,
  parseMoney,
} from './format.js';
import { applyAmountVisibility } from './ui.js';

// Edit a draft row; the page's Save button persists the selected month's snapshot.
export function editEntry(button, kind, updateTotals) {
  const attribute = kind.replace(
    /[A-Z]/g,
    (letter) => '-' + letter.toLowerCase(),
  );
  const row = button.closest(`[data-${attribute}-row]`);
  const form = row?.closest('form');
  if (state.snapshotID || !form || form.inert) return;
  if (document.getElementById('entryEditDialog')) return;
  button.closest('details')?.removeAttribute('open');

  const month = state.month;
  const dialog = document.createElement('dialog');
  dialog.id = 'entryEditDialog';
  dialog.className = 'app-dialog';
  dialog.setAttribute('aria-labelledby', 'entryEditTitle');
  dialog.setAttribute('aria-describedby', 'entryEditHelp');
  dialog.innerHTML = `<form id="entryEditForm">
    <div class="dialog-heading"><h2 id="entryEditTitle">${t('edit' + kind[0].toUpperCase() + kind.slice(1))}</h2></div>
    <div class="dialog-fields">
      <p class="caption" id="entryEditHelp">${t(kind === 'recurringExpense' ? 'editRecurringExpenseHelp' : 'editMonthlyEntryHelp').replace('{month}', escapeHTML(monthLabel(month)))}</p>
      <label for="entryEditName">${t(kind + 'Name')}</label>
      <input id="entryEditName" name="name" maxlength="100" required value="${escapeHTML(row.dataset.name)}">
      <label for="entryEditAmount">${t(kind + 'Amount')} · ${escapeHTML(row.dataset.currency)}</label>
      <input id="entryEditAmount" name="amount" type="text" inputmode="decimal" autocomplete="off" required value="${minorToInput(row.dataset.amountMinor)}">
    </div>
    <div class="dialog-actions"><button class="btn" type="button" data-entry-edit-cancel>${t('cancel')}</button><button class="btn btn-primary" type="submit">${t('confirm')}</button></div>
  </form>`;
  const nameInput = dialog.querySelector('[name="name"]');
  const amountInput = dialog.querySelector('[name="amount"]');
  dialog.addEventListener('input', (event) =>
    event.target.setCustomValidity(''),
  );
  dialog.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (
      state.snapshotID ||
      !row.isConnected ||
      form.inert ||
      state.month !== month
    ) {
      dialog.close();
      return;
    }
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.setCustomValidity(t('field_name'));
      nameInput.reportValidity();
      return;
    }
    let amount;
    try {
      amount = parseMoney(amountInput.value);
      if (amount == null || BigInt(amount) < 0n)
        throw new Error(t(kind + 'Nonnegative'));
    } catch (error) {
      amountInput.setCustomValidity(error.message);
      amountInput.reportValidity();
      return;
    }
    if (name !== row.dataset.name || amount !== row.dataset.amountMinor) {
      row.dataset.name = name;
      row.dataset.amountMinor = amount;
      row.querySelector(`[data-${attribute}-name]`).textContent = name;
      row.querySelector(`[data-${attribute}-amount]`).innerHTML = moneyHTML(
        amount,
        row.dataset.currency,
      );
      state.dirty = true;
      updateTotals();
      applyAmountVisibility();
    }
    dialog.close();
  });
  dialog
    .querySelector('[data-entry-edit-cancel]')
    .addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
  nameInput.focus();
}
