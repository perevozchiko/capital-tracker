import { state, collapsedGroups } from './state.js';
import { api, request } from './api.js';
import { t } from './messages.js';
import { escapeHTML, monthLabel, nextMonth, money } from './format.js';
import { $, notify } from './ui.js';
import { showConfirm } from './dialogs.js';
import { groupSelector } from './accounts.js';
import { render, refresh, mutation } from './router.js';

function orderedAssignments() {
  const ids = [...state.groups.groups.map((g) => g.id), null];
  return ids.flatMap((group_id) =>
    state.accounts
      .filter((a) => (a.group_id ?? null) === group_id)
      .map((a) => ({ id: a.id, group_id })),
  );
}
async function saveAssignments(items) {
  await request('/accounts/assignments', 'PUT', { accounts: items });
  await refresh();
  await render();
}
function showAccountEditor(action, account) {
  const dialog = $('#accountDialog');
  const latest = state.months.at(-1)?.month || state.month;
  const month = nextMonth(latest, 1);
  const titles = {
    rename: 'rename',
    currency: 'changeCurrency',
    archive: 'archive',
    restore: 'restore',
  };
  const helpers = {
    currency: 'currencyHelp',
    archive: 'archiveWarning',
    restore: 'restoreWarning',
  };
  const labels = {
    rename: 'accountName',
    currency: 'currency',
    archive: 'archiveFrom',
    restore: 'restoreFrom',
  };
  dialog.dataset.editorAction = action;
  dialog.dataset.id = String(account.id);
  $('#editTitle').textContent = t(titles[action]) + ' · ' + account.name;
  $('#editHelp').textContent = helpers[action] ? t(helpers[action]) : '';
  let html = '';
  if (action === 'currency') {
    html =
      '<label for="editValue">' +
      t(labels[action]) +
      '</label><select id="editValue" name="value" required>' +
      state.currencies
        .map(
          (c) =>
            '<option value="' +
            c +
            '"' +
            (c === account.currency ? ' selected' : '') +
            '>' +
            c +
            '</option>',
        )
        .join('') +
      '</select>';
  } else {
    const value = action === 'rename' ? account.name : month;
    const type = action === 'rename' ? 'text' : 'month';
    const extra =
      type === 'month' ? ' min="1900-01" max="2200-12"' : ' maxlength="100"';
    html =
      '<label for="editValue">' +
      t(labels[action]) +
      '</label><input id="editValue" name="value" type="' +
      type +
      '"' +
      extra +
      ' required value="' +
      escapeHTML(value) +
      '">';
  }
  $('#editFields').innerHTML = html;
  $('#cancelEdit').textContent = t('cancel');
  $('#confirmEdit').textContent = t('confirm');
  dialog.showModal();
  $('#editValue').focus();
}

function showGroupEditor(action, group = null) {
  const dialog = $('#accountDialog');
  dialog.dataset.editorAction = action;
  dialog.dataset.id = group ? String(group.id) : '';
  $('#editTitle').textContent = t(
    action === 'groupCreate' ? 'createGroup' : 'renameGroup',
  );
  $('#editHelp').textContent = t('groupHelp');
  $('#editFields').innerHTML =
    `<label for="editValue">${t('groupName')}</label><input id="editValue" name="value" type="text" maxlength="100" required value="${escapeHTML(group?.name || '')}">`;
  $('#cancelEdit').textContent = t('cancel');
  $('#confirmEdit').textContent = t('confirm');
  dialog.showModal();
  $('#editValue').focus();
}
async function groupAction(action, id, key) {
  if (action === 'toggleGroup') {
    if (collapsedGroups.has(key)) collapsedGroups.delete(key);
    else collapsedGroups.add(key);
    try {
      localStorage.setItem(
        'capital-collapsed-groups',
        JSON.stringify([...collapsedGroups]),
      );
    } catch {}
    const button = document.querySelector(
      `[data-action="toggleGroup"][data-group-key="${key}"]`,
    );
    const panel = button?.closest('.account-group');
    if (panel) {
      const closed = collapsedGroups.has(key);
      panel.classList.toggle('is-collapsed', closed);
      button.textContent = closed ? '▸' : '▾';
      button.setAttribute('aria-expanded', String(!closed));
    }
    return;
  }
  if (action === 'groupCreate' || action === 'groupRename') {
    showGroupEditor(
      action,
      state.groups.groups.find((g) => g.id === id),
    );
    return;
  }
  if (action === 'groupDelete') {
    const yes = await showConfirm({
      title: t('deleteGroup'),
      message: t('deleteGroupWarning'),
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (!yes) return;
    await mutation(async () => {
      await api('/groups/' + id, { method: 'DELETE' });
      notify(t('groupDeleted'));
    });
    return;
  }
  if (action === 'groupUp' || action === 'groupDown') {
    const ids = state.groups.groups.map((g) => g.id),
      i = ids.indexOf(id),
      j = i + (action === 'groupUp' ? -1 : 1);
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await mutation(async () => request('/groups/reorder', 'PUT', { ids }));
  }
}
function moveAccountIn(items, id, targetGroup, targetID = null, after = true) {
  const itemIndex = items.findIndex((a) => a.id === id);
  if (itemIndex < 0) return items;
  const [item] = items.splice(itemIndex, 1);
  item.group_id = targetGroup;
  let insertIndex;
  if (targetID !== null) {
    insertIndex = items.findIndex((a) => a.id === targetID);
    if (insertIndex < 0) return null;
    if (after) insertIndex++;
  } else {
    insertIndex = items.findLastIndex((a) => a.group_id === targetGroup) + 1;
    if (insertIndex === 0) {
      const order = [...state.groups.groups.map((g) => g.id), null];
      const nextGroups = order.slice(order.indexOf(targetGroup) + 1);
      insertIndex = items.findIndex((a) => nextGroups.includes(a.group_id));
      if (insertIndex < 0) insertIndex = items.length;
    }
  }
  items.splice(insertIndex, 0, item);
  return items;
}
function bindAccountDragAndDrop() {
  let dragging = null;
  document.addEventListener('dragstart', (e) => {
    if (e.target.closest('button,select,input,summary,.account-actions-menu'))
      return;
    const account = e.target.closest('[data-account-row]');
    const header = e.target.closest('[data-group-row]');
    if (account)
      dragging = { kind: 'account', id: Number(account.dataset.accountRow) };
    else if (
      header &&
      header.dataset.groupRow !== 'ungrouped' &&
      header.dataset.groupRow !== 'archive'
    )
      dragging = { kind: 'group', id: Number(header.dataset.groupRow) };
    else return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragging.id));
    e.target.classList.add('dragging');
  });
  document.addEventListener('dragend', () => {
    dragging = null;
    document
      .querySelectorAll('.dragging,.drag-over')
      .forEach((el) => el.classList.remove('dragging', 'drag-over'));
  });
  document.addEventListener('dragover', (e) => {
    if (!dragging) return;
    const target = e.target.closest(
      dragging.kind === 'group'
        ? '[data-group-row]:not([data-group-row="ungrouped"]):not([data-group-row="archive"])'
        : '[data-account-row],.account-group-head,.account-group',
    );
    if (!target) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document
      .querySelectorAll('.drag-over')
      .forEach((el) => el.classList.remove('drag-over'));
    target.classList.add('drag-over');
  });
  document.addEventListener('drop', async (e) => {
    if (!dragging) return;
    const source = dragging;
    dragging = null;
    document
      .querySelectorAll('.dragging,.drag-over')
      .forEach((el) => el.classList.remove('dragging', 'drag-over'));
    try {
      if (source.kind === 'group') {
        const header = e.target.closest('[data-group-row]');
        if (
          !header ||
          header.dataset.groupRow === 'ungrouped' ||
          header.dataset.groupRow === 'archive'
        )
          return;
        e.preventDefault();
        const target = Number(header.dataset.groupRow);
        if (target === source.id) return;
        const ids = state.groups.groups.map((g) => g.id);
        ids.splice(ids.indexOf(source.id), 1);
        let idx = ids.indexOf(target);
        if (
          e.clientY >
          header.getBoundingClientRect().top + header.offsetHeight / 2
        )
          idx++;
        ids.splice(idx, 0, source.id);
        await mutation(async () => request('/groups/reorder', 'PUT', { ids }));
        return;
      }
      const row = e.target.closest('[data-account-row]');
      const panel = e.target.closest('.account-group');
      if (!panel) return;
      e.preventDefault();
      if (panel.dataset.groupId === 'archive') {
        const account = state.accounts.find((a) => a.id === source.id);
        if (account && !account.archived_from_month)
          showAccountEditor('archive', account);
        return;
      }
      const targetGroup = panel.dataset.groupId
        ? Number(panel.dataset.groupId)
        : null;
      const targetID = row ? Number(row.dataset.accountRow) : null;
      if (targetID === source.id) return;
      const after = row
        ? e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2
        : true;
      const items = moveAccountIn(
        orderedAssignments(),
        source.id,
        targetGroup,
        targetID,
        after,
      );
      if (items) await saveAssignments(items);
    } catch (err) {
      notify(err.message || t('error'), true);
    }
  });
}

async function submitAccountEdit(form) {
  const dialog = $('#accountDialog');
  const action = dialog.dataset.editorAction,
    id = Number(dialog.dataset.id);
  const value = form.elements.namedItem('value').value;
  try {
    if (action === 'groupCreate' || action === 'groupRename') {
      if (action === 'groupCreate')
        await request('/groups', 'POST', { name: value });
      else await request('/groups/' + id, 'PATCH', { name: value });
      dialog.close();
      await refresh();
      await render();
      notify(t('groupSaved'));
      return;
    }
    if (action === 'rename')
      await request('/accounts/' + id, 'PATCH', { name: value });
    if (action === 'currency')
      await request('/accounts/' + id, 'PATCH', { currency: value });
    if (action === 'archive')
      await request('/accounts/' + id + '/archive', 'POST', { month: value });
    if (action === 'restore')
      await request('/accounts/' + id + '/restore', 'POST', {
        start_month: value,
      });
    dialog.close();
    await refresh();
    await render();
    notify(
      t(
        action === 'archive'
          ? 'accountArchived'
          : action === 'restore'
            ? 'accountRestored'
            : 'accountUpdated',
      ),
    );
  } catch (err) {
    notify(err.message || t('error'), true);
  }
}

async function accountAction(action, id) {
  const account = state.accounts.find((a) => a.id === id);
  if (!account) return;
  if (['rename', 'currency', 'archive', 'restore'].includes(action)) {
    showAccountEditor(action, account);
    return;
  }
  if (action === 'delete') {
    if (
      !(await showConfirm({
        title: t('deleteAccountTitle'),
        message: t('confirmDelete'),
        confirmLabel: t('delete'),
        cancelLabel: t('cancel'),
        danger: true,
      }))
    )
      return;
    await mutation(async () => {
      await api('/accounts/' + id, {
        method: 'DELETE',
        headers: { 'X-Capital-Tracker': '1' },
      });
      notify(t('accountDeleted'));
    });
  }
  if (action === 'history') {
    const hist = [];
    for (const m of state.months) {
      const d = await api('/months/' + m.month);
      const b = d.balances.find((x) => x.account_id === id);
      if (b) hist.push([m.month, b.amount_minor]);
    }
    const content = hist.length
      ? hist
          .map(
            ([month, value]) =>
              `<tr><td>${monthLabel(month)}</td><td>${money(value, account.currency)}</td></tr>`,
          )
          .join('')
      : `<tr><td colspan="2">${t('historicalEmpty')}</td></tr>`;
    $('#pageContent').innerHTML =
      `<section class="card panel"><div class="panel-heading"><h2>${escapeHTML(account.name)} · ${t('balanceHistory')}</h2><button class="btn btn-small" data-page="accounts">${t('earlier')}</button></div><p class="caption">${t('accountHistoricalNote')}</p><div class="table-scroll"><table><tbody>${content}</tbody></table></div></section>`;
  }
  if (action === 'up' || action === 'down') {
    const items = orderedAssignments(),
      a = state.accounts.find((x) => x.id === id);
    const members = items.filter((x) => x.group_id === (a.group_id ?? null));
    const i = members.findIndex((x) => x.id === id),
      j = i + (action === 'up' ? -1 : 1);
    if (j < 0 || j >= members.length) return;
    const x = items.findIndex((x) => x.id === members[i].id),
      y = items.findIndex((x) => x.id === members[j].id);
    [items[x], items[y]] = [items[y], items[x]];
    await saveAssignments(items);
  }
}

export {
  saveAssignments,
  orderedAssignments,
  groupAction,
  accountAction,
  submitAccountEdit,
  bindAccountDragAndDrop,
  moveAccountIn,
};
