import en from './i18n/en.js';
import ru from './i18n/ru.js';
import { parseRateDecimal, differenceMinor } from './numbers.js';
import { showConfirm, showTypedConfirm } from './dialogs.js';

const $ = selector => document.querySelector(selector);
const state = {page:'dashboard',month:new Date().toLocaleDateString('sv-SE').slice(0,7),accounts:[],months:[],history:[],settings:{language:'en',theme:'dark',version:'0.1.3'},currencies:[],columnCount:12,monthData:null,dashboard:null,dirty:false,selectedAccount:null};
const icons = {
 dashboard:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 accounts:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>',
 monthly:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 15h3"/>',
 settings:'<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.2-1.7l2-1.5-2-3.5-2.4 1A7 7 0 0 0 14 5l-.4-2.5h-4L9.2 5a7 7 0 0 0-2.4 1.3l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 3.4l-2 1.5 2 3.5 2.4-1A7 7 0 0 0 9.2 19l.4 2.5h4L14 19a7 7 0 0 0 2.4-1.3l2.4 1 2-3.5-2-1.5A7 7 0 0 0 19 12Z"/>'
};
const dictionaries={en,ru};
function t(key){return (dictionaries[state.settings.language]||en)[key]||en[key]||key;}
const lang=()=>state.settings.language==='ru'?'ru-RU':'en-US';
const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const monthDate=m=>new Date(`${m}-01T12:00:00`);
function monthLabel(month,short=false){if(!month||!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month))return month;return new Intl.DateTimeFormat(lang(),{month:short?'short':'long',year:'numeric'}).format(monthDate(month));}
function nextMonth(m,shift){const [y,mm]=m.split('-').map(Number);const dt=new Date(Date.UTC(y,mm-1+shift,1));return dt.toISOString().slice(0,7);}
function validMonth(m){return /^\d{4}-(0[1-9]|1[0-2])$/.test(m)&&m>='1900-01'&&m<='2200-12';}
// Format all values using BigInt. Number is never used for financial display.
function money(minor,currency='EUR'){
 if(minor==null)return '—';
 const v=BigInt(minor),neg=v<0n,abs=neg?-v:v;
 const whole=new Intl.NumberFormat(lang(),{useGrouping:true,maximumFractionDigits:0}).format(abs/100n);
 const frac=String(abs%100n).padStart(2,'0');
 const parts=new Intl.NumberFormat(lang(),{style:'currency',currency,currencyDisplay:'symbol',minimumFractionDigits:2,maximumFractionDigits:2}).formatToParts(neg?-0.01:0.01);
 return parts.map(p=>p.type==='integer'?whole:p.type==='fraction'?frac:p.type==='group'?'':p.value).join('');
}
function rateText(v){return String(v??'').replace('.',state.settings.language==='ru'?',':'.');}
function minorToInput(v){if(v==null)return '';const n=BigInt(v),a=n<0n?-n:n;return (n<0n?'-':'')+(a/100n)+'.'+String(a%100n).padStart(2,'0');}
function parseMoney(input){
 const raw=input.trim().replace(/\u00a0|\u202f/g,' ');if(!raw)return null;
 let text=raw;
 if(text.includes(' ')){
  if(!/^-?\d{1,3}(?: \d{3})+(?:[.,]\d{1,2})?$/.test(text))throw new Error(t('invalidAmount'));
  text=text.replaceAll(' ','');
 }
 if(!/^-?\d+(?:[.,]\d{1,2})?$/.test(text))throw new Error(t('invalidAmount'));
 let sign=1n;if(text.startsWith('-')){sign=-1n;text=text.slice(1)}
 const [whole,frac='']=text.replace(',','.').split('.');
 const out=sign*(BigInt(whole)*100n+BigInt(frac.padEnd(2,'0')||'0'));
 if(out>9000000000000000n||out< -9000000000000000n)throw new Error(t('invalidAmount'));
 return String(out);
}
function parseRate(raw){
 try { return parseRateDecimal(raw); }
 catch { throw new Error(t('invalidRate')); }
}
async function api(path,options={}){
 const res=await fetch('/api'+path,{...options,headers:{'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.method&&options.method!=='GET'?{'X-Capital-Tracker':'1'}:{}),...options.headers}});
 const data=res.status===204?null:await res.json().catch(()=>({}));
 if(!res.ok){const error=data.error||{};throw new Error((error.reason&&t('reason_'+error.reason))||(error.field&&t('field_'+error.field))||t(error.code)||t('error'))}
 return data;
}
const request=(path,method,payload)=>api(path,{method,body:JSON.stringify(payload)});
function notify(message,failed=false){const element=$('#toast');element.textContent=message;element.classList.add('visible');element.classList.toggle('toast-error',failed);clearTimeout(notify.timer);notify.timer=setTimeout(()=>element.classList.remove('visible'),3500)}
function themeApply(){const choice=state.settings.theme;const dark=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=choice==='system'?(dark?'dark':'light'):choice;try{localStorage.setItem('capital-appearance',choice)}catch{}}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(state.settings.theme==='system')themeApply()});
async function confirmClean(){
 if(!state.dirty)return true;
 const discard=await showConfirm({title:t('discardChanges'),message:t('unsaved'),confirmLabel:t('discard'),cancelLabel:t('keepEditing'),danger:true});
 if(!discard)return false;
 state.dirty=false;
 return true;
}
window.addEventListener('beforeunload',e=>{if(state.dirty){e.preventDefault();e.returnValue='';}});
function monthControls(){return `<div class="toolbar"><div class="month-switch"><button class="btn btn-icon" type="button" data-action="monthPrev" aria-label="${t('earlier')}">‹</button><label>${escapeHTML(monthLabel(state.month))}</label><button class="btn btn-icon" type="button" data-action="monthNext" aria-label="${t('later')}">›</button></div><input class="btn month-picker" type="month" value="${state.month}" min="1900-01" max="2200-12" aria-label="${t('goToMonth')}"></div>`;}
async function navigate(page){if(!(await confirmClean()))return;state.page=page;state.selectedAccount=null;render().catch(e=>notify(e.message,true));$('#sidebar').classList.remove('show')}
async function setMonth(month){if(!validMonth(month)){notify(t('monthLimit'),true);return false}if(!(await confirmClean()))return false;state.month=month;await render();return true}
function statusPill(d){return `<span class="pill ${d.complete?'good':'bad'}">${d.complete?t('complete'):t('incomplete')}</span>`}
function renderNav(){const routes=[['dashboard','navDashboard'],['accounts','navAccounts'],['monthly','navMonthly'],['settings','navSettings']];$('#navigation').innerHTML=routes.map(([key,label])=>`<button class="nav-item ${state.page===key?'active':''}" data-page="${key}"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[key]}</svg><span>${t(label)}</span></button>`).join('');document.querySelectorAll('[data-i18n]').forEach(el=>{el.textContent=t(el.dataset.i18n)})}
function renderHeader(){const names={dashboard:'navDashboard',accounts:'navAccounts',monthly:'navMonthly',settings:'navSettings'};$('#pageHeading').textContent=t(names[state.page]);$('#sectionEyebrow').textContent=t('appName');$('#headerActions').innerHTML=['dashboard','monthly'].includes(state.page)?monthControls():state.page==='accounts'?`<button class="btn btn-primary" data-action="focusAdd">+ ${t('addAccount')}</button>`:'';document.documentElement.lang=state.settings.language;document.title=`${t(names[state.page])} · Capital Tracker`;}
function emptyStart(){return `<div class="card empty"><div class="welcome-symbol">◈</div><h2>${t('welcome')}</h2><p>${t('welcomeBody')}</p><button type="button" class="btn btn-primary" data-page="accounts">+ ${t('addAccount')}</button></div>`}
function cellFor(d,account){const active=d.accounts.some(a=>a.id===account.id);if(!active)return `<span class="td-muted" title="${t('notActive')}">·</span>`;const b=d.balances.find(x=>x.account_id===account.id);return b?money(b.amount_minor,account.currency):`<span class="td-muted" title="${t('notEntered')}">—</span>`;}
function renderTable(d){const cols=d.columns;const headers=cols.map(x=>`<th class="${x.month===state.month?'selected-col':''}"><button data-action="selectColumn" data-month="${x.month}">${escapeHTML(monthLabel(x.month,true))}</button></th>`).join('');const rows=d.accounts.map(account=>`<tr><td><span>${escapeHTML(account.name)}</span><span class="currency-tag">${account.currency}</span></td>${cols.map(c=>`<td class="${c.month===state.month?'selected-col':''}">${cellFor(c,account)}</td>`).join('')}</tr>`).join('');const totals=cols.map(c=>`<td class="${c.month===state.month?'selected-col':''}">${c.complete?money(c.total_eur_minor):`<span class="td-muted">${t('incomplete')}</span>`}</td>`).join('');return `<div class="table-scroll"><table><thead><tr><th>${t('account')}</th>${headers}</tr></thead><tbody>${rows}<tr class="table-total"><td>${t('totalEUR')}</td>${totals}</tr></tbody></table></div><p class="footer-note">${t('displayedOriginal')} · ${t('exactTotal')}</p>`}
function percentBP(bp){if(bp==null)return '—';const x=BigInt(bp),n=x<0n?-x:x;return (x<0n?'-':'')+(n/100n)+(state.settings.language==='ru'?',':'.')+String(n%100n).padStart(2,'0')+'%';}
function monthIndex(s){const [year,month]=s.split('-').map(Number);return year*12+month-1;}
function chart(history){
 const valid=history.filter(p=>p.complete&&p.total_eur_minor!=null);
 if(valid.length===0)return `<div class="empty">${t('historyEmpty')}</div>`;
 const W=860,H=266,pad={left:88,right:20,top:18,bottom:40},innerW=W-pad.left-pad.right,innerH=H-pad.top-pad.bottom;
 const first=monthIndex(history[0].month),last=monthIndex(history[history.length-1].month);const range=Math.max(1,last-first);
 const values=valid.map(p=>Number(p.total_eur_minor)/100);let min=Math.min(...values),max=Math.max(...values);const spread=Math.max(1,max-min);min-=spread*.14;max+=spread*.14;
 const yFor=v=>pad.top+(max-v)/(max-min)*innerH;
 const xFor=m=>pad.left+(monthIndex(m)-first)/range*innerW;
 const lines=Array.from({length:5},(_,i)=>{const v=max-(max-min)*i/4;return `<line class="gridline" x1="${pad.left}" x2="${W-pad.right}" y1="${yFor(v)}" y2="${yFor(v)}"/><text x="${pad.left-11}" y="${yFor(v)+4}" text-anchor="end">${new Intl.NumberFormat(lang(),{style:'decimal',notation:'compact',maximumFractionDigits:1}).format(v)} €</text>`}).join('');
 let paths='',previous=null;
 for(const p of history){if(p.complete&&p.total_eur_minor!=null){const x=xFor(p.month),y=yFor(Number(p.total_eur_minor)/100);if(previous&&monthIndex(p.month)-monthIndex(previous.month)===1){paths+=`<path class="curve" d="M${xFor(previous.month)},${yFor(Number(previous.total_eur_minor)/100)} L${x},${y}"/>`};previous=p}else previous=null;}
 const step=Math.max(1,Math.ceil(history.length/7));const xLabels=history.filter((_,i)=>i%step===0||i===history.length-1).map(p=>`<text x="${xFor(p.month)}" y="${H-13}" text-anchor="middle">${escapeHTML(monthLabel(p.month,true))}</text>`).join('');
 const dots=valid.map((p,i)=>`<circle class="chart-dot" cx="${xFor(p.month)}" cy="${yFor(Number(p.total_eur_minor)/100)}" r="5" tabindex="0" role="img" aria-label="${escapeHTML(monthLabel(p.month))}: ${escapeHTML(money(p.total_eur_minor))}" data-chart-index="${history.indexOf(p)}"/>`).join('');
 return `<div class="chart-wrap"><svg class="history-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('history')}">${lines}${paths}${dots}${xLabels}</svg></div><p class="footer-note">${t('chartNote')}</p>`;
}
async function renderDashboard(){const d=await api('/dashboard?month='+encodeURIComponent(state.month)+'&columns='+state.columnCount);state.dashboard=d;const m=d.month;const delta=d.change_minor;const changeColor=delta==null?'neutral':BigInt(delta)<0n?'negative':BigInt(delta)>0n?'positive':'neutral';
 const subtotal=m.complete?money(m.total_eur_minor):'—';const change=delta!=null?`${BigInt(delta)>0n?'+':''}${money(delta)}${d.change_percent_bp!=null?` (${BigInt(d.change_percent_bp)>0n?'+':''}${percentBP(d.change_percent_bp)})`:''}`:'—';
 if(d.accounts.length===0){$('#pageContent').innerHTML=emptyStart();return}
 $('#pageContent').innerHTML=`<div class="grid-summary"><article class="card metric"><p class="overline">${t('totalNetWorth')}</p><div class="metric-value">${subtotal}</div>${statusPill(m)} <span class="subtle">${escapeHTML(monthLabel(state.month))}</span></article><article class="card metric"><p class="overline">${t('monthlyChange')}</p><div class="metric-value metric-secondary ${changeColor}">${change}</div><p class="subtle">${delta!=null?t('comparedLastMonth'):t('noPrevious')}</p></article></div><section class="card panel"><div class="panel-heading"><h2>${t('history')}</h2><span class="subtle">${t('historyRange')}</span></div>${chart(state.history)}</section><section class="card panel"><div class="panel-heading"><h2>${t('monthlyOverview')}</h2><div class="overview-actions"><label for="columnCount">${t('showMonths')}</label><select id="columnCount" class="btn"><option>6</option><option>12</option><option>24</option><option>60</option><option>120</option></select><button class="btn btn-small" data-page="monthly">${t('editMonth')}</button></div></div>${renderTable(d)}</section>`;
 $('#columnCount').value=String(state.columnCount);
}
function pluralAccounts(count){const rules=new Intl.PluralRules(lang());if(state.settings.language==='en')return `${count} ${count===1?'account':'accounts'}`;const f=rules.select(count);return `${count} ${f==='one'?'счёт':f==='few'?'счёта':'счетов'}`;}
async function renderAccounts(){const accounts=state.accounts;const rows=accounts.map((a,i)=>`<div class="account-row"><div class="account-main"><div class="account-mark">${a.currency==='EUR'?'€':a.currency==='USD'?'$':a.currency==='RUB'?'₽':a.currency==='TRY'?'₺':'R'}</div><div><strong>${escapeHTML(a.name)} <span class="currency-tag">${a.currency}</span></strong><small>${t('startMonth')}: ${escapeHTML(monthLabel(a.start_month))} · ${a.archived_from_month?t('archived')+' '+escapeHTML(monthLabel(a.archived_from_month)):t('active')}</small></div></div><div class="actions"><button class="btn btn-small" data-action="up" data-id="${a.id}" ${i===0?'disabled':''} aria-label="${t('reorderUp')}">↑</button><button class="btn btn-small" data-action="down" data-id="${a.id}" ${i===accounts.length-1?'disabled':''} aria-label="${t('reorderDown')}">↓</button><button class="btn btn-small" data-action="history" data-id="${a.id}">${t('historyAccount')}</button><button class="btn btn-small" data-action="rename" data-id="${a.id}">${t('rename')}</button><button class="btn btn-small" data-action="currency" data-id="${a.id}">${t('changeCurrency')}</button><button class="btn btn-small" data-action="${a.archived_from_month?'restore':'archive'}" data-id="${a.id}">${t(a.archived_from_month?'restore':'archive')}</button><button class="btn btn-small btn-danger" data-action="delete" data-id="${a.id}">${t('delete')}</button></div></div>`).join('');
 $('#pageContent').innerHTML=`<section class="card panel"><h2>${t('addAccount')}</h2><p class="caption">${t('currencyHelp')}</p><form id="addAccountForm" class="form-row"><div class="field"><label for="accountName">${t('accountName')}</label><input id="accountName" name="name" maxlength="100" required placeholder="${t('namePlaceholder')}"></div><div class="field"><label for="accountCurrency">${t('currency')}</label><select id="accountCurrency" name="currency">${state.currencies.map(c=>`<option>${c}</option>`).join('')}</select></div><div class="field"><label for="accountStart">${t('startMonth')}</label><input id="accountStart" name="start" type="month" min="1900-01" max="2200-12" required value="${(state.months.length&&state.month<=state.months.at(-1).month)?nextMonth(state.months.at(-1).month,1):state.month}"></div><button class="btn btn-primary" type="submit">${t('createAccount')}</button></form></section><section class="card panel"><div class="panel-heading"><h2>${t('accountList')}</h2><span class="subtle">${pluralAccounts(accounts.length)}</span></div>${rows||`<div class="empty">${t('noAccounts')}</div>`}</section>`;
}
function updateBalanceDifference(input){
 const node=document.querySelector(`[data-balance-change="${input.dataset.balance}"]`);
 if(!node)return;
 let current=null;
 try{current=parseMoney(input.value)}catch{}
 const delta=differenceMinor(current,input.dataset.previousMinor||null);
 const n=delta===null?null:BigInt(delta);
 node.className='balance-change '+(n===null?'neutral':n>0n?'positive':n<0n?'negative':'neutral');
 node.textContent=n===null?'—':(n>0n?'+':'')+money(delta,input.dataset.currency);
}
async function renderMonthly(){
 const previousMonth=nextMonth(state.month,-1);
 const [d,previous]=await Promise.all([
  api('/months/'+state.month),
  previousMonth>='1900-01'?api('/months/'+previousMonth):Promise.resolve(null)
 ]);
 state.monthData=d;
 const balances=new Map(d.balances.map(b=>[b.account_id,b.amount_minor]));
 const previousBalances=new Map((previous?.balances||[]).map(b=>[b.account_id,b.amount_minor]));
 const rates=new Map(d.rates.map(r=>[r.currency,r.rate]));
 const currencies=[...new Set(d.accounts.map(a=>a.currency))].filter(c=>c!=='EUR').sort();
 const rows=d.accounts.map(a=>{
  const last=previousBalances.get(a.id);
  return `<div class='editor-row balance-row'>
   <label for='b-${a.id}'>${escapeHTML(a.name)}<small>${a.currency}</small></label>
   <div class='balance-cell balance-previous'><span class='balance-field-label' title='${escapeHTML(monthLabel(previousMonth))}'>${t('previousBalance')}</span><strong>${last==null?'—':escapeHTML(money(last,a.currency))}</strong></div>
   <div class='balance-cell balance-current'><span class='balance-field-label'>${t('currentBalance')}</span><input class='editor-input' id='b-${a.id}' data-balance='${a.id}' data-currency='${a.currency}' data-previous-minor='${last??''}' inputmode='decimal' autocomplete='off' placeholder='${t('enterBalance')}' value='${escapeHTML(minorToInput(balances.get(a.id)))}'></div>
   <div class='balance-cell balance-difference'><span class='balance-field-label'>${t('balanceDifference')}</span><strong class='balance-change neutral' data-balance-change='${a.id}'>—</strong></div>
   <button type='button' class='btn btn-small balance-use-previous' data-action='copyPrevious' data-id='${a.id}' aria-label='${escapeHTML(t('usePrevious')+' — '+a.name)}' ${last==null?'disabled':''}>${t('usePrevious')}</button>
  </div>`;
 }).join('');
 const exchangeRows=currencies.map(c=>`<div class='editor-row'><label for='r-${c}'>EUR → ${c}<small>${t('rateMeaning')} ${c}</small></label><input class='editor-input' id='r-${c}' data-rate='${c}' inputmode='decimal' autocomplete='off' placeholder='${t('enterRate')}' value='${escapeHTML(rateText(rates.get(c)||''))}'></div>`).join('');
 const missing=d.complete?t('complete'):[d.missing_balances.length?t('missingBalances')+': '+d.missing_balances.length:'',d.missing_rates.length?t('missingRates')+': '+d.missing_rates.join(', '):''].filter(Boolean).join(' · ')||t('totalProvisional');
 $('#pageContent').innerHTML=`<div class='status-block'><div class='panel-heading status-heading'><strong>${t('status')}</strong>${statusPill(d)}</div><p class='inline-status'>${missing}</p>${d.complete?`<div class='metric-value metric-secondary'>${money(d.total_eur_minor)}</div>`:''}</div><div class='editor-grid'><section class='card panel'><div class='panel-heading'><h2>${t('balance')}</h2><span class='subtle'>${escapeHTML(monthLabel(state.month))}</span></div><p class='caption'>${t('balancesNote')}</p>${rows||`<div class='empty'>${t('noActiveAccounts')}</div>`}</section><section class='card panel'><div class='panel-heading'><h2>${t('rates')}</h2><span class='subtle'>EUR = 1</span></div><p class='caption'>${t('ratesNote')}</p><div class='editor-list'>${exchangeRows||`<p class='muted'>EUR = 1</p>`}</div><p class='footer-note'>${t('rateFormatHelp')}</p></section></div><div class='editor-footer'><p class='subtle'>${t('exactTotal')}</p><div class='overview-actions'><button class='btn btn-danger' data-action='deleteMonth' ${d.exists?'':'disabled'}>${t('deleteMonth')}</button><button class='btn btn-primary' data-action='saveMonth' ${d.accounts.length?'':'disabled'}>${t('saveMonth')}</button></div></div>`;
 document.querySelectorAll('[data-balance]').forEach(updateBalanceDifference);
 state.dirty=false;
}

async function exportJSON(){
 try {
  const snapshot=await api('/data/export');
  const file=new Blob([JSON.stringify(snapshot,null,2)+'\n'],{type:'application/json'});
  const url=URL.createObjectURL(file);
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download='capital-tracker-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  notify(t('jsonExported'));
 } catch(err){notify(err.message||t('error'),true)}
}
async function importJSON(file){
 if(!file)return;
 try {
  if(file.size>8*1024*1024)throw new Error(t('json_too_large'));
  const body=await file.text();
  let parsed;
  try{parsed=JSON.parse(body)}catch{throw new Error(t('invalidJSONFile'))}
  if(parsed?.format!=='capital-tracker'||parsed.schema_version!==1||!Array.isArray(parsed.accounts)||!Array.isArray(parsed.months)){
   throw new Error(t('invalidJSONFile'));
  }
  if(!(await confirmClean()))return;
  const approved=await showConfirm({
   title:t('confirmImportTitle'),
   message:t('confirmImportMessage').replace('{accounts}',String(parsed.accounts.length)).replace('{months}',String(parsed.months.length)),
   confirmLabel:t('importJSON'),cancelLabel:t('cancel'),danger:true
  });
  if(!approved)return;
  await api('/data/import',{method:'POST',headers:{'X-Capital-Tracker-Import':'replace'},body});
  state.settings=await api('/settings');
  themeApply();
  await refresh();
  state.month=state.history.filter(p=>p.complete).at(-1)?.month||state.months.at(-1)?.month||new Date().toLocaleDateString('sv-SE').slice(0,7);
  state.dirty=false;
  await render();
  notify(t('jsonImported'));
 }catch(err){notify(err.message||t('error'),true)}
}


async function clearAllData(){
 if(!(await confirmClean()))return;
 const phrase=t('clearDataPhrase');
 const approved=await showTypedConfirm({
  title:t('clearDataTitle'),
  message:t('clearDataWarning'),
  prompt:t('clearDataPrompt').replace('{phrase}',phrase),
  phrase,
  confirmLabel:t('clearAllData'),
  cancelLabel:t('cancel')
 });
 if(!approved)return;
 await api('/data/clear',{method:'POST',headers:{'X-Capital-Tracker-Clear':'DELETE'},body:JSON.stringify({confirm:'DELETE'})});
 state.settings=await api('/settings');
 themeApply();
 await refresh();
 state.page='dashboard';
 state.month=new Date().toLocaleDateString('sv-SE').slice(0,7);
 state.monthData=null;
 state.dashboard=null;
 state.dirty=false;
 state.selectedAccount=null;
 await render();
 notify(t('dataCleared'));
}

function renderSettings(){
 const s=state.settings;
 $('#pageContent').innerHTML=`<section class="card panel"><h2>${t('preferences')}</h2>
 <div class="settings-row"><div><strong>${t('language')}</strong><p class="subtle">English / Русский</p></div>
 <select id="languageSelect"><option value="en" ${s.language==='en'?'selected':''}>English</option><option value="ru" ${s.language==='ru'?'selected':''}>Русский</option></select></div>
 <div class="settings-row"><div><strong>${t('theme')}</strong></div>
 <select id="themeSelect">${['system','light','dark'].map(v=>`<option value="${v}" ${s.theme===v?'selected':''}>${t(v)}</option>`).join('')}</select></div></section>
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
 <p>${t('about')}</p><p class="caption">${t('version')}: ${escapeHTML(s.version)}</p></section>`;
}
async function render(){renderNav();renderHeader();if(state.page==='dashboard')await renderDashboard();else if(state.page==='accounts')await renderAccounts();else if(state.page==='monthly')await renderMonthly();else renderSettings();}
async function refresh(){const [accounts,months,history,currencies]=await Promise.all([api('/accounts'),api('/months'),api('/capital/history'),api('/currencies')]);state.accounts=accounts;state.months=months;state.history=history.points;state.currencies=currencies.currencies;}
async function mutation(done){try{await done();await refresh();await render()}catch(e){notify(e.message||t('error'),true)}}
async function saveMonth(){
 const inputs=[...document.querySelectorAll('[data-balance],[data-rate]')];const balances=[],rates=[];let bad=false;
 for(const el of inputs){el.classList.remove('invalid');try{
  if(el.dataset.balance){const v=parseMoney(el.value);if(v!=null)balances.push({account_id:Number(el.dataset.balance),amount_minor:v})}
  if(el.dataset.rate){const v=parseRate(el.value);if(v!=null)rates.push({currency:el.dataset.rate,rate:v})}
 }catch(e){el.classList.add('invalid');el.setAttribute('aria-invalid','true');notify(e.message,true);bad=true}}
 if(bad)return;
 try{await request('/months/'+state.month,'PUT',{balances,rates});state.dirty=false;await refresh();await render();notify(t(state.monthData?.complete?'saved':'savedIncomplete'))}catch(e){notify(t('endpointError')+' '+e.message,true)}
}

function showAccountEditor(action,account){
 const dialog=$('#accountDialog');
 const latest=state.months.at(-1)?.month||state.month;
 const month=nextMonth(latest,1);
 const titles={rename:'rename',currency:'changeCurrency',archive:'archive',restore:'restore'};
 const helpers={currency:'currencyHelp',archive:'archiveWarning',restore:'restoreWarning'};
 const labels={rename:'accountName',currency:'currency',archive:'archiveFrom',restore:'restoreFrom'};
 dialog.dataset.action=action;
 dialog.dataset.id=String(account.id);
 $('#editTitle').textContent=t(titles[action])+' · '+account.name;
 $('#editHelp').textContent=helpers[action]?t(helpers[action]):'';
 let html='';
 if(action==='currency'){
  html='<label for="editValue">'+t(labels[action])+'</label><select id="editValue" name="value" required>'+
   state.currencies.map(c=>'<option value="'+c+'"'+(c===account.currency?' selected':'')+'>'+c+'</option>').join('')+'</select>';
 }else{
  const value=action==='rename'?account.name:month;
  const type=action==='rename'?'text':'month';
  const extra=type==='month'?' min="1900-01" max="2200-12"':' maxlength="100"';
  html='<label for="editValue">'+t(labels[action])+'</label><input id="editValue" name="value" type="'+type+'"'+extra+' required value="'+escapeHTML(value)+'">';
 }
 $('#editFields').innerHTML=html;
 $('#cancelEdit').textContent=t('cancel');
 $('#confirmEdit').textContent=t('confirm');
 dialog.showModal();
 $('#editValue').focus();
}

async function submitAccountEdit(form){
 const dialog=$('#accountDialog');
 const action=dialog.dataset.action, id=Number(dialog.dataset.id);
 const value=form.elements.namedItem('value').value;
 try{
  if(action==='rename')await request('/accounts/'+id,'PATCH',{name:value});
  if(action==='currency')await request('/accounts/'+id,'PATCH',{currency:value});
  if(action==='archive')await request('/accounts/'+id+'/archive','POST',{month:value});
  if(action==='restore')await request('/accounts/'+id+'/restore','POST',{start_month:value});
  dialog.close();
  await refresh();
  await render();
  notify(t(action==='archive'?'accountArchived':action==='restore'?'accountRestored':'accountUpdated'));
 }catch(err){notify(err.message||t('error'),true)}
}

async function accountAction(action,id){const account=state.accounts.find(a=>a.id===id);if(!account)return;
 if(['rename','currency','archive','restore'].includes(action)){
  showAccountEditor(action,account);
  return;
 }
 if(action==='delete'){
  if(!(await showConfirm({title:t('deleteAccountTitle'),message:t('confirmDelete'),confirmLabel:t('delete'),cancelLabel:t('cancel'),danger:true})))return;
  await mutation(async()=>{await api('/accounts/'+id,{method:'DELETE',headers:{'X-Capital-Tracker':'1'}});notify(t('accountDeleted'))});
 }
 if(action==='history'){const hist=[];for(const m of state.months){const d=await api('/months/'+m.month);const b=d.balances.find(x=>x.account_id===id);if(b)hist.push([m.month,b.amount_minor])}const content=hist.length?hist.map(([month,value])=>`<tr><td>${monthLabel(month)}</td><td>${money(value,account.currency)}</td></tr>`).join(''):`<tr><td colspan="2">${t('historicalEmpty')}</td></tr>`;$('#pageContent').innerHTML=`<section class="card panel"><div class="panel-heading"><h2>${escapeHTML(account.name)} · ${t('balanceHistory')}</h2><button class="btn btn-small" data-page="accounts">${t('earlier')}</button></div><p class="caption">${t('accountHistoricalNote')}</p><div class="table-scroll"><table><tbody>${content}</tbody></table></div></section>`;}
 if(action==='up'||action==='down'){const ids=state.accounts.map(a=>a.id);const i=ids.indexOf(id),j=i+(action==='up'?-1:1);if(j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];await mutation(async()=>{await request('/accounts/reorder','PUT',{ids})})}
}
document.addEventListener('click',async e=>{
 const node=e.target.closest('[data-page],[data-action]');if(!node)return;
 const page=node.dataset.page;if(page){await navigate(page);return}
 const action=node.dataset.action,id=Number(node.dataset.id);
 try{
  if(action==='monthPrev')await setMonth(nextMonth(state.month,-1));
  else if(action==='monthNext')await setMonth(nextMonth(state.month,1));
  else if(action==='selectColumn')await setMonth(node.dataset.month);
  else if(action==='focusAdd'){$('#accountName')?.focus()}
  else if(action==='exportJSON')await exportJSON();
  else if(action==='importJSON')$('#jsonFileInput')?.click();
  else if(action==='clearAllData')await clearAllData();
  else if(action==='copyPrevious'){
    const input=document.querySelector(`[data-balance="${id}"]`);
    if(!input||input.dataset.previousMinor==='')return;
    input.value=minorToInput(input.dataset.previousMinor);
    input.classList.remove('invalid');input.removeAttribute('aria-invalid');
    state.dirty=true;updateBalanceDifference(input);input.focus();
   }
   else if(action==='saveMonth')await saveMonth();
  else if(action==='deleteMonth'){
   if(!state.monthData?.exists||!(await showConfirm({title:t('deleteMonth'),message:t('confirmDeleteMonth'),confirmLabel:t('delete'),cancelLabel:t('cancel'),danger:true})))return;
   await request('/months/'+state.month,'DELETE',{confirm:true});
   await refresh();
   state.month=state.months.at(-1)?.month||state.month;
   await render();
   notify(t('monthDeleted'));
  }
  else if(id)await accountAction(action,id);
 }catch(err){notify(err.message||t('error'),true)}
});
document.addEventListener('submit',async e=>{
 if(e.target.id==='editAccountForm'){
  e.preventDefault();
  await submitAccountEdit(e.target);
  return;
 }
 if(e.target.id!=='addAccountForm')return;e.preventDefault();const form=e.target;
 await mutation(async()=>{await request('/accounts','POST',{name:form.elements.name.value,currency:form.elements.currency.value,start_month:form.elements.start.value});notify(t('accountCreated'))});
});
document.addEventListener('input',e=>{if(e.target.matches('.editor-input')){state.dirty=true;e.target.classList.remove('invalid');e.target.removeAttribute('aria-invalid');if(e.target.matches('[data-balance]'))updateBalanceDifference(e.target);}});
document.addEventListener('change',async e=>{
 if(e.target.id==='jsonFileInput'){
  const file=e.target.files?.[0];
  e.target.value='';
  await importJSON(file);
  return;
 }
 if(e.target.classList.contains('month-picker')){const changed=await setMonth(e.target.value);if(!changed&&e.target.isConnected)e.target.value=state.month;return}
 if(e.target.id==='columnCount'){
  state.columnCount=Number(e.target.value);
  await render();
  return;
 }
 if(e.target.id==='languageSelect'||e.target.id==='themeSelect'){
  const language=e.target.id==='languageSelect'?e.target.value:state.settings.language;
  const theme=e.target.id==='themeSelect'?e.target.value:state.settings.theme;
  try{state.settings=await request('/settings','PATCH',{language,theme});themeApply();await render()}catch(err){notify(err.message,true);await render()}
 }
});
$('#cancelEdit').addEventListener('click',()=>$('#accountDialog').close());
$('#accountDialog').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.close()});
$('#mobileMenu').addEventListener('click',()=>$('#sidebar').classList.toggle('show'));
function pointTooltip(node,event){const p=state.history[Number(node.dataset.chartIndex)];if(!p)return;const tooltip=$('#chartTooltip');tooltip.textContent=`${monthLabel(p.month)} · ${money(p.total_eur_minor)}`;tooltip.hidden=false;const rect=node.getBoundingClientRect();const clientX=event?.clientX||rect.left+rect.width/2;const clientY=event?.clientY||rect.top;tooltip.style.left=`${Math.max(8,Math.min(window.innerWidth-200,clientX-80))}px`;tooltip.style.top=`${Math.max(8,clientY-45)}px`}
document.addEventListener('pointerover',e=>{const n=e.target.closest('[data-chart-index]');if(n)pointTooltip(n,e)});
document.addEventListener('pointermove',e=>{const n=e.target.closest('[data-chart-index]');if(n)pointTooltip(n,e)});
document.addEventListener('pointerout',e=>{if(e.target.closest('[data-chart-index]'))$('#chartTooltip').hidden=true});
document.addEventListener('focusin',e=>{if(e.target.matches('[data-chart-index]'))pointTooltip(e.target)});
document.addEventListener('focusout',e=>{if(e.target.matches('[data-chart-index]'))$('#chartTooltip').hidden=true});
async function boot(){try{
 state.settings=await api('/settings');themeApply();await refresh();
 const lastComplete=state.history.filter(x=>x.complete).at(-1);
 if(lastComplete)state.month=lastComplete.month;else if(state.months.length)state.month=state.months[state.months.length-1].month;
 await render();
 if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
 }catch(e){$('#pageContent').innerHTML=`<div class="card empty"><h2>${t('error')}</h2><p>${escapeHTML(e.message)}</p><button class="btn" id="retryBtn">${t('retry')}</button></div>`;$('#retryBtn')?.addEventListener('click',boot)}}
boot();
