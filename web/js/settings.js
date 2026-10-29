import { state } from './state.js';
import { t } from './messages.js';
import { escapeHTML } from './format.js';
import { $ } from './ui.js';
function renderSettings() {
  const s = state.settings;
  $('#pageContent').innerHTML =
    `<section class="card panel"><h2>${t('preferences')}</h2>
 <div class="settings-row"><div><strong>${t('theme')}</strong></div>
 <select id="themeSelect">${['system', 'light', 'dark'].map((v) => `<option value="${v}" ${s.theme === v ? 'selected' : ''}>${t(v)}</option>`).join('')}</select></div></section>
 <section class="card panel"><h2>${t('jsonData')}</h2><p class="caption">${t('jsonDataHelp')}</p>
 <div class="data-tools">
 <button class="btn btn-primary" type="button" data-action="exportJSON">${t('exportJSON')}</button>
 <button class="btn" type="button" data-action="importJSON">${t('importJSON')}</button>
 <input id="jsonFileInput" type="file" accept=".json,application/json" hidden aria-label="${t('importJSON')}">
 </div><p class="footer-note">${t('jsonImportWarning')}</p></section>
 <section class="card panel danger-zone"><h2>${t('dangerZone')}</h2>
 <p class="caption">${t('clearDataWarning')}</p>
 <button type="button" class="btn btn-danger" data-action="clearAllData">${t('clearAllData')}</button></section>
 <section class="card panel"><h2>${t('appName')}</h2><p class="caption">${t('appDescription')}</p>
 <p>${t('about')}</p><p class="caption">${t('version')}: v${escapeHTML(s.version)} · ${t('commit')}: ${escapeHTML(state.buildCommit)}</p></section>`;
}

export { renderSettings };
