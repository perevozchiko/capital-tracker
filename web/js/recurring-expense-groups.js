import { state } from './state.js';
import { t } from './messages.js';
import { escapeHTML, moneyHTML } from './format.js';
import { $ } from './ui.js';
import { showConfirm } from './dialogs.js';

let nextGroupKey = 0;
let changed = () => {};
const groups = () => [...document.querySelectorAll('[data-recurring-group]')];
const rows = (root) => [
  ...root.querySelectorAll('[data-recurring-expense-row]'),
];
const editable = () =>
  !state.snapshotID &&
  $('#recurringExpenseForm') &&
  !$('#recurringExpenseForm').inert;
const collapsed = new Set();

function groupHTML(name, key, content) {
  const ungrouped = key === '';
  const closed = collapsed.has(name);
  return `<section class="account-group recurring-expense-group${closed ? ' is-collapsed' : ''}" data-recurring-group="${key}" data-name="${escapeHTML(name)}">
    <div class="account-group-head" data-recurring-group-header draggable="${!ungrouped}">
      <button type="button" class="group-toggle" data-action="recurringGroupToggle" data-recurring-action="toggle" aria-expanded="${!closed}" aria-label="${t('toggleGroup')}">${closed ? '▸' : '▾'}</button>
      <div class="group-caption"><strong>${escapeHTML(name)}</strong><small data-recurring-group-count></small></div>
      <div class="group-total"><strong data-recurring-group-total>${moneyHTML('0')}</strong><small>${t('groupTotalEUR')}</small></div>
      <div class="group-controls">${ungrouped ? '' : `<details class="account-actions-menu" name="recurring-actions"><summary aria-label="${t('groupActions')}">⋮</summary><div class="action-menu-content"><button type="button" data-recurring-action="groupUp">${t('reorderUp')}</button><button type="button" data-recurring-action="groupDown">${t('reorderDown')}</button><button type="button" data-recurring-action="rename">${t('rename')}</button><button type="button" class="menu-danger" data-recurring-action="delete">${t('delete')}</button></div></details>`}</div>
    </div>
    <div class="account-group-body" data-recurring-group-body>${content}<p class="group-empty" data-recurring-group-empty>${t('recurringExpenseDropHere')}</p></div>
  </section>`;
}

export function renderRecurringExpenseGroups(entries, savedGroups, renderRow) {
  nextGroupKey = 0;
  const assigned = new Set();
  const html = savedGroups
    .map((group) => {
      const content = group.entry_positions
        .map((position) => {
          assigned.add(position);
          return renderRow(entries[position]);
        })
        .join('');
      return groupHTML(group.name, String(++nextGroupKey), content);
    })
    .join('');
  return (
    html +
    groupHTML(
      t('ungrouped'),
      '',
      entries
        .filter((_, index) => !assigned.has(index))
        .map(renderRow)
        .join(''),
    )
  );
}

export function recurringExpenseGroupDialog() {
  return `<dialog id="recurringExpenseGroupDialog" class="app-dialog" aria-labelledby="recurringExpenseGroupTitle"><form id="recurringExpenseGroupForm"><div class="dialog-heading"><h2 id="recurringExpenseGroupTitle"></h2></div><div class="dialog-fields"><label for="recurringExpenseGroupName">${t('groupName')}</label><input id="recurringExpenseGroupName" name="name" maxlength="100" required></div><div class="dialog-actions"><button class="btn" type="button" data-recurring-action="cancel">${t('cancel')}</button><button class="btn btn-primary" type="submit">${t('confirm')}</button></div></form></dialog>`;
}

export function refreshRecurringExpenseGroups() {
  const panels = groups();
  const options = panels
    .map(
      (group) =>
        `<option value="${group.dataset.recurringGroup}">${escapeHTML(group.dataset.name)}</option>`,
    )
    .join('');
  for (const select of document.querySelectorAll(
    '#recurringExpenseGroup, [data-recurring-move]',
  )) {
    const selected = select.matches('[data-recurring-move]')
      ? select.closest('[data-recurring-group]').dataset.recurringGroup
      : select.value;
    select.innerHTML = options;
    select.value = selected;
    if (select.selectedIndex === -1) select.value = '';
  }
  for (const [index, group] of panels.entries()) {
    const members = rows(group);
    group.querySelector('[data-recurring-group-count]').textContent =
      members.length === 1
        ? t('recurringExpenseSingle')
        : t('recurringExpenseCount').replace('{count}', members.length);
    group.querySelector('[data-recurring-group-empty]').hidden =
      members.length > 0;
    for (const [action, disabled] of [
      ['groupUp', index === 0],
      ['groupDown', index === panels.length - 2],
    ]) {
      const button = group.querySelector(`[data-recurring-action="${action}"]`);
      if (button) button.disabled = disabled;
    }
    members.forEach((row, position) => {
      row.querySelector('[data-recurring-action="rowUp"]').disabled =
        position === 0;
      row.querySelector('[data-recurring-action="rowDown"]').disabled =
        position === members.length - 1;
    });
  }
}

export function readRecurringExpenseGroups() {
  const positions = new Map(
    rows($('#recurringExpenseForm')).map((row, position) => [row, position]),
  );
  return groups()
    .filter((group) => group.dataset.recurringGroup !== '')
    .map((group) => ({
      name: group.dataset.name,
      entry_positions: rows(group).map((row) => positions.get(row)),
    }));
}

function onChanged() {
  state.dirty = true;
  refreshRecurringExpenseGroups();
  changed();
}

function showEditor(group) {
  const dialog = $('#recurringExpenseGroupDialog');
  dialog.dataset.key = group?.dataset.recurringGroup || '';
  $('#recurringExpenseGroupTitle').textContent = t(
    group ? 'renameGroup' : 'createGroup',
  );
  $('#recurringExpenseGroupName').value = group?.dataset.name || '';
  $('#recurringExpenseGroupName').setCustomValidity('');
  dialog.showModal();
  $('#recurringExpenseGroupName').focus();
}

function moveRow(row, target, after = false) {
  if (row === target) return;
  const body =
    target.closest('[data-recurring-group-body]') ||
    target.querySelector('[data-recurring-group-body]');
  if (!body) return;
  if (target.matches('[data-recurring-expense-row]'))
    target[after ? 'after' : 'before'](row);
  else
    body.insertBefore(row, body.querySelector('[data-recurring-group-empty]'));
}

export function bindRecurringExpenseGroups(onChange) {
  changed = onChange;
  document.addEventListener('mousedown', (event) => {
    const button = event.target.closest(
      '.recurring-expense-group .action-menu-content button',
    );
    if (!button || !editable()) return;
    // Keep Safari from blurring the menu before the click reaches its button.
    event.preventDefault();
    button.focus({ preventScroll: true });
  });
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-recurring-action]');
    if (!button) return;
    const action = button.dataset.recurringAction;
    const group = button.closest('[data-recurring-group]');
    if (action === 'toggle') {
      const closed = group.classList.toggle('is-collapsed');
      button.textContent = closed ? '▸' : '▾';
      button.setAttribute('aria-expanded', String(!closed));
      if (closed) collapsed.add(group.dataset.name);
      else collapsed.delete(group.dataset.name);
      return;
    }
    if (!editable()) return;
    button.closest('details')?.removeAttribute('open');
    if (action === 'create' || action === 'rename') showEditor(group);
    else if (action === 'cancel') $('#recurringExpenseGroupDialog').close();
    else if (action === 'delete') {
      const form = $('#recurringExpenseForm');
      if (
        !(await showConfirm({
          title: t('deleteGroup'),
          message: t('recurringExpenseDeleteGroupWarning'),
          confirmLabel: t('delete'),
          cancelLabel: t('cancel'),
          danger: true,
        }))
      )
        return;
      if (!form.isConnected || !editable()) return;
      const ungrouped = groups().at(-1);
      rows(group).forEach((row) => moveRow(row, ungrouped));
      group.remove();
      onChanged();
    } else if (action === 'groupUp' || action === 'groupDown') {
      const panels = groups();
      const target =
        panels[panels.indexOf(group) + (action === 'groupUp' ? -1 : 1)];
      if (!target || target.dataset.recurringGroup === '') return;
      target[action === 'groupUp' ? 'before' : 'after'](group);
      onChanged();
    } else if (action === 'rowUp' || action === 'rowDown') {
      const row = button.closest('[data-recurring-expense-row]');
      const members = rows(group);
      const target =
        members[members.indexOf(row) + (action === 'rowUp' ? -1 : 1)];
      if (target) {
        moveRow(row, target, action === 'rowDown');
        onChanged();
      }
    }
  });
  document.addEventListener('submit', (event) => {
    if (event.target.id !== 'recurringExpenseGroupForm') return;
    event.preventDefault();
    if (!editable()) return;
    const input = $('#recurringExpenseGroupName');
    const name = input.value.trim();
    const dialog = $('#recurringExpenseGroupDialog');
    const group = groups().find(
      (group) =>
        group.dataset.recurringGroup === dialog.dataset.key &&
        dialog.dataset.key !== '',
    );
    if (!name) {
      input.setCustomValidity(t('field_name'));
      input.reportValidity();
      return;
    }
    if (
      groups().some(
        (item) =>
          item !== group &&
          item.dataset.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      input.setCustomValidity(t('reason_group_name_exists'));
      input.reportValidity();
      return;
    }
    if (group) {
      if (collapsed.delete(group.dataset.name)) collapsed.add(name);
      group.dataset.name = name;
      group.querySelector('.group-caption strong').textContent = name;
    } else {
      groups()
        .at(-1)
        .insertAdjacentHTML(
          'beforebegin',
          groupHTML(name, String(++nextGroupKey), ''),
        );
    }
    onChanged();
    if (!group) $('#recurringExpenseGroup').value = String(nextGroupKey);
    dialog.close();
  });
  document.addEventListener('input', (event) => {
    if (event.target.id === 'recurringExpenseGroupName')
      event.target.setCustomValidity('');
  });
  document.addEventListener('click', (event) => {
    if (event.target.id === 'recurringExpenseGroupDialog') event.target.close();
  });
  document.addEventListener('change', (event) => {
    const select = event.target.closest('[data-recurring-move]');
    if (!select || !editable()) return;
    const target = groups().find(
      (group) => group.dataset.recurringGroup === select.value,
    );
    if (target) {
      moveRow(select.closest('[data-recurring-expense-row]'), target);
      onChanged();
    }
  });

  let dragging = null;
  const clear = () => {
    dragging = null;
    document
      .querySelectorAll(
        '.recurring-expense-group .dragging,.recurring-expense-group.drag-over,.recurring-expense-group .drag-over',
      )
      .forEach((node) => node.classList.remove('dragging', 'drag-over'));
  };
  document.addEventListener('dragstart', (event) => {
    if (
      !editable() ||
      event.target.closest('button,select,input,summary,.account-actions-menu')
    )
      return;
    const row = event.target.closest('[data-recurring-expense-row]');
    const header = event.target.closest(
      '[data-recurring-group-header][draggable="true"]',
    );
    if (row) dragging = { kind: 'row', node: row };
    else if (header)
      dragging = {
        kind: 'group',
        node: header.closest('[data-recurring-group]'),
      };
    else return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', 'recurring-expense');
    dragging.node.classList.add('dragging');
  });
  document.addEventListener('dragover', (event) => {
    if (!dragging || !editable()) return;
    const target = event.target.closest(
      '[data-recurring-expense-row],[data-recurring-group]',
    );
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    document
      .querySelectorAll(
        '.recurring-expense-group.drag-over,.recurring-expense-group .drag-over',
      )
      .forEach((node) => node.classList.remove('drag-over'));
    target.classList.add('drag-over');
  });
  document.addEventListener('drop', (event) => {
    if (!dragging || !editable()) return;
    const target = event.target.closest(
      dragging.kind === 'group'
        ? '[data-recurring-group]'
        : '[data-recurring-expense-row],[data-recurring-group]',
    );
    if (!target) {
      clear();
      return;
    }
    event.preventDefault();
    const rect = (
      dragging.kind === 'group'
        ? target.querySelector('[data-recurring-group-header]')
        : target
    ).getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    if (dragging.kind === 'row') moveRow(dragging.node, target, after);
    else if (target !== dragging.node) {
      if (target.dataset.recurringGroup === '') target.before(dragging.node);
      else target[after ? 'after' : 'before'](dragging.node);
    }
    clear();
    onChanged();
  });
  document.addEventListener('dragend', clear);
}
