(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- Настройки в коде ---------- */
// Текстовый слой у читателей (не администратора). Этап 1: выключен, читатель видит только картинку страницы,
// выделять и копировать ему нечего. Этап 2: включить (true), чтобы выделять цветом и писать заметку
// к выделенному месту. Копирование, контекстное меню и перетаскивание у читателей заблокированы в любом случае.
const READER_TEXT_LAYER = false;
const CHUNK_PDF = 512 * 1024;      // кусок книги, который читалка просит у сервера
const MAX_REQ = 4 * CHUNK_PDF;     // не больше 2 МБ за один запрос
const MB = 1024 * 1024;
const FORMATS = {pdf: 'PDF', epub: 'EPUB', djvu: 'DjVu'};
const BOOK_FIELDS = 'id,title,authors,year,description,format,file_size,pages,has_text,status,status_note,cover,search,created,updated';
const NOTE_FIELDS = 'id,owner,book,book_title,kind,title,page,shared,created,updated,body_text:excerpt(160,true)';

/* ---------- Значки (линейные SVG) ---------- */
const sv = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  library: sv('<path d="M4 4h3v16H4zM9 4h3v16H9z"/><path d="M14.5 5.2l2.9-.8 4 15.2-2.9.8z"/>'),
  shelves: sv('<path d="M3 5h18M3 12h18M3 19h18"/><path d="M6 5V3M18 12v-2M10 19v-2"/>'),
  notes: sv('<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h7M9 16h5"/>'),
  profile: sv('<circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.6 3.6-6 8-6s8 2.4 8 6"/>'),
  back: sv('<path d="M15 5l-7 7 7 7"/>'),
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="fill" cx="5" cy="12" r="1.8"/><circle class="fill" cx="12" cy="12" r="1.8"/><circle class="fill" cx="19" cy="12" r="1.8"/></svg>',
  plus: sv('<path d="M12 5v14M5 12h14"/>'),
  search: sv('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  up: sv('<path d="M6 15l6-6 6 6"/>'),
  down: sv('<path d="M6 9l6 6 6-6"/>'),
  left: sv('<path d="M15 6l-6 6 6 6"/>'),
  right: sv('<path d="M9 6l6 6-6 6"/>'),
  close: sv('<path d="M6 6l12 12M18 6L6 18"/>'),
  book: sv('<path d="M12 6.5C10.5 5.2 8.4 4.5 5 4.5V18c3.4 0 5.5.7 7 2 1.5-1.3 3.6-2 7-2V4.5c-3.4 0-5.5.7-7 2z"/><path d="M12 6.5V20"/>'),
  upload: sv('<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>'),
  dl: sv('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  grid: sv('<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>'),
  list: sv('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
  toc: sv('<path d="M4 6h16M4 12h10M4 18h13"/>'),
  zin: sv('<circle cx="11" cy="11" r="6.5"/><path d="M8 11h6M11 8v6M16 16l4 4"/>'),
  zout: sv('<circle cx="11" cy="11" r="6.5"/><path d="M8 11h6M16 16l4 4"/>'),
  full: sv('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  pen: sv('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  trash: sv('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  file: sv('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'),
  lesson: sv('<path d="M3 8l9-4 9 4-9 4z"/><path d="M7 10v5c0 1.5 2.2 3 5 3s5-1.5 5-3v-5"/><path d="M21 8v6"/>'),
  eye: sv('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: sv('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>'),
  check: sv('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  people: sv('<circle cx="9" cy="8" r="3"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c2.8 0 5 1.7 5 4.5"/>'),
  log: sv('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
  author: sv('<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/>'),
  moon: sv('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
};

/* ---------- Состояние ---------- */
const S = {books:[], authors:[], shelves:[], sbooks:[], reading:[], notes:[], nfiles:[], invites:[], loaded:false, disk:null};
const PBN = {books:'books', authors:'authors', shelves:'shelves', sbooks:'shelf_books', reading:'reading', notes:'notes', nfiles:'note_files'};
const KEYS = Object.keys(PBN);
const LIST_OPTS = {books: () => ({fields: BOOK_FIELDS + (isAdmin() ? ',orig_name,hash' : '')}), notes: () => ({fields: NOTE_FIELDS})};
const loadLS = (k, d) => { try { const v = localStorage.getItem('kn_'+k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } };
const saveLS = (k, v) => { try { localStorage.setItem('kn_'+k, JSON.stringify(v)); } catch(e){} };
const dropLS = k => { try { localStorage.removeItem('kn_'+k); } catch(e){} };
const UI = {hops:0, q:'', reorder:'', booksView: loadLS('booksView', 'grid'), booksSort: loadLS('booksSort', 'title'), booksFmt:'', booksScan:false,
  tab:'notes', notesQ:'', notesKind:'', notesHits:null, logQ:{days:7, user:'', book:''}, log:null, descOpen:false};
const pb = new PocketBase(location.origin);
pb.autoCancellation(false);
const me = () => pb.authStore.record || {};
const isAdmin = () => me().role === 'admin';

/* ---------- Тема оформления: auto (как в системе), light, dark ---------- */
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
function themePref(){ const t = loadLS('theme', 'auto'); return t === 'light' || t === 'dark' ? t : 'auto'; }
function isDark(){ const t = themePref(); return t === 'dark' || (t === 'auto' && darkMQ.matches); }
function applyTheme(){
  const t = themePref(), root = document.documentElement;
  if(t === 'auto') delete root.dataset.theme; else root.dataset.theme = t;
  $$('meta[name="theme-color"]').forEach(m => m.setAttribute('content', isDark() ? '#15181B' : '#F4EFE6'));
}
function setTheme(t){
  saveLS('theme', t); applyTheme();
  if(pb.authStore.isValid && me().theme !== t) pb.collection('users').update(me().id, {theme: t}).then(r => pb.authStore.save(pb.authStore.token, r)).catch(() => {});
}
function themeFromUser(){ const t = me().theme; if((t === 'auto' || t === 'light' || t === 'dark') && t !== themePref()){ saveLS('theme', t); applyTheme(); } }
darkMQ.addEventListener && darkMQ.addEventListener('change', () => { if(themePref() === 'auto') applyTheme(); });
applyTheme();

/* ---------- Мелочи ---------- */
const pad = n => String(n).padStart(2, '0');
const MONF = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const dateOf = s => new Date(String(s || '').replace(' ', 'T'));
function fmtDate(s){
  const d = dateOf(s); if(isNaN(d)) return '';
  return d.getDate() + ' ' + MONF[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
}
function fmtWhen(s){
  const d = dateOf(s); if(isNaN(d)) return '';
  const today = new Date(); const y = new Date(Date.now() - 864e5);
  const same = (a, b) => a.toDateString() === b.toDateString();
  const t = pad(d.getHours()) + ':' + pad(d.getMinutes());
  return same(d, today) ? 'сегодня, ' + t : same(d, y) ? 'вчера, ' + t : fmtDate(s);
}
const plural = (n, f) => { n = Math.abs(n) % 100; const n1 = n % 10; if(n > 10 && n < 20) return f[2]; if(n1 > 1 && n1 < 5) return f[1]; if(n1 === 1) return f[0]; return f[2]; };
const BOOKS_W = ['книга','книги','книг'], PAGES_W = ['страница','страницы','страниц'], NOTES_W = ['заметка','заметки','заметок'];
const fsize = b => b < MB ? Math.max(1, Math.round(b/1024)) + ' КБ'
  : b < 1024*MB ? (b/MB).toFixed(1).replace('.', ',') + ' МБ'
  : (b/1024/MB).toFixed(1).replace('.', ',') + ' ГБ';
// Поиск без учёта регистра и буквы ё (так же считает сервер)
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"„“”]/g, '').replace(/\s+/g, ' ').trim();
const ID_ABC = 'abcdefghijklmnopqrstuvwxyz0123456789';
function newId(){ const a = new Uint8Array(15); crypto.getRandomValues(a); return Array.from(a, x => ID_ABC[x % 36]).join(''); }
const collator = new Intl.Collator('ru', {sensitivity: 'base', numeric: true});

/* ---------- Доступ к данным ---------- */
const byId = (key, id) => S[key].find(x => x.id === id);
const bySort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || collator.compare(a.name || '', b.name || '');
const authorName = id => (byId('authors', id) || {}).name || '';
const authorsText = b => (b.authors || []).map(authorName).filter(Boolean).join(', ');
const readingOf = bookId => S.reading.find(r => r.book === bookId);
const myShelf = s => !s.common && s.owner === me().id;
const canEditShelf = s => s && (s.common ? isAdmin() : s.owner === me().id);
const shelfKids = (parent, common) => S.shelves.filter(s => (s.parent || '') === (parent || '') && (parent ? true : (common ? s.common : myShelf(s)))).sort(bySort);
const shelfBooks = id => S.sbooks.filter(x => x.shelf === id).map(x => byId('books', x.book)).filter(Boolean);
function shelfPath(s){ const out = []; let cur = s, g = 0; while(cur && g++ < 5){ out.unshift(cur); cur = cur.parent ? byId('shelves', cur.parent) : null; } return out; }
const shelfDepth = s => shelfPath(s).length;
// Сколько книг на полке вместе с подполками (без повторов)
function shelfCount(s){
  const ids = new Set();
  const walk = x => { S.sbooks.forEach(sb => { if(sb.shelf === x.id) ids.add(sb.book); }); S.shelves.filter(c => c.parent === x.id).forEach(walk); };
  walk(s); return ids.size;
}
const booksOfAuthor = id => S.books.filter(b => (b.authors || []).includes(id));
const notesOfBook = id => S.notes.filter(n => n.book === id);
const titleSort = (a, b) => collator.compare(a.title || '', b.title || '');

function upsert(key, rec){ const arr = S[key]; const i = arr.findIndex(x => x.id === rec.id); if(i >= 0) arr[i] = {...arr[i], ...rec}; else arr.push({...rec}); schedule(); }
function removeLocal(key, id){ S[key] = S[key].filter(x => x.id !== id); schedule(); }

async function loadAll(keys = KEYS){
  const res = await Promise.all(keys.map(k => pb.collection(PBN[k]).getFullList({batch: 1000, ...(LIST_OPTS[k] ? LIST_OPTS[k]() : {})})));
  keys.forEach((k, n) => { S[k] = res[n]; });
  schedule();
}
let subscribed = false;
async function subscribeAll(){
  if(subscribed) return; subscribed = true;
  await pb.collection('users').subscribe(me().id, e => { if(e.action === 'update'){ pb.authStore.save(pb.authStore.token, e.record); themeFromUser(); schedule(); } });
  for(const k of KEYS){
    await pb.collection(PBN[k]).subscribe('*', e => {
      if(e.action === 'delete') removeLocal(k, e.record.id);
      else {
        const r = e.record;
        // заметки: в общем списке без текста, только начало для подписи
        if(k === 'notes'){ r.body_text = String(r.body_text || '').slice(0, 160); delete r.body; delete r.search; }
        upsert(k, r);
      }
    });
  }
}

/* ---------- Запуск ---------- */
async function boot(){
  if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const qs = new URLSearchParams(location.search);
  const invite = qs.get('invite');
  const mail = MAIL_LINKS.find(k => qs.get(k));
  // ключ из письма или приглашения сразу убираем из адресной строки и истории
  if(invite || mail) history.replaceState(null, '', location.pathname + location.hash);
  if(mail){ showMailLink(mail, qs.get(mail).trim()); return; }
  if(!pb.authStore.isValid){ showAuth(invite ? 'register' : 'login', invite); return; }
  try { await pb.collection('users').authRefresh(); }
  catch(e){ if(e && e.status && e.status !== 0){ pb.authStore.clear(); showAuth('login'); return; } }
  startApp();
}
async function startApp(){
  $('#auth').hidden = true; $('#app').hidden = false;
  themeFromUser();
  buildNav();
  render(true);
  try {
    // кука для обложек и файлов книг: ставит сервер, странице она недоступна
    await pb.send('/api/knigi/session', {});
    await loadAll();
    S.loaded = true; $('#notice').hidden = true; render(true);
    if(isAdmin()) loadInvites();
    subscribeAll().catch(() => {});
  } catch(e){
    showNotice('Не удалось загрузить данные. ' + errText(e));
  }
}
let lastSession = Date.now();
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState !== 'visible'){ RD.doc && rdSave(true); return; }
  checkUpdate();
  if(S.loaded && pb.authStore.isValid){
    if(Date.now() - lastSession > 3600e3){ lastSession = Date.now(); pb.send('/api/knigi/session', {}).catch(() => {}); }
    loadAll().catch(() => {});
  }
});
window.addEventListener('pagehide', () => { RD.doc && rdSave(true); });

/* ---------- Проверка новой версии ---------- */
// Сравниваем ?v= у app.js и app.css в открытой странице и в свежем index.html с сервера
const verOf = html => (html.match(/\/app\.(?:js|css)\?v=\d+/g) || []).sort().join(' ');
const MY_VER = verOf(document.documentElement.innerHTML);
let lastCheck = 0;
async function checkUpdate(){
  if(!navigator.onLine || Date.now() - lastCheck < 60e3) return;
  lastCheck = Date.now();
  try {
    const res = await fetch('/index.html', {cache: 'no-store'});
    if(!res.ok) return;
    const v = verOf(await res.text());
    if(v && MY_VER && v !== MY_VER) $('#update-bar').hidden = false;
  } catch(e){}
}
setInterval(checkUpdate, 30*60e3);
$('#update-btn').addEventListener('click', () => location.reload());
$('#update-close').addEventListener('click', () => { $('#update-bar').hidden = true; });
window.addEventListener('online', () => { $('#notice').hidden = true; schedule(); if(S.loaded) loadAll().catch(() => {}); });
window.addEventListener('offline', () => { showNotice('Нет подключения к интернету. Книги открываются только при подключении.'); schedule(); });
let raf = 0;
function schedule(){ if(raf) return; raf = requestAnimationFrame(() => { raf = 0; render(); }); }
function showNotice(text){ $('#notice-text').textContent = text; $('#notice').hidden = false; }

/* ---------- Меню разделов: внизу на телефоне, сбоку на компьютере ---------- */
const TABS = [['lib', '#/', 'Библиотека', 'library'], ['shelves', '#/shelves', 'Полки', 'shelves'], ['notes', '#/notes', 'Заметки', 'notes'], ['profile', '#/profile', 'Профиль', 'profile']];
function buildNav(){
  const items = TABS.map(([k, h, l, ic]) => `<a href="${h}" class="tab" data-tab="${k}">${ICON[ic]}<span>${l}</span></a>`).join('');
  $('#tabbar').innerHTML = `<div class="tabbar-in">${items}</div>`;
  $('#side').innerHTML = `<div class="side-brand"><span class="side-logo" aria-hidden="true"></span><b>Библиотека</b></div>${items}`;
}

/* ---------- Адреса экранов ----------
   #/ главная, #/shelves полки, #/sh/ID полка, #/books все книги, #/authors авторы, #/a/ID автор,
   #/b/ID карточка книги (?tab=lessons), #/read/ID читалка (?p=страница), #/pdf/ID файл урока в читалке (?note=ID),
   #/note/ID заметка или урок, #/note/new (?book=ID&page=N&kind=lesson), #/notes мои заметки, #/profile, #/log журнал */
function route(){
  const h = location.hash.replace(/^#\/?/, '');
  const [path, q] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return {name: parts[0] || 'home', id: parts[1] || '', q: new URLSearchParams(q || '')};
}
const go = (hash, replace) => { if(replace) location.replace(hash); else location.hash = hash; };
function goBack(fallback){ if(UI.hops > 0) history.back(); else go(fallback, true); }
window.addEventListener('hashchange', () => { UI.hops++; UI.reorder = ''; closeMenu(); render(true); if(route().name !== 'read' && route().name !== 'pdf') window.scrollTo(0, 0); });

/* ---------- Отрисовка ---------- */
const VIEWS = {};
function render(force){
  const r = route();
  const reading = r.name === 'read' || r.name === 'pdf';
  if(reading){ if(S.loaded) rdShow(r); return; }
  if(RD.open) rdClose();
  const tab = ['shelves','sh','books','authors','a'].includes(r.name) ? 'shelves' : ['notes','note'].includes(r.name) ? 'notes' : ['profile','log'].includes(r.name) ? 'profile' : 'lib';
  $$('.tab').forEach(t => t.setAttribute('aria-current', t.dataset.tab === tab ? 'page' : 'false'));
  const m = $('#main');
  if(!S.loaded){ m.innerHTML = '<div class="loading">Загружаю…</div>'; return; }
  // экран заметки не перерисовывается от живых обновлений, пока в нём редактор: иначе сбился бы ввод
  if(r.name === 'note' && !force && ED.quill && ED.id) { renderUploadsPanel(); return; }
  // поле поиска не теряет фокус при перерисовке
  const focus = document.activeElement && document.activeElement.id && m.contains(document.activeElement) ? document.activeElement.id : '';
  const sel = focus && document.activeElement.selectionStart;
  if(r.name !== 'note' || !(ED.id && (ED.id === r.id || (r.id === 'new' && ED.isNew)))) edClose();
  m.innerHTML = (VIEWS[r.name] || VIEWS.home)(r);
  if(r.name === 'note') edMount(r);
  if(focus){ const el = document.getElementById(focus); if(el){ el.focus(); try { el.setSelectionRange(sel, sel); } catch(e){} } }
  renderUploadsPanel();
}
const notFound = () => `<div class="card"><p>Не найдено: возможно, это уже удалили.</p><a class="btn" href="#/">На главную</a></div>`;
const backLink = (href, text) => `<a class="back" href="${href}" data-back="${esc(href)}">${ICON.back}<span>${esc(text)}</span></a>`;

/* ---------- Обложки ---------- */
// Обложка открывается только вошедшему: сервер проверяет защищённую куку
const coverUrl = b => b.cover ? `/api/knigi/f/cover/${b.id}?v=${encodeURIComponent(b.cover)}` : '';
const SPINES = ['#2C4A66', '#5B3A3A', '#3F5A44', '#6B5534', '#4A4560', '#2F5560', '#6A3F52', '#4F4A3E'];
function spineColor(id){ let h = 0; for(const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return SPINES[h % SPINES.length]; }
function coverHTML(b, cls){
  const ph = `<span class="cover-ph" style="--spine:${spineColor(b.id)}"><b>${esc(b.title)}</b><small>${esc(authorsText(b))}</small></span>`;
  const img = b.cover ? `<img src="${esc(coverUrl(b))}" alt="" loading="lazy" draggable="false" onerror="this.remove()">` : '';
  return `<span class="cover ${cls || ''}">${ph}${img}</span>`;
}
const fmtBadge = b => b.format !== 'pdf' ? `<span class="badge">${FORMATS[b.format] || b.format}</span>` : '';
function bookTile(b){
  const r = readingOf(b.id);
  const prog = r && r.pages ? `<span class="prog"><i style="width:${Math.min(100, Math.round(r.page / r.pages * 100))}%"></i></span>` : '';
  return `<a class="tile" href="#/b/${b.id}">${coverHTML(b)}${fmtBadge(b)}${b.status === 'processing' ? '<span class="badge wait">Обрабатывается</span>' : ''}${prog}
    <span class="t-title">${esc(b.title)}</span><span class="t-author">${esc(authorsText(b))}</span></a>`;
}
function bookRow(b, extra){
  return `<a class="brow" href="#/b/${b.id}">${coverHTML(b, 'sm')}<span class="brow-t"><b>${esc(b.title)}</b><span>${esc(authorsText(b))}</span>
    <small>${[b.year || '', b.pages ? b.pages + ' с.' : '', FORMATS[b.format], b.format === 'pdf' && b.status === 'ready' && !b.has_text ? 'скан без текста' : '', b.status === 'processing' ? 'обрабатывается' : ''].filter(Boolean).join(' · ')}</small>${extra || ''}</span>${ICON.chev}</a>`;
}
const booksGrid = list => list.length ? `<div class="grid">${list.map(bookTile).join('')}</div>` : '<p class="empty">Книг пока нет.</p>';

/* ---------- Главная «Библиотека» ---------- */
function searchHits(q){
  const n = norm(q);
  if(!n) return null;
  const words = n.split(' ');
  const books = S.books.filter(b => { const s = b.search || norm(b.title + ' ' + authorsText(b)); return words.every(w => s.includes(w)); }).sort(titleSort);
  const authors = S.authors.filter(a => words.every(w => (a.search || norm(a.name)).includes(w)));
  return {books, authors};
}
VIEWS.home = () => {
  const hits = searchHits(UI.q);
  const head = `<header class="head"><h1>Библиотека</h1>${isAdmin() ? `<button type="button" class="btn primary sm" data-act="add-books">${ICON.upload}<span>Добавить книги</span></button>` : ''}</header>
    <label class="search"><span class="sr">Поиск по названию и автору</span>${ICON.search}<input type="search" id="q" placeholder="Название или автор" value="${esc(UI.q)}" autocomplete="off" enterkeyhint="search"></label>`;
  if(hits){
    return head + `<section class="block">${hits.authors.length ? `<h2>Авторы</h2><div class="chips">${hits.authors.slice(0, 12).map(a => `<a class="chip" href="#/a/${a.id}">${ICON.author}${esc(a.name)}</a>`).join('')}</div>` : ''}
      <h2>Книги · ${hits.books.length}</h2>${hits.books.length ? `<div class="rows">${hits.books.slice(0, 100).map(b => bookRow(b)).join('')}</div>` : '<p class="empty">Ничего не нашлось. Проверьте написание или поищите по одному слову.</p>'}</section>`;
  }
  const cont = S.reading.filter(r => byId('books', r.book)).sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, 3);
  const common = shelfKids('', true), mine = shelfKids('', false);
  const recent = [...S.books].sort((a, b) => String(b.created).localeCompare(String(a.created))).slice(0, 12);
  return head + `
    ${cont.length ? `<section class="block"><h2>Продолжить чтение</h2><div class="cont">${cont.map(r => { const b = byId('books', r.book);
      return `<a class="cont-item" href="#/read/${b.id}">${coverHTML(b, 'sm')}<span><b>${esc(b.title)}</b><small>${esc(authorsText(b))}</small>
        <span class="prog wide"><i style="width:${r.pages ? Math.min(100, Math.round(r.page / r.pages * 100)) : 0}%"></i></span><small>с. ${r.page}${r.pages ? ' из ' + r.pages : ''}</small></span></a>`; }).join('')}</div></section>` : ''}
    <section class="block"><div class="block-h"><h2>Полки</h2><a class="more-link" href="#/shelves">Все полки</a></div>
      ${common.length ? `<div class="shelf-cards">${common.map(shelfCard).join('')}</div>` : `<p class="empty">${isAdmin() ? 'Общих полок пока нет. Создайте первую на вкладке «Полки».' : 'Общих полок пока нет.'}</p>`}</section>
    <section class="block"><div class="block-h"><h2>Мои полки</h2>${mine.length ? '' : '<a class="more-link" href="#/shelves">Создать</a>'}</div>
      ${mine.length ? `<div class="shelf-cards">${mine.map(shelfCard).join('')}</div>` : '<p class="empty">Своих полок пока нет. Их видите только вы.</p>'}</section>
    <section class="block"><div class="block-h"><h2>Недавно добавленные</h2><a class="more-link" href="#/books">Все книги · ${S.books.length}</a></div>${booksGrid(recent)}</section>`;
};
function shelfCard(s){
  const n = shelfCount(s), kids = S.shelves.filter(c => c.parent === s.id).length;
  const covers = shelfBooks(s.id).slice(0, 3);
  return `<a class="shelf-card" href="#/sh/${s.id}"><span class="sc-covers">${covers.map(b => coverHTML(b, 'xs')).join('') || `<span class="sc-empty">${ICON.shelves}</span>`}</span>
    <b>${esc(s.name)}</b><small>${n} ${plural(n, BOOKS_W)}${kids ? ` · ${kids} ${plural(kids, ['подполка','подполки','подполок'])}` : ''}</small></a>`;
}

/* ---------- Полки ---------- */
function shelfTree(parent, common, level){
  const list = shelfKids(parent, common);
  if(!list.length) return '';
  const ro = UI.reorder === (common ? 'common' : 'mine') + ':' + (parent || '');
  return `<ul class="tree lvl${level}">${list.map((s, i) => `<li><div class="tree-row"><a href="#/sh/${s.id}">${ICON.shelves}<span>${esc(s.name)}</span><small>${shelfCount(s)}</small></a>
      ${ro ? `<span class="arrows"><button type="button" class="icon-btn" data-act="move-shelf" data-id="${s.id}" data-dir="-1" aria-label="Выше"${i === 0 ? ' disabled' : ''}>${ICON.up}</button><button type="button" class="icon-btn" data-act="move-shelf" data-id="${s.id}" data-dir="1" aria-label="Ниже"${i === list.length - 1 ? ' disabled' : ''}>${ICON.down}</button></span>` : ''}</div>
      ${shelfTree(s.id, common, level + 1)}</li>`).join('')}</ul>`;
}
VIEWS.shelves = () => {
  const common = shelfKids('', true), mine = shelfKids('', false);
  const orderBtn = (scope, list) => list.length > 1 ? `<button type="button" class="btn sm ghost" data-act="reorder" data-scope="${scope}:">${UI.reorder === scope + ':' ? 'Готово' : 'Порядок'}</button>` : '';
  return `<header class="head"><h1>Полки</h1></header>
    <nav class="links">
      <a href="#/books">${ICON.library}Все книги<span class="n">${S.books.length}</span>${ICON.chev}</a>
      <a href="#/authors">${ICON.author}Авторы<span class="n">${new Set(S.books.flatMap(b => b.authors || [])).size}</span>${ICON.chev}</a>
    </nav>
    <section class="card"><div class="block-h"><h2>Общие полки</h2><span class="row-acts">${isAdmin() ? orderBtn('common', common) + `<button type="button" class="btn sm" data-act="new-shelf" data-common="1">${ICON.plus}<span>Полка</span></button>` : ''}</span></div>
      ${common.length ? shelfTree('', true, 1) : '<p class="empty">Общих полок пока нет.</p>'}</section>
    <section class="card"><div class="block-h"><h2>Мои полки</h2><span class="row-acts">${orderBtn('mine', mine)}<button type="button" class="btn sm" data-act="new-shelf" data-common="">${ICON.plus}<span>Полка</span></button></span></div>
      ${mine.length ? shelfTree('', false, 1) : '<p class="empty">Своих полок пока нет. Их видите только вы.</p>'}</section>`;
};
VIEWS.sh = r => {
  const s = byId('shelves', r.id);
  if(!s) return notFound();
  const path = shelfPath(s);
  const up = path.length > 1 ? '#/sh/' + path[path.length - 2].id : '#/shelves';
  const kids = shelfKids(s.id);
  const books = shelfBooks(s.id).sort(titleSort);
  const ro = UI.reorder === 'sub:' + s.id;
  return `${backLink(up, path.length > 1 ? path[path.length - 2].name : 'Полки')}
    <header class="head"><div><p class="crumbs">${path.slice(0, -1).map(p => `<a href="#/sh/${p.id}">${esc(p.name)}</a>`).join(' › ') || (s.common ? 'Общая полка' : 'Моя полка')}</p><h1>${esc(s.name)}</h1></div>
      ${canEditShelf(s) ? `<button type="button" class="icon-btn" data-act="shelf-menu" data-id="${s.id}" aria-label="Действия с полкой" aria-haspopup="menu">${ICON.more}</button>` : ''}</header>
    ${kids.length ? `<section class="block"><div class="block-h"><h2>Подполки</h2>${ro ? '<button type="button" class="btn sm ghost" data-act="reorder" data-scope="">Готово</button>' : ''}</div>
      <div class="sub-list">${kids.map((k, i) => `<div class="sub-row"><a class="sub" href="#/sh/${k.id}">${ICON.shelves}<span>${esc(k.name)}</span><small>${shelfCount(k)}</small>${ICON.chev}</a>
        ${ro ? `<span class="arrows"><button type="button" class="icon-btn" data-act="move-shelf" data-id="${k.id}" data-dir="-1" aria-label="Выше"${i === 0 ? ' disabled' : ''}>${ICON.up}</button><button type="button" class="icon-btn" data-act="move-shelf" data-id="${k.id}" data-dir="1" aria-label="Ниже"${i === kids.length - 1 ? ' disabled' : ''}>${ICON.down}</button></span>` : ''}</div>`).join('')}</div></section>` : ''}
    <section class="block"><div class="block-h"><h2>Книги · ${books.length}</h2>${canEditShelf(s) ? `<button type="button" class="btn sm" data-act="shelf-books" data-id="${s.id}">${ICON.plus}<span>Добавить книги</span></button>` : ''}</div>
      ${books.length ? booksGrid(books) : `<p class="empty">${canEditShelf(s) ? 'На полке пока нет книг. Нажмите «Добавить книги» или откройте книгу и выберите «На полку».' : 'На полке пока нет книг.'}</p>`}</section>`;
};

/* ---------- Все книги ---------- */
const SORTS = {title: 'по названию', author: 'по автору', added: 'сначала новые'};
function sortedBooks(list){
  const by = UI.booksSort;
  const a1 = b => { const a = byId('authors', (b.authors || [])[0]); return a ? a.sort_name || a.name : 'яяя'; };
  if(by === 'author') return list.sort((a, b) => collator.compare(a1(a), a1(b)) || titleSort(a, b));
  if(by === 'added') return list.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return list.sort(titleSort);
}
VIEWS.books = () => {
  let list = S.books.filter(b => (!UI.booksFmt || b.format === UI.booksFmt) && (!UI.booksScan || (b.format === 'pdf' && b.status === 'ready' && !b.has_text)));
  list = sortedBooks(list);
  const fmts = Object.keys(FORMATS).filter(f => S.books.some(b => b.format === f));
  return `${backLink('#/shelves', 'Полки')}<header class="head"><h1>Все книги</h1><span class="n-head">${list.length}</span></header>
    <div class="toolbar">
      <label class="sel"><span class="sr">Сортировка</span><select id="books-sort">${Object.entries(SORTS).map(([k, l]) => `<option value="${k}"${UI.booksSort === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="sel"><span class="sr">Формат</span><select id="books-fmt"><option value="">все форматы</option>${fmts.map(f => `<option value="${f}"${UI.booksFmt === f ? ' selected' : ''}>${FORMATS[f]}</option>`).join('')}</select></label>
      <label class="check-chip"><input type="checkbox" id="books-scan"${UI.booksScan ? ' checked' : ''}><span>скан без текста</span></label>
      <span class="seg2" role="group" aria-label="Вид"><button type="button" data-act="books-view" data-v="grid" aria-pressed="${UI.booksView === 'grid'}" aria-label="Сеткой">${ICON.grid}</button><button type="button" data-act="books-view" data-v="list" aria-pressed="${UI.booksView === 'list'}" aria-label="Списком">${ICON.list}</button></span>
    </div>
    ${list.length ? (UI.booksView === 'list' ? `<div class="rows">${list.map(b => bookRow(b)).join('')}</div>` : booksGrid(list)) : '<p class="empty">Под эти условия книг нет.</p>'}`;
};

/* ---------- Авторы ---------- */
VIEWS.authors = () => {
  const list = S.authors.map(a => ({a, n: booksOfAuthor(a.id).length})).filter(x => x.n).sort((x, y) => collator.compare(x.a.sort_name || x.a.name, y.a.sort_name || y.a.name));
  const groups = [];
  for(const x of list){ const L = (x.a.sort_name || x.a.name || '?').trim()[0].toUpperCase().replace('Ё', 'Е'); let g = groups[groups.length - 1]; if(!g || g.L !== L){ g = {L, items: []}; groups.push(g); } g.items.push(x); }
  return `${backLink('#/shelves', 'Полки')}<header class="head"><h1>Авторы</h1><span class="n-head">${list.length}</span></header>
    ${groups.length ? groups.map(g => `<section class="letter"><h2>${esc(g.L)}</h2><nav class="links">${g.items.map(x => `<a href="#/a/${x.a.id}">${esc(x.a.sort_name || x.a.name)}<span class="n">${x.n}</span>${ICON.chev}</a>`).join('')}</nav></section>`).join('') : '<p class="empty">Авторов пока нет: они появляются вместе с книгами.</p>'}`;
};
VIEWS.a = r => {
  const a = byId('authors', r.id);
  if(!a) return notFound();
  const list = booksOfAuthor(a.id).sort(titleSort);
  return `${backLink('#/authors', 'Авторы')}<header class="head"><div><p class="crumbs">Автор</p><h1>${esc(a.name)}</h1></div>
    ${isAdmin() ? `<button type="button" class="icon-btn" data-act="author-edit" data-id="${a.id}" aria-label="Изменить имя автора">${ICON.pen}</button>` : ''}</header>
    <section class="block"><h2>Книги · ${list.length}</h2>${booksGrid(list)}</section>`;
};

/* ---------- Карточка книги ---------- */
function noteRow(n, opts){
  opts = opts || {};
  const b = n.book ? byId('books', n.book) : null;
  const where = opts.noBook ? '' : b ? esc(b.title) : n.book_title ? `${esc(n.book_title)} (книга удалена)` : 'Без книги';
  return `<a class="note-row" href="#/note/${n.id}">${n.kind === 'lesson' ? ICON.lesson : ICON.notes}
    <span class="nr-t"><b>${esc(n.title || 'Без заголовка')}</b>${n.body_text ? `<span class="nr-x">${esc(n.body_text)}</span>` : ''}
      <small>${[where, n.page ? 'с. ' + n.page : '', fmtWhen(n.updated)].filter(Boolean).join(' · ')}</small></span>
    ${n.shared && n.owner === me().id ? '<span class="tag">Видна всем</span>' : ''}${ICON.chev}</a>`;
}
VIEWS.b = r => {
  const b = byId('books', r.id);
  if(!b) return notFound();
  const rd = readingOf(b.id);
  const shelves = S.sbooks.filter(x => x.book === b.id).map(x => byId('shelves', x.shelf)).filter(Boolean);
  const tab = isAdmin() && r.q.get('tab') === 'lessons' ? 'lessons' : 'notes';
  const mine = notesOfBook(b.id).filter(n => n.owner === me().id && n.kind === (tab === 'lessons' ? 'lesson' : 'note')).sort((x, y) => String(y.updated).localeCompare(String(x.updated)));
  const shared = isAdmin() ? [] : notesOfBook(b.id).filter(n => n.owner !== me().id && n.shared).sort((x, y) => (x.page || 0) - (y.page || 0));
  const canRead = b.format === 'pdf' && b.status === 'ready';
  const readBtn = b.format !== 'pdf' ? `<p class="soon">Читалка для этого формата появится позже.</p>`
    : b.status === 'processing' ? '<p class="soon">Книга обрабатывается: через минуту её можно будет открыть.</p>'
    : `<a class="btn primary big" href="#/read/${b.id}">${ICON.book}<span>${rd && rd.page > 1 ? 'Продолжить со с. ' + rd.page : 'Читать'}</span></a>`;
  const facts = [b.year ? b.year + ' г.' : '', b.pages ? `${b.pages} ${plural(b.pages, PAGES_W)}` : '', FORMATS[b.format], isAdmin() && b.file_size ? fsize(b.file_size) : '',
    b.format === 'pdf' && b.status === 'ready' && !b.has_text ? 'скан без текста' : ''].filter(Boolean);
  return `${backLink('#/', 'Библиотека')}
    <article class="book">
      <div class="book-cover">${coverHTML(b, 'lg')}</div>
      <div class="book-info">
        <h1>${esc(b.title)}</h1>
        ${(b.authors || []).length ? `<p class="book-authors">${b.authors.map(id => byId('authors', id)).filter(Boolean).map(a => `<a href="#/a/${a.id}">${esc(a.name)}</a>`).join(', ')}</p>` : ''}
        <p class="facts">${facts.map(esc).join(' · ')}</p>
        ${b.status === 'processing' ? '<p class="tag wait">Обрабатывается</p>' : ''}
        ${b.status === 'error' ? `<p class="form-err">${esc(b.status_note || 'Файл не удалось обработать.')}</p>` : isAdmin() && b.status_note ? `<p class="hint">${esc(b.status_note)}</p>` : ''}
        <div class="book-acts">${readBtn}
          <button type="button" class="btn" data-act="to-shelf" data-id="${b.id}">${ICON.shelves}<span>На полку</span></button>
          ${isAdmin() ? `<button type="button" class="icon-btn" data-act="book-menu" data-id="${b.id}" aria-label="Действия с книгой" aria-haspopup="menu">${ICON.more}</button>` : ''}</div>
        ${shelves.length ? `<p class="on-shelves">На полках: ${shelves.map(s => `<a class="chip sm" href="#/sh/${s.id}">${esc(shelfPath(s).map(p => p.name).join(' › '))}</a>`).join(' ')}</p>` : ''}
        ${b.description ? `<details class="desc"${UI.descOpen ? ' open' : ''}><summary>Описание</summary><p>${esc(b.description).replace(/\n/g, '<br>')}</p></details>` : ''}
      </div>
    </article>
    <section class="card notes-card">
      ${isAdmin() ? `<div class="tabs" role="tablist"><a role="tab" href="#/b/${b.id}" aria-selected="${tab === 'notes'}">Заметки</a><a role="tab" href="#/b/${b.id}?tab=lessons" aria-selected="${tab === 'lessons'}">Уроки</a></div>` : '<h2>Заметки</h2>'}
      <div class="rows">${mine.map(n => noteRow(n, {noBook: true})).join('') || `<p class="empty">${tab === 'lessons' ? 'Уроков к этой книге пока нет.' : 'Заметок к этой книге пока нет.'}</p>`}</div>
      <a class="btn" href="#/note/new?book=${b.id}${tab === 'lessons' ? '&kind=lesson' : ''}">${ICON.plus}<span>${tab === 'lessons' ? 'Урок' : 'Заметка'}</span></a>
      ${shared.length ? `<h3 class="sub-h">Заметки автора библиотеки</h3><div class="rows">${shared.map(n => noteRow(n, {noBook: true})).join('')}</div>` : ''}
    </section>`;
};

/* ---------- Мои заметки ---------- */
VIEWS.notes = () => {
  const kinds = isAdmin() ? [['', 'Все'], ['note', 'Заметки'], ['lesson', 'Уроки']] : [['', 'Мои'], ['shared', 'От автора библиотеки']];
  let list = S.notes.filter(n => {
    if(UI.notesKind === 'shared') return n.owner !== me().id;
    if(n.owner !== me().id) return false;
    return !UI.notesKind || n.kind === UI.notesKind;
  });
  if(UI.notesQ && UI.notesHits) list = list.filter(n => UI.notesHits.has(n.id));
  list.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return `<header class="head"><h1>Заметки</h1>
      <span class="row-acts"><a class="btn sm" href="#/note/new">${ICON.plus}<span>Заметка</span></a>${isAdmin() ? `<a class="btn sm" href="#/note/new?kind=lesson">${ICON.plus}<span>Урок</span></a>` : ''}</span></header>
    <label class="search"><span class="sr">Поиск по тексту заметок</span>${ICON.search}<input type="search" id="nq" placeholder="Поиск по заголовку и тексту" value="${esc(UI.notesQ)}" autocomplete="off"></label>
    <div class="seg" role="radiogroup" aria-label="Что показать">${kinds.map(([k, l]) => `<button type="button" role="radio" data-act="notes-kind" data-k="${k}" aria-checked="${UI.notesKind === k}">${l}</button>`).join('')}</div>
    ${UI.notesQ && !UI.notesHits ? '<p class="hint">Ищу…</p>' : ''}
    <div class="rows">${list.map(n => noteRow(n)).join('') || `<p class="empty">${UI.notesQ ? 'Ничего не нашлось.' : 'Здесь появятся заметки ко всем книгам. Новую заметку можно начать в карточке книги или прямо в читалке.'}</p>`}</div>`;
};
let nqTimer = 0;
function notesSearch(){
  clearTimeout(nqTimer);
  const q = norm(UI.notesQ);
  if(!q){ UI.notesHits = null; schedule(); return; }
  UI.notesHits = null;
  nqTimer = setTimeout(async () => {
    try {
      const words = q.split(' ').slice(0, 5);
      const filter = words.map((w, i) => `search ~ {:w${i}}`).join(' && ');
      const params = {}; words.forEach((w, i) => params['w' + i] = w);
      const res = await pb.collection('notes').getFullList({filter: pb.filter(filter, params), fields: 'id'});
      if(norm(UI.notesQ) === q){ UI.notesHits = new Set(res.map(x => x.id)); schedule(); }
    } catch(e){ toast(errText(e)); }
  }, 300);
}

/* ---------- Профиль ---------- */
VIEWS.profile = () => {
  const u = me();
  const inv = S.invites.slice().sort((a, b) => String(b.created).localeCompare(String(a.created)));
  const myNotes = S.notes.filter(n => n.owner === u.id).length;
  return `<header class="head"><h1>Профиль</h1></header>
    <section class="card me-card"><span class="me" aria-hidden="true">${esc((String(u.name || u.email || '?').trim()[0] || '?').toUpperCase())}</span>
      <div class="who"><b>${esc(u.name || 'Без имени')}</b><span>${esc(u.email || '')}</span><small>${isAdmin() ? 'Администратор библиотеки' : 'Читатель'}</small></div>
      <button type="button" class="icon-btn" data-act="edit-name" aria-label="Изменить имя">${ICON.pen}</button></section>
    <section class="card"><h2>Оформление</h2>
      <div class="seg3" role="radiogroup" aria-label="Тема">${[['light','Светлая'],['dark','Тёмная'],['auto','Как в системе']].map(([k, l]) =>
        `<input type="radio" name="p-theme" id="p-theme-${k}" value="${k}"${themePref() === k ? ' checked' : ''}><label for="p-theme-${k}">${l}</label>`).join('')}</div></section>
    <nav class="links">
      <a href="#/notes">${ICON.notes}${isAdmin() ? 'Мои заметки и уроки' : 'Мои заметки'}<span class="n">${myNotes}</span>${ICON.chev}</a>
      ${isAdmin() ? `<a href="#/log">${ICON.log}Журнал чтения${ICON.chev}</a>` : ''}
    </nav>
    ${isAdmin() ? `<details class="fold" id="inv-fold"${UI.invOpen ? ' open' : ''}><summary><span>Приглашения</span>${ICON.chev}</summary><div class="fold-body">
      <p class="hint">Новый человек может зарегистрироваться только по приглашению. Создайте его и отправьте ссылку.</p>
      <div class="field"><label for="i-note">Для кого (заметка)</label><input type="text" id="i-note" placeholder="Например: мама"></div>
      <div class="field"><label for="i-max">Сколько регистраций</label><select id="i-max"><option value="1">1 человек</option><option value="5">до 5 человек</option><option value="0">без ограничения</option></select></div>
      <div class="field"><label for="i-exp">Действует до (необязательно)</label><input type="date" id="i-exp"></div>
      <button type="button" class="btn primary" data-act="new-invite">Создать и скопировать ссылку</button>
      <div>${inv.length ? inv.map(i => `<div class="inv"><code>${esc(i.code)}</code><span class="muted">${i.note ? esc(i.note) + ' · ' : ''}использовано ${i.uses || 0}${i.max_uses > 0 ? ' из ' + i.max_uses : ', без ограничения'}${i.expires ? ' · до ' + fmtDate(i.expires) : ''}</span>
        <div class="acts"><button type="button" class="btn sm" data-act="copy-invite" data-code="${esc(i.code)}">Скопировать ссылку</button><button type="button" class="btn sm ghost danger" data-act="del-invite" data-id="${esc(i.id)}">Удалить</button></div></div>`).join('') : '<p class="hint">Приглашений пока нет.</p>'}</div>
    </div></details>` : ''}
    <details class="fold"><summary><span>Сменить пароль</span>${ICON.chev}</summary><div class="fold-body">
      <div class="field"><label for="p-old">Текущий пароль</label><input type="password" id="p-old" autocomplete="current-password"></div>
      <div class="field"><label for="p-new">Новый пароль (не короче 8 символов)</label><input type="password" id="p-new" autocomplete="new-password"></div>
      <div class="field"><label for="p-new2">Повторите новый</label><input type="password" id="p-new2" autocomplete="new-password"></div>
      <button type="button" class="btn" data-act="save-pass">Сменить пароль</button></div></details>
    ${isAdmin() && S.disk ? `<p class="hint">Книг: ${S.disk.count}, ${fsize(S.disk.books || 1)}. Свободно на диске сервера ${fsize(S.disk.free)}.</p>` : ''}
    <button type="button" class="btn wide" data-act="logout">Выйти</button>
    <p class="hint"><a href="/privacy.html" target="_blank" rel="noopener">Политика конфиденциальности</a></p>`;
};
async function loadInvites(){ try { S.invites = await pb.collection('invites').getFullList(); schedule(); } catch(e){} }
async function loadDisk(){ try { S.disk = await pb.send('/api/knigi/disk', {}); schedule(); } catch(e){} }

/* ---------- Журнал чтения (только администратор) ---------- */
VIEWS.log = () => {
  if(!isAdmin()) return notFound();
  const L = UI.log;
  if(!L){ loadLog(); return `${backLink('#/profile', 'Профиль')}<header class="head"><h1>Журнал чтения</h1></header><div class="loading">Загружаю…</div>`; }
  const q = UI.logQ;
  const people = Object.fromEntries(L.users.map(u => [u.id, u]));
  const readers = L.users.filter(u => !u.admin);
  const bookIds = [...new Map(L.rows.map(r => [r.book || r.book_title, r])).values()];
  const days = [];
  for(const r of L.rows){
    const t = new Date(r.hour + ':00:00Z');
    const key = t.toDateString();
    let g = days[days.length - 1]; if(!g || g.key !== key){ g = {key, t, rows: []}; days.push(g); }
    g.rows.push({...r, t});
  }
  const st = L.settings;
  const limitMB = Math.round(st.limit / MB);
  return `${backLink('#/profile', 'Профиль')}<header class="head"><h1>Журнал чтения</h1></header>
    <p class="hint">${st.log ? `Журнал включён, записи хранятся ${st.days} дн.` : 'Журнал выключен (READ_LOG=0): новые записи не появляются.'} ${st.limit ? `Ограничение ${limitMB} МБ в час на читателя.` : 'Ограничение скорости выключено.'} ${st.watermark ? 'Подпись на страницах включена.' : 'Подпись на страницах выключена.'} Красным отмечены часы, где превышен лимит или открыто больше 150 страниц.</p>
    <div class="toolbar">
      <label class="sel"><span class="sr">Читатель</span><select id="log-user"><option value="">все читатели</option>${readers.map(u => `<option value="${u.id}"${q.user === u.id ? ' selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}</select></label>
      <label class="sel"><span class="sr">Книга</span><select id="log-book"><option value="">все книги</option>${bookIds.filter(r => r.book).map(r => `<option value="${r.book}"${q.book === r.book ? ' selected' : ''}>${esc(r.book_title)}</option>`).join('')}</select></label>
      <label class="sel"><span class="sr">За сколько дней</span><select id="log-days">${[[1,'сегодня и вчера'],[7,'7 дней'],[30,'30 дней'],[180,'180 дней']].map(([k, l]) => `<option value="${k}"${+q.days === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    ${days.length ? days.map(g => `<section class="card log-day"><h2>${g.t.getDate()} ${MONF[g.t.getMonth()]}${g.t.getFullYear() !== new Date().getFullYear() ? ' ' + g.t.getFullYear() : ''}</h2>
      ${g.rows.map(r => { const u = people[r.user] || {}; const bad = r.over_limit || r.pages_seen > 150; const h = r.t.getHours();
        return `<div class="log-row${bad ? ' bad' : ''}"><span class="lr-time">${pad(h)}:00–${pad((h + 1) % 24)}:00</span>
          <span class="lr-main"><b>${esc(u.name || u.email || 'Пользователь удалён')}</b> <span class="muted">${esc(u.email || '')}</span><br>${r.book ? `<a href="#/b/${r.book}">${esc(r.book_title)}</a>` : esc(r.book_title) + ' (удалена)'}</span>
          <span class="lr-num">${r.pages_seen} ${plural(r.pages_seen, ['стр.', 'стр.', 'стр.'])}<br>${fsize(r.bytes_sent || 0)}${r.over_limit ? '<br><b>лимит</b>' : ''}</span></div>`; }).join('')}</section>`).join('') : '<p class="empty">За это время записей нет.</p>'}`;
};
let logBusy = false;
async function loadLog(){
  if(logBusy) return; logBusy = true;
  try { const q = UI.logQ; UI.log = await pb.send(`/api/knigi/admin/log?days=${q.days}&user=${encodeURIComponent(q.user)}&book=${encodeURIComponent(q.book)}`, {}); }
  catch(e){ UI.log = {rows: [], users: [], settings: {}}; toast(errText(e)); }
  finally { logBusy = false; render(true); }
}

/* ---------- Заметка и урок ---------- */
// Редактор Quill 2 (лицензия BSD) лежит в vendor/quill и подгружается при первом открытии заметки.
// Пока человек пишет, черновик сразу пишется в память браузера и через полторы секунды сохраняется на сервере.
const ED = {id: '', isNew: false, quill: null, rec: null, dirty: false, timer: 0, saving: null, state: ''};
let quillLoad = null;
function loadQuill(){
  if(window.Quill) return Promise.resolve();
  if(quillLoad) return quillLoad;
  quillLoad = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/vendor/quill/quill.snow.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = '/vendor/quill/quill.js'; s.onload = res; s.onerror = () => { quillLoad = null; rej(new Error('Редактор не загрузился. Проверьте интернет.')); };
    document.head.appendChild(s);
  });
  return quillLoad;
}
// Тот же список разрешённых тегов, что и на сервере: показываем только безопасное оформление
const ALLOWED = new Set(['P','BR','H2','H3','STRONG','B','EM','I','U','S','UL','OL','LI','BLOCKQUOTE','A']);
function cleanHtml(html){
  const doc = new DOMParser().parseFromString('<div>' + String(html || '') + '</div>', 'text/html');
  const walk = node => {
    for(const ch of [...node.childNodes]){
      if(ch.nodeType === 3) continue;
      if(ch.nodeType !== 1 || !ALLOWED.has(ch.tagName)){ if(ch.nodeType === 1 && !/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|SVG|MATH)$/.test(ch.tagName)){ walk(ch); ch.replaceWith(...ch.childNodes); } else ch.remove(); continue; }
      const href = ch.tagName === 'A' ? ch.getAttribute('href') || '' : '';
      for(const a of [...ch.attributes]) ch.removeAttribute(a.name);
      if(ch.tagName === 'A' && /^(https?:\/\/|mailto:)/i.test(href)){ ch.setAttribute('href', href); ch.setAttribute('target', '_blank'); ch.setAttribute('rel', 'noopener noreferrer'); }
      walk(ch);
    }
  };
  const root = doc.body.firstChild; walk(root); return root.innerHTML;
}
const draftKey = id => 'draft_' + id;
VIEWS.note = r => {
  const isNew = r.id === 'new';
  if(isNew && ED.isNew && ED.id) { /* та же новая заметка */ }
  const n = isNew ? null : (ED.rec && ED.rec.id === r.id ? ED.rec : byId('notes', r.id));
  if(!isNew && !n) return notFound();
  const kind = isNew ? (isAdmin() && r.q.get('kind') === 'lesson' ? 'lesson' : 'note') : n.kind;
  const bookId = isNew ? r.q.get('book') || '' : n.book;
  const b = bookId ? byId('books', bookId) : null;
  const own = isNew || n.owner === me().id;
  const back = b ? '#/b/' + b.id + (kind === 'lesson' ? '?tab=lessons' : '') : '#/notes';
  const page = isNew ? (+r.q.get('page') || '') : (n.page || '');
  const bookLine = b ? `<a href="#/b/${b.id}">${esc(b.title)}</a>` : n && n.book_title ? `${esc(n.book_title)} <span class="muted">(книга удалена)</span>` : '<span class="muted">Без книги</span>';
  const pageLink = p => b && b.format === 'pdf' && p ? `<a class="page-link" href="#/read/${b.id}?p=${p}">с. ${p}</a>` : p ? `с. ${p}` : '';
  if(!own){
    return `${backLink(back, b ? b.title : 'Заметки')}
      <article class="card note-view"><p class="note-kind">${kind === 'lesson' ? 'Урок' : 'Заметка'} автора библиотеки</p>
        <h1>${esc(n.title || 'Без заголовка')}</h1><p class="note-meta">${bookLine}${n.page ? ' · ' + pageLink(n.page) : ''} · изменено ${esc(fmtWhen(n.updated))}</p>
        <div class="prose" id="note-body"><p class="muted">Загружаю…</p></div></article>
      ${kind === 'lesson' ? filesBlock(n, false) : ''}`;
  }
  return `${backLink(back, b ? b.title : 'Заметки')}
    <article class="card note-edit">
      <div class="note-top"><p class="note-kind">${kind === 'lesson' ? 'Урок' : 'Заметка'}</p>${n && n.shared ? '<span class="tag shared">Видна всем</span>' : ''}
        <span class="ed-state" id="ed-state" role="status">${esc(ED.state)}</span>
        <button type="button" class="icon-btn" data-act="note-menu" aria-label="Действия с заметкой" aria-haspopup="menu">${ICON.more}</button></div>
      <label class="sr" for="ed-title">Заголовок</label><input type="text" id="ed-title" class="ed-title" maxlength="300" placeholder="Заголовок" value="${esc(n ? n.title : '')}">
      <div class="note-meta">${bookLine}<label class="ed-page">страница <input type="number" id="ed-page" min="0" max="99999" inputmode="numeric" value="${esc(page)}"></label>${b && b.format === 'pdf' ? `<a class="btn sm ghost" id="ed-open" href="#/read/${b.id}${page ? '?p=' + page : ''}">Открыть книгу</a>` : ''}</div>
      <div id="ed-box" class="ed-box"><p class="muted">Загружаю редактор…</p></div>
    </article>
    ${kind === 'lesson' && n ? filesBlock(n, true) : kind === 'lesson' ? '<p class="hint">Файлы можно будет прикрепить, когда в уроке появится текст или заголовок.</p>' : ''}`;
};
function filesBlock(n, own){
  const files = S.nfiles.filter(f => f.note === n.id).sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.created).localeCompare(String(b.created)));
  const ups = UP.items.filter(u => u.kind === 'file' && u.note === n.id && u.state !== 'done');
  if(!own && !files.length) return '';
  return `<section class="card files"><div class="block-h"><h2>Файлы${files.length ? ' · ' + files.length : ''}</h2>
      ${own && isAdmin() ? `<label class="btn sm">${ICON.plus}<span>Прикрепить файлы</span><input type="file" id="note-files" data-note="${n.id}" multiple hidden accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.gif,.heic"></label>` : ''}</div>
    ${files.map(f => `<div class="file-row">${ICON.file}<span class="fr-t"><b>${esc(f.name)}</b><small>${esc((f.ext || '').toUpperCase())} · ${fsize(f.size || 0)}</small></span>
      ${f.ext === 'pdf' ? `<a class="btn sm" href="#/pdf/${f.id}?note=${n.id}">Открыть</a>` : own ? `<button type="button" class="btn sm" data-act="file-dl" data-id="${f.id}">${ICON.dl}<span>Скачать</span></button>` : ''}
      ${own ? `<button type="button" class="icon-btn" data-act="file-del" data-id="${f.id}" aria-label="Удалить файл">${ICON.trash}</button>` : ''}</div>`).join('')}
    ${ups.map(u => `<div class="file-row up">${ICON.upload}<span class="fr-t"><b>${esc(u.file.name)}</b><small>${esc(upText(u))}</small><span class="prog wide"><i style="width:${u.pct}%"></i></span></span></div>`).join('')}
    ${!files.length && !ups.length ? '<p class="empty">PDF, DOC, DOCX, PPT, PPTX и изображения до 50 МБ. PDF открывается прямо в приложении, остальное можно скачать.</p>' : ''}
    ${own && isAdmin() && files.some(f => f.ext !== 'pdf') ? '<p class="hint">Если урок виден всем, читатели видят только PDF, остальные файлы видите только вы.</p>' : ''}</section>`;
}
async function edMount(r){
  const own = r.id === 'new' || ((ED.rec && ED.rec.id === r.id ? ED.rec : byId('notes', r.id)) || {}).owner === me().id;
  if(r.id === 'new'){
    if(!ED.isNew || !ED.id){ ED.id = newId(); ED.isNew = true; ED.rec = null; ED.state = ''; }
  } else if(ED.id !== r.id){ ED.id = r.id; ED.isNew = false; ED.rec = null; ED.state = ''; }
  const id = ED.id;
  let rec = ED.rec;
  if(!rec && !ED.isNew){
    try { rec = await pb.collection('notes').getOne(id); } catch(e){ toast(errText(e)); return; }
    if(ED.id !== id) return;
    ED.rec = rec;
  }
  if(!own){ const box = $('#note-body'); if(box) box.innerHTML = cleanHtml(rec.body) || '<p class="muted">Текста нет.</p>'; return; }
  try { await loadQuill(); } catch(e){ $('#ed-box').innerHTML = `<p class="form-err">${esc(e.message)}</p>`; return; }
  const box = $('#ed-box'); if(!box || ED.id !== id) return;
  box.innerHTML = '<div id="ed-q"></div>';
  const q = new Quill('#ed-q', {theme: 'snow', placeholder: 'Текст заметки',
    modules: {toolbar: {container: [[{header: 2}, {header: 3}], ['bold', 'italic', 'underline'], [{list: 'bullet'}, {list: 'ordered'}], ['blockquote', 'link'], ['undo']],
      handlers: {undo(){ this.quill.history.undo(); }}}, history: {delay: 700, maxStack: 300, userOnly: true}}});
  ED.quill = q;
  // русские подсказки на кнопках
  const tips = {'.ql-header[value="2"]': 'Заголовок', '.ql-header[value="3"]': 'Подзаголовок', '.ql-bold': 'Жирный', '.ql-italic': 'Курсив', '.ql-underline': 'Подчёркнутый',
    '.ql-list[value="bullet"]': 'Маркированный список', '.ql-list[value="ordered"]': 'Нумерованный список', '.ql-blockquote': 'Цитата', '.ql-link': 'Ссылка', '.ql-undo': 'Отменить'};
  for(const [s, t] of Object.entries(tips)){ const el = box.querySelector(s); if(el){ el.title = t; el.setAttribute('aria-label', t); } }
  const hb = box.querySelectorAll('.ql-header'); if(hb[0]) hb[0].innerHTML = '<b>З</b>'; if(hb[1]) hb[1].innerHTML = '<b>з</b>';
  const ub = box.querySelector('.ql-undo'); if(ub) ub.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12h-2" transform="translate(0 -6)"/></svg>';
  let html = rec ? rec.body || '' : '';
  // новая заметка из читалки с выделенной цитатой
  if(!rec && UI.quote){ html = `<blockquote>${esc(UI.quote)}</blockquote><p></p>`; UI.quote = ''; ED.dirty = true; }
  const draft = loadLS(draftKey(id), null);
  if(draft && (!rec || draft.at > Date.parse(String(rec.updated).replace(' ', 'T')) + 1000) && (draft.body !== html || draft.title !== (rec ? rec.title : ''))){
    html = draft.body;
    const t = $('#ed-title'); if(t) t.value = draft.title || '';
    const p = $('#ed-page'); if(p && draft.page) p.value = draft.page;
    ED.dirty = true; edState('Восстановлен несохранённый черновик');
  }
  q.setContents(q.clipboard.convert({html: cleanHtml(html)}), 'silent');
  q.history.clear();
  q.on('text-change', (d, o, src) => { if(src === 'user') edChanged(); });
  if(ED.dirty) edChanged();
  if(!rec && !$('#ed-title').value && window.matchMedia('(min-width: 700px)').matches) $('#ed-title').focus();
}
function edState(t){ ED.state = t; const el = $('#ed-state'); if(el) el.textContent = t; }
function edData(){
  const q = ED.quill; if(!q) return null;
  const empty = !q.getText().trim();
  const body = empty ? '' : q.getSemanticHTML().replace(/&nbsp;/g, ' ');
  return {title: ($('#ed-title') || {}).value || '', body, page: +(($('#ed-page') || {}).value || 0) || 0};
}
function edChanged(){
  const d = edData(); if(!d) return;
  ED.dirty = true;
  saveLS(draftKey(ED.id), {...d, at: Date.now()});
  edState('Есть несохранённые изменения');
  clearTimeout(ED.timer); ED.timer = setTimeout(edSave, 1500);
  const o = $('#ed-open'); if(o && o.href){ const r = route(); const bid = ED.rec ? ED.rec.book : r.q.get('book'); if(bid) o.href = `#/read/${bid}${d.page ? '?p=' + d.page : ''}`; }
}
async function edSave(){
  clearTimeout(ED.timer);
  if(!ED.dirty) return;
  if(ED.saving){ await ED.saving.catch(() => {}); return edSave(); }
  const d = edData(); if(!d) return;
  const id = ED.id, isNew = ED.isNew;
  if(isNew && !d.title.trim() && !d.body) return; // пустую новую заметку не сохраняем
  ED.dirty = false;
  edState('Сохраняю…');
  ED.saving = (async () => {
    const r = route();
    let rec;
    if(isNew){
      const kind = isAdmin() && r.q.get('kind') === 'lesson' ? 'lesson' : 'note';
      rec = await pb.collection('notes').create({id, owner: me().id, kind, book: r.q.get('book') || '', ...d});
      ED.isNew = false;
      if(route().name === 'note' && route().id === 'new') history.replaceState(null, '', '#/note/' + id);
    } else {
      rec = await pb.collection('notes').update(id, d);
    }
    ED.rec = rec;
    upsert('notes', {...rec, body_text: String(rec.body_text || '').slice(0, 160), body: undefined, search: undefined});
    if(!ED.dirty) dropLS(draftKey(id));
    edState('Сохранено');
    // у нового урока появляется блок файлов
    if(isNew && rec.kind === 'lesson' && route().name === 'note'){ const card = $('.note-edit'); const hint = card && card.nextElementSibling; if(hint && hint.classList.contains('hint')) hint.outerHTML = filesBlock(rec, true); }
  })();
  try { await ED.saving; }
  catch(e){ ED.dirty = true; edState('Не сохранено: ' + errText(e) + ' Черновик остался на этом устройстве.'); }
  finally { ED.saving = null; }
}
function edClose(){
  if(ED.dirty) edSave();
  ED.quill = null; ED.id = ''; ED.isNew = false; ED.rec = null; ED.state = '';
}
document.addEventListener('input', e => { if((e.target.id === 'ed-title' || e.target.id === 'ed-page') && ED.quill) edChanged(); });
function noteMenu(btn){
  const n = ED.rec; const own = !n || n.owner === me().id;
  if(!own) return;
  const items = [];
  if(isAdmin()) items.push({label: 'Настройки', run: () => noteSettings()});
  items.push({label: n && n.book ? 'Сменить книгу' : 'Привязать к книге', run: () => pickBook(n)});
  if(n) items.push({label: n.kind === 'lesson' ? 'Удалить урок' : 'Удалить заметку', danger: true, run: () => openForm({title: n.kind === 'lesson' ? 'Удалить урок?' : 'Удалить заметку?',
    text: `«${n.title || 'Без заголовка'}» удалится полностью${n.kind === 'lesson' ? ' вместе с прикреплёнными файлами' : ''}. Вернуть её будет нельзя.`, submit: 'Удалить', danger: true,
    async onSave(){ await pb.collection('notes').delete(n.id); dropLS(draftKey(n.id)); removeLocal('notes', n.id); ED.dirty = false; toast('Удалено'); goBack(n.book ? '#/b/' + n.book : '#/notes'); }})});
  openMenu(btn, items);
}
// «Поделиться» спрятано в настройках заметки: только администратор
async function noteSettings(){
  await edSave();
  const n = ED.rec;
  if(!n){ toast('Сначала напишите что-нибудь: пустая заметка не сохраняется.'); return; }
  openForm({title: 'Настройки', fields: [{key: 'shared', type: 'check', label: 'Видна всем читателям', hint: 'Читатели увидят её только для чтения в карточке книги, в блоке «Заметки автора библиотеки». У урока они увидят и PDF-файлы, остальные файлы видите только вы.'}],
    values: {shared: !!n.shared}, async onSave(v){
      const rec = await pb.collection('notes').update(n.id, {shared: v.shared});
      ED.rec = rec; upsert('notes', {...rec, body_text: String(rec.body_text || '').slice(0, 160), body: undefined, search: undefined});
      toast(v.shared ? 'Теперь видна всем читателям' : 'Теперь видна только вам'); render(true);
    }});
}
function pickBook(n){
  let q = '';
  const list = () => { const h = searchHits(q); return (h ? h.books : [...S.books].sort(titleSort)).slice(0, 60); };
  const rows = () => list().map(b => `<button type="button" class="pick-row" data-dlg="pick" data-id="${b.id}">${coverHTML(b, 'xs')}<span><b>${esc(b.title)}</b><small>${esc(authorsText(b))}</small></span></button>`).join('') || '<p class="empty">Ничего не нашлось.</p>';
  openForm({title: 'Книга для заметки', html: `<label class="search"><span class="sr">Поиск</span>${ICON.search}<input type="search" id="pick-q" placeholder="Название или автор" autocomplete="off"></label><div class="pick-list" id="pick-list">${rows()}</div>
      ${n && n.book ? '<button type="button" class="btn sm ghost" data-dlg="pick" data-id="">Оставить без книги</button>' : ''}`, noSubmit: true,
    onInput(el){ if(el.id === 'pick-q'){ q = el.value; $('#pick-list').innerHTML = rows(); } },
    async onClick(el){
      await edSave();
      const book = el.dataset.id;
      if(!ED.rec){ dlg.close(); go('#/note/new?book=' + book, true); return; }
      const rec = await pb.collection('notes').update(ED.rec.id, {book});
      ED.rec = rec; upsert('notes', {...rec, body_text: String(rec.body_text || '').slice(0, 160), body: undefined, search: undefined});
      dlg.close(); render(true);
    }});
}

/* ---------- Окно с формой ---------- */
const dlg = $('#dlg'), form = $('#dlg-form');
let cur = null;
function fieldHTML(fd, v){
  const id = 'fld-' + fd.key, val = v ?? '';
  if(fd.type === 'check') return `<label class="check-row"><input type="checkbox" id="${id}"${val ? ' checked' : ''}><span><b>${esc(fd.label)}</b>${fd.hint ? `<small>${esc(fd.hint)}</small>` : ''}</span></label>`;
  let input;
  if(fd.type === 'textarea') input = `<textarea id="${id}" rows="${fd.rows || 4}" maxlength="${fd.max || 20000}" placeholder="${esc(fd.placeholder || '')}">${esc(val)}</textarea>`;
  else if(fd.type === 'select') input = `<select id="${id}">${(fd.options || []).map(([k, l]) => `<option value="${esc(k)}"${String(val) === String(k) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else input = `<input type="${fd.type || 'text'}" id="${id}" value="${esc(val)}" maxlength="${fd.max || 300}" placeholder="${esc(fd.placeholder || '')}" autocomplete="off"${fd.list ? ` list="${fd.list}"` : ''}${fd.type === 'number' ? ' inputmode="numeric"' : ''}>`;
  return `<div class="field"><label for="${id}">${esc(fd.label)}</label>${input}${fd.hint ? `<small class="hint">${esc(fd.hint)}</small>` : ''}</div>`;
}
function openForm(o){
  cur = {...o, saved: false};
  form.innerHTML = `<div class="dlg-head"><h2>${esc(o.title)}</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть">${ICON.close}</button></div>
    <div class="dlg-body">${o.text ? `<p class="dlg-text">${esc(o.text)}</p>` : ''}${(o.fields || []).map(fd => fieldHTML(fd, (o.values || {})[fd.key])).join('')}${o.html || ''}</div>
    <p class="dlg-err" id="dlg-err" hidden></p>
    ${o.noSubmit ? '' : `<div class="dlg-foot">${o.noCancel ? '' : '<button type="button" class="btn" data-close>Отмена</button>'}<button type="submit" class="btn ${o.danger ? 'danger-fill' : 'primary'}" id="dlg-ok">${esc(o.submit || 'Сохранить')}</button></div>`}`;
  if(!dlg.open) dlg.showModal();
  const first = form.querySelector('.dlg-body input[type=text], .dlg-body input[type=search], .dlg-body input[type=number], .dlg-body textarea');
  if(first && window.matchMedia('(min-width: 700px)').matches) first.focus();
}
function formErr(msg){ const p = $('#dlg-err'); if(!p) return; p.textContent = msg; p.hidden = !msg; }
function collect(){
  const v = {};
  for(const fd of cur.fields || []){
    const el = form.querySelector('#fld-' + fd.key);
    v[fd.key] = fd.type === 'check' ? !!(el && el.checked) : el ? el.value.trim() : '';
  }
  return v;
}
form.addEventListener('submit', async e => {
  e.preventDefault();
  if(!cur || !cur.onSave) return;
  const v = collect();
  const miss = (cur.fields || []).find(fd => fd.required && !v[fd.key]);
  if(miss){ formErr(`Заполните поле «${miss.label}».`); return; }
  const ok = $('#dlg-ok'); ok.disabled = true; formErr('');
  try { await cur.onSave(v, cur); cur.saved = true; if(dlg.open) dlg.close(); }
  catch(err){ formErr(errText(err)); }
  finally { ok.disabled = false; }
});
form.addEventListener('click', async e => {
  if(e.target.closest('[data-close]')){ dlg.close(); return; }
  const own = e.target.closest('[data-dlg]');
  if(own && cur && cur.onClick){ try { await cur.onClick(own); } catch(err){ formErr(errText(err)); } }
});
form.addEventListener('input', e => { if(cur && cur.onInput) cur.onInput(e.target); });
form.addEventListener('change', e => { if(cur && cur.onChange) cur.onChange(e.target); });
dlg.addEventListener('close', () => { const c = cur; cur = null; c && c.onClose && c.onClose(c.saved); });
function thenOpen(fn){ if(dlg.open) dlg.addEventListener('close', () => setTimeout(fn, 0), {once: true}); else fn(); }
function arm(btn, text){
  if(btn.dataset.armed === '1') return true;
  btn.dataset.armed = '1'; const old = btn.innerHTML; btn.textContent = text;
  setTimeout(() => { if(btn.isConnected){ btn.dataset.armed = ''; btn.innerHTML = old; } }, 3500);
  return false;
}
function info(title, text){ openForm({title, text, submit: 'Понятно', noCancel: true, async onSave(){}}); }
const FIELD_RU = {email:'почта', password:'пароль', passwordConfirm:'повтор пароля', oldPassword:'текущий пароль', name:'название', title:'название', year:'год', page:'страница', body:'текст'};
function errText(e){
  if(!e) return 'Неизвестная ошибка.';
  if(e.isAbort) return 'Запрос прерван.';
  if(e.status === 0) return 'Нет связи с сервером. Проверьте интернет.';
  const r = e.response || {};
  const msg = r.message || e.message || '';
  if(/[а-яё]/i.test(msg)) return msg;
  const data = r.data || {};
  const keys = Object.keys(data);
  if(e.status === 400 && keys.length){
    if(data.email && data.email.code === 'validation_not_unique') return 'Этот адрес почты уже зарегистрирован.';
    if(data.password && /length/.test(data.password.code || '')) return 'Пароль должен быть не короче 8 символов.';
    if(data.passwordConfirm) return 'Пароли не совпадают.';
    if(data.oldPassword) return 'Текущий пароль введён неверно.';
    if(data.body && /size/.test(data.body.code || '')) return 'Текст слишком большой.';
    return 'Проверьте поля: ' + keys.map(k => FIELD_RU[k] || k).join(', ') + '.';
  }
  if(e.status === 400) return 'Это действие сейчас недоступно.';
  if(e.status === 401 || e.status === 403) return 'Нет доступа к этому действию.';
  if(e.status === 404) return 'Не найдено: возможно, это уже удалили.';
  if(e.status === 413) return 'Файл слишком большой.';
  if(e.status === 429) return 'Слишком много запросов подряд. Подождите немного.';
  return 'Не удалось выполнить действие. Попробуйте ещё раз.';
}

/* ---------- Меню «⋯» ---------- */
let menu = null;
function closeMenu(){ if(menu){ menu.el.remove(); menu.btn.setAttribute('aria-expanded', 'false'); menu = null; } }
function openMenu(btn, items){
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu'; el.setAttribute('role', 'menu');
  el.innerHTML = items.map((it, i) => `<button type="button" role="menuitem" data-i="${i}"${it.danger ? ' class="danger"' : ''}>${esc(it.label)}</button>`).join('');
  (RD.open ? $('#reader') : document.body).appendChild(el);
  const r = btn.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  el.style.top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - h - 8)) + 'px';
  el.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
  btn.setAttribute('aria-expanded', 'true');
  menu = {el, btn, items};
  el.querySelector('button').focus();
}
window.addEventListener('resize', closeMenu);
document.addEventListener('keydown', e => {
  if(!menu) return;
  if(e.key === 'Escape'){ const b = menu.btn; closeMenu(); b.focus(); e.stopPropagation(); return; }
  if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    const items = [...menu.el.querySelectorAll('button')], i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    e.preventDefault();
  }
}, true);

/* ---------- Полки: создать, переименовать, порядок, удалить ---------- */
function openShelfForm(o){
  const s = o.shelf;
  openForm({title: s ? 'Переименовать полку' : o.parent ? 'Новая подполка' : o.common ? 'Новая общая полка' : 'Новая полка',
    text: s ? '' : o.parent ? `Внутри полки «${o.parent.name}».` : o.common ? 'Общую полку видят все читатели.' : 'Свою полку видите только вы.',
    fields: [{key: 'name', label: 'Название', required: true, max: 120, placeholder: 'Например: Молитва'}], values: {name: s ? s.name : ''},
    async onSave(v){
      if(s){ upsert('shelves', await pb.collection('shelves').update(s.id, {name: v.name})); toast('Сохранено'); return; }
      const sibs = shelfKids(o.parent ? o.parent.id : '', o.common);
      const rec = await pb.collection('shelves').create({owner: me().id, name: v.name, common: !!o.common, parent: o.parent ? o.parent.id : '', sort: sibs.length});
      upsert('shelves', rec); toast('Полка создана');
      if(o.parent) go('#/sh/' + o.parent.id, true);
    }});
}
function shelfMenu(btn, s){
  const kids = S.shelves.filter(c => c.parent === s.id).length;
  const items = [];
  if(shelfDepth(s) < 3) items.push({label: 'Новая подполка', run: () => openShelfForm({parent: s, common: s.common})});
  items.push({label: 'Переименовать', run: () => openShelfForm({shelf: s})});
  if(kids > 1) items.push({label: 'Порядок подполок', run: () => { UI.reorder = 'sub:' + s.id; render(true); }});
  items.push({label: 'Книги на полке', run: () => openShelfBooks(s)});
  items.push({label: 'Удалить полку', danger: true, run: () => {
    const n = S.sbooks.filter(x => x.shelf === s.id).length;
    if(kids || n){ info('Полка не пустая', `Удалить можно только пустую полку без подполок. Сейчас на ней ${[kids ? `${kids} ${plural(kids, ['подполка','подполки','подполок'])}` : '', n ? `${n} ${plural(n, BOOKS_W)}` : ''].filter(Boolean).join(' и ')}. Сначала уберите их: сами книги останутся в библиотеке.`); return; }
    openForm({title: 'Удалить полку?', text: `Полка «${s.name}» пустая и удалится полностью.`, submit: 'Удалить', danger: true,
      async onSave(){ await pb.collection('shelves').delete(s.id); removeLocal('shelves', s.id); toast('Полка удалена'); go(s.parent ? '#/sh/' + s.parent : '#/shelves', true); }});
  }});
  openMenu(btn, items);
}
async function moveShelf(id, dir){
  const s = byId('shelves', id); if(!s) return;
  const list = shelfKids(s.parent || '', s.common);
  const i = list.findIndex(x => x.id === id), j = i + dir;
  if(j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const changed = [];
  list.forEach((x, n) => { if((x.sort ?? 0) !== n){ x.sort = n; changed.push(x); } });
  render(true);
  try { for(const x of changed) upsert('shelves', await pb.collection('shelves').update(x.id, {sort: x.sort})); }
  catch(e){ toast(errText(e)); loadAll(['shelves']).catch(() => {}); }
}
// Поставить книгу на полки или убрать: галочки по дереву полок, которые человек может менять
function openToShelf(b){
  const on = new Set(S.sbooks.filter(x => x.book === b.id).map(x => x.shelf));
  const branch = (parent, common, lvl) => shelfKids(parent, common).map(s => `<label class="check-row lvl${lvl}"><input type="checkbox" name="shelf" value="${s.id}"${on.has(s.id) ? ' checked' : ''}><span><b>${esc(s.name)}</b></span></label>${branch(s.id, common, lvl + 1)}`).join('');
  const commonHTML = isAdmin() ? branch('', true, 1) : '', mineHTML = branch('', false, 1);
  if(!commonHTML && !mineHTML){ info('Полок пока нет', isAdmin() ? 'Создайте полку на вкладке «Полки», потом ставьте на неё книги.' : 'Создайте свою полку на вкладке «Полки», потом ставьте на неё книги. Её будете видеть только вы.'); return; }
  openForm({title: 'На полку', text: `«${b.title}»: отметьте полки. Книга может стоять на нескольких.`,
    html: `${commonHTML ? `<fieldset class="checks"><legend class="flabel">Общие полки</legend>${commonHTML}</fieldset>` : ''}${mineHTML ? `<fieldset class="checks"><legend class="flabel">Мои полки</legend>${mineHTML}</fieldset>` : ''}`,
    async onSave(){
      const want = new Set([...form.querySelectorAll('input[name=shelf]:checked')].map(i => i.value));
      for(const id of want) if(!on.has(id)) upsert('sbooks', await pb.collection('shelf_books').create({shelf: id, book: b.id}));
      for(const x of S.sbooks.filter(x => x.book === b.id && !want.has(x.shelf) && canEditShelf(byId('shelves', x.shelf)))){ await pb.collection('shelf_books').delete(x.id); removeLocal('sbooks', x.id); }
      toast('Сохранено');
    }});
}
// Книги на полке: поиск по всей библиотеке с галочками
function openShelfBooks(s){
  const start = new Set(S.sbooks.filter(x => x.shelf === s.id).map(x => x.book));
  const want = new Set(start);
  let q = '';
  const rows = () => { const h = searchHits(q); const list = (h ? h.books : [...S.books].sort((a, b) => (want.has(b.id) - want.has(a.id)) || titleSort(a, b))).slice(0, 150);
    return list.map(b => `<label class="check-row book-check"><input type="checkbox" name="sb" value="${b.id}"${want.has(b.id) ? ' checked' : ''}>${coverHTML(b, 'xs')}<span><b>${esc(b.title)}</b><small>${esc(authorsText(b))}</small></span></label>`).join('') || '<p class="empty">Ничего не нашлось.</p>'; };
  openForm({title: 'Книги на полке «' + s.name + '»', html: `<label class="search"><span class="sr">Поиск</span>${ICON.search}<input type="search" id="sb-q" placeholder="Название или автор" autocomplete="off"></label>
      <p class="hint" id="sb-n">Отмечено: ${want.size}</p><div class="pick-list" id="sb-list">${rows()}</div>`,
    onInput(el){ if(el.id === 'sb-q'){ q = el.value; $('#sb-list').innerHTML = rows(); } },
    onChange(el){ if(el.name === 'sb'){ el.checked ? want.add(el.value) : want.delete(el.value); $('#sb-n').textContent = 'Отмечено: ' + want.size; } },
    async onSave(){
      let n = S.sbooks.filter(x => x.shelf === s.id).length;
      for(const id of want) if(!start.has(id)) upsert('sbooks', await pb.collection('shelf_books').create({shelf: s.id, book: id, sort: n++}));
      for(const x of S.sbooks.filter(x => x.shelf === s.id && !want.has(x.book))){ await pb.collection('shelf_books').delete(x.id); removeLocal('sbooks', x.id); }
      toast('Сохранено');
    }});
}

/* ---------- Книга: изменить, обложка, удалить (только администратор) ---------- */
function bookMenu(btn, b){
  const items = [{label: 'Изменить данные', run: () => openBookForm(b)}, {label: 'Заменить обложку', run: () => pickCover(b)}];
  if(b.status === 'error' || (b.status === 'ready' && b.format === 'pdf')) items.push({label: 'Обработать заново', run: async () => {
    try { await pb.send(`/api/knigi/books/${b.id}/reprocess`, {method: 'POST'}); kickProcess(); toast('Книга снова обрабатывается'); } catch(e){ toast(errText(e)); } }});
  items.push({label: 'Удалить книгу', danger: true, run: () => confirmDeleteBook(b)});
  openMenu(btn, items);
}
async function authorIds(text){
  const names = text.split(/\s*[;,]\s*/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 20);
  const ids = [];
  for(const name of names){
    let a = S.authors.find(x => norm(x.name) === norm(name));
    if(!a){ a = await pb.collection('authors').create({name}); upsert('authors', a); }
    if(!ids.includes(a.id)) ids.push(a.id);
  }
  return ids;
}
function openBookForm(b){
  const dl = `<datalist id="authors-dl">${S.authors.map(a => `<option value="${esc(a.name)}">`).join('')}</datalist>`;
  openForm({title: 'Данные книги', fields: [
    {key: 'title', label: 'Название', required: true, max: 500},
    {key: 'authors', label: 'Авторы (через запятую)', max: 1000, list: 'authors-dl', placeholder: 'Эдвард Баундс, Джордж Мюллер'},
    {key: 'year', label: 'Год издания', type: 'number'},
    {key: 'description', label: 'Описание', type: 'textarea', rows: 6, max: 20000}],
    values: {title: b.title, authors: (b.authors || []).map(authorName).filter(Boolean).join(', '), year: b.year || '', description: b.description || ''},
    html: dl + (b.orig_name ? `<p class="hint">Файл: ${esc(b.orig_name)}, ${fsize(b.file_size || 0)}</p>` : ''),
    async onSave(v){
      const ids = await authorIds(v.authors);
      upsert('books', await pb.collection('books').update(b.id, {title: v.title, authors: ids, year: +v.year || 0, description: v.description}, {fields: BOOK_FIELDS + ',orig_name,hash'}));
      loadAll(['authors']).catch(() => {});
      toast('Сохранено');
    }});
}
function editAuthor(a){
  openForm({title: 'Автор', fields: [{key: 'name', label: 'Имя, как на обложке', required: true, max: 200}, {key: 'sort_name', label: 'Для списка по алфавиту (фамилия первой)', max: 200}],
    values: {name: a.name, sort_name: a.sort_name}, async onSave(v){ upsert('authors', await pb.collection('authors').update(a.id, v)); loadAll(['books']).catch(() => {}); toast('Сохранено'); }});
}
function pickFile(accept, multiple, cb){
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = accept; inp.multiple = !!multiple; inp.hidden = true;
  inp.addEventListener('change', () => { const files = [...inp.files]; inp.remove(); if(files.length) cb(files); });
  (dlg.open ? dlg : document.body).appendChild(inp);
  inp.click();
}
function pickCover(b){
  pickFile('image/jpeg,image/png,image/webp,image/gif', false, async ([f]) => {
    if(f.size > 10 * MB){ toast('Картинка больше 10 МБ.'); return; }
    const fd = new FormData(); fd.append('cover', f);
    try { const r = await pb.send(`/api/knigi/books/${b.id}/cover`, {method: 'POST', body: fd}); upsert('books', {id: b.id, cover: r.cover}); toast('Обложка заменена'); }
    catch(e){ toast(errText(e)); }
  });
}
function confirmDeleteBook(b){
  const mine = notesOfBook(b.id).filter(n => n.owner === me().id);
  const fields = mine.length ? [{key: 'notes', type: 'select', label: `Ваши заметки и уроки к этой книге (${mine.length})`, options: [['keep', 'оставить без книги'], ['delete', 'удалить вместе с книгой']], hint: 'Оставленные будут в разделе «Заметки» с пометкой «книга удалена».'}] : [];
  openForm({title: 'Удалить книгу?', text: `«${b.title}»: удалятся файл, текст, обложка, место на полках и прогресс чтения у всех. Вернуть можно только новой загрузкой. Заметки читателей останутся у них без книги.`,
    fields, values: {notes: 'keep'}, submit: 'Удалить', danger: true,
    async onSave(v){
      await pb.send(`/api/knigi/books/${b.id}?notes=${v.notes === 'delete' ? 'delete' : 'keep'}`, {method: 'DELETE'});
      removeLocal('books', b.id);
      S.sbooks = S.sbooks.filter(x => x.book !== b.id); S.reading = S.reading.filter(x => x.book !== b.id);
      loadAll(['notes', 'authors']).catch(() => {});
      toast('Книга удалена'); go('#/', true);
    }});
}

/* ---------- Загрузка книг и файлов уроков (только администратор) ---------- */
// Файл идёт кусками по 8 МБ, по одному файлу за раз. Оборвавшийся кусок отправляется заново.
const UP = {items: [], running: false, hidden: false};
const UP_EXT = {book: /\.(pdf|epub|djvu|djv)$/i, file: /\.(pdf|docx?|pptx?|jpe?g|png|webp|gif|heic)$/i};
const UP_MAX = {book: 500 * MB, file: 50 * MB};
function addUploads(files, kind, note){
  for(const f of files){
    const it = {id: newId(), file: f, kind, note: note || '', state: 'wait', pct: 0, msg: '', bookId: ''};
    if(!UP_EXT[kind].test(f.name)){ it.state = 'err'; it.msg = kind === 'book' ? 'Подходят только PDF, EPUB и DjVu.' : 'Этот вид файла не подходит.'; }
    else if(f.size > UP_MAX[kind]){ it.state = 'err'; it.msg = `Больше ${UP_MAX[kind] / MB} МБ.`; }
    else if(kind === 'book' && S.books.some(b => b.orig_name === f.name && b.file_size === f.size)){ it.state = 'skip'; it.msg = 'Такой файл уже есть в библиотеке.'; }
    UP.items.push(it);
  }
  UP.hidden = false;
  runUploads();
  render(true);
}
function upText(u){
  return {wait: 'ждёт очереди', up: `загружается, ${u.pct}%`, proc: 'обрабатывается', done: 'готово', err: 'ошибка: ' + u.msg, skip: u.msg}[u.state] || '';
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function xhrChunk(url, blob, onProg){
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('Authorization', pb.authStore.token);
    x.upload.onprogress = e => onProg(e.loaded);
    x.onload = () => {
      let j = {}; try { j = JSON.parse(x.responseText || '{}'); } catch(e){}
      if(x.status >= 200 && x.status < 300) res(j); else rej({status: x.status, response: j});
    };
    x.onerror = () => rej({status: 0});
    const fd = new FormData(); fd.append('chunk', blob, 'chunk');
    x.send(fd);
  });
}
async function uploadOne(it){
  const f = it.file;
  const st = await pb.send('/api/knigi/upload/start', {method: 'POST', body: {name: f.name, size: f.size, kind: it.kind, note: it.note}});
  it.upload = st.upload;
  for(let i = 0; i < st.chunks; i++){
    if(it.cancel) throw {msg: 'отменено'};
    const blob = f.slice(i * st.chunk, Math.min(f.size, (i + 1) * st.chunk));
    for(let attempt = 0; ; attempt++){
      try {
        await xhrChunk(`/api/knigi/upload/${st.upload}/${i}`, blob, loaded => { it.pct = Math.min(99, Math.floor((i * st.chunk + loaded) / f.size * 100)); upPaint(); });
        break;
      } catch(e){
        if(attempt >= 5 || (e.status >= 400 && e.status < 500)) throw e;
        it.msg = 'связь прервалась, пробую ещё раз'; upPaint();
        await sleep(2000 * Math.pow(2, attempt));
      }
    }
  }
  return pb.send(`/api/knigi/upload/${st.upload}/finish`, {method: 'POST'});
}
function kickProcess(){ pb.send('/api/knigi/process', {method: 'POST'}).catch(() => {}); }
async function runUploads(){
  if(UP.running) return; UP.running = true;
  try {
    for(;;){
      const it = UP.items.find(x => x.state === 'wait');
      if(!it) break;
      it.state = 'up'; it.pct = 0; upPaint();
      try {
        const res = await uploadOne(it);
        it.pct = 100;
        if(res.kind === 'book'){ it.state = 'proc'; it.bookId = res.id; kickProcess(); }
        else { it.state = 'done'; }
        loadAll(it.kind === 'book' ? ['books', 'authors'] : ['nfiles']).catch(() => {});
      } catch(e){
        it.state = 'err'; it.msg = e.msg || errText(e);
        if(it.upload) pb.send('/api/knigi/upload/' + it.upload, {method: 'DELETE'}).catch(() => {});
      }
      upPaint();
    }
  } finally { UP.running = false; loadDisk(); }
}
// Обработка книги закончилась: приходит живое обновление записи
function upCheckProc(){
  for(const it of UP.items) if(it.state === 'proc'){ const b = byId('books', it.bookId); if(b && b.status !== 'processing'){ it.state = b.status === 'error' ? 'err' : 'done'; if(b.status === 'error') it.msg = b.status_note || 'файл не обработан'; } }
}
let upRaf = 0;
function upPaint(){ if(upRaf) return; upRaf = requestAnimationFrame(() => { upRaf = 0; renderUploadsPanel(); const r = route(); if(r.name === 'note'){ const fb = $('.files'); const n = ED.rec; if(fb && n) fb.outerHTML = filesBlock(n, n.owner === me().id); } }); }
function renderUploadsPanel(){
  upCheckProc();
  let el = $('#uploads');
  const books = UP.items.filter(u => u.kind === 'book');
  if(!books.length || UP.hidden || RD.open){ if(el) el.remove(); return; }
  if(!el){ el = document.createElement('section'); el.id = 'uploads'; el.className = 'uploads'; el.setAttribute('aria-label', 'Загрузка книг'); $('#app').appendChild(el); }
  const active = books.filter(u => u.state === 'wait' || u.state === 'up' || u.state === 'proc').length;
  el.innerHTML = `<div class="up-head"><b>Загрузка книг${active ? ` · осталось ${active}` : ''}</b>
      <button type="button" class="icon-btn" data-act="up-close" aria-label="${active ? 'Свернуть' : 'Закрыть'}">${active ? ICON.down : ICON.close}</button></div>
    ${active ? '<p class="hint">Не закрывайте вкладку, пока файлы загружаются.</p>' : ''}
    <div class="up-list">${books.map(u => `<div class="up-row ${u.state}"><span class="up-t"><b>${u.state === 'done' && u.bookId ? `<a href="#/b/${u.bookId}">${esc(u.file.name)}</a>` : esc(u.file.name)}</b>
      <small>${fsize(u.file.size)} · ${esc(upText(u))}</small><span class="prog wide"><i style="width:${u.state === 'done' || u.state === 'proc' ? 100 : u.pct}%"></i></span></span>
      ${u.state === 'skip' ? `<button type="button" class="btn sm ghost" data-act="up-force" data-id="${u.id}">Всё равно</button>` : ''}
      ${u.state === 'wait' || u.state === 'up' ? `<button type="button" class="icon-btn" data-act="up-cancel" data-id="${u.id}" aria-label="Отменить">${ICON.close}</button>` : ''}</div>`).join('')}</div>
    ${S.disk ? `<p class="hint">Свободно на диске сервера: ${fsize(S.disk.free)}.</p>` : ''}`;
}

/* ---------- Читалка PDF ---------- */
// pdf.js (лицензия Apache 2.0) лежит в vendor/pdfjs. Файл книги целиком не передаётся: читалка просит у сервера
// только нужные куски по 512 КБ (свой загрузчик PDFDataRangeTransport, каждый кусок отдельным запросом с Range).
// Сохранения, печати и кнопки «Скачать» в читалке нет. Подпись читателя рисуется прямо на холсте страницы.
// У читателей нет текстового слоя (READER_TEXT_LAYER), копирование, контекстное меню и перетаскивание выключены.
const RD = {open: false, key: '', src: null, doc: null, lib: null, link: null, linkAt: 0, mark: '', title: '', page: 1, pages: 0, zoom: 1,
  cache: new Map(), seq: 0, seen: new Set(), saveT: 0, pending: [], pause: 0, bars: true, outline: null, back: '#/'};
const rdText = () => isAdmin() || READER_TEXT_LAYER;
let pdfjsLoad = null;
function loadPdfjs(){
  if(!pdfjsLoad) pdfjsLoad = import('/vendor/pdfjs/pdf.min.mjs').then(lib => { lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'; return lib; }).catch(e => { pdfjsLoad = null; throw e; });
  return pdfjsLoad;
}
async function rdGetLink(force){
  if(!force && RD.link && Date.now() - RD.linkAt < (RD.link.ttl - 600) * 1000) return RD.link;
  const s = RD.src;
  RD.link = await pb.send(s.kind === 'book' ? `/api/knigi/books/${s.id}/link` : `/api/knigi/files/${s.id}/link`, {});
  RD.linkAt = Date.now();
  return RD.link;
}
class RangeError429 extends Error {}
async function rdFetch(begin, end, attempt){
  attempt = attempt || 0;
  const link = await rdGetLink(attempt > 0);
  let res;
  try { res = await fetch(link.url, {headers: {Range: `bytes=${begin}-${end - 1}`}, cache: 'no-store', credentials: 'same-origin'}); }
  catch(e){ if(attempt < 3){ await sleep(1500 * (attempt + 1)); return rdFetch(begin, end, attempt + 1); } throw {status: 0}; }
  if(res.status === 206 || res.status === 200) return new Uint8Array(await res.arrayBuffer());
  let j = {}; try { j = await res.json(); } catch(e){}
  if(res.status === 429){ const err = new RangeError429(j.message || ''); err.wait = j.wait || 10; throw err; }
  if(res.status === 401 && attempt < 1) return rdFetch(begin, end, attempt + 1); // ссылка устарела: просим новую
  throw {status: res.status, response: j};
}
function rdMakeTransport(lib, length){
  class T extends lib.PDFDataRangeTransport {
    requestDataRange(begin, end){
      // большой запрос делим на части не больше 2 МБ (границы кратны 512 КБ, как ждёт pdf.js)
      for(let b = begin; b < end; b += MAX_REQ) rdQueue(this, b, Math.min(end, b + MAX_REQ));
    }
  }
  return new T(length, null);
}
function rdQueue(t, b, e){
  if(RD.pause){ RD.pending.push([t, b, e]); return; }
  rdFetch(b, e).then(buf => { if(RD.transport === t) t.onDataRange(b, buf); }).catch(err => {
    if(err instanceof RangeError429){ RD.pending.push([t, b, e]); rdPause(err); return; }
    rdMsg(errText(err), true);
  });
}
// Сервер сказал «слишком быстро»: показываем паузу, запросы ждут и потом продолжаются с того же места
function rdPause(err){
  if(RD.pause) return;
  RD.pause = Date.now() + err.wait * 60e3;
  const tick = () => {
    if(!RD.pause) return;
    const left = Math.ceil((RD.pause - Date.now()) / 60e3);
    if(left <= 0){
      $('#rd-msg').innerHTML = `<div class="rd-msg-box"><p>Можно продолжить чтение.</p><button type="button" class="btn primary" data-rd="resume">Продолжить</button></div>`;
      $('#rd-msg').hidden = false; return;
    }
    $('#rd-msg').innerHTML = `<div class="rd-msg-box"><p><b>Вы читаете очень быстро.</b></p><p>Сделайте паузу и продолжите через ${left} ${plural(left, ['минуту','минуты','минут'])}.</p><button type="button" class="btn" data-rd="close">Закрыть книгу</button></div>`;
    $('#rd-msg').hidden = false;
    RD.pauseT = setTimeout(tick, 20e3);
  };
  tick();
}
function rdResume(){
  RD.pause = 0; clearTimeout(RD.pauseT);
  $('#rd-msg').hidden = true;
  const p = RD.pending; RD.pending = [];
  for(const [t, b, e] of p) rdQueue(t, b, e);
}
function rdMsg(text, isErr){
  const m = $('#rd-msg'); if(!m) return;
  if(!text){ m.hidden = true; return; }
  m.innerHTML = `<div class="rd-msg-box"><p${isErr ? ' class="form-err"' : ''}>${esc(text)}</p>${isErr ? '<button type="button" class="btn" data-rd="close">Закрыть</button>' : ''}</div>`;
  m.hidden = false;
}
function rdShell(){
  const box = $('#reader');
  box.innerHTML = `<div class="rd-top"><button type="button" class="icon-btn" data-rd="close" aria-label="Закрыть книгу">${ICON.back}</button>
      <h1 class="rd-title" id="rd-title"></h1>
      <button type="button" class="icon-btn" data-rd="toc" id="rd-toc" aria-label="Оглавление" hidden>${ICON.toc}</button>
      ${RD.src.kind === 'book' ? `<button type="button" class="btn sm" data-rd="note">${ICON.pen}<span>Заметка</span></button>` : ''}
      <button type="button" class="icon-btn" data-rd="menu" aria-label="Ещё" aria-haspopup="menu">${ICON.more}</button></div>
    <div class="rd-stage" id="rd-stage"><div class="rd-pagebox" id="rd-pagebox"></div></div>
    <div class="rd-bottom"><button type="button" class="icon-btn" data-rd="prev" aria-label="Предыдущая страница">${ICON.left}</button>
      <button type="button" class="rd-num" data-rd="goto" id="rd-num" aria-label="Перейти к странице">…</button>
      <button type="button" class="icon-btn" data-rd="next" aria-label="Следующая страница">${ICON.right}</button>
      <span class="rd-sp"></span>
      <button type="button" class="icon-btn" data-rd="zout" aria-label="Уменьшить">${ICON.zout}</button>
      <button type="button" class="icon-btn" data-rd="zin" aria-label="Увеличить">${ICON.zin}</button>
      ${document.fullscreenEnabled ? `<button type="button" class="icon-btn" data-rd="full" aria-label="Во весь экран">${ICON.full}</button>` : ''}</div>
    <input type="range" class="rd-slider" id="rd-slider" min="1" max="1" value="1" aria-label="Страница">
    <div class="rd-msg" id="rd-msg" hidden></div>`;
  box.classList.toggle('reader-free', isAdmin());
  box.classList.toggle('dark-pages', !!loadLS('darkPages', false));
}
async function rdShow(r){
  const src = r.name === 'read' ? {kind: 'book', id: r.id} : {kind: 'file', id: r.id};
  const key = src.kind + ':' + src.id;
  const want = +r.q.get('p') || 0;
  $('#app').hidden = true; $('#reader').hidden = false; RD.open = true;
  document.documentElement.classList.add('reading');
  if(RD.key === key && RD.doc){
    if($('#rd-stage') == null){ RD.src = src; rdShell(); rdHeader(); }
    if(want && want !== RD.page) rdGo(want); else rdGo(RD.page, true);
    return;
  }
  // другая книга: прежнюю закрываем
  rdDispose();
  RD.key = key; RD.src = src; RD.zoom = 1; RD.seen = new Set(); RD.pause = 0; RD.pending = [];
  if(src.kind === 'book'){
    const b = byId('books', src.id);
    if(!b){ RD.key = ''; $('#reader').innerHTML = `<div class="rd-msg"><div class="rd-msg-box"><p>Книга не найдена.</p><button type="button" class="btn" data-rd="close">Назад</button></div></div>`; return; }
    RD.title = b.title; RD.back = '#/b/' + b.id;
    if(b.format !== 'pdf'){ $('#reader').innerHTML = `<div class="rd-msg"><div class="rd-msg-box"><p>Читалка для этого формата появится позже.</p><button type="button" class="btn" data-rd="close">Назад</button></div></div>`; RD.key = ''; return; }
  } else {
    const f = byId('nfiles', src.id);
    RD.title = f ? f.name : 'Файл урока'; RD.back = r.q.get('note') ? '#/note/' + r.q.get('note') : '#/notes';
  }
  rdShell(); rdHeader();
  rdMsg('Открываю…');
  try {
    const [lib, link] = await Promise.all([loadPdfjs(), rdGetLink(true)]);
    if(RD.key !== key) return;
    RD.lib = lib; RD.mark = link.mark || '';
    RD.transport = rdMakeTransport(lib, link.size);
    const task = lib.getDocument({range: RD.transport, length: link.size, rangeChunkSize: CHUNK_PDF, disableAutoFetch: true, disableStream: true,
      isEvalSupported: false, enableXfa: false, cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/'});
    RD.task = task;
    const doc = await task.promise;
    if(RD.key !== key){ doc.destroy(); return; }
    RD.doc = doc; RD.pages = doc.numPages;
    rdMsg('');
    const rd = src.kind === 'book' ? readingOf(src.id) : null;
    const start = Math.min(RD.pages, Math.max(1, want || (rd ? rd.page : 1)));
    $('#rd-slider').max = RD.pages;
    rdGo(start, true);
    doc.getOutline().then(o => { RD.outline = o && o.length ? o : null; const t = $('#rd-toc'); if(t) t.hidden = !RD.outline; }).catch(() => {});
  } catch(e){
    if(RD.key !== key) return;
    rdMsg(e && e.name === 'PasswordException' ? 'Файл защищён паролем, его нельзя открыть.' : e && e.name === 'InvalidPDFException' ? 'Файл повреждён или это не PDF.' : errText(e), true);
  }
}
function rdHeader(){ const t = $('#rd-title'); if(t) t.textContent = RD.title; }
function rdDispose(){
  clearTimeout(RD.saveT); clearTimeout(RD.pauseT);
  if(RD.doc) RD.doc.destroy().catch(() => {});
  else if(RD.task) RD.task.destroy().catch(() => {});
  RD.doc = null; RD.task = null; RD.transport = null; RD.cache.clear(); RD.key = ''; RD.link = null; RD.outline = null; RD.pause = 0; RD.pending = [];
}
function rdClose(){
  if(RD.doc) rdSave(true);
  RD.open = false;
  if(document.fullscreenElement) document.exitFullscreen().catch(() => {});
  document.documentElement.classList.remove('reading');
  $('#reader').hidden = true; $('#app').hidden = false;
  closeMenu();
  // книга остаётся открытой в памяти: вернувшись к ней, человек не ждёт загрузки заново
}
// Сколько места под страницу и масштаб «страница целиком»
function rdFit(page){
  const st = $('#rd-stage');
  const vp = page.getViewport({scale: 1});
  const W = Math.max(200, st.clientWidth - 16), H = Math.max(200, st.clientHeight - 16);
  return Math.min(W / vp.width, H / vp.height);
}
// Подпись прямо на холсте: по диагонали через страницу и мелко внизу
function rdWatermark(ctx, w, h){
  const text = RD.mark; if(!text) return;
  const diag = Math.hypot(w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2); ctx.rotate(-Math.atan2(h, w));
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let fs = h * 0.055;
  ctx.font = `600 ${fs}px "Golos Text", Arial, sans-serif`;
  const mw = ctx.measureText(text).width;
  if(mw > diag * 0.78){ fs *= diag * 0.78 / mw; ctx.font = `600 ${fs}px "Golos Text", Arial, sans-serif`; }
  ctx.fillStyle = 'rgba(40, 40, 40, 0.12)';
  ctx.fillText(text, 0, 0);
  ctx.restore();
  ctx.save();
  const small = Math.max(9, w / 64);
  ctx.font = `500 ${small}px "Golos Text", Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(40, 40, 40, 0.3)';
  const d = new Date();
  ctx.fillText(`${text} · ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`, w / 2, h - small * 0.6);
  ctx.restore();
}
// Нарисовать страницу n в новый элемент (холст и, если можно, текстовый слой)
async function rdRender(n){
  const key = n + '@' + RD.zoom + '@' + window.innerWidth + 'x' + window.innerHeight;
  const hit = RD.cache.get(n);
  if(hit && hit.key === key) return hit.el;
  const page = await RD.doc.getPage(n);
  const scale = rdFit(page) * RD.zoom;
  const vp = page.getViewport({scale});
  let out = Math.min(window.devicePixelRatio || 1, 2);
  if(vp.width * vp.height * out * out > 12e6) out = Math.sqrt(12e6 / (vp.width * vp.height));
  const el = document.createElement('div');
  el.className = 'rd-page';
  el.style.width = Math.floor(vp.width) + 'px'; el.style.height = Math.floor(vp.height) + 'px';
  el.style.setProperty('--scale-factor', vp.scale);
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width * out); canvas.height = Math.floor(vp.height * out);
  canvas.setAttribute('draggable', 'false');
  el.appendChild(canvas);
  const ctx = canvas.getContext('2d', {alpha: false});
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({canvasContext: ctx, viewport: vp, transform: out !== 1 ? [out, 0, 0, out, 0, 0] : null}).promise;
  rdWatermark(ctx, canvas.width, canvas.height);
  if(rdText()){
    const tl = document.createElement('div'); tl.className = 'textLayer'; el.appendChild(tl);
    try { await new RD.lib.TextLayer({textContentSource: page.streamTextContent(), container: tl, viewport: vp}).render(); } catch(e){}
  }
  RD.cache.set(n, {key, el});
  // держим в памяти только соседние страницы
  for(const k of [...RD.cache.keys()]) if(Math.abs(k - n) > 2 && Math.abs(k - RD.page) > 2) RD.cache.delete(k);
  return el;
}
async function rdGo(n, force){
  if(!RD.doc) return;
  n = Math.min(RD.pages, Math.max(1, n | 0));
  if(n === RD.page && !force && $('#rd-pagebox .rd-page')) return;
  RD.page = n;
  const seq = ++RD.seq;
  $('#rd-num').textContent = `${n} из ${RD.pages}`;
  const sl = $('#rd-slider'); if(sl) sl.value = n;
  const box = $('#rd-pagebox');
  box.classList.add('busy');
  try {
    const el = await rdRender(n);
    if(seq !== RD.seq || !RD.open) return;
    box.replaceChildren(el);
    box.classList.remove('busy');
    $('#rd-stage').classList.toggle('zoomed', RD.zoom > 1);
    if(RD.zoom === 1) $('#rd-stage').scrollTo(0, 0);
    RD.seen.add(n);
    rdSaveSoon();
    // следующую страницу готовим заранее, чтобы листалось без ожидания
    if(n < RD.pages) setTimeout(() => { if(seq === RD.seq) rdRender(n + 1).catch(() => {}); }, 250);
  } catch(e){
    if(seq === RD.seq && !(e instanceof RangeError429) && e && e.name !== 'RenderingCancelledException') rdMsg(errText(e), true);
  }
}
function rdSaveSoon(){ clearTimeout(RD.saveT); RD.saveT = setTimeout(() => rdSave(false), 1500); }
// Прогресс и открытые страницы (для журнала): только у книг
function rdSave(leaving){
  clearTimeout(RD.saveT);
  if(!RD.src || RD.src.kind !== 'book' || !RD.doc) return;
  const body = {page: RD.page, pages: RD.pages, seen: [...RD.seen]};
  RD.seen = new Set();
  const id = RD.src.id;
  const r = readingOf(id);
  if(r && r.page === body.page && !body.seen.length) return;
  if(leaving){
    fetch(`/api/knigi/books/${id}/progress`, {method: 'POST', keepalive: true, headers: {'Content-Type': 'application/json', Authorization: pb.authStore.token}, body: JSON.stringify(body)}).catch(() => {});
    if(r) upsert('reading', {...r, page: body.page, updated: new Date().toISOString().replace('T', ' ')});
    return;
  }
  pb.send(`/api/knigi/books/${id}/progress`, {method: 'POST', body}).then(res => {
    const old = readingOf(id);
    upsert('reading', {...(old || {}), id: res.id, book: id, user: me().id, page: res.page, pages: res.pages, updated: res.updated});
  }).catch(() => { body.seen.forEach(p => RD.seen.add(p)); });
}
function rdZoom(k){
  const z = Math.min(4, Math.max(1, Math.round(RD.zoom * k * 100) / 100));
  if(z === RD.zoom) return;
  RD.zoom = z; RD.cache.clear(); rdGo(RD.page, true);
}
function rdGoto(){
  openForm({title: 'Перейти к странице', fields: [{key: 'p', label: `Страница (от 1 до ${RD.pages})`, type: 'number', required: true}], values: {p: RD.page}, submit: 'Перейти',
    async onSave(v){ const p = +v.p; if(!(p >= 1 && p <= RD.pages)) throw {message: `Введите число от 1 до ${RD.pages}.`}; rdGo(p); }});
}
async function rdToc(){
  if(!RD.outline) return;
  const flat = [];
  const walk = (items, lvl) => { for(const it of items){ flat.push({it, lvl}); if(it.items && it.items.length && lvl < 3) walk(it.items, lvl + 1); } };
  walk(RD.outline, 1);
  openForm({title: 'Оглавление', noSubmit: true, html: `<div class="toc">${flat.slice(0, 600).map((x, i) => `<button type="button" class="toc-row lvl${x.lvl}" data-dlg="toc" data-i="${i}">${esc(x.it.title)}</button>`).join('')}</div>`,
    async onClick(el){
      const it = flat[+el.dataset.i].it;
      try {
        let dest = it.dest;
        if(typeof dest === 'string') dest = await RD.doc.getDestination(dest);
        if(!dest) return;
        const idx = typeof dest[0] === 'number' ? dest[0] : await RD.doc.getPageIndex(dest[0]);
        dlg.close(); rdGo(idx + 1);
      } catch(e){ toast('В оглавлении нет ссылки на страницу.'); }
    }});
}
function rdNote(){
  // администратор может выделить цитату на странице: она попадёт в заметку
  let sel = window.getSelection && String(window.getSelection() || '').trim();
  if(!sel && RD.sel && Date.now() - RD.sel.at < 15e3) sel = RD.sel.text;
  UI.quote = isAdmin() && sel ? sel.slice(0, 3000) : '';
  rdSave(false);
  go(`#/note/new?book=${RD.src.id}&page=${RD.page}`);
}
function rdMenu(btn){
  const dark = !!loadLS('darkPages', false);
  openMenu(btn, [
    {label: dark ? 'Обычные страницы' : 'Тёмные страницы', run: () => { saveLS('darkPages', !dark); $('#reader').classList.toggle('dark-pages', !dark); }},
    {label: 'Перейти к странице', run: rdGoto},
    ...(RD.src.kind === 'book' ? [{label: 'Карточка книги', run: () => go('#/b/' + RD.src.id)}] : []),
  ]);
}
// Нажатия в читалке
$('#reader').addEventListener('click', e => {
  if(menu){
    const it = e.target.closest('.menu [data-i]');
    const m = menu; closeMenu();
    if(it){ m.items[+it.dataset.i].run(); return; }
    if(e.target.closest('[data-rd="menu"]') === m.btn) return;
  }
  const b = e.target.closest('[data-rd]');
  if(!b) return;
  const a = b.dataset.rd;
  if(a === 'close'){ rdClose(); goBack(RD.back || '#/'); }
  else if(a === 'prev') rdGo(RD.page - 1);
  else if(a === 'next') rdGo(RD.page + 1);
  else if(a === 'zin') rdZoom(1.25);
  else if(a === 'zout') rdZoom(0.8);
  else if(a === 'goto') rdGoto();
  else if(a === 'toc') rdToc();
  else if(a === 'note') rdNote();
  else if(a === 'menu') rdMenu(b);
  else if(a === 'resume') rdResume();
  else if(a === 'full'){ if(document.fullscreenElement) document.exitFullscreen().catch(() => {}); else $('#reader').requestFullscreen().catch(() => {}); }
});
$('#reader').addEventListener('change', e => { if(e.target.id === 'rd-slider') rdGo(+e.target.value); });
$('#reader').addEventListener('input', e => { if(e.target.id === 'rd-slider') $('#rd-num').textContent = `${e.target.value} из ${RD.pages}`; });
// Листание пальцем и нажатием по краям, щипок для масштаба
const TP = {x: 0, y: 0, t: 0, pinch: 0, z: 1, moved: false};
$('#reader').addEventListener('touchstart', e => {
  if(!e.target.closest('#rd-stage')) return;
  if(e.touches.length === 2){ TP.pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); TP.z = 1; return; }
  const t = e.touches[0]; TP.x = t.clientX; TP.y = t.clientY; TP.t = Date.now(); TP.moved = false; TP.pinch = 0;
}, {passive: true});
$('#reader').addEventListener('touchmove', e => {
  if(TP.pinch && e.touches.length === 2){
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    TP.z = d / TP.pinch;
    const pg = $('#rd-pagebox .rd-page'); if(pg) pg.style.transform = `scale(${TP.z})`;
    e.preventDefault(); return;
  }
  TP.moved = true;
}, {passive: false});
$('#reader').addEventListener('touchend', e => {
  if(TP.pinch){
    if(e.touches.length) return;
    const pg = $('#rd-pagebox .rd-page'); if(pg) pg.style.transform = '';
    const z = TP.z; TP.pinch = 0;
    if(Math.abs(z - 1) > 0.08) rdZoom(z);
    return;
  }
  if(!e.target.closest('#rd-stage') || !e.changedTouches.length) return;
  const t = e.changedTouches[0], dx = t.clientX - TP.x, dy = t.clientY - TP.y;
  if(RD.zoom === 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - TP.t < 900){ rdGo(RD.page + (dx < 0 ? 1 : -1)); TP.swiped = Date.now(); }
});
$('#reader').addEventListener('click', e => {
  const st = e.target.closest('#rd-stage');
  if(!st || e.target.closest('[data-rd]') || (TP.swiped && Date.now() - TP.swiped < 500)) return;
  if(String(window.getSelection() || '').trim()) return; // выделяют текст
  const r = st.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
  if(x < 0.28) rdGo(RD.page - 1);
  else if(x > 0.72) rdGo(RD.page + 1);
  else { RD.bars = !RD.bars; $('#reader').classList.toggle('bars-off', !RD.bars); }
});
$('#reader').addEventListener('wheel', e => {
  if(!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault(); rdZoom(e.deltaY < 0 ? 1.1 : 0.9);
}, {passive: false});
document.addEventListener('keydown', e => {
  if(!RD.open || dlg.open) return;
  const k = e.key;
  if((e.ctrlKey || e.metaKey) && /^[psPS]$/.test(k)){ e.preventDefault(); return; } // печать и сохранение страницы выключены
  if(e.target.closest && e.target.closest('input, textarea, select')) return;
  if(k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && RD.zoom === 1)){ e.preventDefault(); rdGo(RD.page + 1); }
  else if(k === 'ArrowLeft' || k === 'PageUp'){ e.preventDefault(); rdGo(RD.page - 1); }
  else if(k === 'Home'){ rdGo(1); } else if(k === 'End'){ rdGo(RD.pages); }
  else if(k === '+' || k === '='){ rdZoom(1.25); } else if(k === '-'){ rdZoom(0.8); }
});
// У читателей: без копирования, контекстного меню и перетаскивания. Администратору можно.
for(const ev of ['copy', 'cut', 'contextmenu', 'dragstart']){
  $('#reader').addEventListener(ev, e => {
    if(isAdmin()) return;
    e.preventDefault();
    if(ev === 'copy' || ev === 'cut'){ try { e.clipboardData && e.clipboardData.setData('text/plain', ''); } catch(_){} toast('Копировать текст книги нельзя.'); }
  });
}
// Выделение в читалке запоминаем: нажатие на кнопку «Заметка» может его сбросить
document.addEventListener('selectionchange', () => {
  if(!RD.open) return;
  const t = String(window.getSelection() || '').trim();
  if(t) RD.sel = {text: t, at: Date.now()};
});
let rsT = 0;
window.addEventListener('resize', () => { if(!RD.open || !RD.doc) return; clearTimeout(rsT); rsT = setTimeout(() => { RD.cache.clear(); rdGo(RD.page, true); }, 250); });
document.addEventListener('fullscreenchange', () => { if(RD.open && RD.doc){ RD.cache.clear(); setTimeout(() => rdGo(RD.page, true), 150); } });

/* ---------- Вход и регистрация ---------- */
let authMode = 'login', authInvite = '', authEmail = '', isFirstRun = false;
// «Забыли пароль?»: повторная отправка через 2 минуты. Раньше PocketBase сам не отправит второе письмо на ту же почту
const RESET_WAIT = 120e3;
const RESET_SENT = 'Если такой адрес зарегистрирован, письмо придёт в течение нескольких минут. Проверьте папку «Спам».';
let resetSent = false, resetTimer = 0;
async function showAuth(mode, invite){
  $('#app').hidden = true; $('#auth').hidden = false;
  authMode = mode || 'login'; if(invite) authInvite = invite;
  try { const r = await fetch('/api/knigi/setup'); if(r.ok) isFirstRun = !!(await r.json()).firstRun; } catch(e){}
  if(isFirstRun) authMode = 'register';
  renderAuth();
}
// Поле пароля с кнопкой «показать или скрыть»
const passInput = (id, auto, extra) => `<span class="pass"><input type="password" id="${id}" autocomplete="${auto}"${extra || ''}><button type="button" class="eye" data-eye="${id}" aria-label="Показать пароль" aria-pressed="false">${ICON.eye}</button></span>`;
$('#auth').addEventListener('click', e => {
  const b = e.target.closest('[data-eye]'); if(!b) return;
  const inp = document.getElementById(b.dataset.eye), show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  b.innerHTML = show ? ICON.eyeOff : ICON.eye;
  b.setAttribute('aria-pressed', String(show)); b.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
});
function resetLeft(){ return Math.max(0, loadLS('resetAt', 0) + RESET_WAIT - Date.now()); }
// Обратный отсчёт на кнопке «Отправить ещё раз»
function tickReset(){
  clearInterval(resetTimer);
  const upd = () => {
    const btn = $('#auth-form[data-mode="reset"] [type=submit]');
    if(!btn){ clearInterval(resetTimer); return; }
    const left = Math.ceil(resetLeft() / 1000);
    btn.disabled = left > 0;
    btn.textContent = left > 0 ? `Отправить ещё раз через ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : resetSent ? 'Отправить ещё раз' : 'Отправить ссылку';
    if(left <= 0) clearInterval(resetTimer);
  };
  upd(); resetTimer = setInterval(upd, 1000);
}
function renderAuth(msg, ok){
  const b = $('#auth-body');
  const note = msg ? `<p class="${ok ? 'form-ok' : 'form-err'}">${esc(msg)}</p>` : '';
  const joinNote = '';
  if(authMode === 'register'){
    $('#auth-sub').textContent = isFirstRun ? 'Создайте аккаунт владельца. Вы станете администратором библиотеки и сможете приглашать других.' : 'Регистрация по приглашению.';
    b.innerHTML = `<form class="stack" id="auth-form" data-mode="register" novalidate>${joinNote}
      ${isFirstRun ? '' : `<label>Код приглашения<input type="text" id="a-invite" autocomplete="off" autocapitalize="characters" value="${esc(authInvite)}" required></label>`}
      <label>Имя<input type="text" id="a-name" autocomplete="name"></label>
      <label>Почта<input type="email" id="a-email" autocomplete="email" required></label>
      <label>Пароль (не короче 8 символов)${passInput('a-pass', 'new-password', ' minlength="8" required')}</label>
      <label>Повторите пароль${passInput('a-pass2', 'new-password', ' required')}</label>
      <label class="check"><input type="checkbox" id="a-consent"><span>Согласен на обработку персональных данных по <a href="/privacy.html" target="_blank" rel="noopener">политике конфиденциальности</a></span></label>
      ${note}<button class="btn primary big wide" type="submit">Создать аккаунт</button>
      ${isFirstRun ? '' : `<div class="auth-links"><button type="button" class="linkbtn" data-auth="login">У меня уже есть аккаунт</button></div>`}
    </form>`;
  } else if(authMode === 'reset'){
    $('#auth-sub').textContent = 'Пришлём ссылку для нового пароля на вашу почту.';
    b.innerHTML = `<form class="stack" id="auth-form" data-mode="reset" novalidate>
      <label>Почта<input type="email" id="a-email" autocomplete="email" value="${esc(authEmail)}" required></label>
      ${resetSent ? `<p class="form-ok" role="status">${esc(RESET_SENT)}</p>` : ''}
      ${note}<button class="btn primary big wide" type="submit">Отправить ссылку</button>
      <div class="auth-links"><button type="button" class="linkbtn" data-auth="login">Вернуться ко входу</button></div>
    </form>`;
    tickReset();
  } else {
    $('#auth-sub').textContent = 'Книги, полки и заметки в одном месте.';
    b.innerHTML = `<form class="stack" id="auth-form" data-mode="login" novalidate>${joinNote}
      <label>Почта<input type="email" id="a-email" autocomplete="email" value="${esc(authEmail)}" required></label>
      <label>Пароль${passInput('a-pass', 'current-password', ' required')}</label>
      ${note}<button class="btn primary big wide" type="submit">Войти</button>
      <div class="auth-links"><button type="button" class="linkbtn" data-auth="register">Регистрация по приглашению</button><button type="button" class="linkbtn" data-auth="reset">Забыли пароль?</button></div>
    </form>`;
  }
}
$('#auth').addEventListener('click', e => {
  const b = e.target.closest('[data-auth]'); if(!b) return;
  const em = $('#a-email'); if(em && em.value.trim()) authEmail = em.value.trim();
  if(b.dataset.auth !== 'reset') resetSent = false;
  authMode = b.dataset.auth; renderAuth();
});
$('#auth').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('[type=submit]');
  const v = id => (f.querySelector('#' + id)?.value || '').trim();
  if(f.dataset.mode === 'newpass'){ submitNewPass(f); return; }
  btn.disabled = true;
  try{
    if(f.dataset.mode === 'login'){
      if(!v('a-email') || !v('a-pass')) throw {msg:'Введите почту и пароль.'};
      try { await pb.collection('users').authWithPassword(v('a-email'), f.querySelector('#a-pass').value); }
      catch(err){ if(err.status === 400) throw {msg:'Неверная почта или пароль.'}; throw err; }
      startApp();
    } else if(f.dataset.mode === 'register'){
      const pass = f.querySelector('#a-pass').value, pass2 = f.querySelector('#a-pass2').value;
      if(!isFirstRun && !v('a-invite')) throw {msg:'Введите код приглашения.'};
      if(!v('a-email')) throw {msg:'Введите почту.'};
      if(pass.length < 8) throw {msg:'Пароль должен быть не короче 8 символов.'};
      if(pass !== pass2) throw {msg:'Пароли не совпадают.'};
      if(!f.querySelector('#a-consent').checked) throw {msg:'Нужно согласие на обработку персональных данных.'};
      const body = {email: v('a-email'), password: pass, passwordConfirm: pass2, name: v('a-name'), theme: themePref()};
      if(!isFirstRun) body.invite = v('a-invite');
      await pb.collection('users').create(body);
      await pb.collection('users').authWithPassword(body.email, pass);
      isFirstRun = false;
      startApp();
    } else {
      // Ответ сервера одинаковый для любого адреса, поэтому и сообщение всегда одно
      const email = v('a-email');
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw {msg:'Проверьте адрес почты.'};
      if(resetLeft() > 0) return;
      try { await pb.collection('users').requestPasswordReset(email); }
      catch(err){
        if(err.status === 429) throw {msg:'Писем было слишком много. Попробуйте снова через час.'};
        if(err.status === 400) throw {msg:'Проверьте адрес почты.'};
        throw err;
      }
      authEmail = email; resetSent = true; saveLS('resetAt', Date.now());
      renderAuth(); return;
    }
  }catch(err){ authErr(err.msg || errText(err)); }
  finally{ if(f.dataset.mode === 'reset') tickReset(); else btn.disabled = false; }
});
function authErr(text){
  const fe = $('#auth-form'); if(!fe) return;
  let p = fe.querySelector('.form-err');
  if(!p){ p = document.createElement('p'); p.className = 'form-err'; fe.querySelector('[type=submit]').before(p); }
  p.textContent = text;
}

/* ---------- Ссылки из писем ---------- */
const MAIL_LINKS = ['reset', 'verify', 'email-change'];
// Ключ из письма: id, почта и срок (exp) лежат в его средней части
function tokenInfo(token){
  try { return JSON.parse(decodeURIComponent(escape(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))) || {}; }
  catch(e){ return {}; }
}
let mailToken = '';
function showMailLink(kind, token){
  $('#app').hidden = true; $('#auth').hidden = false;
  mailToken = token;
  const info = tokenInfo(token);
  if(info.email) authEmail = info.email;
  const expired = !info.exp || info.exp * 1000 < Date.now();
  if(kind === 'reset') expired ? mailDone('reset-old') : renderNewPass();
  else if(kind === 'verify') confirmVerify(expired);
  else mailDone('change');
}
// Открыть библиотеку после экрана из письма: вход, если нужно
function openDiary(){ pb.authStore.isValid ? boot() : showAuth('login'); }
const MAIL_SCREENS = {
  'reset-ok': ['Пароль изменён', 'Теперь войдите с новым паролем.', 'Войти', 'login'],
  'reset-old': ['Ссылка устарела', 'Ссылка для нового пароля действует ограниченное время и срабатывает один раз. Запросите новое письмо.', 'Запросить новое письмо', 'reset'],
  'verify-ok': ['Почта подтверждена', 'Спасибо. Теперь можно вернуться в библиотеку.', 'Открыть библиотеку', 'diary'],
  'verify-old': ['Ссылка устарела', 'Ссылка для подтверждения почты устарела или уже использована. Если почта уже подтверждена, ничего делать не нужно.', 'Открыть библиотеку', 'diary'],
  'change': ['Смена почты', 'Смена почты в приложении пока не поддерживается, почта для входа осталась прежней. Чтобы сменить её, напишите администратору.', 'Открыть библиотеку', 'diary'],
};
function mailDone(key){
  const [title, text, btn, next] = MAIL_SCREENS[key];
  $('#auth-sub').textContent = '';
  $('#auth-body').innerHTML = `<div class="stack" role="status"><h2 class="auth-title">${esc(title)}</h2><p class="muted">${esc(text)}</p>
    <button type="button" class="btn primary big wide" id="mail-next">${esc(btn)}</button></div>`;
  $('#mail-next').onclick = () => {
    if(next === 'diary') openDiary();
    else { authMode = next; resetSent = false; renderAuth(); }
  };
}
function renderNewPass(){
  $('#auth-sub').textContent = authEmail ? 'Новый пароль для ' + authEmail : 'Придумайте новый пароль.';
  $('#auth-body').innerHTML = `<form class="stack" id="auth-form" data-mode="newpass" novalidate>
    <input type="email" autocomplete="username" value="${esc(authEmail)}" hidden>
    <label>Новый пароль (не короче 8 символов)${passInput('n-pass', 'new-password', ' minlength="8" required')}</label>
    <label>Повторите пароль${passInput('n-pass2', 'new-password', ' required')}</label>
    <button class="btn primary big wide" type="submit">Сохранить пароль</button>
  </form>`;
}
async function submitNewPass(f){
  const p1 = f.querySelector('#n-pass').value, p2 = f.querySelector('#n-pass2').value;
  if(p1.length < 8) return authErr('Пароль должен быть не короче 8 символов.');
  if(p1 !== p2) return authErr('Пароли не совпадают.');
  const btn = f.querySelector('[type=submit]'); btn.disabled = true;
  try {
    await pb.collection('users').confirmPasswordReset(mailToken, p1, p2);
    // после смены пароля прежние входы этого человека больше не действуют
    const info = tokenInfo(mailToken);
    if(pb.authStore.record && pb.authStore.record.id === info.id) pb.authStore.clear();
    mailDone('reset-ok');
  } catch(err){
    const data = (err.response || {}).data || {};
    if(data.token || err.status === 404) mailDone('reset-old');
    else { authErr(errText(err)); btn.disabled = false; }
  }
}
async function confirmVerify(expired){
  if(expired){ mailDone('verify-old'); return; }
  $('#auth-sub').textContent = '';
  $('#auth-body').innerHTML = '<p class="muted" role="status">Подтверждаю почту…</p>';
  try { await pb.collection('users').confirmVerification(mailToken); mailDone('verify-ok'); }
  catch(err){
    if(err.status !== 0){ mailDone('verify-old'); return; }
    $('#auth-body').innerHTML = `<div class="stack"><p class="form-err">${esc(errText(err))}</p><button type="button" class="btn primary big wide" id="mail-next">Попробовать ещё раз</button></div>`;
    $('#mail-next').onclick = () => confirmVerify(false);
  }
}


/* ---------- Нажатия ---------- */
document.addEventListener('click', async e => {
  if(menu && !RD.open){
    const it = e.target.closest('.menu [data-i]');
    const m = menu; closeMenu();
    if(it){ m.items[+it.dataset.i].run(); return; }
    if(e.target.closest('[data-act$="-menu"]') === m.btn) return;
  }
  // «Назад»: по истории, если пришли изнутри приложения
  const bk = e.target.closest('#main a[data-back]');
  if(bk && UI.hops > 0 && !e.metaKey && !e.ctrlKey){ e.preventDefault(); history.back(); return; }
  const up = e.target.closest('#uploads [data-act]');
  const a = up || e.target.closest('#main [data-act]');
  if(!a || !S.loaded) return;
  const d = a.dataset;
  switch(d.act){
    case 'add-books': pickFile('.pdf,.epub,.djvu,.djv,application/pdf,application/epub+zip', true, files => { loadDisk(); addUploads(files, 'book'); }); break;
    case 'up-close': UP.hidden = true; if(!UP.items.some(u => ['wait','up','proc'].includes(u.state))) UP.items = UP.items.filter(u => u.kind !== 'book'); renderUploadsPanel(); break;
    case 'up-cancel': { const it = UP.items.find(u => u.id === d.id); if(!it) return; if(it.state === 'wait'){ it.state = 'err'; it.msg = 'отменено'; } else it.cancel = true; renderUploadsPanel(); break; }
    case 'up-force': { const it = UP.items.find(u => u.id === d.id); if(it){ it.state = 'wait'; it.msg = ''; runUploads(); renderUploadsPanel(); } break; }
    case 'new-shelf': openShelfForm({common: !!d.common}); break;
    case 'shelf-menu': { const s = byId('shelves', d.id); if(s) shelfMenu(a, s); break; }
    case 'shelf-books': { const s = byId('shelves', d.id); if(s) openShelfBooks(s); break; }
    case 'reorder': UI.reorder = UI.reorder === d.scope || !d.scope ? '' : d.scope; render(true); break;
    case 'move-shelf': moveShelf(d.id, +d.dir); break;
    case 'books-view': UI.booksView = d.v; saveLS('booksView', d.v); render(true); break;
    case 'to-shelf': { const b = byId('books', d.id); if(b) openToShelf(b); break; }
    case 'book-menu': { const b = byId('books', d.id); if(b) bookMenu(a, b); break; }
    case 'author-edit': { const x = byId('authors', d.id); if(x) editAuthor(x); break; }
    case 'notes-kind': UI.notesKind = d.k; render(true); break;
    case 'note-menu': noteMenu(a); break;
    case 'file-dl': {
      try {
        const l = await pb.send(`/api/knigi/files/${d.id}/link`, {});
        const x = document.createElement('a'); x.href = l.url + '&dl=1'; x.rel = 'noopener'; document.body.appendChild(x); x.click(); x.remove();
      } catch(err){ toast(errText(err)); }
      break;
    }
    case 'file-del': {
      const f = byId('nfiles', d.id); if(!f) return;
      if(!arm(a, 'Удалить?')) return;
      try { await pb.collection('note_files').delete(f.id); removeLocal('nfiles', f.id); upPaint(); toast('Файл удалён'); } catch(err){ toast(errText(err)); }
      break;
    }
    case 'edit-name': openForm({title: 'Имя', fields: [{key: 'name', label: 'Как вас называть', max: 100}], values: {name: me().name || ''},
      async onSave(v){ const rec = await pb.collection('users').update(me().id, {name: v.name}); pb.authStore.save(pb.authStore.token, rec); render(true); }}); break;
    default: accountAction(a, d);
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if(t.name === 'p-theme'){ setTheme(t.value); return; }
  if(t.id === 'books-sort'){ UI.booksSort = t.value; saveLS('booksSort', t.value); render(true); return; }
  if(t.id === 'books-fmt'){ UI.booksFmt = t.value; render(true); return; }
  if(t.id === 'books-scan'){ UI.booksScan = t.checked; render(true); return; }
  if(t.id === 'log-user' || t.id === 'log-book' || t.id === 'log-days'){ UI.logQ[t.id.slice(4)] = t.value; UI.log = null; render(true); return; }
  if(t.id === 'note-files'){ const files = [...t.files]; t.value = ''; if(files.length) addUploads(files, 'file', t.dataset.note); return; }
});
document.addEventListener('input', e => {
  if(e.target.id === 'q'){ UI.q = e.target.value; schedule(); }
  if(e.target.id === 'nq'){ UI.notesQ = e.target.value; notesSearch(); schedule(); }
});
document.addEventListener('toggle', e => {
  // событие приходит и при отрисовке уже раскрытого блока: реагируем только на настоящее изменение
  if(e.target.id === 'inv-fold' && e.target.open !== UI.invOpen){ UI.invOpen = e.target.open; if(UI.invOpen && isAdmin()) loadInvites(); }
  if(e.target.classList && e.target.classList.contains('desc')) UI.descOpen = e.target.open;
}, true);
window.addEventListener('hashchange', () => { if(route().name === 'profile' && isAdmin()) loadDisk(); });

/* ---------- Профиль: пароль, приглашения, выход ---------- */
const INV_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function inviteCode(){ const a = new Uint8Array(8); crypto.getRandomValues(a); return Array.from(a, x => INV_ABC[x % INV_ABC.length]).join(''); }
async function copyText(text){
  try { await navigator.clipboard.writeText(text); toast('Ссылка скопирована'); }
  catch(e){ window.prompt && window.prompt('Скопируйте:', text); }
}
async function accountAction(a, d){
  try{
    switch(d.act){
      case 'save-pass': {
        const old = $('#p-old').value, n1 = $('#p-new').value, n2 = $('#p-new2').value;
        if(n1.length < 8){ toast('Новый пароль должен быть не короче 8 символов.'); return; }
        if(n1 !== n2){ toast('Новые пароли не совпадают.'); return; }
        const email = me().email;
        await pb.collection('users').update(me().id, {oldPassword: old, password: n1, passwordConfirm: n2});
        await pb.collection('users').authWithPassword(email, n1);
        toast('Пароль изменён'); render(true); break;
      }
      case 'new-invite': {
        const body = {code: inviteCode(), note: $('#i-note').value.trim(), max_uses: Number($('#i-max').value), uses: 0, expires: $('#i-exp').value};
        const rec = await pb.collection('invites').create(body);
        S.invites.push(rec); render(true);
        copyText(`${location.origin}/?invite=${rec.code}`);
        break;
      }
      case 'copy-invite': copyText(`${location.origin}/?invite=${d.code}`); break;
      case 'del-invite': {
        if(!arm(a, 'Точно?')) return;
        await pb.collection('invites').delete(d.id);
        S.invites = S.invites.filter(i => i.id !== d.id); render(true); break;
      }
      case 'logout': {
        await fetch('/api/knigi/logout', {method: 'POST'}).catch(() => {});
        Object.keys(localStorage).filter(k => k.startsWith('kn_draft_')).forEach(k => localStorage.removeItem(k));
        pb.authStore.clear(); location.hash = ''; location.reload(); break;
      }
    }
  }catch(e){ toast(errText(e)); }
}

let tt = 0;
function toast(msg){ const el = $('#toast'); const host = dlg.open ? dlg : RD.open ? $('#reader') : document.body; if(el.parentNode !== host) host.appendChild(el); el.textContent = msg; el.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), 2800); }

boot();
})();
