import { copy, pageDescriptions } from './ui-copy.js';
import { checkNumbers, mergeSavedFields } from './form-utils.js';
import { icon, brandMark, esc, initial, fileUrl, serverIcon, toggle, row } from './dashboard-ui.js';

const root = document.getElementById('root');
const toastEl = document.getElementById('toast');
const appDialog = document.getElementById('app-dialog');
const navGroups = [['overview','features'],['automod'],['welcome','tickets','levels','starboard','community'],['send','hooks','music','games'],['settings']];
const savedLang = localStorage.getItem('sanad_ui');
const browserLang = (navigator.languages || [navigator.language]).map(l => l?.split('-')[0]).find(l => l === 'ar' || l === 'en');
const state = {
  lang: ['ar','en'].includes(savedLang) ? savedLang : browserLang || 'ar',
  me: null, servers: [], serverId: localStorage.getItem('sanad_server') || null,
  place: localStorage.getItem('sanad_place') === 'server' ? 'server' : 'home',
  tab: navGroups.flat().includes(localStorage.getItem('sanad_tab')) ? localStorage.getItem('sanad_tab') : 'overview',
  config: null, invite: '', directory: {channels:[],roles:[],error:''}, hidden:0, menu:false, loadingServer:false,
};
function t(key) { return copy[state.lang][key] || key; }
function tr(ar,en) { return state.lang === 'ar' ? ar : en; }
function applyLang() {
  document.documentElement.lang = state.lang; document.documentElement.dir = copy[state.lang].dir;
  document.title = tr('سند · لوحة التحكم','Sanad · Dashboard');
}
function currentServer() { return state.servers.find(s => (s._id || s.id) === state.serverId) || null; }
let toastTimer;
function toast(message) {
  clearTimeout(toastTimer); toastEl.textContent = message; toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'),3000);
}
async function api(path, options = {}) {
  const response = await fetch(path, {...options, credentials:'same-origin', headers:{'Content-Type':'application/json',...options.headers}});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'http_'+response.status);
    error.permission = data.permission || '';
    throw error;
  }
  return data;
}
function yn(on) { return on ? t('on') : t('off'); }
function note(error, permission) {
  const messages = {
    bot_error: tr('تعذّر الوصول إلى البوت. تحقق من اتصاله وصلاحياته.','Could not reach the bot. Check its connection and permissions.'),
    unauthorized: tr('انتهت الجلسة. سجّل الدخول مجددًا.','Your session expired. Sign in again.'),
    forbidden: t('need_manage_server'),
    rate_limited: tr('زرزور طلب الانتظار لحظة. أعد المحاولة.','Zrzur asked for a short wait. Try again.'),
    need_manage_server: t('need_manage_server'),
    MissingPermission: permission === 'ManageWebhooks'
      ? t('botMissingWebhooks')
      : t('MissingPermission'),
  };
  if (messages[error]) return messages[error];
  if (copy[state.lang][error]) return t(error);
  return tr('تعذّر إكمال الطلب. تحقق من الاتصال والصلاحيات، ثم حاول مجددًا.','The request could not be completed. Check the connection and permissions, then try again.');
}
function greet(name) {
  const hour = new Date().getHours();
  const isolatedName = '\u2068' + name + '\u2069';
  return state.lang === 'ar' ? (hour < 12 ? 'صباح الخير، ' : 'مساء الخير، ')+isolatedName : (hour < 12 ? 'Good morning, ' : hour < 18 ? 'Good afternoon, ' : 'Good evening, ')+isolatedName;
}
function pickChannel(path,value,{id} = {}) {
  const channels = state.directory.channels;
  if (!channels.length) return '<input class="field" '+(id ? 'id="'+id+'"' : '')+' data-path="'+esc(path)+'" value="'+esc(value || '')+'" placeholder="'+t('channel')+'" dir="ltr"/>';
  return '<select class="select" '+(id ? 'id="'+id+'"' : '')+' data-path="'+esc(path)+'"><option value="">—</option>'+channels.map(c => '<option value="'+esc(c.id)+'" '+(c.id === value ? 'selected' : '')+'>'+esc(c.category ? c.category+' / '+c.name : c.name)+'</option>').join('')+'</select>';
}
function pickRole(path,value) {
  const roles = state.directory.roles;
  if (!roles.length) return '<input class="field" data-path="'+esc(path)+'" value="'+esc(value || '')+'" dir="ltr"/>';
  return '<select class="select" data-path="'+esc(path)+'"><option value="">—</option>'+roles.map(r => '<option value="'+esc(r.id)+'" '+(r.id === value ? 'selected' : '')+'>'+esc(r.name)+'</option>').join('')+'</select>';
}
function channelChoices(id) {
  const channels = state.directory.channels;
  if (!channels.length) return '<input class="field" id="'+id+'" placeholder="'+t('channel')+'" dir="ltr"/>';
  return '<select class="select" id="'+id+'">'+channels.map(c => '<option value="'+esc(c.id)+'">'+esc(c.category ? c.category+' / '+c.name : c.name)+'</option>').join('')+'</select>';
}

function inviteFor() { return state.invite || 'https://app.zrzur.com/'; }
function languageButton() {
  return `<button class="out language-switch" data-language aria-label="${t('interfaceLang')}">${icon('globe')}<span lang="${state.lang === 'ar' ? 'en' : 'ar'}">${state.lang === 'ar' ? 'English' : 'العربية'}</span></button>`;
}
function bindLanguage() {
  root.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', async () => {
    if (!(await mayLeaveView())) return;
    state.lang = state.lang === 'ar' ? 'en' : 'ar'; localStorage.setItem('sanad_ui',state.lang);
    state.me ? renderShell() : renderLogin();
  }));
}
function appChrome(name) {
  return '<div class="app-caption" aria-hidden="true"></div>';
}
function renderLogin() {
  applyLang();
  const error = new URLSearchParams(location.search).get('error');
  root.innerHTML = `<div class="login-page">${appChrome('Sanad')}<header class="login-header"><a class="wordmark" href="/">${brandMark()}<strong>Sanad <span>${tr('لوحة التحكم','Dashboard')}</span></strong></a>${languageButton()}</header><main class="login-layout"><section class="login-intro"><span class="eyebrow">SANAD / ZRZUR</span><h1>${tr('كل ما يحتاجه<br>مجتمعك.','A better home<br>for your community.')}</h1><p>${t('loginBody')}</p><div class="login-points">${['automod','community','tickets'].map(key => `<span>${icon(key)}${t(key)}</span>`).join('')}</div></section><section class="login-card">${brandMark('login-symbol')}<h2>${tr('أهلًا بعودتك','Welcome back')}</h2><p>${tr('سجّل الدخول للمتابعة إلى سيرفراتك.','Sign in to continue to your servers.')}</p>${error ? `<div class="err">${esc(note(error))}</div>` : ''}<a class="btn primary" href="/auth/login">${brandMark()}${t('signIn')}</a><div class="login-divider"><span>${tr('جديد على سند؟','New to Sanad?')}</span></div><a class="btn ghost" href="${esc(inviteFor())}" target="_blank" rel="noreferrer">${icon('plus')}${t('invite')}</a><div class="login-note">${icon('lock')}${tr('تسجيل دخول آمن عبر Zrzur','Secure sign-in through Zrzur')}</div></section></main><footer class="login-footer">Sanad · <a href="https://app.zrzur.com/" target="_blank" rel="noreferrer">Zrzur</a></footer></div>`;
  bindLanguage();
}
function groupTitle(tab) {
  const titles = [tr('السيرفر','Server'),tr('الحماية','Protection'),tr('المجتمع','Community'),tr('الأدوات','Tools'),tr('الإعدادات','Settings')];
  return titles[navGroups.findIndex(group => group.includes(tab))] || t(tab);
}
function serverCard(server) {
  const id = server._id || server.id;
  const name = esc(server.name || id);
  if (server.botPresent === true) return `<button class="server-card" data-server="${esc(id)}" data-server-name="${name}" aria-label="${name}">${serverIcon(server,'server-orb')}<strong><bdi>${name}</bdi></strong><span class="server-action">${t('open')}</span></button>`;
  const absent = server.botPresent === false;
  return `<article class="pending-server" data-server-name="${name}">${serverIcon(server,'mini-orb')}<div><strong><bdi>${name}</bdi></strong><p>${absent ? tr('سند غير مضاف إلى هذا السيرفر','Sanad has not been added to this server') : tr('تعذّر التحقق من وجود البوت','Could not verify bot access')}</p></div>${absent ? `<a class="btn ghost" href="${esc(inviteFor(server))}" target="_blank" rel="noreferrer">${icon('plus')}${tr('إضافة البوت','Add bot')}</a>` : `<button class="out" data-recheck aria-label="${t('refresh')}">${icon('refresh')}</button>`}</article>`;
}
function unavailableContent(server) {
  const absent = server?.botPresent === false;
  return `<section class="empty-state access-empty">${brandMark('',true)}<h2>${absent ? tr('أضف سند إلى السيرفر أولًا','Add Sanad to this server first') : tr('السيرفر غير متاح حاليًا','This server is currently unavailable')}</h2><p>${absent ? tr('تظهر إعدادات الإدارة بعد إضافة البوت والتحقق من صلاحيات حسابك.','Management settings appear after the bot is added and your account permissions are verified.') : tr('تعذّر التحقق من وصول البوت. حدّث قائمة السيرفرات للمحاولة مجددًا.','Bot access could not be verified. Refresh the server list to try again.')}</p>${absent ? `<a class="btn primary" href="${esc(inviteFor(server))}" target="_blank" rel="noreferrer">${icon('plus')}${tr('إضافة البوت','Add bot')}</a>` : ''}</section>`;
}
function openDialog(title, body, footer = '') {
  if (appDialog.open) appDialog.close();
  appDialog.returnValue = '';
  appDialog.innerHTML = `<header class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="out" data-close-dialog aria-label="${tr('إغلاق','Close')}">${icon('close')}</button></header><div class="dialog-body">${body}</div>${footer ? `<footer class="dialog-footer">${footer}</footer>` : ''}`;
  appDialog.dir = copy[state.lang].dir;
  appDialog.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => appDialog.close('cancel')));
  appDialog.showModal();
}
appDialog.addEventListener('click', ev => {
  if (ev.target !== appDialog) return;
  const rect = appDialog.getBoundingClientRect();
  if (ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) appDialog.close('cancel');
});
function confirmAction(title, message, action, danger = true) {
  return new Promise(resolve => {
    openDialog(title, `<p class="dialog-description">${esc(message)}</p>`, `<button class="btn quiet" data-close-dialog autofocus>${tr('إلغاء','Cancel')}</button><button class="btn ${danger ? 'danger' : 'primary'}" id="dialog-confirm">${esc(action)}</button>`);
    appDialog.addEventListener('close', () => resolve(appDialog.returnValue === 'confirm'), { once:true });
    document.getElementById('dialog-confirm').addEventListener('click', () => appDialog.close('confirm'));
    appDialog.querySelector('[autofocus]')?.focus();
  });
}
function showUnavailable(server) { openDialog(tr('إدارة السيرفر','Server management'),unavailableContent(server)); }
function showServerPicker() {
  const ready = state.servers.filter(server => server.botPresent !== false);
  const pending = state.servers.filter(server => server.botPresent === false);
  const list = ready.map(server => `<button class="picker-row" data-select-server="${esc(server._id || server.id)}">${serverIcon(server,'mini-orb')}<bdi>${esc(server.name)}</bdi>${icon('next')}</button>`).join('');
  openDialog(tr('اختر سيرفرًا','Choose a server'), `<p class="dialog-description">${tr('اختر السيرفر الذي تريد إدارة سند فيه.','Choose where you want to manage Sanad.')}</p><label class="search-box dialog-search">${icon('search')}<input type="search" id="picker-search" aria-label="${tr('البحث عن سيرفر','Search servers')}" placeholder="${tr('البحث عن سيرفر','Search servers')}"/></label><div class="picker-list">${list || `<p class="lead">${t('noServers')}</p>`}</div><p class="hint" id="picker-empty" hidden>${tr('لا توجد نتائج.','No results.')}</p>${pending.length ? `<div class="dialog-section-label">${tr('بحاجة إلى إضافة البوت','Add the bot to get started')}</div><div class="pending-servers">${pending.map(serverCard).join('')}</div>` : ''}`, `<button class="btn quiet" data-close-dialog>${tr('إغلاق','Close')}</button><a class="btn primary" href="${esc(inviteFor())}" target="_blank" rel="noreferrer">${icon('plus')}${t('invite')}</a>`);
  appDialog.querySelectorAll('[data-select-server]').forEach(button => button.addEventListener('click', () => { appDialog.close(); openServer(button.dataset.selectServer); }));
  appDialog.querySelectorAll('[data-recheck]').forEach(button => button.addEventListener('click', async () => { button.disabled = true; try { await refreshDirectory(); renderShell(); showServerPicker(); } catch(e) { toast(note(e.message)); button.disabled = false; } }));
  document.getElementById('picker-search').addEventListener('input', ev => {
    const query = ev.target.value.normalize('NFKC').toLocaleLowerCase(state.lang); let count = 0;
    appDialog.querySelectorAll('[data-select-server]').forEach(button => { button.hidden = !button.textContent.normalize('NFKC').toLocaleLowerCase(state.lang).includes(query); if (!button.hidden) count++; });
    document.getElementById('picker-empty').hidden = count > 0 || !query;
  });
}
function showAbout() {
  openDialog(tr('حول سند','About Sanad'), `<div class="about-brand">${brandMark()}<strong>Sanad <span>${tr('سند','Community bot')}</span></strong></div><p class="dialog-description">${tr('بوت إدارة المجتمع على Zrzur. أدوات الحماية والترحيب والتذاكر والمستويات، في مساحة واحدة.','Your Zrzur community bot. Protection, welcome messages, tickets, and levels in one space.')}</p><div class="detail-card"><div>${icon('community')}<span>${tr('سيرفرات متاحة للإدارة','Manageable servers')}</span><strong>${state.servers.filter(s => s.botPresent === true).length}</strong></div><div>${icon('globe')}<span>${t('interfaceLang')}</span><strong>${state.lang === 'ar' ? 'العربية' : 'English'}</strong></div><div>${icon('info')}<span>${tr('الإصدار','Version')}</span><strong><bdi>1.0</bdi></strong></div></div>`, `<button class="btn quiet" data-close-dialog>${tr('إغلاق','Close')}</button><a class="btn ghost" href="https://app.zrzur.com/" target="_blank" rel="noreferrer">${icon('external')}${tr('فتح Zrzur','Open Zrzur')}</a>`);
}
function formSnapshot(view) {
  return JSON.stringify([...view.querySelectorAll('input,select,textarea')].map(node => [node.id || node.dataset.path,node.value]));
}
async function mayLeaveView() {
  const view = document.getElementById('view');
  if (!view?.dataset.formSnapshot || view.dataset.formSnapshot === formSnapshot(view)) return true;
  return confirmAction(tr('مغادرة دون حفظ؟','Leave without saving?'),tr('لديك تعديلات لم تُحفظ. هل تريد تجاهلها ومغادرة الصفحة؟','You have unsaved changes. Discard them and leave this page?'),tr('تجاهل التعديلات','Discard changes'),false);
}
function decorateView() {
  const view = document.getElementById('view');
  if (!view) return;
  view.querySelectorAll('.panel').forEach(panel => {
    const rows = [...panel.children].filter(child => child.classList.contains('row'));
    if (!rows.length) return;
    const group = document.createElement('div');
    group.className = 'settings-rows';
    rows[0].before(group);
    rows.forEach(row => group.append(row));
    panel.classList.add('settings-section');
  });
  view.querySelectorAll('.panel > h3').forEach(heading => {
    if (!['community','automod'].includes(state.tab) && heading.textContent === t(state.tab)) { heading.remove(); return; }
    const key = Object.keys(pageDescriptions).find(key => t(key) === heading.textContent) || state.tab;
    heading.insertAdjacentHTML('afterbegin',icon(key));
  });
  view.querySelectorAll('.btn').forEach(button => {
    if (button.querySelector('.icon')) return;
    const label = button.textContent.trim();
    const operation = button.dataset.act;
    const name = operation === 'delete' ? 'trash' : operation === 'regen' ? 'refresh' : operation === 'save' || label === t('save') || label === t('saveToken') ? 'save' : operation === 'send' || label === t('send') ? 'send' : 'plus';
    button.insertAdjacentHTML('afterbegin', icon(name));
    if (operation === 'delete') button.classList.add('danger-text');
  });
  view.querySelectorAll('textarea,input[type="text"],input:not([type])').forEach(input => input.dir = 'auto');
  view.querySelectorAll('input[data-path$="Id"],input[id$="prefix"],input[id$="colour"],input[type="number"],[data-path="autorole.roleIds"],[data-path="automod.ignoreChannels"]').forEach(input => input.dir = 'ltr');
  view.dataset.formSnapshot = formSnapshot(view);
  installSectionEditors(view);
}
function installSectionEditors(view) {
  view.querySelectorAll('.panel').forEach(panel => {
    const save = panel.querySelector('#save-settings,#save-am,#save-raid,[data-save-fields]');
    if (!save) return;
    panel.dataset.savedFields = formSnapshot(panel);
    const toolbar = save.closest('.toolbar');
    toolbar.insertAdjacentHTML('afterbegin', `<span class="edit-status" role="status"></span><button class="btn quiet" type="button" data-reset-section>${tr('تراجع عن التعديلات','Reset changes')}</button>`);
    const reset = toolbar.querySelector('[data-reset-section]');
    panel.querySelectorAll('input[type="number"]').forEach(input => {
      input.min = input.dataset.path === 'starboard.threshold' ? '1' : '0';
      input.max = input.dataset.path === 'starboard.threshold' ? '50' : '86400';
      input.step = '1';
    });
    const update = () => {
      const dirty = panel.dataset.savedFields !== formSnapshot(panel);
      save.disabled = !dirty; reset.disabled = !dirty;
      toolbar.querySelector('.edit-status').textContent = dirty ? tr('تعديلات غير محفوظة','Unsaved changes') : tr('كل التعديلات محفوظة','All changes saved');
      panel.classList.toggle('is-dirty',dirty);
    };
    panel.addEventListener('input', ev => { ev.target.setCustomValidity?.(''); update(); });
    panel.addEventListener('change',update);
    reset.addEventListener('click', () => {
      const values = new Map(JSON.parse(panel.dataset.savedFields));
      panel.querySelectorAll('input,select,textarea').forEach(input => { input.value = values.get(input.id || input.dataset.path) ?? ''; input.setCustomValidity(''); });
      update();
    });
    panel.updateEditor = update;
    update();
  });
  view.querySelectorAll('textarea[maxlength]').forEach(input => {
    const counter = document.createElement('span'); counter.className = 'character-count'; counter.dir = 'ltr';
    input.after(counter);
    const update = () => { counter.textContent = `${input.value.length} / ${input.maxLength}`; };
    input.addEventListener('input',update); update();
  });
}
function validateSection(panel) {
  const inputs = [...panel.querySelectorAll('input,select,textarea')];
  const error = checkNumbers(inputs.map(input => ({path:input.dataset.path,type:input.type,value:input.value})));
  if (error) {
    const input = inputs.find(input => input.dataset.path === error.path);
    input.setCustomValidity(error.order ? tr('الحد الأدنى يجب ألا يتجاوز الحد الأعلى.','The minimum must not exceed the maximum.') : tr(`أدخل عددًا صحيحًا من ${error.min} إلى ${error.max}.`,`Enter a whole number between ${error.min} and ${error.max}.`));
  }
  return inputs.every(input => input.reportValidity());
}
function commitSection(panel) {
  const view = document.getElementById('view');
  const saved = JSON.parse(formSnapshot(panel));
  view.dataset.formSnapshot = JSON.stringify(mergeSavedFields(JSON.parse(view.dataset.formSnapshot),saved));
  panel.dataset.savedFields = JSON.stringify(saved);
  panel.updateEditor?.();
}
document.addEventListener('click', ev => {
  if (!state.menu || ev.target.closest('.userbar')) return;
  state.menu = false;
  const menu = document.getElementById('account-menu');
  if (menu) menu.hidden = true;
  document.getElementById('userbar')?.setAttribute('aria-expanded','false');
});
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape' || !state.menu) return;
  state.menu = false; document.getElementById('account-menu').hidden = true;
  document.getElementById('userbar').setAttribute('aria-expanded','false'); document.getElementById('userbar').focus();
});
window.addEventListener('beforeunload', ev => {
  const view = document.getElementById('view');
  if (view?.dataset.formSnapshot && view.dataset.formSnapshot !== formSnapshot(view)) {
    ev.preventDefault(); ev.returnValue = '';
  }
});

function renderShell() {
  applyLang();
  const server = state.place === 'server' ? currentServer() : null;
  const user = state.me || {};
  const name = user.display_name || user.username || 'User';
  const avatar = fileUrl('avatar',user);
  const ready = state.servers;
  const rail = ready.map(s => {
    const id = s._id || s.id;
    return `<button class="srv ${server && id === state.serverId ? 'active' : ''}" data-server="${esc(id)}" data-tooltip="${esc(s.name)}" aria-label="${esc(s.name)}" ${server && id === state.serverId ? 'aria-current="page"' : ''}>${serverIcon(s,'rail-orb')}</button>`;
  }).join('');
  const groups = [tr('إدارة السيرفر','Server'),tr('الأمان','Safety'),tr('المجتمع','Community'),tr('الأدوات','Tools'),tr('التفضيلات','Preferences')];
  const nav = server ? navGroups.map((group,index) => `<div class="nav-group"><div class="nav-label">${icon('chevron')}${groups[index]}</div>${group.map(id => `<button data-tab="${id}" class="${state.tab === id ? 'active' : ''}" ${state.tab === id ? 'aria-current="page"' : ''}>${icon(id)}<span>${t(id === "send" ? "messages" : id)}</span></button>`).join('')}</div>`).join('') : `<div class="nav-group"><button data-server-picker>${icon('community')}${t('yourServers')}</button></div>`;
  const siblings = navGroups.find(group => group.includes(state.tab)) || ['overview'];
  root.innerHTML = appChrome(server?.name || t('yourServers')) + `<div class="app"><aside class="rail" aria-label="${t('yourServers')}"><button class="brand ${server ? '' : 'on'}" data-server-picker data-tooltip="${t('yourServers')}" aria-label="${t('yourServers')}">${brandMark()}</button><div class="sep"></div>${rail}<button class="srv add-server" data-server-picker data-tooltip="${t('yourServers')}" aria-label="${t('yourServers')}">${icon('plus')}</button><a class="rail-bottom" href="https://app.zrzur.com/" target="_blank" rel="noreferrer" aria-label="Zrzur">${icon('external')}</a></aside>
    <aside class="side"><button class="side-head ${server ? 'has-banner' : ''}" data-server-picker aria-haspopup="dialog">${server ? `<div class="server-banner">${brandMark()}</div>` : ''}<span class="side-brand">${server ? serverIcon(server,'mini-orb') : brandMark()}<bdi>${esc(server?.name || 'Sanad')}</bdi></span>${icon('chevron')}</button><nav class="nav" aria-label="${tr('التنقل الرئيسي','Main navigation')}">${nav}</nav><div class="sidebar-footer"><a href="https://app.zrzur.com/" target="_blank" rel="noreferrer">${icon('external')}${tr('فتح Zrzur','Open Zrzur')}</a><span class="sidebar-version">Sanad <bdi>v1.0</bdi></span></div></aside>
    <div class="userbar"><div class="avatar">${avatar ? `<img src="${esc(avatar)}" alt="${esc(name)}"/>` : `<span aria-hidden="true">${esc(initial(name))}</span>`}</div><div class="meta"><div class="name"><bdi>${esc(name)}</bdi></div>${user.username && user.username !== name ? `<div class="sub"><bdi dir="ltr">@${esc(user.username)}</bdi></div>` : ""}</div><button class="out" id="userbar" aria-label="${tr('قائمة الحساب','Account menu')}" aria-expanded="${state.menu}">${icon('settings')}</button><div class="menu" id="account-menu" ${state.menu ? '' : 'hidden'}><span class="menu-label">${tr('حسابك','Your account')}</span><button id="cycle-lang">${icon('globe')}${t('interfaceLang')}<span>${state.lang === 'ar' ? 'English' : 'العربية'}</span></button><a class="danger-text" href="/logout">${icon('logout')}${t('logout')}</a></div></div>
    <main class="main"><header class="top">${icon(server ? state.tab : 'home')}<h1 id="view-title"></h1>${server && siblings.length > 1 ? `<div class="top-separator"></div><nav class="view-tabs" aria-label="${tr('أقسام الصفحة','Page sections')}">${siblings.map(id => `<button data-tab="${id}" class="${id === state.tab ? 'active' : ''}" ${id === state.tab ? 'aria-current="page"' : ''}>${t(id === "send" ? "messages" : id)}</button>`).join('')}</nav>` : ''}<div class="top-actions">${languageButton()}<button class="out" data-about aria-label="${tr('حول سند','About Sanad')}" data-tooltip="${tr('حول سند','About Sanad')}">${icon('info')}</button><button class="out" id="refresh-view" data-tooltip="${t('refresh')}" aria-label="${t('refresh')}">${icon('refresh')}</button></div></header><div class="content" id="view"></div></main></div>`;
  root.querySelectorAll('[data-home]').forEach(button => button.addEventListener('click',async () => {
    if (!(await mayLeaveView())) return;
    state.place = 'home'; state.menu = false; localStorage.setItem('sanad_place','home'); renderShell();
  }));
  root.querySelectorAll('[data-server]').forEach(button => button.addEventListener('click',() => openServer(button.dataset.server)));
  root.querySelectorAll('[data-server-picker]').forEach(button => button.addEventListener('click',showServerPicker));
  root.querySelectorAll('[data-about]').forEach(button => button.addEventListener('click',showAbout));
  root.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click',() => navigateTab(button.dataset.tab)));
  installMobileNavigation();
  document.getElementById('userbar').addEventListener('click',() => {
    state.menu = !state.menu; document.getElementById('account-menu').hidden = !state.menu;
    document.getElementById('userbar').setAttribute('aria-expanded',String(state.menu));
  });
  document.getElementById('cycle-lang').addEventListener('click',async () => {
    if (!(await mayLeaveView())) return;
    state.lang = state.lang === 'ar' ? 'en' : 'ar'; state.menu = false;
    localStorage.setItem('sanad_ui',state.lang); renderShell();
  });
  document.getElementById('refresh-view').addEventListener('click',async ev => {
    if (!(await mayLeaveView())) return;
    const button = ev.currentTarget; button.disabled = true;
    try {
      await refreshDirectory();
      if (server && currentServer()?.botPresent === true) await loadConfig(); else state.place = 'home';
      renderShell(); toast(t('updated'));
    } catch(e) { toast(note(e.message)); } finally { button.disabled = false; }
  });
  bindLanguage(); renderView();
  root.querySelector('.nav .active')?.scrollIntoView({block:'nearest',inline:'nearest'});
  root.querySelector('.view-tabs .active')?.scrollIntoView({block:'nearest',inline:'nearest'});
}
function installMobileNavigation() {
  const app = root.querySelector('.app');
  if (!app) return;
  const primary = ['overview','automod','community'];
  app.insertAdjacentHTML('beforeend', `<nav class="mobile-dock" aria-label="${tr('التنقل','Navigation')}">${primary.map(tab => `<button data-mobile-tab="${tab}" ${state.tab === tab ? 'aria-current="page"' : ''}>${icon(tab)}<span>${t(tab)}</span></button>`).join('')}<button data-mobile-more ${!primary.includes(state.tab) ? 'aria-current="page"' : ''} aria-haspopup="dialog">${icon('menu')}<span>${tr('المزيد','More')}</span></button></nav>`);
  root.querySelector('.top').insertAdjacentHTML('afterbegin', `<button class="out mobile-server-picker" aria-label="${t('pick')}" aria-haspopup="dialog">${icon('community')}</button>`);
  root.querySelector('.mobile-server-picker').addEventListener('click',showServerPicker);
  root.querySelectorAll('[data-mobile-tab]').forEach(button => button.addEventListener('click',() => navigateTab(button.dataset.mobileTab)));
  root.querySelector('[data-mobile-more]').addEventListener('click',() => {
    openDialog(tr('أدوات السيرفر','Server tools'), `<div class="mobile-sheet-context">${serverIcon(currentServer(),'mini-orb')}<bdi>${esc(currentServer()?.name || t('pick'))}</bdi></div><div class="mobile-tools-grid">${navGroups.flat().filter(tab => !primary.includes(tab)).map(tab => `<button class="mobile-tool" data-sheet-tab="${tab}" ${state.tab === tab ? 'aria-current="page"' : ''}>${icon(tab)}<span>${t(tab === 'send' ? 'messages' : tab)}</span></button>`).join('')}</div><div class="mobile-account-summary"><span class="avatar">${fileUrl('avatar',state.me) ? `<img src="${esc(fileUrl('avatar',state.me))}" alt=""/>` : esc(initial(state.me?.display_name || state.me?.username))}</span><bdi>${esc(state.me?.display_name || state.me?.username || '')}</bdi></div>`, `<button class="btn quiet" data-close-dialog>${tr('إغلاق','Close')}</button><a class="btn ghost" href="/logout">${icon('logout')}${t('logout')}</a>`);
    appDialog.querySelectorAll('[data-sheet-tab]').forEach(button => button.addEventListener('click',() => { appDialog.close(); navigateTab(button.dataset.sheetTab); }));
  });
}

async function navigateTab(tab) {
  if (!(await mayLeaveView())) return;
  state.place = 'server'; state.tab = tab; localStorage.setItem('sanad_place','server'); localStorage.setItem('sanad_tab',tab); renderShell();
}
async function refreshDirectory() {
  const data = await api('/api/boot');
  if (!data.user) { location.assign('/'); return; }
  state.me = data.user; state.servers = data.servers || []; state.hidden = Number(data.hidden) || 0;
}

async function openServer(id) {
  if (state.loadingServer || !(await mayLeaveView())) return;
  const server = state.servers.find(s => (s._id || s.id) === id);
  if (!server) return;
  if (server.botPresent === false) { state.serverId = id; state.place = 'server'; renderShell(); return; }
  state.loadingServer = true;
  state.serverId = id; state.place = 'server'; state.menu = false; state.tab = 'overview'; state.config = null;
  localStorage.setItem('sanad_server', id); localStorage.setItem('sanad_place', 'server'); localStorage.setItem('sanad_tab','overview');
  const view = document.getElementById('view');
  if (view) view.innerHTML = '<div class="loading-state" role="status"><span class="spinner"></span>'+t('loading')+'</div>';
  try { await loadConfig(); server.botPresent = true; renderShell(); }
  catch(e) { server.botPresent = null; renderShell(); toast(note(e.message)); }
  finally { state.loadingServer = false; }
}

function featureOnCount(c) {
  const flags = [c.welcome?.enabled, c.goodbye?.enabled, c.leveling?.enabled, c.automod?.enabled, c.tickets?.enabled, c.antiraid?.enabled, c.starboard?.enabled];
  const on = flags.filter(Boolean).length;
  return `${on}/${flags.length}`;
}
function featureBlock() {
  const c = state.config || {};
  const items = [
    ["welcome.enabled", t("welcome"), !!c.welcome?.enabled],
    ["goodbye.enabled", t("goodbye"), !!c.goodbye?.enabled],
    ["leveling.enabled", state.lang === "ar" ? "المستويات" : "Leveling", !!c.leveling?.enabled],
    ["automod.enabled", t("automod"), !!c.automod?.enabled],
    ["tickets.enabled", state.lang === "ar" ? "التذاكر" : "Tickets", !!c.tickets?.enabled],
    ["antiraid.enabled", t("raid"), !!c.antiraid?.enabled],
    ["starboard.enabled", state.lang === "ar" ? "النجوم" : "Starboard", !!c.starboard?.enabled],
  ];
  const hints = {
    welcome: tr('رسالة مخصّصة لأعضاء مجتمعك الجدد.', 'A personal greeting for your newest members.'),
    goodbye: tr('رسالة تلقائية عند مغادرة الأعضاء.', 'An automatic message when members leave.'),
    leveling: tr('نقاط خبرة ومستويات تكافئ التفاعل.', 'Experience points and levels that reward participation.'),
    automod: tr('كواشف للسبام والروابط والمحتوى المزعج.', 'Filters for spam, links, and disruptive content.'),
    tickets: tr('مساحة دعم خاصة بين الأعضاء والطاقم.', 'Private support spaces for members and staff.'),
    antiraid: tr('الاستجابة لموجات الانضمام المفاجئة.', 'Respond to sudden surges in new members.'),
    starboard: tr('عرض الرسائل التي يميّزها مجتمعك بالنجوم.', 'Showcase messages starred by your community.'),
  };
  return items.map(([key, label, on]) => row(label, hints[key.split('.')[0]], toggle(on, key))).join("");
}

function commandGuide(kind) {
  const music = kind === 'music';
  const commands = music ? [['/play',tr('اسم أغنية أو رابط Spotify','Song name or Spotify link')],['/queue',tr('عرض قائمة الانتظار','View the queue')],['/skip',tr('تخطي الأغنية الحالية','Skip the current track')],['/stop',tr('إيقاف التشغيل','Stop playback')]] : [['/xo',tr('لعبة إكس أو مع صديق','Play tic-tac-toe with a friend')],['/rps',tr('حجر، ورقة، مقص','Rock, paper, scissors')],['/help',tr('اكتشف الألعاب والأوامر المتاحة','Discover available games and commands')]];
  return '<section class="panel command-guide"><span class="service-icon">'+icon(kind)+'</span><h3>'+t(kind)+'</h3><p class="lead">'+tr('هذه الميزة تُستخدم داخل قنوات Zrzur. استخدم الأوامر التالية في السيرفر.','This feature runs inside Zrzur channels. Use these commands in your server.')+'</p>'+commands.map(([command,description]) => '<div class="row"><code dir="ltr">'+command+'</code><span>'+description+'</span></div>').join('')+(music ? '<p class="hint">'+tr('يتطلب التشغيل إعداد Spotify والصوت على البوت، والانضمام إلى قناة صوتية.','Playback requires Spotify and audio configuration on the bot. Join a voice channel first.')+'</p>' : '')+'</section>';
}
function setupMessagePreview() {
  const form = document.querySelector('#view > .panel');
  if (!form) return;
  const wrapper = document.createElement('div'); wrapper.className = 'composer-layout'; form.before(wrapper); wrapper.append(form);
  wrapper.insertAdjacentHTML('beforeend','<aside class="panel message-preview"><div class="preview-label">'+icon('welcome')+tr('معاينة الرسالة','Message preview')+'</div><div class="preview-message"><span class="avatar sanad-mark">'+brandMark()+'</span><div><strong>Sanad <span class="bot-tag">BOT</span></strong><p id="preview-content" dir="auto"></p><div class="embed-preview" id="embed-preview"><strong id="preview-title" dir="auto"></strong><p id="preview-description" dir="auto"></p></div></div></div><p class="hint">'+tr('معاينة تقريبية لشكل الرسالة في القناة.','An approximate preview of your message in the channel.')+'</p></aside>');
  const update = () => {
    document.getElementById('preview-content').textContent = document.getElementById('send-content').value || tr('رسالتك تبدأ هنا…','Your message starts here…');
    document.getElementById('preview-title').textContent = document.getElementById('send-title').value;
    document.getElementById('preview-description').textContent = document.getElementById('send-desc').value;
    const embed = document.getElementById('embed-preview');
    embed.hidden = !document.getElementById('send-title').value && !document.getElementById('send-desc').value;
    const colour = document.getElementById('send-colour').value;
    embed.style.borderInlineStartColor = /^#[0-9a-f]{6}$/i.test(colour) ? colour : '#ec1460';
  };
  form.addEventListener('input', update); update();
}
function renderView() {
  const view = document.getElementById("view");
  const title = document.getElementById("view-title");
  const srv = currentServer();
  if (!view || !title) return;
  view.dataset.view = state.place === 'home' ? 'home' : state.tab;
  title.textContent = state.place === "home" ? t("yourServers") : groupTitle(state.tab);
  if (!srv) {
    const emptyTitle = state.hidden ? t("need_manage_server") : t("noServers");
    const emptyBody = state.hidden ? t("memberBlocked") : t("noServersBody");
    view.innerHTML = `<div class="panel"><h3>${emptyTitle}</h3><p class="lead">${emptyBody}</p><a class="btn primary" href="${esc(state.invite)}" target="_blank">${t("invite")}</a></div>`;
    return;
  }
  view.classList.remove("home-view");
  if (srv.botPresent !== true) { view.innerHTML = unavailableContent(srv); bindView(); return; }
  const c = state.config || {};
  const a = c.automod || {};
  if (state.tab === "overview") {
    const services = [
      ['automod','automod',!!a.enabled],['welcome','welcome',!!c.welcome?.enabled],
      ['tickets','tickets',!!c.tickets?.enabled],['levels','levels',!!c.leveling?.enabled],
      ['starboard','starboard',!!c.starboard?.enabled],['send','send',null],
    ];
    const checks = [[t('automod'),!!a.enabled,'automod'],[t('raid'),!!c.antiraid?.enabled,'automod'],[t('logs'),!!c.modLogChannelId,'settings']];
    view.innerHTML = `<div class="page-heading"><div><span class="eyebrow">${esc(srv.name)}</span><h2>${t('overview')}</h2><p>${tr(...pageDescriptions.overview)}</p></div><a class="btn ghost" href="https://app.zrzur.com/" target="_blank" rel="noreferrer">${icon('external')}${tr('فتح Zrzur','Open Zrzur')}</a></div>
      <section class="hello server-summary"><div class="hello-copy"><span class="eyebrow">Sanad / Zrzur</span><h2>${esc(srv.name)}</h2><p>${t('heroBody')}</p><button class="btn hero-button" data-jump="settings">${icon('settings')}${tr('إعدادات السيرفر','Server settings')}</button></div>${serverIcon(srv,'hero-server')}</section>
      <div class="grid stats-grid">${[[t('features'),featureOnCount(c),'features',tr('ميزات مفعّلة','enabled features')],[t('channels'),state.directory.error ? '—' : state.directory.channels.length,'send',tr('قناة نصية متاحة','available text channels')],[t('roles'),state.directory.error ? '—' : state.directory.roles.length,'community',tr('رتب السيرفر','server roles')],[t('prefix'),esc(c.prefix || '!'),'settings',tr('بادئة أوامر سند','Sanad command prefix')]].map(([label,value,key,hint]) => `<div class="stat"><div class="stat-top"><span>${label}</span>${icon(key)}</div><strong dir="auto">${value}</strong><small>${hint}</small></div>`).join('')}</div>
      ${state.directory.error ? `<div class="err">${esc(note(state.directory.error))}</div>` : ''}
      <div class="overview-columns"><section><div class="section-heading"><div><h3>${tr('أدوات مجتمعك','Your community tools')}</h3><p>${tr('كل التفاصيل، تحت سيطرتك.','Every detail, under your control.')}</p></div><button class="text-button" data-jump="features">${tr('كل الميزات','All features')}</button></div><div class="service-grid">${services.map(([id,label,on]) => `<button class="service" data-jump="${id}"><span class="service-icon ${id}">${icon(id)}</span><strong>${t(label)}</strong><span>${tr(...pageDescriptions[id])}</span><span class="service-status ${on ? 'enabled' : ''}">${on === null ? tr('كتابة رسالة','Compose a message') : yn(on)}</span></button>`).join('')}</div></section>
      <aside class="overview-aside"><section class="panel protection-summary"><div class="section-heading"><h3>${tr('حماية السيرفر','Server protection')}</h3>${icon('automod')}</div><div class="protection-symbol ${a.enabled ? 'enabled' : ''}">${icon('automod')}</div><h4>${a.enabled ? tr('الحماية التلقائية مفعّلة','Automod is enabled') : tr('عزّز أمان مجتمعك','Strengthen your community')}</h4><p class="lead">${tr('راجع إعدادات الحماية لتناسب احتياجات سيرفرك.','Review protection settings to suit your server.')}</p>${checks.map(([label,on,tab]) => `<button class="check-row" data-jump="${tab}"><span>${label}</span><span class="status-tag ${on ? 'enabled' : ''}">${yn(on)}</span></button>`).join('')}<button class="btn ghost full" data-jump="automod">${tr('إدارة الحماية','Manage protection')}</button></section><section class="panel quick-panel"><h3>${tr('وصول سريع','Quick access')}</h3><button class="quick-row" data-jump="send">${icon('send')}${tr('إرسال إعلان','Send an announcement')}</button><button class="quick-row" data-jump="hooks">${icon('hooks')}${t('hooks')}</button><button class="quick-row" data-jump="music">${icon('music')}${tr('دليل الموسيقى','Music guide')}</button></section></aside></div>`;
  } else if (state.tab === "features") {
    view.innerHTML = `<section class="panel"><h3>${t("features")}</h3><p class="lead">${tr("تُحفظ تغييرات مفاتيح التفعيل مباشرة لهذا السيرفر.", "Switch changes are saved immediately for this server.")}</p>${featureBlock()}</section>`;
  } else if (state.tab === "automod") {
    const dets = [
      ["automod.antiSpam", state.lang === "ar" ? "الرسائل المزعجة" : "Spam"],
      ["automod.antiDuplicate", state.lang === "ar" ? "الرسائل المتكررة" : "Duplicates"],
      ["automod.antiInvites", state.lang === "ar" ? "دعوات السيرفرات" : "Server invites"],
      ["automod.antiLinks", state.lang === "ar" ? "روابط" : "Links"],
      ["automod.antiMassMention", state.lang === "ar" ? "الإشارات الجماعية" : "Mass mentions"],
      ["automod.antiEmojiSpam", state.lang === "ar" ? "إغراق الإيموجي" : "Emoji spam"],
      ["automod.antiNewlines", state.lang === "ar" ? "الأسطر المفرطة" : "Excessive newlines"],
      ["automod.antiZalgo", tr("النصوص المشوّهة", "Distorted text")],
      ["automod.antiAttachments", state.lang === "ar" ? "إغراق المرفقات" : "Attachment spam"],
      ["automod.escalate", state.lang === "ar" ? "تصعيد" : "Escalate"],
      ["automod.quietAlerts", state.lang === "ar" ? "تنبيه هادئ" : "Quiet alerts"],
      ["automod.bypassMods", state.lang === "ar" ? "استثناء المشرفين" : "Exempt moderators"],
    ];
    const num = (label, path, val) =>
      row(label, "", `<input class="field" data-path="${path}" type="number" value="${Number(val) || 0}"/>`);
    view.innerHTML = `
      <section class="panel"><h3>${t("automod")}</h3>${row(t("automod"), "", toggle(!!a.enabled, "automod.enabled"))}</section>
      <section class="panel"><h3>${t("filters")}</h3>${dets.map(([k, label]) => row(label, "", toggle(!!a[k.split(".")[1]] || (k.endsWith("escalate") && a.action === "escalate"), k))).join("")}</section>
      <section class="panel"><h3>${t("policy")}</h3>
        ${row(t("action"), "", `<select class="select" id="am-action" data-path="automod.action">${["delete", "warn", "timeout", "escalate"].map((v) => `<option value="${v}" ${a.action === v ? "selected" : ""}>${t(v + "Action")}</option>`).join("")}</select>`)}
        ${num(state.lang === "ar" ? "مدة الإيقاف (ث)" : "Timeout (s)", "automod.timeoutSeconds", a.timeoutSeconds)}
        ${num(state.lang === "ar" ? "حد المنشن" : "Max mentions", "automod.maxMentions", a.maxMentions)}
        ${num(state.lang === "ar" ? "حد السبام" : "Spam count", "automod.spamCount", a.spamCount)}
        ${num(tr("حد الإيموجي", "Max emojis"), "automod.maxEmojis", a.maxEmojis)}
        ${num(tr("حد الأسطر", "Max newlines"), "automod.maxNewlines", a.maxNewlines)}
        ${num(tr("حد المرفقات", "Max attachments"), "automod.maxAttachments", a.maxAttachments)}
        ${num(tr("مخالفات قبل التحذير", "Strikes before warning"), "automod.strikeWarnAt", a.strikeWarnAt)}
        ${num(tr("مخالفات قبل الإيقاف", "Strikes before timeout"), "automod.strikeTimeoutAt", a.strikeTimeoutAt)}
        ${row(t("words"), t("wordsHint"), `<textarea data-path="automod.badWords">${esc((a.badWords || []).join("\n"))}</textarea>`)}
        ${row(t("domains"), t("wordsHint"), `<textarea data-path="automod.allowDomains">${esc((a.allowDomains || []).join("\n"))}</textarea>`)}
        <div class="toolbar"><button class="btn primary" id="save-am" type="button">${t("save")}</button></div>
      </section>
      <section class="panel"><h3>${t("raid")}</h3>
        ${row(t("raid"), "", toggle(!!c.antiraid?.enabled, "antiraid.enabled"))}
        ${num(state.lang === "ar" ? "عدد الانضمام" : "Join count", "antiraid.joinThreshold", c.antiraid?.joinThreshold)}
        ${num(state.lang === "ar" ? "النافذة (ث)" : "Window (s)", "antiraid.joinWindowSec", c.antiraid?.joinWindowSec)}
        ${num(state.lang === "ar" ? "مدة القفل" : "Lock seconds", "antiraid.lockSeconds", c.antiraid?.lockSeconds)}
        <div class="toolbar"><button class="btn primary" id="save-raid" type="button">${t("save")}</button></div>
      </section>`;
  } else if (["community", "welcome", "tickets", "levels", "starboard"].includes(state.tab)) {
    view.innerHTML = `<section class="panel"><h3>${t("welcome")}</h3>
      ${row(t("welcome"), "", toggle(!!c.welcome?.enabled, "welcome.enabled"))}
      ${row(t("channel"), "", pickChannel("welcome.channelId", c.welcome?.channelId || ""))}
      ${row(t("message"), "", `<textarea data-path="welcome.message">${esc(c.welcome?.message || "")}</textarea>`)}
      ${row(tr("رسالة الترحيب الخاصة", "Welcome direct message"), tr("اتركها فارغة لتعطيل الرسالة الخاصة.", "Leave blank to disable direct messages."), `<textarea data-path="welcome.dm">${esc(c.welcome?.dm || "")}</textarea>`)}
      ${row(t("goodbye"), "", toggle(!!c.goodbye?.enabled, "goodbye.enabled"))}
      ${row(t("channel"), "", pickChannel("goodbye.channelId", c.goodbye?.channelId || ""))}
      ${row(t("goodbyeMsg"), "", `<textarea data-path="goodbye.message">${esc(c.goodbye?.message || "")}</textarea>`)}
      <div class="toolbar"><button class="btn primary" data-save-fields type="button">${t("save")}</button></div>
    </section>
    <section class="panel"><h3>${t("levels")}</h3>
      ${row(t("levels"), "", toggle(!!c.leveling?.enabled, "leveling.enabled"))}
      ${row(state.lang === "ar" ? "حد XP الأدنى" : "XP min", "", `<input class="field" data-path="leveling.xpMin" type="number" value="${Number(c.leveling?.xpMin) || 0}"/>`)}
      ${row(state.lang === "ar" ? "حد XP الأعلى" : "XP max", "", `<input class="field" data-path="leveling.xpMax" type="number" value="${Number(c.leveling?.xpMax) || 0}"/>`)}
      ${row(state.lang === "ar" ? "الانتظار (ث)" : "Cooldown (s)", "", `<input class="field" data-path="leveling.cooldownSec" type="number" value="${Number(c.leveling?.cooldownSec) || 0}"/>`)}
      ${row(t("channel"), "", pickChannel("leveling.levelUpChannelId", c.leveling?.levelUpChannelId || ""))}
      ${row(t("levelMsg"), "", `<textarea data-path="leveling.levelUpMessage">${esc(c.leveling?.levelUpMessage || "")}</textarea>`)}
      <div class="toolbar"><button class="btn primary" data-save-fields type="button">${t("save")}</button></div>
    </section>
    <section class="panel"><h3>${t("tickets")}</h3>
      ${row(t("tickets"), "", toggle(!!c.tickets?.enabled, "tickets.enabled"))}
      ${row(t("staff"), "", pickRole("tickets.staffRoleId", c.tickets?.staffRoleId || ""))}
      ${row(t("logs"), "", pickChannel("tickets.logChannelId", c.tickets?.logChannelId || ""))}
      ${row(t("category"), "", `<input class="field" data-path="tickets.categoryId" value="${esc(c.tickets?.categoryId || "")}"/>`)}
      <div class="toolbar"><button class="btn primary" data-save-fields type="button">${t("save")}</button></div>
    </section>
    <section class="panel"><h3>${t("starboard")}</h3>
      ${row(t("starboard"), "", toggle(!!c.starboard?.enabled, "starboard.enabled"))}
      ${row(t("channel"), "", pickChannel("starboard.channelId", c.starboard?.channelId || ""))}
      ${row(t("emoji"), "", `<input class="field" data-path="starboard.emoji" value="${esc(c.starboard?.emoji || "⭐")}"/>`)}
      ${row(t("threshold"), "", `<input class="field" data-path="starboard.threshold" type="number" value="${Number(c.starboard?.threshold) || 3}"/>`)}
      ${row(t("suggest"), "", pickChannel("suggest.channelId", c.suggest?.channelId || ""))}
      <div class="toolbar"><button class="btn primary" data-save-fields type="button">${t("save")}</button></div>
    </section>`;
  } else if (state.tab === "send") {
    const blocked = state.directory?.error;
    view.innerHTML = `<section class="panel"><h3>${t("send")}</h3><p class="lead">${t("sendHint")}</p>
      ${blocked ? `<div class="err">${esc(note(blocked))}</div>` : ""}
      <div class="form">
        <label>${t("channel")}${channelChoices("send-channel")}</label>
        <label>${t("content")}<textarea id="send-content" maxlength="2000"></textarea></label>
        <label>${t("embedTitle")}<input class="field" id="send-title" maxlength="256"/></label>
        <label>${t("embedBody")}<textarea id="send-desc" maxlength="2000"></textarea></label>
        <label>${t("colour")}<input class="field" id="send-colour" value="#E11D48" maxlength="7"/></label>
        <div class="toolbar"><button class="btn primary" id="send-go" type="button">${t("send")}</button></div>
      </div>
    </section>`;
  } else if (['music','games'].includes(state.tab)) {
    view.innerHTML = commandGuide(state.tab);
  } else if (state.tab === "hooks") {
    view.innerHTML = `<section class="panel"><h3>${t("hooks")}</h3><p class="lead">${t("hookHint")}</p><p class="lead">${t("loading")}</p></section>`;
    renderHooks();
  } else {
    view.innerHTML = `<section class="panel"><h3>${t("settings")}</h3>
      ${row(t("language"), "", `<select class="select" id="set-locale"><option value="ar" ${c.locale === "ar" ? "selected" : ""}>العربية</option><option value="en" ${c.locale !== "ar" ? "selected" : ""}>English</option></select>`)}
      ${row(t("prefix"), "", `<input class="field" id="set-prefix" maxlength="5" value="${esc(c.prefix || "!")}"/>`)}
      ${row(t("staff"), "", pickRole("staffRoleId", c.staffRoleId || ""))}
      ${row(t("mute"), "", pickRole("muteRoleId", c.muteRoleId || ""))}
      ${row(t("logs"), "", pickChannel("modLogChannelId", c.modLogChannelId || ""))}
      ${row(t("generalLogs"), "", pickChannel("logChannelId", c.logChannelId || ""))}
      ${row(t("autorole"), t("wordsHint"), `<textarea data-path="autorole.roleIds">${esc((c.autorole?.roleIds || []).join("\n"))}</textarea>`)}
      ${row(t("ignoreCh"), t("wordsHint"), `<textarea data-path="automod.ignoreChannels">${esc((c.automod?.ignoreChannels || []).join("\n"))}</textarea>`)}
      <div class="toolbar"><button class="btn primary" id="save-settings" type="button">${t("save")}</button></div>
    </section>`;
  }
  if (['welcome','tickets','levels','starboard'].includes(state.tab)) {
    const index = {welcome:0, levels:1, tickets:2, starboard:3}[state.tab];
    view.querySelectorAll(':scope > .panel').forEach((panel,i) => { if (i !== index) panel.remove(); });
  }
  if (state.tab !== 'overview') {
    const description = pageDescriptions[state.tab] || pageDescriptions.settings;
    view.insertAdjacentHTML('afterbegin', '<div class="page-heading"><div><span class="eyebrow">'+esc(srv.name)+'</span><h2>'+t(state.tab)+'</h2><p>'+tr(...description)+'</p></div><span class="save-note">'+icon('settings')+tr('إعدادات خاصة بهذا السيرفر','Settings for this server')+'</span></div>');
  }
  if (state.tab === 'send') setupMessagePreview();
  decorateView();
  bindView();
}

async function patch(path, value) {
  await api(`/api/servers/${encodeURIComponent(state.serverId)}/config`, {
    method: "PATCH",
    body: JSON.stringify({ path, value }),
  });
}
async function saveFields(rootEl) {
  for (const node of rootEl.querySelectorAll("[data-path]")) {
    await patch(node.getAttribute("data-path"), node.value);
  }
}
function bindView() {
  const view = document.getElementById("view");
  if (!view) return;
  view.querySelectorAll("[data-server]").forEach((btn) => {
    btn.addEventListener("click", () => openServer(btn.getAttribute("data-server")));
  });
  view.querySelectorAll("[data-jump]").forEach((btn) => {
    btn.addEventListener("click", () => navigateTab(btn.getAttribute('data-jump')));
  });
  view.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const config = await api(`/api/servers/${encodeURIComponent(state.serverId)}/toggle`, {
          method: "POST",
          body: JSON.stringify({ path: btn.getAttribute("data-toggle") }),
        });
        state.config = config;
        toast(t("updated"));
        const enabled = btn.dataset.toggle.split(".").reduce((value,key) => value?.[key], config);
        btn.classList.toggle("on", !!enabled);
        btn.setAttribute("aria-checked", String(!!enabled));
      } catch (e) {
        toast(note(e.message));
      } finally { btn.disabled = false; }
    });
  });
  document.getElementById("btn-refresh")?.addEventListener("click", async () => {
    await loadConfig();
    toast(t("updated"));
    renderView();
  });
  view.querySelectorAll("#save-am, #save-raid, [data-save-fields]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const panel = btn.closest('.panel');
      if (!validateSection(panel)) return;
      btn.disabled = true; panel.inert = true; panel.setAttribute('aria-busy','true');
      try {
        await saveFields(panel);
        await loadConfig();
        commitSection(panel);
        toast(t("saved"));
      } catch (e) {
        toast(note(e.message));
      } finally { panel.inert = false; panel.setAttribute('aria-busy','false'); panel.updateEditor?.(); }
    });
  });
  document.getElementById("send-go")?.addEventListener("click", async (ev) => {
    const btn = ev.currentTarget; btn.disabled = true;
    try {
      await api(`/api/servers/${encodeURIComponent(state.serverId)}/messages`, {
        method: "POST",
        body: JSON.stringify({
          channelId: document.getElementById("send-channel")?.value || "",
          content: document.getElementById("send-content")?.value || "",
          title: document.getElementById("send-title")?.value || "",
          description: document.getElementById("send-desc")?.value || "",
          colour: document.getElementById("send-colour")?.value || "",
        }),
      });
      toast(t("sent"));
      document.getElementById("send-content").value = "";
      document.getElementById("send-title").value = "";
      document.getElementById("send-desc").value = "";
      document.getElementById("send-content").dispatchEvent(new Event("input", { bubbles: true }));
      view.dataset.formSnapshot = formSnapshot(view);
    } catch (e) {
      toast(note(e.message));
    } finally { btn.disabled = false; }
  });
  document.getElementById("save-settings")?.addEventListener("click", async ev => {
    const panel = ev.currentTarget.closest('.panel');
    if (!validateSection(panel)) return;
    panel.inert = true; panel.setAttribute('aria-busy','true');
    try {
      await patch("locale", document.getElementById("set-locale").value);
      await patch("prefix", document.getElementById("set-prefix").value.trim() || "!");
      await saveFields(panel);
      await loadConfig();
      document.getElementById('set-prefix').value = state.config.prefix;
      commitSection(panel); toast(t("saved"));
    } catch(e) { toast(note(e.message)); }
    finally { panel.inert = false; panel.setAttribute('aria-busy','false'); panel.updateEditor?.(); }
  });
}
async function loadConfig() {
  const srv = currentServer();
  if (!srv) {
    state.config = null;
    state.directory = { channels: [], roles: [], error: "" };
    return;
  }
  state.serverId = srv._id || srv.id;
  const id = encodeURIComponent(state.serverId);
  state.config = await api(`/api/servers/${id}/config`);
  state.directory = { channels: [], roles: [], error: "" };
  try {
    const [channels, roles] = await Promise.all([
      api(`/api/servers/${id}/channels`),
      api(`/api/servers/${id}/roles`),
    ]);
    state.directory.channels = channels.channels || [];
    state.directory.roles = roles.roles || [];
    state.directory.bot = channels.bot || {};
  } catch (e) {
    state.directory.error = e.message || "bot_error";
  }
}
async function renderHooks() {
  const view = document.getElementById("view");
  const serverId = state.serverId;
  if (!view || state.tab !== "hooks") return;
  let hooks = [];
  let error = state.directory?.error || "";
  let errorPerm = "";
  try {
    const data = await api(`/api/servers/${encodeURIComponent(serverId)}/webhooks`);
    hooks = data.webhooks || [];
  } catch (e) {
    error = e.message || error;
    errorPerm = e.permission || "";
  }
  if (state.place !== "server" || state.tab !== "hooks" || state.serverId !== serverId) return;
  const cards = hooks
    .map((hook) => {
      const ch = (state.directory?.channels || []).find((c) => c.id === hook.channelId);
      return `<article class="hook" data-hook="${esc(hook.id)}">
        <h4>${esc(hook.name || hook.id)}</h4>
        <div class="pill">${esc(ch?.name || hook.channelId || "—")} · ${hook.hasToken ? t("tokenSaved") : t("tokenMissing")}</div>
        <div class="form">
          <label>${t("content")}<textarea data-hook-content maxlength="2000"></textarea></label>
          <label>${t("username")}<input class="field" data-hook-user maxlength="80"/></label>
          <label>${t("embedTitle")}<input class="field" data-hook-title maxlength="256"/></label>
          <label>${t("embedBody")}<textarea data-hook-desc maxlength="2000"></textarea></label>
          ${hook.hasToken ? "" : `<label>${t("pasteToken")}<input class="field" type="password" autocomplete="off" data-hook-token maxlength="200"/></label>`}
        </div>
        <div class="toolbar">
          <button class="btn primary" type="button" data-act="send">${t("send")}</button>
          ${hook.hasToken ? "" : `<button class="btn ghost" type="button" data-act="save">${t("saveToken")}</button>`}
          <button class="btn ghost" type="button" data-act="regen">${t("regen")}</button>
          <button class="btn ghost" type="button" data-act="delete">${t("delete")}</button>
        </div>
      </article>`;
    })
    .join("");
  const botGap = state.directory.bot?.webhooks === false || (error === "MissingPermission" && errorPerm === "ManageWebhooks");
  view.innerHTML = `<section class="panel"><h3>${t("hooks")}</h3><p class="lead">${t("hookHint")}</p>
    ${botGap ? `<div class="err">${esc(t("botMissingWebhooks"))}<div class="toolbar"><a class="btn primary" href="${esc(inviteFor())}" target="_blank" rel="noreferrer">${t("grantWebhooks")}</a></div></div>` : ""}
    ${error && !botGap ? `<div class="err">${esc(note(error, errorPerm))}</div>` : ""}
    <div class="form">
      <label>${t("hookName")}<input class="field" id="hook-name" maxlength="80"/></label>
      <label>${t("channel")}${channelChoices("hook-channel")}</label>
      <div class="toolbar"><button class="btn primary" id="hook-create" type="button">${t("createHook")}</button></div>
    </div>
    <div class="hooks">${cards || `<p class="lead">${t("noHooks")}</p>`}</div>
  </section>`;
  view.insertAdjacentHTML('afterbegin', '<div class="page-heading"><div><span class="eyebrow">'+esc(currentServer()?.name)+'</span><h2>'+t('hooks')+'</h2><p>'+tr(...pageDescriptions.hooks)+'</p></div></div>');
  decorateView();
  document.getElementById("hook-create")?.addEventListener("click", async () => {
    try {
      await api(`/api/servers/${encodeURIComponent(serverId)}/webhooks`, {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("hook-name")?.value || "",
          channelId: document.getElementById("hook-channel")?.value || "",
        }),
      });
      toast(t("created"));
      renderHooks();
    } catch (e) {
      toast(note(e.message, e.permission));
    }
  });
  view.querySelectorAll("[data-hook]").forEach((card) => {
    const id = card.getAttribute("data-hook");
    card.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.getAttribute("data-act");
        try {
          if (act === "send") {
            await api(`/api/servers/${encodeURIComponent(serverId)}/webhooks/${encodeURIComponent(id)}/send`, {
              method: "POST",
              body: JSON.stringify({
                content: card.querySelector("[data-hook-content]")?.value || "",
                username: card.querySelector("[data-hook-user]")?.value || "",
                title: card.querySelector("[data-hook-title]")?.value || "",
                description: card.querySelector("[data-hook-desc]")?.value || "",
              }),
            });
            toast(t("sent"));
            card.querySelector("[data-hook-content]").value = "";
            return;
          }
          if (act === "save") {
            await api(`/api/servers/${encodeURIComponent(serverId)}/webhooks/${encodeURIComponent(id)}/token`, {
              method: "POST",
              body: JSON.stringify({ token: card.querySelector("[data-hook-token]")?.value || "" }),
            });
            toast(t("saved"));
            renderHooks();
            return;
          }
          if (act === "regen") {
            await api(`/api/servers/${encodeURIComponent(serverId)}/webhooks/${encodeURIComponent(id)}/token`, {
              method: "POST",
              body: JSON.stringify({ regenerate: true }),
            });
            toast(t("saved"));
            renderHooks();
            return;
          }
          if (act === "delete") {
            if (!(await confirmAction(tr("حذف الويب هوك", "Delete webhook"), tr("سيُحذف الويب هوك ولن تتمكن الخدمات من استخدامه. لا يمكن التراجع عن هذا الإجراء.", "This webhook and its integration access will be removed. This cannot be undone."), t("delete")))) return;
            await api(`/api/servers/${encodeURIComponent(serverId)}/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
            toast(t("deleted"));
            renderHooks();
          }
        } catch (e) {
          toast(note(e.message, e.permission));
        }
      });
    });
  });
}
async function boot() {
  applyLang();
  root.setAttribute('aria-busy','true');
  root.innerHTML = appChrome('Sanad') + `<main class="boot-screen" role="status">${brandMark()}<span class="spinner"></span><p>${t('loading')}</p></main>`;
  try {
    const data = await api("/api/boot");
    state.invite = data.invite || "";
    if (!data.user) return renderLogin();
    state.me = data.user;
    state.servers = data.servers || [];
    state.hidden = Number(data.hidden) || 0;
    const known = state.servers.some((s) => (s._id || s.id) === state.serverId);
    if (!known) state.serverId = (state.servers.find(s => s.botPresent === true) || state.servers[0])?.id || (state.servers.find(s => s.botPresent === true) || state.servers[0])?._id || null;
    state.place = state.serverId ? 'server' : 'home';
    if (state.place === "server" && state.serverId && currentServer()?.botPresent === true) {
      try { await loadConfig(); }
      catch (error) { state.place = 'home'; toast(note(error.message)); }
    }
    else if (state.serverId && currentServer()?.botPresent !== false) {
      try { await loadConfig(); currentServer().botPresent = true; }
      catch(error) { toast(note(error.message)); }
    }
    renderShell();
  } catch (e) {
    renderLogin();
    toast(note(e.message));
  } finally {
    root.setAttribute('aria-busy','false');
  }
}
boot();
