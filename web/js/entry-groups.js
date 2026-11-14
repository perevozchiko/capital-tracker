import { state } from './state.js';
import { t } from './messages.js';
import { escapeHTML, moneyHTML } from './format.js';
import { $ } from './ui.js';
import { showConfirm } from './dialogs.js';

// Monthly entry groups shared by recurring and major expenses. Each page keeps
// its own attribute prefix, so their DOM hooks and drag state never overlap.
export function createEntryGroups({
  prefix,
  row,
  groupClass,
  form,
  ids,
  messages,
}) {
  const groupAttr = `data-${prefix}-group`;
  const actionAttr = `data-${prefix}-action`;
  const moveAttr = `data-${prefix}-move`;
  const rowSelector = `[data-${row}]`;
  const groupSelector = `[${groupAttr}]`;
  const keyOf = (node) => node.getAttribute(groupAttr);
  let nextGroupKey = 0;
  let changed = () => {};
  const groups = () => [...document.querySelectorAll(groupSelector)];
  const rows = (root) => [...root.querySelectorAll(rowSelector)];
  const editable = () =>
    !state.snapshotID && $('#' + form) && !$('#' + form).inert;
  const collapsed = new Set();

  function groupHTML(name, key, content) {
    const ungrouped = key === '';
    const closed = collapsed.has(name);
    return `<section class="account-group entry-group ${groupClass}${closed ? ' is-collapsed' : ''}" ${groupAttr}="${key}" data-name="${escapeHTML(name)}">
    <div class="account-group-head" ${groupAttr}-header draggable="${!ungrouped}">
      <button type="button" class="group-toggle" data-action="${prefix}GroupToggle" ${actionAttr}="toggle" aria-expanded="${!closed}" aria-label="${t('toggleGroup')}">${closed ? '▸' : '▾'}</button>
      <div class="group-caption"><strong>${escapeHTML(name)}</strong><small ${groupAttr}-count></small></div>
      <div class="group-total"><strong ${groupAttr}-total>${moneyHTML('0')}</strong><small>${t('groupTotalEUR')}</small></div>
      <div class="group-controls">${ungrouped ? '' : `<details class="account-actions-menu" name="${prefix}-actions"><summary aria-label="${t('groupActions')}">⋮</summary><div class="action-menu-content"><button type="button" ${actionAttr}="groupUp">${t('reorderUp')}</button><button type="button" ${actionAttr}="groupDown">${t('reorderDown')}</button><button type="button" ${actionAttr}="rename">${t('rename')}</button><button type="button" class="menu-danger" ${actionAttr}="delete">${t('delete')}</button></div></details>`}</div>
    </div>
    <div class="account-group-body" ${groupAttr}-body>${content}<p class="group-empty" ${groupAttr}-empty>${t(messages.dropHere)}</p></div>
  </section>`;
  }

  function render(entries, savedGroups, renderRow) {
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

  function dialog() {
    return `<dialog id="${ids}Dialog" class="app-dialog" aria-labelledby="${ids}Title"><form id="${ids}Form"><div class="dialog-heading"><h2 id="${ids}Title"></h2></div><div class="dialog-fields"><label for="${ids}Name">${t('groupName')}</label><input id="${ids}Name" name="name" maxlength="100" required></div><div class="dialog-actions"><button class="btn" type="button" ${actionAttr}="cancel">${t('cancel')}</button><button class="btn btn-primary" type="submit">${t('confirm')}</button></div></form></dialog>`;
  }

  function refresh() {
    const panels = groups();
    const options = panels
      .map(
        (group) =>
          `<option value="${keyOf(group)}">${escapeHTML(group.dataset.name)}</option>`,
      )
      .join('');
    for (const select of document.querySelectorAll(`#${ids}, [${moveAttr}]`)) {
      const selected = select.matches(`[${moveAttr}]`)
        ? keyOf(select.closest(groupSelector))
        : select.value;
      select.innerHTML = options;
      select.value = selected;
      if (select.selectedIndex === -1) select.value = '';
    }
    for (const [index, group] of panels.entries()) {
      const members = rows(group);
      group.querySelector(`[${groupAttr}-count]`).textContent =
        members.length === 1
          ? t(messages.single)
          : t(messages.count).replace('{count}', members.length);
      group.querySelector(`[${groupAttr}-empty]`).hidden = members.length > 0;
      for (const [action, disabled] of [
        ['groupUp', index === 0],
        ['groupDown', index === panels.length - 2],
      ]) {
        const button = group.querySelector(`[${actionAttr}="${action}"]`);
        if (button) button.disabled = disabled;
      }
      members.forEach((member, position) => {
        member.querySelector(`[${actionAttr}="rowUp"]`).disabled =
          position === 0;
        member.querySelector(`[${actionAttr}="rowDown"]`).disabled =
          position === members.length - 1;
      });
    }
  }

  function read() {
    const positions = new Map(
      rows($('#' + form)).map((member, position) => [member, position]),
    );
    return groups()
      .filter((group) => keyOf(group) !== '')
      .map((group) => ({
        name: group.dataset.name,
        entry_positions: rows(group).map((member) => positions.get(member)),
      }));
  }

  function onChanged() {
    state.dirty = true;
    refresh();
    changed();
  }

  function showEditor(group) {
    const editor = $(`#${ids}Dialog`);
    editor.dataset.key = group ? keyOf(group) : '';
    $(`#${ids}Title`).textContent = t(group ? 'renameGroup' : 'createGroup');
    $(`#${ids}Name`).value = group?.dataset.name || '';
    $(`#${ids}Name`).setCustomValidity('');
    editor.showModal();
    $(`#${ids}Name`).focus();
  }

  function moveRow(member, target, after = false) {
    if (member === target) return;
    const body =
      target.closest(`[${groupAttr}-body]`) ||
      target.querySelector(`[${groupAttr}-body]`);
    if (!body) return;
    if (target.matches(rowSelector)) target[after ? 'after' : 'before'](member);
    else body.insertBefore(member, body.querySelector(`[${groupAttr}-empty]`));
  }

  function bind(onChange) {
    changed = onChange;
    document.addEventListener('mousedown', (event) => {
      const button = event.target.closest(
        `.${groupClass} .action-menu-content button`,
      );
      if (!button || !editable()) return;
      // Keep Safari from blurring the menu before the click reaches its button.
      event.preventDefault();
      button.focus({ preventScroll: true });
    });
    document.addEventListener('click', async (event) => {
      const button = event.target.closest(`[${actionAttr}]`);
      if (!button) return;
      const action = button.getAttribute(actionAttr);
      const group = button.closest(groupSelector);
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
      else if (action === 'cancel') $(`#${ids}Dialog`).close();
      else if (action === 'delete') {
        const formNode = $('#' + form);
        if (
          !(await showConfirm({
            title: t('deleteGroup'),
            message: t(messages.deleteWarning),
            confirmLabel: t('delete'),
            cancelLabel: t('cancel'),
            danger: true,
          }))
        )
          return;
        if (!formNode.isConnected || !editable()) return;
        const ungrouped = groups().at(-1);
        rows(group).forEach((member) => moveRow(member, ungrouped));
        group.remove();
        onChanged();
      } else if (action === 'groupUp' || action === 'groupDown') {
        const panels = groups();
        const target =
          panels[panels.indexOf(group) + (action === 'groupUp' ? -1 : 1)];
        if (!target || keyOf(target) === '') return;
        target[action === 'groupUp' ? 'before' : 'after'](group);
        onChanged();
      } else if (action === 'rowUp' || action === 'rowDown') {
        const member = button.closest(rowSelector);
        const members = rows(group);
        const target =
          members[members.indexOf(member) + (action === 'rowUp' ? -1 : 1)];
        if (target) {
          moveRow(member, target, action === 'rowDown');
          onChanged();
        }
      }
    });
    document.addEventListener('submit', (event) => {
      if (event.target.id !== `${ids}Form`) return;
      event.preventDefault();
      if (!editable()) return;
      const input = $(`#${ids}Name`);
      const name = input.value.trim();
      const editor = $(`#${ids}Dialog`);
      const group = groups().find(
        (group) => keyOf(group) === editor.dataset.key && editor.dataset.key,
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
      if (!group) $('#' + ids).value = String(nextGroupKey);
      editor.close();
    });
    document.addEventListener('input', (event) => {
      if (event.target.id === `${ids}Name`) event.target.setCustomValidity('');
    });
    document.addEventListener('click', (event) => {
      if (event.target.id === `${ids}Dialog`) event.target.close();
    });
    document.addEventListener('change', (event) => {
      const select = event.target.closest(`[${moveAttr}]`);
      if (!select || !editable()) return;
      const target = groups().find((group) => keyOf(group) === select.value);
      if (target) {
        moveRow(select.closest(rowSelector), target);
        onChanged();
      }
    });

    let dragging = null;
    const clear = () => {
      dragging = null;
      document
        .querySelectorAll(
          `.${groupClass} .dragging,.${groupClass}.drag-over,.${groupClass} .drag-over`,
        )
        .forEach((node) => node.classList.remove('dragging', 'drag-over'));
    };
    document.addEventListener('dragstart', (event) => {
      if (
        !editable() ||
        event.target.closest(
          'button,select,input,summary,.account-actions-menu',
        )
      )
        return;
      const member = event.target.closest(rowSelector);
      const header = event.target.closest(
        `[${groupAttr}-header][draggable="true"]`,
      );
      if (member) dragging = { kind: 'row', node: member };
      else if (header)
        dragging = { kind: 'group', node: header.closest(groupSelector) };
      else return;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', row);
      dragging.node.classList.add('dragging');
    });
    document.addEventListener('dragover', (event) => {
      if (!dragging || !editable()) return;
      const target = event.target.closest(`${rowSelector},${groupSelector}`);
      if (!target) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      document
        .querySelectorAll(`.${groupClass}.drag-over,.${groupClass} .drag-over`)
        .forEach((node) => node.classList.remove('drag-over'));
      target.classList.add('drag-over');
    });
    document.addEventListener('drop', (event) => {
      if (!dragging || !editable()) return;
      const target = event.target.closest(
        dragging.kind === 'group'
          ? groupSelector
          : `${rowSelector},${groupSelector}`,
      );
      if (!target) {
        clear();
        return;
      }
      event.preventDefault();
      const rect = (
        dragging.kind === 'group'
          ? target.querySelector(`[${groupAttr}-header]`)
          : target
      ).getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      if (dragging.kind === 'row') moveRow(dragging.node, target, after);
      else if (target !== dragging.node) {
        if (keyOf(target) === '') target.before(dragging.node);
        else target[after ? 'after' : 'before'](dragging.node);
      }
      clear();
      onChanged();
    });
    document.addEventListener('dragend', clear);
  }

  return { render, dialog, refresh, read, bind };
}
