import { state, collapsedGroups } from './state.js';
import { api } from './api.js';
import { t } from './messages.js';
import {
  escapeHTML,
  monthLabel,
  money,
  nextMonth,
  pluralAccounts,
} from './format.js';
import { $, groupVisibilityButtons } from './ui.js';
function groupSelector(selected, attribute) {
  return `<select ${attribute} aria-label="${t('moveToGroup')}"><option value="" ${selected === null ? 'selected' : ''}>${t('ungrouped')}</option>${state.groups.groups.map((g) => `<option value="${g.id}" ${selected === g.id ? 'selected' : ''}>${escapeHTML(g.name)}</option>`).join('')}</select>`;
}
async function renderAccounts() {
  state.groups = await api('/groups?month=' + encodeURIComponent(state.month));
  const accounts = state.accounts;
  const groups = state.groups.groups;
  const groupRows = (group, id, index) => {
    const members = accounts.filter((a) =>
      id === 'archive'
        ? !!a.archived_from_month
        : !a.archived_from_month && (a.group_id ?? null) === id,
    );
    const key =
      id === 'archive' ? 'archive' : id === null ? 'ungrouped' : 'g-' + id;
    const closed = collapsedGroups.has(key);
    const total =
      group.total_eur_minor == null ? '—' : money(group.total_eur_minor);
    const buttons =
      id === null || id === 'archive'
        ? ''
        : `<details class="account-actions-menu" name="account-actions"><summary aria-label="${t('groupActions')}" title="${t('groupActions')}">⋮</summary><div class="action-menu-content"><button type="button" data-action="groupUp" data-group-id="${id}" ${index === 0 ? 'disabled' : ''}>${t('reorderUp')}</button><button type="button" data-action="groupDown" data-group-id="${id}" ${index === groups.length - 1 ? 'disabled' : ''}>${t('reorderDown')}</button><button type="button" data-action="groupRename" data-group-id="${id}">${t('rename')}</button><button type="button" class="menu-danger" data-action="groupDelete" data-group-id="${id}">${t('delete')}</button></div></details>`;
    const rows = members
      .map(
        (
          a,
          i,
        ) => `<div class="account-row" data-account-row="${a.id}" draggable="${id !== 'archive'}">
   <div class="account-main">${id === 'archive' ? '' : `<span class="drag-handle" title="${t('dragAccount')}" aria-hidden="true">⠿</span>`}<div class="account-mark">${a.currency === 'EUR' ? '€' : a.currency === 'USD' ? '$' : a.currency === 'RUB' ? '₽' : a.currency === 'TRY' ? '₺' : 'R'}</div><div><strong>${escapeHTML(a.name)} <span class="currency-tag">${a.currency}</span></strong><small>${t('startMonth')}: ${escapeHTML(monthLabel(a.start_month))} · ${a.archived_from_month ? t('archived') + ' ' + escapeHTML(monthLabel(a.archived_from_month)) : t('active')}</small></div></div>
   <div class="actions"><details class="account-actions-menu" name="account-actions"><summary aria-label="${t('accountActions')}" title="${t('accountActions')}">⋮</summary><div class="action-menu-content"><button type="button" data-action="history" data-id="${a.id}">${t('historyAccount')}</button><button type="button" data-action="rename" data-id="${a.id}">${t('rename')}</button><button type="button" data-action="currency" data-id="${a.id}">${t('changeCurrency')}</button>${a.archived_from_month ? '' : `<label class="menu-move-label">${t('moveToGroup')}${groupSelector(a.group_id ?? null, 'data-move-account="' + a.id + '"')}</label><button type="button" data-action="up" data-id="${a.id}" ${i === 0 ? 'disabled' : ''}>${t('reorderUp')}</button><button type="button" data-action="down" data-id="${a.id}" ${i === members.length - 1 ? 'disabled' : ''}>${t('reorderDown')}</button>`}<button type="button" data-action="${a.archived_from_month ? 'restore' : 'archive'}" data-id="${a.id}">${t(a.archived_from_month ? 'restore' : 'archive')}</button><button type="button" class="menu-danger" data-action="delete" data-id="${a.id}">${t('delete')}</button></div></details></div>
  </div>`,
      )
      .join('');
    return `<section class="account-group ${closed ? 'is-collapsed' : ''}" data-group-id="${id === null ? '' : id}">
   <div class="account-group-head" data-group-row="${id === 'archive' ? 'archive' : id === null ? 'ungrouped' : id}" draggable="${id !== null && id !== 'archive'}">
    <button class="group-toggle" data-action="toggleGroup" data-group-key="${key}" aria-expanded="${!closed}" aria-label="${t('toggleGroup')}">${closed ? '▸' : '▾'}</button>
    <div class="group-caption"><strong>${escapeHTML(id === 'archive' ? t('archiveGroup') : id === null ? t('ungrouped') : group.name)}</strong><small>${pluralAccounts(members.length)}</small></div>
    <div class="group-total"><strong>${total}</strong><small>${t('groupTotalEUR')} · ${escapeHTML(monthLabel(state.month, true))}${group.total_eur_minor == null ? ' · ' + t('incomplete') : ''}</small></div>
    <div class="group-controls">${buttons}</div>
   </div>
   <div class="account-group-body">${rows || `<p class="group-empty">${id === 'archive' ? t('archiveEmpty') : t('dropAccountHere')}</p>`}</div>
  </section>`;
  };
  const html =
    groups.map((g, i) => groupRows(g, g.id, i)).join('') +
    groupRows(state.groups.ungrouped, null, groups.length) +
    groupRows(
      state.groups.archive || { total_eur_minor: null },
      'archive',
      groups.length,
    );
  $('#pageContent').innerHTML =
    `<section class="card panel"><h2>${t('addAccount')}</h2><p class="caption">${t('currencyHelp')}</p><form id="addAccountForm" class="form-row form-row-groups">
 <div class="field"><label for="accountName">${t('accountName')}</label><input id="accountName" name="name" maxlength="100" required placeholder="${t('namePlaceholder')}"></div>
 <div class="field"><label for="accountCurrency">${t('currency')}</label><select id="accountCurrency" name="currency">${state.currencies.map((c) => `<option>${c}</option>`).join('')}</select></div>
 <div class="field"><label for="accountGroup">${t('group')}</label>${groupSelector(null, 'id="accountGroup" name="group"')}</div>
 <div class="field"><label for="accountStart">${t('startMonth')}</label><input id="accountStart" name="start" type="month" min="1900-01" max="2200-12" required value="${state.months.length && state.month <= state.months.at(-1).month ? nextMonth(state.months.at(-1).month, 1) : state.month}"></div>
 <button class="btn btn-primary" type="submit">${t('createAccount')}</button></form></section>
 <section class="card panel"><div class="panel-heading"><div><h2>${t('accountList')}</h2><span class="subtle">${pluralAccounts(accounts.length)}</span></div><div class="overview-actions">${groupVisibilityButtons()}<button class="btn btn-small btn-primary" data-action="groupCreate">+ ${t('createGroup')}</button></div></div>
 <p class="caption">${t('dragGroupsHint')}</p>${html}</section>`;
}

export { renderAccounts, groupSelector };
