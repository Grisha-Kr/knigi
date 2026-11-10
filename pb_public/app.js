(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- Настройки в коде ---------- */
// Текстовый слой у читателей (не администратора). Этап 1: был выключен. Этап 2: включён, чтобы читатели
// выделяли текст цветом и писали к нему мысль. Копирование, контекстное меню и перетаскивание у читателей
// заблокированы в любом случае, а на телефоне выделение у них только через «Маркер» (без системного меню).
const READER_TEXT_LAYER = true;
const CHUNK_PDF = 512 * 1024;      // кусок книги, который читалка просит у сервера
const MAX_REQ = 4 * CHUNK_PDF;     // не больше 2 МБ за один запрос
const MB = 1024 * 1024;
const FORMATS = {pdf: 'PDF', epub: 'EPUB', djvu: 'DjVu', fb2: 'FB2', mobi: 'MOBI', azw3: 'AZW3', txt: 'TXT'};
const FMT_ORDER = ['pdf', 'epub', 'djvu', 'fb2', 'mobi', 'azw3', 'txt'];
// Какой читалкой открывается формат (правки 3.1): DjVu сервер переводит в PDF, FB2, MOBI, AZW3 и TXT в EPUB.
// Такая же таблица VIEW на сервере (convert_lib.js).
const VIEW = {pdf: 'pdf', djvu: 'pdf', epub: 'epub', fb2: 'epub', mobi: 'epub', azw3: 'epub', txt: 'epub'};
const viewOf = fmt => VIEW[fmt] || 'pdf';
const isEpView = fmt => VIEW[fmt] === 'epub';
// «DjVu, открывается как PDF»: подпись исходного формата в карточке
const fmtLong = fmt => fmt && VIEW[fmt] && VIEW[fmt] !== fmt ? `${FORMATS[fmt]}, открывается как ${FORMATS[VIEW[fmt]]}` : (FORMATS[fmt] || fmt);
// Расширения книг для выбора файла и проверки
const BOOK_ACCEPT = '.pdf,.epub,.djvu,.djv,.fb2,.fbz,.zip,.mobi,.azw3,.txt,application/pdf,application/epub+zip,text/plain';
const BOOK_RE = /\.(pdf|epub|djvu|djv|fb2|fbz|fb2\.zip|mobi|azw3|txt)$/i;
const BOOK_TYPES = 'PDF, EPUB, DjVu, FB2, MOBI, AZW3 и TXT';
const AU_EXT = /\.(mp3|m4a)$/i, AU_MAX = 200 * MB; // главы аудио (правки 4.3)
const BOOK_FIELDS = 'id,title,authors,year,description,formats,file_size,pages,has_text,text_file,status,status_note,cover,search,hidden,opened_at,created,updated';
const BFILE_FIELDS = 'id,book,format,file_size,orig_size,ocr,pages,has_text,status,status_note,created';
const NOTE_FIELDS = 'id,owner,book,book_title,kind,title,page,shared,group,quote,color,format,place,ai,created,updated,body_text:excerpt(400,true)';
// Цвета выделений: в базе слово, на экране полупрозрачная заливка под текстом
const HL = {yellow: ['Жёлтый', '#F7D53E'], green: ['Зелёный', '#7DD87A'], blue: ['Голубой', '#6DB9F2'], pink: ['Розовый', '#F38DC3']};
const HL_KEYS = Object.keys(HL);

/* ---------- Значки (линейные SVG) ---------- */
const sv = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  library: sv('<path d="M4 4h3v16H4zM9 4h3v16H9z"/><path d="M14.5 5.2l2.9-.8 4 15.2-2.9.8z"/>'),
  shelves: sv('<path d="M3 5h18M3 12h18M3 19h18"/><path d="M6 5V3M18 12v-2M10 19v-2"/>'),
  notes: sv('<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h7M9 16h5"/>'),
  ai: sv('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'),
  profile: sv('<circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.6 3.6-6 8-6s8 2.4 8 6"/>'),
  back: sv('<path d="M15 5l-7 7 7 7"/>'),
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="fill" cx="5" cy="12" r="1.8"/><circle class="fill" cx="12" cy="12" r="1.8"/><circle class="fill" cx="19" cy="12" r="1.8"/></svg>',
  plus: sv('<path d="M12 5v14M5 12h14"/>'),
  search: sv('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  ocr: sv('<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M8.5 9h7M12 9v7"/>'),
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
  chat: sv('<path d="M4 5h16v11H9l-5 4z"/>'),
  log: sv('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
  author: sv('<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/>'),
  moon: sv('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  expand: sv('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  collapse: sv('<path d="M20 4l-6 6M14 5v5h5M4 20l6-6M10 19v-5H5"/>'),
  camera: sv('<path d="M4 8h3.5L9 5.5h6L16.5 8H20v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  marker: sv('<path d="M14.5 4.5l5 5L10 19H5v-5z"/><path d="M12 7l5 5"/><path d="M4 21h9"/>'),
  hl: sv('<path d="M5 20h14"/><path d="M8 16l-1.5-1.5L15 6l3 3-8.5 8.5z"/>'),
  copy: sv('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  inbox: sv('<path d="M4 13l2.5-8h11L20 13v6H4z"/><path d="M4 13h4.5l1 2h5l1-2H20"/>'),
  lock: sv('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  head: sv('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.5"/>'),
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M8 5.2v13.6L19 12z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="fill" x="6.5" y="5" width="4" height="14" rx="1"/><rect class="fill" x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
  aa: '<svg viewBox="0 0 24 24" aria-hidden="true"><text x="2" y="18" font-size="15" font-weight="700" fill="currentColor" stroke="none" font-family="Georgia,serif">А</text><text x="13" y="18" font-size="10" font-weight="700" fill="currentColor" stroke="none" font-family="Georgia,serif">а</text></svg>',
};

/* ---------- Состояние ---------- */
// marks: отметки «Читаю» и «Прочитано» (у каждого свои); offers: предложенные книги (у читателя свои, у администратора все);
// pbooks: книги на проверке (только у администратора, в общих списках их нет)
// группы (этап 3): groups, gmembers (участники), gbooks (книги групп), gplan (этапы плана), comments (комментарии),
// people (участники общих групп: имя и фото), gcfg (лимиты и включён ли план), gcount (сколько групп, только администратору)
const S = {books:[], bfiles:[], authors:[], shelves:[], sbooks:[], reading:[], notes:[], nfiles:[], marks:[], offers:[], pbooks:[], invites:[], users:[], owner:null, loaded:false, disk:null, mail:null,
  groups:[], gmembers:[], gbooks:[], gplan:[], comments:[], people:[], gcfg:{maxPerUser: 5, maxMembers: 25, plan: true}, gcount:null,
  ocr:null, // ocr: очередь распознавания (правки 3.1, только администратору, GET /api/knigi/ocr)
  access:null, // access: срок доступа (правки 4.1, GET /api/knigi/access)
  atracks:[], aprog:[], // главы аудио и свой прогресс слушания (правки 4.3, часть Б)
  bacc:[]}; // bacc: кому открыты скрытые книги (правки 4.3, book_access): у читателя свои строки, у администратора все
const PBN = {books:'books', bfiles:'book_files', authors:'authors', shelves:'shelves', sbooks:'shelf_books', reading:'reading', notes:'notes', nfiles:'note_files', marks:'marks', offers:'book_offers', pbooks:'books',
  groups:'groups', gmembers:'group_members', gbooks:'group_books', gplan:'group_plan', comments:'note_comments', people:'users', bacc:'book_access', atracks:'audio_tracks', aprog:'audio_progress'};
const KEYS = Object.keys(PBN);
const loadKeys = () => KEYS.filter(k => k !== 'pbooks' || isAdmin());
const LIST_OPTS = {books: () => ({fields: BOOK_FIELDS + (isAdmin() ? ',offered_by' : ''), filter: 'pending = false'}), pbooks: () => ({fields: BOOK_FIELDS + ',offered_by,pending', filter: 'pending = true'}),
  bfiles: () => ({fields: BFILE_FIELDS + (isAdmin() ? ',orig_name,hash' : '')}), notes: () => ({fields: NOTE_FIELDS}), people: () => ({fields: 'id,name,avatar'}), atracks: () => ({sort: 'sort,created'})};
const loadLS = (k, d) => { try { const v = localStorage.getItem('kn_'+k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } };
const saveLS = (k, v) => { try { localStorage.setItem('kn_'+k, JSON.stringify(v)); } catch(e){} };
const dropLS = k => { try { localStorage.removeItem('kn_'+k); } catch(e){} };
const UI = {hops:0, reorder:'', revShelves:{}, finAll:false, booksView: loadLS('booksView', 'grid'), booksSort: loadLS('booksSort', 'title'), booksFmt:'', booksScan:false, booksHidden:false, booksAudio:false,
  tab:'notes', notesQ:'', notesKind:'', notesHits:null, cardFrom:{}, logQ:{days:7, user:'', book:''}, log:null, descOpen:false,
  cardFmt:{}, hlColor:'', hlThought:false, hlOpen:new Set(), noteCtx:null,
  fullFor:'', fullNow:false, normalOnce:false,
  gState:{}, gPrev:{}, gBanner:{}, gFeed:{}, cmDraft:{}, cmEdit:'', join:null};
const pb = new PocketBase(location.origin);
pb.autoCancellation(false);
const me = () => pb.authStore.record || {};
const isAdmin = () => me().role === 'admin';
// Срок доступа закончился или стоит пауза (правки 4.1): книги не открываются, записи только смотреть
const readOnly = () => !!(S.access && !S.access.active);

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
// книга на проверке у администратора лежит в S.pbooks, но открывается так же, как любая (карточка, читалка, правка)
const byId = (key, id) => S[key].find(x => x.id === id) || (key === 'books' ? S.pbooks.find(x => x.id === id) : undefined);
const bookKey = id => S.pbooks.some(x => x.id === id) ? 'pbooks' : 'books';
const bySort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || collator.compare(a.name || '', b.name || '');
const authorName = id => (byId('authors', id) || {}).name || '';
const authorsText = b => (b.authors || []).map(authorName).filter(Boolean).join(', ');
/* ---------- Форматы книги и прогресс по форматам ---------- */
// У книги может быть несколько файлов (PDF, EPUB, DjVu, по одному каждого формата). Прогресс у каждого формата свой.
const fmtSort = (a, b) => FMT_ORDER.indexOf(a) - FMT_ORDER.indexOf(b);
const filesOfBook = id => S.bfiles.filter(f => f.book === id).sort((a, b) => fmtSort(a.format, b.format));
const fileOf = (id, fmt) => S.bfiles.find(f => f.book === id && f.format === fmt);
const bookFormats = b => ((b.formats && b.formats.length) ? [...b.formats] : filesOfBook(b.id).map(f => f.format)).sort(fmtSort);
const canRead = f => !!f && !!VIEW[f.format] && f.status === 'ready';
const readFmt = r => r.format || 'pdf';
const readsOf = id => S.reading.filter(r => r.book === id && fileOf(id, readFmt(r)));
const readOf = (id, fmt) => S.reading.find(r => r.book === id && readFmt(r) === fmt);
// Последнее чтение этой книги (любой формат): для «Продолжить чтение» и полоски на обложке
const readingOf = id => readsOf(id).sort((a, b) => String(b.updated).localeCompare(String(a.updated)))[0];
const progPct = r => !r ? 0 : isEpView(readFmt(r)) ? Math.min(100, Math.round(r.pct || 0)) : r.pages ? Math.min(100, Math.round(r.page / r.pages * 100)) : 0;
const progText = r => isEpView(readFmt(r)) ? `${Math.round(r.pct || 0)}%` : `с. ${r.page}${r.pages ? ' из ' + r.pages : ''}`;
// Какой формат открывает «Читать»: тот, что этот человек читал последним, иначе PDF с текстом,
// иначе книга для читалки EPUB (EPUB, FB2, MOBI, AZW3, TXT), иначе любой, что открывается
function defaultFormat(b){
  const last = readingOf(b.id);
  if(last && canRead(fileOf(b.id, readFmt(last)))) return readFmt(last);
  const files = filesOfBook(b.id).filter(canRead);
  const pick = files.find(f => f.format === 'pdf' && f.has_text) || files.find(f => isEpView(f.format) && f.has_text) ||
    files.find(f => viewOf(f.format) === 'pdf' && f.has_text) || files.find(f => isEpView(f.format)) || files[0];
  return pick ? pick.format : (bookFormats(b)[0] || 'pdf');
}
// Скан без текста: файл для читалки PDF (PDF или DjVu), готовый, без текстового слоя
const scanFile = f => !!f && viewOf(f.format) === 'pdf' && f.status === 'ready' && !f.has_text;
const isScan = b => filesOfBook(b.id).some(scanFile) && !filesOfBook(b.id).some(f => f.has_text && f.status === 'ready');
// Файл книги со страницами (PDF, иначе DjVu): к нему относится «страница» у заметки
const pageFileOf = id => filesOfBook(id).find(f => viewOf(f.format) === 'pdf' && canRead(f));
const readHref = (bookId, fmt, extra) => `#/read/${bookId}?f=${fmt}${extra || ''}`;
const myShelf = s => !s.common && s.owner === me().id;
const canEditShelf = s => s && !readOnly() && (s.common ? isAdmin() : s.owner === me().id);
const shelfKids = (parent, common) => S.shelves.filter(s => (s.parent || '') === (parent || '') && (parent ? true : (common ? s.common : myShelf(s)))).sort(bySort);
const shelfBooks = id => { const s = byId('shelves', id); return S.sbooks.filter(x => x.shelf === id).map(x => byId('books', x.book)).filter(b => b && !(s && s.common && bookNA(b))); };
function shelfPath(s){ const out = []; let cur = s, g = 0; while(cur && g++ < 5){ out.unshift(cur); cur = cur.parent ? byId('shelves', cur.parent) : null; } return out; }
const shelfDepth = s => shelfPath(s).length;
// Сколько книг на полке вместе с подполками (без повторов)
function shelfCount(s){
  const ids = new Set();
  const walk = x => { S.sbooks.forEach(sb => { if(sb.shelf === x.id) ids.add(sb.book); }); S.shelves.filter(c => c.parent === x.id).forEach(walk); };
  walk(s); if(!isAdmin()) for(const id of [...ids]){ const b = byId('books', id); if(b && bookNA(b) && s.common) ids.delete(id); } return ids.size;
}
const booksOfAuthor = id => libBooks().filter(b => (b.authors || []).includes(id));
const notesOfBook = id => S.notes.filter(n => n.book === id);
const myHls = id => S.notes.filter(n => n.book === id && n.kind === 'highlight' && n.owner === me().id);
const titleSort = (a, b) => collator.compare(a.title || '', b.title || '');
/* ---------- Скрытые книги (правки 4.1 и 4.3) ---------- */
// Скрытую книгу видит администратор. Если он открыл её отдельным читателям (book_access), у них она как обычная.
// Остальной читатель видит её, только если у него с ней что-то связано: карточка «Книга временно недоступна», без чтения.
const myAccess = id => S.bacc.find(x => x.book === id && x.user === me().id);
const bookReaders = id => S.bacc.filter(x => x.book === id).map(x => S.users.find(u => u.id === x.user)).filter(Boolean)
  .sort((a, b) => collator.compare(a.name || a.email || '', b.name || b.email || ''));
const bookNA = b => !!b && !!b.hidden && !isAdmin() && !myAccess(b.id);
const libBooks = () => isAdmin() ? S.books : S.books.filter(b => !bookNA(b));
// Запись к книге, которой у читателя нет (скрыта или на проверке): ссылка в читалку ведёт сюда, нажатие пишет сообщение
const NA_HREF = '#/na';
const NA_TEXT = 'Книга временно недоступна.';
// Когда книга открыта всем или этому читателю (правки 4.3): «Недавно добавленные» у читателей считаются по этой дате
function addedAt(b){
  if(isAdmin()) return String(b.created || '');
  const a = myAccess(b.id), opened = !b.hidden && b.opened_at ? String(b.opened_at) : '';
  const mine = a ? String(a.created || '') : '';
  return (opened && mine ? (opened < mine ? opened : mine) : opened || mine) || String(b.opened_at || b.created || '');
}
// Название книги в записи: книги нет совсем (удалена) или она временно недоступна
function noteBookText(n, b){
  if(b) return esc(b.title) + (bookNA(b) ? ' <span class="muted">(временно недоступна)</span>' : '');
  if(n.book) return `${esc(n.book_title || 'Книга')} <span class="muted">(книга временно недоступна)</span>`;
  return n.book_title ? `${esc(n.book_title)} <span class="muted">(книга удалена)</span>` : '';
}

function upsert(key, rec){ const arr = S[key]; const i = arr.findIndex(x => x.id === rec.id); if(i >= 0) arr[i] = {...arr[i], ...rec}; else arr.push({...rec}); schedule(); }
function removeLocal(key, id){ S[key] = S[key].filter(x => x.id !== id); schedule(); }

async function loadAll(keys = loadKeys()){
  keys = keys.filter(k => k !== 'pbooks' || isAdmin());
  const res = await Promise.all(keys.map(k => pb.collection(PBN[k]).getFullList({batch: 1000, ...(LIST_OPTS[k] ? LIST_OPTS[k]() : {})})));
  keys.forEach((k, n) => { S[k] = res[n]; });
  schedule();
}
let subscribed = false;
async function subscribeAll(){
  if(subscribed) return; subscribed = true;
  await pb.collection('users').subscribe(me().id, e => { if(e.action === 'update'){ pb.authStore.save(pb.authStore.token, e.record); themeFromUser(); loadAccess(); schedule(); } });
  // книгу скрыли или открыли (правки 4.1): тем, кому она перестала быть видна, PocketBase событие не шлёт,
  // поэтому сервер рассылает короткое сообщение, и приложение читателя перечитывает книги, файлы и полки
  let visT = 0;
  await pb.realtime.subscribe('knigi_books', () => {
    if(isAdmin()) return;
    // у книги изменилось аудио (опубликовали или сняли главу) или видимость: перечитываем и главы
    clearTimeout(visT); visT = setTimeout(() => loadAll(['books', 'bfiles', 'sbooks', 'bacc', 'atracks']).catch(() => {}), 300);
  });
  for(const k of KEYS){
    if(k === 'pbooks') continue; // книги на проверке приходят вместе с books
    await pb.collection(PBN[k]).subscribe('*', e => {
      // состав групп поменялся: от него зависят права на заметки, комментарии и фото
      if((k === 'groups' || k === 'gmembers') && e.action !== 'update') refreshGroups();
      if(k === 'people' && e.record.id === me().id) return; // своя запись приходит отдельной подпиской
      if(e.action === 'delete'){ removeLocal(k, e.record.id); if(k === 'books') removeLocal('pbooks', e.record.id); if(k === 'notes'){ hlLive(e.record, true); ghlLive(e.record, true); } }
      else {
        const r = e.record;
        // книга ушла на проверку или её одобрили: переносим между списками
        if(k === 'books'){ if(r.pending){ S.books = S.books.filter(x => x.id !== r.id); upsert('pbooks', r); } else { S.pbooks = S.pbooks.filter(x => x.id !== r.id); upsert('books', r); } return; }
        // заметки: в общем списке без текста, только начало для подписи
        if(k === 'notes'){ hlLive(r); ghlLive(r); r.body_text = String(r.body_text || '').slice(0, 400); delete r.body; delete r.search; delete r.anchor; }
        if(k === 'groups' && e.action === 'update'){ const old = byId('groups', r.id); if(old && old.book !== r.book) loadAll(['gbooks', 'gplan', 'gmembers']).catch(() => {}); }
        upsert(k, r);
      }
    });
  }
}

/* ---------- Запуск ---------- */
async function boot(){
  if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const qs = new URLSearchParams(location.search);
  const invite = qs.get('invite'), join = qs.get('group');
  const mail = MAIL_LINKS.find(k => qs.get(k));
  // ссылка в группу (?group=КОД): код запоминаем. Без входа сначала вход, после него сразу вступление;
  // если человек уже вошёл, приложение покажет приглашение с кнопкой «Вступить».
  if(join) saveLS('join', {code: join.trim(), auto: !pb.authStore.isValid});
  // ключ из письма или приглашения сразу убираем из адресной строки и истории
  if(invite || mail || join) history.replaceState(null, '', location.pathname + location.hash);
  if(mail){ showMailLink(mail, qs.get(mail).trim()); return; }
  if(!pb.authStore.isValid){ showAuth(invite ? 'register' : 'login', invite); return; }
  try { await pb.collection('users').authRefresh(); }
  catch(e){ if(e && e.status && e.status !== 0){ pb.authStore.clear(); showAuth('login'); return; } }
  startApp();
}
async function startApp(){
  $('#auth').hidden = true; $('#app').hidden = false;
  curRoute = route(); readerHistory(null);
  themeFromUser();
  buildNav();
  render(true);
  try {
    // кука для обложек и файлов книг: ставит сервер, странице она недоступна
    await pb.send('/api/knigi/session', {});
    await Promise.all([loadAll(), loadGroupCfg()]);
    S.loaded = true; $('#notice').hidden = true; render(true);
    if(S.access) renderAccessBar(); // в полоске учитываются свои одобренные книги (они приходят с остальными данными)
    if(isAdmin()){ loadInvites(); loadUsers(); loadOcr(); } else loadOwner();
    loadAccess();
    subscribeAll().catch(() => {});
    if(route().name === 'g') gVisit(route().id);
    if(route().name === 'profile' && isAdmin()) loadGCount();
    // пришли по ссылке в группу
    const join = loadLS('join', null);
    if(join && join.code){
      dropLS('join');
      if(join.auto) joinGroup(join.code).catch(() => go('#/join/' + encodeURIComponent(join.code)));
      else go('#/join/' + encodeURIComponent(join.code));
    }
  } catch(e){
    showNotice('Не удалось загрузить данные. ' + errText(e));
  }
}
let lastSession = Date.now();
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState !== 'visible'){ RD.doc && rdSave(true); apSave(true); return; }
  checkUpdate();
  if(S.loaded && pb.authStore.isValid){
    if(Date.now() - lastSession > 3600e3){ lastSession = Date.now(); pb.send('/api/knigi/session', {}).catch(() => {}); }
    loadAll().catch(() => {});
    loadAccess();
  }
});
window.addEventListener('pagehide', () => { RD.doc && rdSave(true); apSave(true); });

/* ---------- Срок доступа (правки 4.1, по образцу «Молитвенного дневника») ---------- */
// Состояние приходит с сервера: «сегодня» он считает по времени Хабаровска. Без доступа вверху красная полоска
// (она не закрывается), за 7 дней до конца срока жёлтая (её можно закрыть до следующего входа, kn_accHide).
const dnum = iso => { const [y, m, d] = String(iso).split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const fmtDay = iso => { const [y, m, d] = String(iso || '').split('-').map(Number); return !y ? '' : d + ' ' + MONF[m - 1] + (y !== new Date().getFullYear() ? ' ' + y : ''); };
const DAYS_W = ['день', 'дня', 'дней'], MONTHS_W = ['месяц', 'месяца', 'месяцев'];
const contactHTML = c => /^[^\s@]+@[^\s@]+$/.test(c || '') ? `<a href="mailto:${esc(c)}">${esc(c)}</a>` : esc(c || 'администратору');
const daysLeft = a => Math.round(dnum(a.until) - dnum(a.today));
const leftText = k => k <= 0 ? 'сегодня последний день' : `осталось ${k} ${plural(k, DAYS_W)}`;
const accHead = a => a.reason === 'suspended' ? 'Доступ приостановлен' : 'Срок доступа закончился';
async function loadAccess(){
  if(!pb.authStore.isValid) return;
  const was = readOnly();
  try { S.access = await pb.send('/api/knigi/access', {}); } catch(e){ return; }
  renderAccessBar();
  if(was !== readOnly() && S.loaded) render(true); else schedule();
}
const accKey = a => [me().id, a.reason, a.until].join('|');
function renderAccessBar(){
  const a = S.access, bar = $('#access-bar');
  if(!bar) return;
  let html = '', off = false;
  if(a && !a.active){
    off = true;
    html = `<b>${accHead(a)}${a.reason === 'expired' && a.until ? ' ' + fmtDay(a.until) : ''}.</b> Книги сейчас не открываются${S.offers.some(o => o.user === me().id && o.status === 'approved') ? ' (кроме тех, что вы прислали и администратор одобрил: их можно читать)' : ''}, свои цитаты и заметки можно смотреть. Чтобы продлить, напишите: ${contactHTML(a.contact)}`;
  } else if(a && a.until && !a.admin && daysLeft(a) <= 7){
    html = `Доступ действует до ${fmtDay(a.until)} (${leftText(daysLeft(a))}). Чтобы продлить, напишите: ${contactHTML(a.contact)}`;
  }
  bar.classList.toggle('off', off);
  $('#access-close').hidden = off;
  $('#access-text').innerHTML = html;
  bar.hidden = !html || (!off && loadLS('accHide', '') === accKey(a));
}
document.addEventListener('click', e => { if(e.target.closest('#access-close') && S.access){ saveLS('accHide', accKey(S.access)); $('#access-bar').hidden = true; } });
function accessLine(){
  const a = S.access;
  if(!a) return '';
  if(a.admin) return 'Вы администратор, доступ бессрочный.';
  if(!a.active) return `${accHead(a)}${a.reason === 'expired' && a.until ? ' ' + fmtDay(a.until) : ''}: книги не открываются, а добавлять и менять ничего нельзя. Чтобы продлить, напишите: ${contactHTML(a.contact)}`;
  return a.until ? `Доступ действует до ${fmtDay(a.until)} включительно.` : 'Доступ бессрочный.';
}
// Короткая строка вместо кнопки, которая без доступа не работает
// Своя книга читателя (правки 4.3): он её предложил, администратор одобрил. Без доступа она открывается для чтения
// и слушания (сервер проверяет то же самое, openForRead), записи по ней без доступа не создаются.
const myOwnBook = b => !!b && !isAdmin() && S.offers.some(o => o.book === b.id && o.user === me().id && o.status === 'approved');
const roBook = b => readOnly() && !(myOwnBook(b) && !bookNA(b));
const roNote = () => `<p class="na-note">${ICON.lock}<span>${accessLine()}</span></p>`;

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
// Разделы. Новый раздел (например, «Группы») добавляется строкой сюда: [ключ, адрес, подпись, значок].
// Профиль открывается фото: в шапке на телефоне, внизу бокового меню на компьютере.
const TABS = [['lib', '#/', 'Библиотека', 'library'], ['shelves', '#/shelves', 'Полки', 'shelves'], ['notes', '#/notes', 'Заметки', 'notes'], ['groups', '#/groups', 'Группы', 'people']];
function buildNav(){
  const items = TABS.map(([k, h, l, ic]) => `<a href="${h}" class="tab" data-tab="${k}">${ICON[ic]}<span>${l}</span></a>`).join('');
  $('#tabbar').innerHTML = `<div class="tabbar-in">${items}</div>`;
  const review = isAdmin() ? `<a href="#/review" class="tab" data-tab="review">${ICON.inbox}<span>На проверке</span><span class="n" id="side-rev"></span></a>` : '';
  $('#side').innerHTML = `<div class="side-brand"><span class="side-logo" aria-hidden="true"></span><b>Библиотека</b></div>${items}${review}<a class="side-me" id="side-me" href="#/profile"></a>`;
}
// Сколько книг ждёт проверки (только у администратора): счётчик в меню и точка на фото
const reviewCount = () => isAdmin() ? S.pbooks.length : 0;
// Фото в шапке на телефоне: открывает профиль (на компьютере профиль внизу бокового меню)
const meLink = () => `<a class="me-link${reviewCount() ? ' dot' : ''}" href="#/profile" aria-label="Профиль${reviewCount() ? ', есть книги на проверке' : ''}" title="Профиль">${faceHTML(me(), 'md')}</a>`;

/* ---------- Адреса экранов ----------
   #/ главная (#/?q=слово: поиск), #/review книги на проверке (#/review/ID_КНИГИ проверка одной), #/shelves полки, #/sh/ID полка, #/books все книги, #/authors авторы, #/a/ID автор,
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
// История переходов для книги: читалка всегда стоит сразу после карточки этой книги.
// Поэтому «Назад» в читалке, кнопка «Назад» браузера и жест назад на iPhone ведут в карточку,
// а из карточки «Назад» ведёт туда, откуда пришли (главная, полка, автор, поиск), без петель.
let curRoute = null;
function readerHistory(prev){
  const r = route();
  if(r.name !== 'read' || !r.id) return;
  if(history.state && history.state.kn) return; // вернулись на запись читалки, которая уже стоит после карточки
  const h = location.hash;
  // из карточки этой книги или с экрана проверки: «Назад» в читалке ведёт туда же
  if(prev && ((prev.name === 'b' && prev.id === r.id) || (prev.name === 'review' && prev.id === r.id))){ history.replaceState({kn: 1}, '', h); return; }
  // из группы (кнопка «Читать в группе», ссылка «с. 45» в ленте) или с экрана заметки: «Назад» туда же
  if(prev && (prev.name === 'g' || prev.name === 'note') && r.q.get('g')){ history.replaceState({kn: 1}, '', h); return; }
  // открыли не из карточки (например, «Продолжить чтение» или ссылка из заметки): карточка встаёт перед читалкой
  // knRoot: карточку вставили первой записью приложения, её «Назад» ведёт на главную, а не за пределы приложения
  history.replaceState(prev ? null : {knRoot: 1}, '', '#/b/' + r.id);
  history.pushState({kn: 1}, '', h);
}
// Откуда пришли в карточку книги: подпись её кнопки «Назад» (правки 4.2).
// Запоминается только при переходе на новую запись истории. Возврат в карточку из заметки, цитаты, урока,
// файла урока или читалки идёт шагом назад по истории (запись уже помечена kix), и место, откуда книгу открыли,
// не меняется: стрелка в карточке с одного нажатия ведёт в библиотеку, на полку, к автору, в поиск, «Заметки» или группу.
// Адрес источника хранится и в самой записи истории (state.from), поэтому подпись верна и после перезагрузки.
let curHash = location.hash;
function noteCardFrom(prev, cur, prevHash){
  if(cur.name !== 'b' || !prev || prev.name === 'read' || prev.name === 'pdf' || (prev.name === 'b' && prev.id === cur.id)) return;
  UI.cardFrom[cur.id] = prev;
  try { history.replaceState({...(history.state || {}), from: prevHash}, '', location.hash); } catch(e){}
}
function cardFromRoute(bookId){
  const st = history.state;
  if(st && st.from && route().name === 'b' && route().id === bookId){ const h = String(st.from).replace(/^#\/?/, '').split('?'); const p = h[0].split('/').filter(Boolean); return {name: p[0] || 'home', id: p[1] || '', q: new URLSearchParams(h[1] || '')}; }
  return UI.cardFrom[bookId];
}
// Вкладки карточки («Заметки», «Уроки», «Цитаты») меняют адрес без новой записи в истории
function swapHash(h){ history.replaceState(history.state, '', h); curRoute = route(); curHash = location.hash; render(true); }
window.addEventListener('hashchange', () => {
  const prev = curRoute, prevHash = curHash; curRoute = route(); curHash = location.hash;
  readerHistory(prev);
  // новая запись истории получает метку kix; у записи, на которую вернулись «Назад», метка уже есть
  const fresh = !(history.state && history.state.kix);
  if(fresh){ try { history.replaceState({...(history.state || {}), kix: Date.now()}, '', location.hash); } catch(e){} noteCardFrom(prev, curRoute, prevHash); }
  UI.hops++; UI.reorder = ''; UI.cmEdit = ''; closeMenu(); render(true);
  if(S.loaded && curRoute.name === 'g' && !curRoute.q.get('gb') && !(prev && prev.name === 'g' && prev.id === curRoute.id)) gVisit(curRoute.id);
  // к результатам поиска «Назад» возвращает на то же место прокрутки (оно хранится в записи истории)
  if(route().name !== 'read' && route().name !== 'pdf') window.scrollTo(0, (route().name === 'home' && history.state && history.state.sy) || 0);
});
// Слово поиска хранится в адресе (#/?q=слово): «Назад» из книги возвращает к тем же результатам.
// Пока человек печатает, адрес меняется без новой записи в истории.
function setSearch(q){
  const h = q ? '#/?q=' + encodeURIComponent(q) : '#/';
  if(location.hash !== h) history.replaceState(history.state && history.state.sy ? {...history.state, sy: 0} : history.state, '', h);
  curRoute = route(); curHash = location.hash;
  schedule();
}
const searchQ = () => { const r = route(); return r.name === 'home' ? (r.q.get('q') || '') : ''; };
let syT = 0;
window.addEventListener('scroll', () => {
  if(RD.open || !searchQ()) return;
  clearTimeout(syT);
  syT = setTimeout(() => { if(searchQ()) try { history.replaceState({...(history.state || {}), sy: Math.round(window.scrollY)}, '', location.hash); } catch(e){} }, 250);
}, {passive: true});
// «Назад» из читалки книги: в карточку этой книги (шагом назад по истории, если карточка стоит перед читалкой)
function readerBack(){
  const r = route();
  rdClose();
  if(r.name === 'read' && r.id){
    if(history.state && history.state.kn) history.back(); else go('#/b/' + r.id, true);
    return;
  }
  goBack((READER.mode === 'epub' ? EP.back : RD.back) || '#/');
}

/* ---------- Отрисовка ---------- */
const VIEWS = {};
function render(force){
  const r = route();
  const reading = r.name === 'read' || r.name === 'pdf';
  // читалка открывается заново только при переходе (force): живые обновления данных её не трогают
  if(reading){ if(S.loaded && (force || !RD.open)) rdShow(r); renderMini(); return; }
  if(RD.open) rdClose();
  noteFullSync(r);
  sideMe();
  const tab = ['shelves','sh','books','authors','a'].includes(r.name) ? 'shelves' : (r.name === 'note' && r.q.get('g')) || ['groups','g','join'].includes(r.name) ? 'groups' : ['notes','note'].includes(r.name) ? 'notes' : ['profile','log','ai'].includes(r.name) ? 'profile' : r.name === 'review' ? 'review' : 'lib';
  $$('.tab').forEach(t => t.setAttribute('aria-current', t.dataset.tab === tab ? 'page' : 'false'));
  // точка на «Группы»: новые заметки, комментарии или новая книга с прошлого захода
  const gnew = S.loaded && anyGroupNew();
  $$('.tab[data-tab="groups"]').forEach(t => { t.classList.toggle('dot', gnew); t.setAttribute('aria-label', 'Группы' + (gnew ? ', есть новое' : '')); });
  const sm = $('#side-me'); if(sm) sm.setAttribute('aria-current', tab === 'profile' ? 'page' : 'false');
  const rv = $('#side-rev'); if(rv) rv.textContent = reviewCount() || '';
  const m = $('#main');
  if(!S.loaded){ m.innerHTML = '<div class="loading">Загружаю…</div>'; return; }
  // плеер: пока ползунок перемотки тянут пальцем, экран не перерисовывается
  if(r.name === 'listen' && !force && AP.seeking) return;
  // экран заметки не перерисовывается от живых обновлений, пока в нём редактор: иначе сбился бы ввод
  if(r.name === 'note' && !force && ED.quill && ED.id) { renderUploadsPanel(); cmPaint(); return; }
  // поле поиска не теряет фокус при перерисовке
  const focus = document.activeElement && document.activeElement.id && m.contains(document.activeElement) ? document.activeElement.id : '';
  const sel = focus && document.activeElement.selectionStart;
  if(r.name !== 'note' || !(ED.id && (ED.id === r.id || (r.id === 'new' && ED.isNew)))) edClose();
  m.innerHTML = (VIEWS[r.name] || VIEWS.home)(r);
  if(r.name === 'note') edMount(r);
  if(focus){ const el = document.getElementById(focus); if(el){ el.focus(); try { el.setSelectionRange(sel, sel); } catch(e){} } }
  renderUploadsPanel();
  renderMini(); apTick();
}
const notFound = () => `<div class="card"><p>Не найдено: возможно, это уже удалили.</p><a class="btn" href="#/">На главную</a></div>`;
const backLink = (href, text) => `<a class="back" href="${href}" data-back="${esc(href)}">${ICON.back}<span>${esc(text)}</span></a>`;

/* ---------- Обложки ---------- */
// Обложка открывается только вошедшему: сервер проверяет защищённую куку
const coverUrl = b => b.cover ? `/api/knigi/f/cover/${b.id}?v=${encodeURIComponent(b.cover)}` : '';
const SPINES = ['#2C4A66', '#5B3A3A', '#3F5A44', '#6B5534', '#4A4560', '#2F5560', '#6A3F52', '#4F4A3E'];
function spineColor(id){ let h = 0; for(const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return SPINES[h % SPINES.length]; }
function coverHTML(b, cls, extra){
  const ph = `<span class="cover-ph" style="--spine:${spineColor(b.id)}"><b>${esc(b.title)}</b><small>${esc(authorsText(b))}</small></span>`;
  const img = b.cover ? `<img src="${esc(coverUrl(b))}" alt="" loading="lazy" draggable="false" onerror="this.remove()">` : '';
  return `<span class="cover ${cls || ''}${bookNA(b) ? ' na' : ''}">${ph}${img}${extra || ''}</span>`;
}
// Значок «Аудио» на обложке (правки 4.3): у администратора и при одних черновиках, у читателя при опубликованных главах
const audioMark = b => hasAudio(b) && !bookNA(b) ? `<span class="au-mark" title="Есть аудио">${ICON.head}<span>Аудио</span></span>` : '';
// Пометка формата на обложке: у книги только с PDF её нет, иначе все форматы через точку
// Скрытая книга: у администратора «Видна только вам», у читателя «Временно недоступна»
// Открыта отдельным читателям (правки 4.3): у администратора «Видна: 2 читателям»
const READERS_DAT = ['читателю', 'читателям', 'читателям'];
const hiddenText = b => { const n = bookReaders(b.id).length; return n ? `Видна: ${n} ${plural(n, READERS_DAT)}` : 'Видна только вам'; };
const hiddenBadge = b => !b.hidden ? '' : isAdmin() ? `<span class="badge hid">${hiddenText(b)}</span>` : bookNA(b) ? '<span class="badge hid">Временно недоступна</span>' : '';
const fmtBadge = b => { const f = bookFormats(b); return f.length > 1 || (f[0] && f[0] !== 'pdf') ? `<span class="badge">${f.map(x => FORMATS[x] || x).join(' · ')}</span>` : ''; };
function bookTile(b){
  const r = readingOf(b.id);
  const prog = r && progPct(r) ? `<span class="prog"><i style="width:${progPct(r)}%"></i></span>` : '';
  return `<a class="tile" href="#/b/${b.id}">${coverHTML(b, '', audioMark(b))}${hiddenBadge(b) || fmtBadge(b)}${b.status === 'processing' ? '<span class="badge wait">Обрабатывается</span>' : ''}${prog}
    <span class="t-title">${esc(b.title)}</span><span class="t-author">${esc(authorsText(b))}</span></a>`;
}
function bookRow(b, extra){
  return `<a class="brow" href="#/b/${b.id}">${coverHTML(b, 'sm')}<span class="brow-t"><b>${esc(b.title)}</b><span>${esc(authorsText(b))}</span>
    <small>${bookNA(b) ? 'Книга временно недоступна' : [b.year || '', b.pages ? b.pages + ' с.' : '', bookFormats(b).map(f => FORMATS[f]).join(', '), hasAudio(b) ? 'аудио' : '', isScan(b) ? 'скан без текста' : '', b.status === 'processing' ? 'обрабатывается' : ''].filter(Boolean).join(' · ')}</small>${b.hidden && isAdmin() ? `<small class="hid-note">${hiddenText(b)}</small>` : ''}${extra || ''}</span>${ICON.chev}</a>`;
}
const booksGrid = list => list.length ? `<div class="grid">${list.map(bookTile).join('')}</div>` : '<p class="empty">Книг пока нет.</p>';

/* ---------- Главная «Библиотека» ---------- */
function searchHits(q){
  const n = norm(q);
  if(!n) return null;
  const words = n.split(' ');
  const books = libBooks().filter(b => { const s = b.search || norm(b.title + ' ' + authorsText(b)); return words.every(w => s.includes(w)); }).sort(titleSort);
  // только авторы, у которых есть книги в библиотеке (автор книги на проверке не показывается)
  const withBooks = new Set(libBooks().flatMap(b => b.authors || []));
  const authors = S.authors.filter(a => withBooks.has(a.id) && words.every(w => (a.search || norm(a.name)).includes(w)));
  return {books, authors};
}
VIEWS.home = r => {
  const q = r.q.get('q') || '';
  const hits = searchHits(q);
  const head = `<header class="head"><h1>Библиотека</h1><span class="row-acts">${isAdmin() ? `<button type="button" class="btn primary sq" data-act="add-books" title="Добавить книги" aria-label="Добавить книги">${ICON.upload}</button>` : ''}
      ${meLink()}</span></header>
    <div class="search"><label for="q" class="sr">Поиск по названию и автору</label>${ICON.search}<input type="search" id="q" placeholder="Название или автор" value="${esc(q)}" autocomplete="off" enterkeyhint="search">
      ${q ? `<button type="button" class="search-x" data-act="search-clear" aria-label="Очистить поиск" title="Очистить поиск">${ICON.close}</button>` : ''}</div>`;
  if(hits){
    return head + `<section class="block">${hits.authors.length ? `<h2>Авторы</h2><div class="chips">${hits.authors.slice(0, 12).map(a => `<a class="chip" href="#/a/${a.id}">${ICON.author}${esc(a.name)}</a>`).join('')}</div>` : ''}
      <h2>Книги · ${hits.books.length}</h2>${hits.books.length ? `<div class="rows">${hits.books.slice(0, 100).map(b => bookRow(b)).join('')}</div>` : '<p class="empty">Ничего не нашлось. Проверьте написание или поищите по одному слову.</p>'}</section>`;
  }
  // «Продолжить чтение»: только книги с отметкой «Читаю», сначала последняя открытая
  const lastAt = m => { const rd = readingOf(m.book); return String((rd && rd.updated) || m.started_at || m.updated || ''); };
  // скрытая от читателя книга (правки 4.1) здесь не показывается
  const cont = S.marks.filter(m => m.status === 'reading' && S.books.some(b => b.id === m.book && !bookNA(b))).sort((a, b) => lastAt(b).localeCompare(lastAt(a)));
  const common = shelfKids('', true), mine = shelfKids('', false);
  const recent = [...libBooks()].sort((a, b) => addedAt(b).localeCompare(addedAt(a))).slice(0, 12);
  return head + `
    <section class="block"><h2>Продолжить чтение</h2>${cont.length ? `<div class="cont">${cont.map(m => { const b = byId('books', m.book), r = readingOf(b.id), multi = bookFormats(b).length > 1;
      return `<a class="cont-item" href="#/b/${b.id}">${coverHTML(b, 'sm')}<span><b>${esc(b.title)}</b><small>${esc(authorsText(b))}</small>
        ${r ? `<span class="prog wide"><i style="width:${progPct(r)}%"></i></span><small>${multi ? FORMATS[readFmt(r)] + ' · ' : ''}${progText(r)}</small>` : '<small>ещё не открывали</small>'}</span></a>`; }).join('')}</div>`
      : '<p class="empty">Отметьте книгу «Читаю» в её карточке, и она появится здесь.</p>'}</section>
    ${contListenHTML()}
    <section class="block"><div class="block-h"><h2>Полки</h2><a class="more-link" href="#/shelves">Все полки</a></div>
      ${common.length ? `<div class="shelf-cards">${common.map(shelfCard).join('')}</div>` : `<p class="empty">${isAdmin() ? 'Общих полок пока нет. Создайте первую на вкладке «Полки».' : 'Общих полок пока нет.'}</p>`}</section>
    <section class="block"><div class="block-h"><h2>Мои полки</h2>${mine.length ? '' : '<a class="more-link" href="#/shelves">Создать</a>'}</div>
      ${mine.length ? `<div class="shelf-cards">${mine.map(shelfCard).join('')}</div>` : '<p class="empty">Своих полок пока нет. Их видите только вы.</p>'}</section>
    <section class="block"><div class="block-h"><h2>Недавно добавленные</h2><a class="more-link" href="#/books">Все книги · ${libBooks().length}</a></div>${booksGrid(recent)}</section>`;
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
  return `<header class="head"><h1>Полки</h1>${meLink()}</header>
    <nav class="links">
      <a href="#/books">${ICON.library}Все книги<span class="n">${libBooks().length}</span>${ICON.chev}</a>
      <a href="#/authors">${ICON.author}Авторы<span class="n">${new Set(libBooks().flatMap(b => b.authors || [])).size}</span>${ICON.chev}</a>
    </nav>
    <section class="card"><div class="block-h"><h2>Общие полки</h2><span class="row-acts">${isAdmin() ? orderBtn('common', common) + `<button type="button" class="btn sm" data-act="new-shelf" data-common="1">${ICON.plus}<span>Полка</span></button>` : ''}</span></div>
      ${common.length ? shelfTree('', true, 1) : '<p class="empty">Общих полок пока нет.</p>'}</section>
    <section class="card"><div class="block-h"><h2>Мои полки</h2><span class="row-acts">${readOnly() ? '' : orderBtn('mine', mine) + `<button type="button" class="btn sm" data-act="new-shelf" data-common="">${ICON.plus}<span>Полка</span></button>`}</span></div>
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
  if(by === 'added') return list.sort((a, b) => addedAt(b).localeCompare(addedAt(a)));
  return list.sort(titleSort);
}
VIEWS.books = () => {
  let list = libBooks().filter(b => (!UI.booksFmt || bookFormats(b).includes(UI.booksFmt)) && (!UI.booksScan || isScan(b)) && (!UI.booksHidden || b.hidden) && (!UI.booksAudio || hasAudio(b)));
  list = sortedBooks(list);
  const fmts = FMT_ORDER.filter(f => S.bfiles.some(x => x.format === f));
  return `${backLink('#/shelves', 'Полки')}<header class="head"><h1>Все книги</h1><span class="n-head">${list.length}</span></header>
    <div class="toolbar">
      <label class="sel"><span class="sr">Сортировка</span><select id="books-sort">${Object.entries(SORTS).map(([k, l]) => `<option value="${k}"${UI.booksSort === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="sel"><span class="sr">Формат</span><select id="books-fmt"><option value="">все форматы</option>${fmts.map(f => `<option value="${f}"${UI.booksFmt === f ? ' selected' : ''}>${FORMATS[f]}</option>`).join('')}</select></label>
      <label class="check-chip"><input type="checkbox" id="books-scan"${UI.booksScan ? ' checked' : ''}><span>скан без текста</span></label>
      ${S.atracks.length || UI.booksAudio ? `<label class="check-chip"><input type="checkbox" id="books-audio"${UI.booksAudio ? ' checked' : ''}><span>С аудио · ${libBooks().filter(hasAudio).length}</span></label>` : ''}
      ${isAdmin() ? `<label class="check-chip"><input type="checkbox" id="books-hidden"${UI.booksHidden ? ' checked' : ''}><span>Скрытые · ${S.books.filter(b => b.hidden).length}</span></label>` : ''}
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
// Где в книге: «PDF, с. 45» или «EPUB, Глава 3 · 41%». Формат пишем, только если у книги их несколько.
function placeText(n, b){
  const fmt = n.format || (n.page ? 'pdf' : '');
  const where = isEpView(fmt) ? (n.place || '') : n.page ? 'с. ' + n.page : '';
  if(!where) return '';
  return (b && bookFormats(b).length > 1 && fmt ? FORMATS[fmt] + ', ' : '') + where;
}
// Ссылка в читалку на место заметки или цитаты (gid: открыть в групповом режиме)
function noteHref(n, gid){
  const b = n.book ? byId('books', n.book) : null;
  // книга скрыта от читателя (правки 4.1): переход на страницу пишет «Книга временно недоступна»
  if(n.book && (!b || bookNA(b)) && (n.page || n.format)) return NA_HREF;
  if(!b) return '';
  const fmt = n.format || (n.page ? 'pdf' : '');
  const gq = gid ? '&g=' + gid : '';
  if(!fmt || !canRead(fileOf(b.id, fmt))) return '';
  if(viewOf(fmt) === 'pdf') return readHref(b.id, fmt, (n.page ? '&p=' + n.page : '') + (n.kind === 'highlight' ? '&hl=' + n.id : '') + gq);
  return readHref(b.id, fmt, '&hl=' + n.id + gq);
}
function noteRow(n, opts){
  opts = opts || {};
  if(n.kind === 'highlight') return hlRow(n, opts);
  const b = n.book ? byId('books', n.book) : null;
  const where = opts.noBook ? '' : noteBookText(n, b) || 'Без книги';
  return `<a class="note-row" href="#/note/${n.id}">${n.kind === 'lesson' ? ICON.lesson : ICON.notes}
    <span class="nr-t"><b>${esc(n.title || 'Без заголовка')}</b>${n.body_text ? `<span class="nr-x">${esc(n.body_text.slice(0, 160))}</span>` : ''}
      <small>${[where, esc(placeText(n, b)), fmtWhen(n.updated)].filter(Boolean).join(' · ')}</small></span>
    ${n.shared && n.owner === me().id ? '<span class="tag">Видна всем</span>' : ''}${n.group && n.owner === me().id ? '<span class="tag grp">Видно группе</span>' : ''}${n.ai ? `<span class="tag ai" title="Создано ${esc(n.ai)}">${esc(n.ai)}</span>` : ''}${ICON.chev}</a>`;
}
// Цитата в списке: цветная полоска, текст (до 3 строк, дальше «ещё»), мысль, место и дата
function hlRow(n, opts){
  opts = opts || {};
  const b = n.book ? byId('books', n.book) : null;
  const href = noteHref(n);
  const open = UI.hlOpen.has(n.id), long = (n.quote || '').length > 170;
  const where = opts.noBook ? '' : noteBookText(n, b);
  const meta = [where, esc(placeText(n, b)), fmtWhen(n.created)].filter(Boolean).join(' · ');
  const inner = `<span class="hl-q${open ? ' open' : ''}">${esc(n.quote || '')}</span>${n.body_text ? `<span class="hl-t">${esc(n.body_text)}</span>` : ''}<small>${meta}</small>`;
  return `<div class="hl-row" style="--hl:${(HL[n.color] || HL.yellow)[1]}">${href ? `<a class="hl-main" href="${esc(href)}">${inner}</a>` : `<span class="hl-main">${inner}</span>`}
    <span class="hl-side">${long ? `<button type="button" class="linkbtn sm" data-act="hl-more" data-id="${n.id}">${open ? 'свернуть' : 'ещё'}</button>` : ''}
    ${n.shared && n.owner === me().id ? '<span class="tag">Видна всем</span>' : ''}${n.group && n.owner === me().id ? `<a class="tag grp" href="#/note/${n.id}${byId('groups', n.group) ? '?g=' + n.group : ''}">Видно группе</a>` : ''}</span></div>`;
}
function hlFilters(list){
  const colors = HL_KEYS.filter(c => list.some(n => n.color === c));
  if(list.length < 2) return '';
  return `<div class="hl-filters" role="group" aria-label="Фильтр цитат">
    <button type="button" class="hl-chip all" data-act="hl-color" data-c="" aria-pressed="${!UI.hlColor}">Все</button>
    ${colors.map(c => `<button type="button" class="hl-chip" data-act="hl-color" data-c="${c}" aria-pressed="${UI.hlColor === c}" aria-label="${HL[c][0]}" title="${HL[c][0]}"><i style="--hl:${HL[c][1]}"></i></button>`).join('')}
    <label class="check-chip sm"><input type="checkbox" id="hl-thought"${UI.hlThought ? ' checked' : ''}><span>Только с мыслями</span></label></div>`;
}
const hlOrder = (a, b) => fmtSort(a.format || 'pdf', b.format || 'pdf') || (a.page || 0) - (b.page || 0)
  || (parseFloat((/(\d+(?:[.,]\d+)?)%/.exec(a.place || '') || [])[1]) || 0) - (parseFloat((/(\d+(?:[.,]\d+)?)%/.exec(b.place || '') || [])[1]) || 0)
  || String(a.created).localeCompare(String(b.created));
VIEWS.b = r => {
  const b = byId('books', r.id);
  if(!b) return notFound();
  const fmts = bookFormats(b);
  const files = filesOfBook(b.id);
  let fmt = UI.cardFmt[b.id];
  if(!fmt || !fmts.includes(fmt)) fmt = defaultFormat(b);
  const f = fileOf(b.id, fmt);
  const rd = readOf(b.id, fmt);
  const shelves = S.sbooks.filter(x => x.book === b.id).map(x => byId('shelves', x.shelf)).filter(Boolean);
  const q = r.q.get('tab');
  const tab = q === 'lessons' && isAdmin() ? 'lessons' : q === 'highlights' ? 'highlights' : 'notes';
  const kind = tab === 'lessons' ? 'lesson' : tab === 'highlights' ? 'highlight' : 'note';
  let mine = notesOfBook(b.id).filter(n => n.owner === me().id && n.kind === kind);
  mine = kind === 'highlight' ? mine.sort(hlOrder) : mine.sort((x, y) => String(y.updated).localeCompare(String(x.updated)));
  const hlAll = mine;
  if(kind === 'highlight') mine = mine.filter(n => (!UI.hlColor || n.color === UI.hlColor) && (!UI.hlThought || n.body_text));
  const shared = isAdmin() ? [] : notesOfBook(b.id).filter(n => n.owner !== me().id && n.shared).sort((x, y) => (x.kind === 'highlight') - (y.kind === 'highlight') || hlOrder(x, y));
  const ep = isEpView(fmt);
  const na = bookNA(b), ro = readOnly();
  const readBtn = roBook(b) && !na ? roNote() : na ? `<p class="na-note">${ICON.lock}<span>Книга временно недоступна. Ваши цитаты, заметки и место, где вы остановились, сохранены.</span></p>`
    : !f ? (fmts.length ? '<p class="soon">Файла книги нет.</p>' : '')
    : f.status === 'processing' ? `<p class="soon">${VIEW[fmt] !== fmt ? `${FORMATS[fmt]} переводится для читалки ${FORMATS[VIEW[fmt]]}: это идёт в фоне, большая книга может занять несколько минут.` : 'Книга обрабатывается: через минуту её можно будет открыть.'}</p>`
    : f.status === 'error' ? '<p class="soon">Этот файл не открывается: при обработке была ошибка.</p>'
    : `<a class="btn primary big" href="${readHref(b.id, fmt)}">${ICON.book}<span>${rd && (ep ? rd.pct >= 1 : rd.page > 1) ? (ep ? `Продолжить, ${Math.round(rd.pct)}%` : 'Продолжить со с. ' + rd.page) : 'Читать'}</span></a>`;
  const pend = !!b.pending;
  const offerer = isAdmin() && b.offered_by ? (S.users.find(u => u.id === b.offered_by) || {}) : null;
  const seg = fmts.length > 1 ? `<div class="fmt-seg" role="radiogroup" aria-label="Формат">${fmts.map(x => `<button type="button" role="radio" data-act="card-fmt" data-id="${b.id}" data-f="${x}" aria-checked="${x === fmt}">${FORMATS[x]}</button>`).join('')}</div>` : '';
  const facts = [b.year ? b.year + ' г.' : '', f && f.pages ? `${f.pages} ${plural(f.pages, PAGES_W)}` : '', !fmts.length ? 'аудиокнига' : fmts.length > 1 && VIEW[fmt] === fmt ? '' : fmtLong(fmt),
    isAdmin() && b.file_size ? fsize(b.file_size) : '', scanFile(f) ? 'скан без текста' : ''].filter(Boolean);
  const ocrLine = f && f.ocr && f.has_text ? '<p class="hint ocr-note">Текст распознан автоматически, возможны ошибки.</p>' : '';
  const adminNotes = isAdmin() ? files.filter(x => x.status !== 'error' && x.status_note).map(x => `<p class="hint">${fmts.length > 1 ? FORMATS[x.format] + ': ' : ''}${esc(x.status_note)}</p>`).join('') : '';
  const errors = files.filter(x => x.status === 'error').map(x => `<p class="form-err">${fmts.length > 1 ? FORMATS[x.format] + ': ' : ''}${esc(x.status_note || 'Файл не удалось обработать.')}</p>`).join('');
  const tabs = [['notes', 'Заметки'], ...(isAdmin() ? [['lessons', 'Уроки']] : []), ['highlights', 'Цитаты']];
  // число у вкладки: сколько моих заметок, уроков и цитат к этой книге (ноль не пишем)
  const mineOf = k => notesOfBook(b.id).filter(n => n.owner === me().id && n.kind === k).length;
  const tabN = {notes: mineOf('note'), lessons: isAdmin() ? mineOf('lesson') : 0, highlights: mineOf('highlight')};
  const emptyText = {notes: 'Заметок к этой книге пока нет.', lessons: 'Уроков к этой книге пока нет.',
    highlights: hlAll.length ? 'Под этот фильтр цитат нет.' : 'Цитат пока нет. Откройте книгу, выделите текст и выберите цвет: так сохраняется цитата. На телефоне нажмите «Маркер» и проведите пальцем по строкам.'}[tab];
  const inGroups = groupsOfBook(b.id);
  const from = cardFromRoute(b.id);
  const fromText = !from ? 'Библиотека' : from.name === 'sh' ? ((byId('shelves', from.id) || {}).name || 'Полка') : from.name === 'a' ? ((byId('authors', from.id) || {}).name || 'Автор')
    : from.name === 'g' ? ((byId('groups', from.id) || {}).name || 'Группа')
    : from.name === 'home' && from.q.get('q') ? 'Поиск'
    : {books: 'Все книги', notes: 'Заметки', note: 'Заметка', shelves: 'Полки', authors: 'Авторы', profile: 'Профиль', log: 'Журнал чтения', review: 'На проверке', groups: 'Группы', ai: 'Подключение к ИИ'}[from.name] || 'Библиотека';
  return `${backLink(pend ? '#/review/' + b.id : '#/', pend ? 'На проверке' : fromText)}
    ${pend ? `<p class="pend-note">Книга на проверке: её видите только вы. <a href="#/review/${b.id}">Открыть проверку</a></p>` : ''}
    ${b.hidden && isAdmin() && !pend ? `<p class="pend-note hid-bar">${ICON.lock}<span>${bookReaders(b.id).length ? `Видна вам и читателям: ${esc(bookReaders(b.id).map(u => u.name || u.email).join(', '))}. Изменить` : 'Видна только вам. Открыть всем или отдельным читателям'}: «⋯» → «Настройки».</span></p>` : ''}
    <article class="book">
      <div class="book-cover">${coverHTML(b, 'lg')}</div>
      <div class="book-info">
        <h1>${esc(b.title)}</h1>
        ${(b.authors || []).length ? `<p class="book-authors">${b.authors.map(id => byId('authors', id)).filter(Boolean).map(a => `<a href="#/a/${a.id}">${esc(a.name)}</a>`).join(', ')}</p>` : ''}
        ${seg}
        <p class="facts">${facts.map(esc).join(' · ')}</p>
        ${b.status === 'processing' && !(f && f.status === 'processing') ? '<p class="tag wait">Обрабатывается</p>' : ''}
        ${ocrLine}${errors}${adminNotes}
        ${ro && !na && myOwnBook(b) ? '<p class="own-note">Ваша книга: доступна для чтения</p>' : ''}
        <div class="book-acts">${readBtn}${pend || roBook(b) ? '' : listenBtn(b, !fmts.length)}
          ${pend || na || ro ? '' : `<button type="button" class="btn" data-act="to-shelf" data-id="${b.id}">${ICON.shelves}<span>На полку</span></button>`}
          ${isAdmin() ? `<button type="button" class="icon-btn" data-act="book-menu" data-id="${b.id}" aria-label="Действия с книгой" aria-haspopup="menu" title="Действия с книгой">${ICON.more}</button>` : ''}</div>
        ${pend || ro ? '' : markRow(b)}
        ${isAdmin() && !pend ? ocrCardHTML(b, f) : ''}
        ${offerer ? `<p class="hint offered">Предложил: ${esc(offerer.name || offerer.email || 'читатель')}</p>` : ''}
        ${shelves.length ? `<p class="on-shelves">На полках: ${shelves.map(s => `<a class="chip sm" href="#/sh/${s.id}">${esc(shelfPath(s).map(p => p.name).join(' › '))}</a>`).join(' ')}</p>` : ''}
        ${inGroups.length ? `<p class="on-shelves">Читаем в группе: ${inGroups.map(g => `<a class="chip sm" href="#/g/${g.id}">${ICON.people}${esc(g.name)}</a>`).join(' ')}</p>` : ''}
        ${b.description ? `<details class="desc"${UI.descOpen ? ' open' : ''}><summary>Описание</summary><p>${esc(b.description).replace(/\n/g, '<br>')}</p></details>` : ''}
      </div>
    </article>
    ${pend ? '' : audioBlock(b)}
    <section class="card notes-card">
      <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<a role="tab" data-swap="1" href="#/b/${b.id}${k === 'notes' ? '' : '?tab=' + k}" aria-selected="${tab === k}">${l}${tabN[k] ? ` <span class="n">${tabN[k]}</span>` : ''}</a>`).join('')}</div>
      ${kind === 'highlight' ? hlFilters(hlAll) : ''}
      <div class="rows">${mine.map(n => noteRow(n, {noBook: true})).join('') || `<p class="empty">${emptyText}</p>`}</div>
      ${kind !== 'highlight' && !ro ? `<a class="btn" href="#/note/new?book=${b.id}${tab === 'lessons' ? '&kind=lesson' : ''}">${ICON.plus}<span>${tab === 'lessons' ? 'Урок' : 'Заметка'}</span></a>` : ''}
      ${shared.length ? `<h3 class="sub-h owner-h">${S.owner ? faceHTML(S.owner, 'xs') : ''}<span>Заметки автора библиотеки</span></h3><div class="rows">${shared.map(n => noteRow(n, {noBook: true})).join('')}</div>` : ''}
    </section>`;
};

/* ---------- Мои заметки ---------- */
VIEWS.notes = () => {
  const kinds = isAdmin() ? [['', 'Все'], ['note', 'Заметки'], ['lesson', 'Уроки'], ['highlight', 'Цитаты'], ['ai', 'От ИИ']]
    : [['', 'Все мои'], ['note', 'Заметки'], ['highlight', 'Цитаты'], ['shared', 'От автора библиотеки']];
  let list = S.notes.filter(n => {
    if(UI.notesKind === 'shared') return n.owner !== me().id && n.shared;
    if(n.owner !== me().id) return false;
    if(UI.notesKind === 'ai') return !!n.ai; // созданные ИИ-помощником (этап 4)
    return !UI.notesKind || n.kind === UI.notesKind;
  });
  if(UI.notesQ && UI.notesHits) list = list.filter(n => UI.notesHits.has(n.id));
  list.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return `<header class="head head-wrap"><h1>Заметки</h1>${meLink()}
      <span class="row-acts">${readOnly() ? '' : `<a class="btn sm" href="#/note/new">${ICON.plus}<span>Заметка</span></a>`}${isAdmin() ? `<a class="btn sm" href="#/note/new?kind=lesson">${ICON.plus}<span>Урок</span></a>` : ''}</span></header>
    <label class="search"><span class="sr">Поиск по тексту заметок и цитат</span>${ICON.search}<input type="search" id="nq" placeholder="Поиск по тексту, цитатам и мыслям" value="${esc(UI.notesQ)}" autocomplete="off"></label>
    <div class="seg" role="radiogroup" aria-label="Что показать">${kinds.map(([k, l]) => `<button type="button" role="radio" data-act="notes-kind" data-k="${k}" aria-checked="${UI.notesKind === k}">${l}</button>`).join('')}</div>
    ${UI.notesQ && !UI.notesHits ? '<p class="hint">Ищу…</p>' : ''}
    <div class="rows">${list.map(n => noteRow(n)).join('') || `<p class="empty">${UI.notesQ ? 'Ничего не нашлось.' : UI.notesKind === 'ai' ? 'Здесь появятся заметки, которые создал ИИ-помощник (Claude, ChatGPT, Perplexity). Подключить его: Профиль → «Подключение к ИИ».' : 'Здесь появятся заметки ко всем книгам. Новую заметку можно начать в карточке книги или прямо в читалке.'}</p>`}</div>`;
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

/* ---------- Фото профиля ---------- */
// Фото защищённое: приложение получает его по маршруту с ключом входа и держит в памяти как blob-ссылку.
// Своё фото видит каждый, все фото видит администратор, фото администратора видят все вошедшие.
const AV = new Map();
function avatarSrc(u){
  if(!u || !u.avatar || !u.id) return '';
  const k = u.id + '/' + u.avatar, v = AV.get(k);
  if(v && v !== 'loading' && v !== 'err') return v;
  if(!v){
    AV.set(k, 'loading');
    fetch(`/api/knigi/users/${encodeURIComponent(u.id)}/avatar?v=${encodeURIComponent(u.avatar)}`, {headers: {Authorization: pb.authStore.token}, cache: 'no-store'})
      .then(r => { if(!r.ok) throw new Error(); return r.blob(); })
      .then(b => { AV.set(k, URL.createObjectURL(b)); schedule(); }).catch(() => AV.set(k, 'err'));
  }
  return '';
}
const initial = u => (String((u && (u.name || u.email)) || '?').trim()[0] || '?').toUpperCase();
function faceHTML(u, cls){
  const src = avatarSrc(u);
  return `<span class="face ${cls || ''}" aria-hidden="true">${src ? `<img src="${esc(src)}" alt="" draggable="false">` : esc(initial(u))}</span>`;
}
// Внизу бокового меню на компьютере: фото и имя
function sideMe(){
  const el = $('#side-me'); if(!el) return;
  const u = me(), html = `<span class="face-wrap${reviewCount() ? ' dot' : ''}">${faceHTML(u, 'sm')}</span><span>${esc(u.name || u.email || 'Профиль')}</span>`;
  if(el.innerHTML !== html) el.innerHTML = html;
  el.setAttribute('aria-label', 'Профиль' + (reviewCount() ? ', есть книги на проверке' : ''));
  el.title = 'Профиль';
}
function avatarMenu(btn){
  const items = [{label: me().avatar ? 'Выбрать другое фото' : 'Выбрать фото', run: () => pickPhoto(f => cropPhoto(f))}];
  if(me().avatar) items.push({label: 'Убрать фото', danger: true, run: () => openForm({title: 'Убрать фото?', text: 'Вместо фото будет первая буква имени.', submit: 'Убрать', danger: true,
    async onSave(){ const rec = await pb.collection('users').update(me().id, {avatar: null}); pb.authStore.save(pb.authStore.token, rec); toast('Фото убрано'); render(true); }})});
  openMenu(btn, items);
}
// Выбор фото: поле кладём в открытое окно, иначе на телефоне из окна оно не срабатывает
function pickPhoto(cb){ pickFile('image/*,.heic,.heif', false, ([f]) => cb(f)); }

// Окно обрезки по кругу: двигать пальцем или мышью, увеличивать ползунком, щипком или колесом.
// На сервер уходит квадрат 512×512 JPEG (обычно 40-120 КБ).
const AVATAR_SIZE = 512, PHOTO_MAX = 15 * MB;
const cropDlg = $('#crop'), cropStage = $('#crop-stage'), cropImg = $('#crop-img');
const CR = {img: null, W: 0, H: 0, cx: .5, cy: .5, z: 1, seq: 0, url: ''};
const clampZ = z => Math.min(4, Math.max(1, +z || 1));
function cropMsg(text){
  const m = $('#crop-msg'); m.textContent = text || ''; m.hidden = !text;
  cropImg.hidden = !!text; cropDlg.classList.toggle('no-img', !!text);
  $('#crop-done').disabled = !!text;
}
function cropPhoto(file){
  if(!cropDlg.open) cropDlg.showModal();
  cropLoad(file);
}
async function cropLoad(file){
  const seq = ++CR.seq;
  CR.img = null; cropMsg('Открываю фото…');
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if(file.size > PHOTO_MAX){ cropMsg('Фото больше 15 МБ. Выберите фото поменьше.'); return; }
  let img = null;
  try { img = await createImageBitmap(file); }
  catch(e){
    try { img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
    catch(e2){ img = null; }
  }
  if(seq !== CR.seq) return;
  if(!img){
    cropMsg(['heic','heif'].includes(ext) ? 'Это фото в формате HEIC: этот браузер его не открывает. Выберите фото в формате JPG или PNG.' : 'Эту картинку не удалось открыть. Выберите фото в формате JPG, PNG или WEBP.');
    return;
  }
  // большое фото уменьшаем до 2048 точек: так окно не тратит лишнюю память
  const W = img.width || img.naturalWidth, H = img.height || img.naturalHeight;
  const k = Math.min(1, 2048 / Math.max(W, H));
  const cv = document.createElement('canvas'); cv.width = Math.round(W * k); cv.height = Math.round(H * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  if(CR.url) URL.revokeObjectURL(CR.url);
  const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.9));
  if(seq !== CR.seq) return;
  CR.url = URL.createObjectURL(blob);
  Object.assign(CR, {img: cv, W: cv.width, H: cv.height, cx: .5, cy: .5, z: 1});
  cropImg.src = CR.url;
  cropMsg('');
  cropDraw();
}
const cropD = () => cropStage.clientWidth * 0.8;
function cropClamp(){
  const k = Math.min(CR.W, CR.H) / CR.z / 2;
  CR.cx = Math.min(1 - k / CR.W, Math.max(k / CR.W, CR.cx));
  CR.cy = Math.min(1 - k / CR.H, Math.max(k / CR.H, CR.cy));
}
let cropRaf = 0;
function cropDraw(){
  if(cropRaf) return;
  cropRaf = requestAnimationFrame(() => {
    cropRaf = 0;
    if(!CR.img) return;
    cropClamp();
    const s = cropD() / Math.min(CR.W, CR.H) * CR.z, c = cropStage.clientWidth / 2;
    cropImg.style.width = CR.W + 'px'; cropImg.style.height = CR.H + 'px';
    cropImg.style.transform = `translate(${c - CR.cx * CR.W * s}px, ${c - CR.cy * CR.H * s}px) scale(${s})`;
    $('#crop-z').value = CR.z;
  });
}
const ptrs = new Map();
cropStage.addEventListener('pointerdown', e => { if(!CR.img) return; try { cropStage.setPointerCapture(e.pointerId); } catch(err){} ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY}); });
cropStage.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if(!p || !CR.img) return;
  const before = [...ptrs.values()].map(q => ({...q}));
  p.x = e.clientX; p.y = e.clientY;
  const after = [...ptrs.values()];
  const s = cropD() / Math.min(CR.W, CR.H) * CR.z;
  let dx, dy;
  if(after.length === 1){ dx = after[0].x - before[0].x; dy = after[0].y - before[0].y; }
  else {
    const mid = a => ({x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2});
    const dist = a => Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
    dx = mid(after).x - mid(before).x; dy = mid(after).y - mid(before).y;
    CR.z = clampZ(CR.z * dist(after) / dist(before));
  }
  CR.cx -= dx / (s * CR.W); CR.cy -= dy / (s * CR.H);
  cropDraw();
});
const ptrEnd = e => ptrs.delete(e.pointerId);
cropStage.addEventListener('pointerup', ptrEnd);
cropStage.addEventListener('pointercancel', ptrEnd);
cropStage.addEventListener('wheel', e => { if(!CR.img) return; e.preventDefault(); CR.z = clampZ(CR.z * Math.exp(-e.deltaY * 0.0015)); cropDraw(); }, {passive: false});
$('#crop-z').addEventListener('input', e => { if(!CR.img) return; CR.z = clampZ(e.target.value); cropDraw(); });
window.addEventListener('resize', () => { if(cropDlg.open) cropDraw(); });
$('#crop-file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if(f) cropLoad(f); });
$('#crop-cancel').addEventListener('click', () => { CR.seq++; cropDlg.close(); });
cropDlg.addEventListener('close', () => { CR.seq++; CR.img = null; ptrs.clear(); });
$('#crop-done').addEventListener('click', async e => {
  if(!CR.img) return;
  const btn = e.currentTarget; btn.disabled = true;
  try {
    cropClamp();
    const side = Math.min(CR.W, CR.H) / CR.z;
    const cv = document.createElement('canvas'); cv.width = cv.height = AVATAR_SIZE;
    const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(CR.img, CR.cx * CR.W - side / 2, CR.cy * CR.H - side / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    let blob = null;
    for(const q of [0.86, 0.78, 0.68, 0.55]){ blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', q)); if(blob && blob.size <= 300 * 1024) break; }
    if(!blob) throw new Error('Не удалось обработать фото.');
    const rec = await pb.collection('users').update(me().id, {avatar: new File([blob], 'avatar.jpg', {type: 'image/jpeg'})});
    pb.authStore.save(pb.authStore.token, rec);
    if(isAdmin()) loadUsers();
    cropDlg.close(); toast('Фото сохранено'); render(true);
  } catch(err){ toast(errText(err)); }
  finally { btn.disabled = false; }
});

/* ---------- Заметка на весь экран ---------- */
// Режим внутри приложения: прячутся меню и всё лишнее, текст колонкой по центру. Выбор запоминается
// на этом устройстве (kn_noteFull). Из читалки заметка всегда открывается в обычном виде.
function noteFullSync(r){
  if(r.name !== 'note'){ document.documentElement.classList.remove('note-full'); UI.fullFor = ''; return; }
  const id = r.id === 'new' ? 'new:' + (ED.isNew ? ED.id : '') : r.id;
  if(UI.fullFor !== id && !(ED.id && (id === ED.id || id === 'new:' + ED.id))){
    UI.fullNow = UI.normalOnce ? false : !!loadLS('noteFull', false);
    UI.normalOnce = false;
  }
  UI.fullFor = id;
  document.documentElement.classList.toggle('note-full', UI.fullNow);
}
function fullBtnHTML(){
  const on = UI.fullNow, t = on ? 'Свернуть' : 'На весь экран';
  return `<button type="button" class="ed-full" data-act="note-full" title="${t}" aria-label="${t}" aria-pressed="${on}">${on ? ICON.collapse : ICON.expand}</button>`;
}
function setFull(on){
  // место прокрутки: тот же абзац остаётся на той же высоте экрана
  let anchor = null;
  for(const el of $$('#main .ql-editor > *, #main .prose > *, #main .file-row, #main .note-meta')){
    const r = el.getBoundingClientRect(); if(r.bottom > 70){ anchor = {el, top: r.top}; break; }
  }
  UI.fullNow = !!on; saveLS('noteFull', UI.fullNow);
  document.documentElement.classList.toggle('note-full', UI.fullNow);
  $$('#main .ed-full').forEach(b => { b.outerHTML = fullBtnHTML(); });
  if(anchor && anchor.el.isConnected) window.scrollBy(0, anchor.el.getBoundingClientRect().top - anchor.top);
}
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape' || !UI.fullNow || route().name !== 'note' || dlg.open || cropDlg.open || menu || RD.open) return;
  if(e.target.closest && e.target.closest('.ql-tooltip')) return;
  setFull(false);
});

/* ---------- Отметки «Читаю» и «Прочитано» ---------- */
// Отметка у каждого своя (коллекция marks). «Продолжить чтение» на главной показывает только книги с «Читаю».
// Место, где остановился, запоминается у любой открытой книги отдельно (reading).
const markOf = id => S.marks.find(m => m.book === id);
const dayOf = s => String(s || '').slice(0, 10);
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const nowStr = () => new Date().toISOString().replace('T', ' ');
function markRow(b){
  const m = markOf(b.id);
  if(m && m.status === 'finished') return `<div class="mark-row">
      <button type="button" class="mark-done" data-act="mark-finish" data-id="${b.id}" title="Изменить дату">${ICON.check}<span>Прочитано ${esc(fmtDate(m.finished_at))}</span></button>
      <button type="button" class="btn sm" data-act="mark-again" data-id="${b.id}">Читать снова</button></div>`;
  const on = m && m.status === 'reading';
  return `<div class="mark-row">
      <button type="button" class="btn sm mark-btn" data-act="mark-reading" data-id="${b.id}" aria-pressed="${!!on}" title="${on ? 'Снять отметку «Читаю»' : 'Книга появится в «Продолжить чтение» на главной'}">${on ? ICON.check : ICON.book}<span>Читаю</span></button>
      <button type="button" class="btn sm" data-act="mark-finish" data-id="${b.id}">${ICON.check}<span>Прочитано</span></button></div>
    ${on && m.finished_at ? `<p class="hint">Уже прочитана ${esc(fmtDate(m.finished_at))}.</p>` : ''}`;
}
async function markSave(bookId, patch){
  const m = markOf(bookId);
  const rec = m && !String(m.id).startsWith('tmp')
    ? await pb.collection('marks').update(m.id, patch)
    : await pb.collection('marks').create({user: me().id, book: bookId, ...patch});
  upsert('marks', rec);
  return rec;
}
async function markReading(bookId){
  const m = markOf(bookId);
  try {
    if(m && m.status === 'reading'){
      // снять «Читаю»: прочитанная раньше книга снова «Прочитано», иначе отметки нет
      if(m.finished_at){ await markSave(bookId, {status: 'finished'}); toast('Отметка «Читаю» снята'); }
      else { await pb.collection('marks').delete(m.id); removeLocal('marks', m.id); toast('Отметка «Читаю» снята'); }
      return;
    }
    await markSave(bookId, {status: 'reading', started_at: nowStr()});
    toast('Книга в «Продолжить чтение» на главной');
  } catch(e){ toast(errText(e)); }
}
function markFinish(bookId){
  const m = markOf(bookId), done = m && m.status === 'finished';
  openForm({title: done ? 'Прочитано' : 'Отметить «Прочитано»', text: done ? 'Можно поменять дату прочтения или снять отметку.' : 'Книга появится в профиле в разделе «Прочитанные». Отметка «Читаю» снимется.',
    fields: [{key: 'day', label: 'Дата прочтения', type: 'date', required: true}], values: {day: done ? dayOf(m.finished_at) : todayStr()},
    html: done ? '<button type="button" class="btn ghost danger wide" data-dlg="unmark">Снять отметку «Прочитано»</button>' : '',
    submit: done ? 'Сохранить' : 'Отметить',
    async onClick(el){
      if(el.dataset.dlg !== 'unmark') return;
      await pb.collection('marks').delete(m.id); removeLocal('marks', m.id); dlg.close(); toast('Отметка снята');
    },
    async onSave(v){
      if(v.day > todayStr()) throw {message: 'Дата прочтения не может быть в будущем.'};
      await markSave(bookId, {status: 'finished', finished_at: v.day + ' 12:00:00.000Z'});
      toast(done ? 'Дата сохранена' : 'Отмечено: прочитано');
    }});
  const inp = $('#fld-day'); if(inp) inp.max = todayStr();
}
async function markAgain(bookId){
  try { await markSave(bookId, {status: 'reading', started_at: nowStr()}); toast('Книга снова в «Продолжить чтение»'); } catch(e){ toast(errText(e)); }
}
// Плашка в читалке: человек листает книгу без отметки (дальше 3 страниц или 3%) → один раз на книгу «Читаете эту книгу?»
const ASK = {book: '', pages: new Set(), pct0: null};
const askedKey = () => 'markAsked_' + me().id;
function askCheck(bookId, page, pct){
  if(!bookId || !S.loaded || markOf(bookId) || $('#mk-ask')) return;
  const b = byId('books', bookId); if(!b || b.pending) return;
  const asked = loadLS(askedKey(), []);
  if(asked.includes(bookId)) return;
  if(ASK.book !== bookId){ ASK.book = bookId; ASK.pages = new Set(); ASK.pct0 = pct == null ? null : pct; }
  if(page) ASK.pages.add(page);
  if(!(ASK.pages.size > 3 || (pct != null && ASK.pct0 != null && Math.abs(pct - ASK.pct0) >= 3))) return;
  saveLS(askedKey(), [bookId, ...asked].slice(0, 1000));
  const el = document.createElement('div');
  el.className = 'mk-ask'; el.id = 'mk-ask'; el.dataset.book = bookId;
  el.innerHTML = `<span>Читаете эту книгу?</span><button type="button" class="btn sm primary" data-rd="ask-mark">Отметить «Читаю»</button>
    <button type="button" class="icon-btn" data-rd="ask-close" aria-label="Закрыть" title="Закрыть">${ICON.close}</button>`;
  $('#reader').appendChild(el);
}
function askHide(){ const el = $('#mk-ask'); if(el) el.remove(); }

/* ---------- Книги от читателей ---------- */
// Читатель предлагает книгу (до 3 на проверке), администратор проверяет: одобряет с правками и полками или отклоняет с причиной.
const OFFER_MAX = 3;
const OFFER_ST = {pending: 'На проверке', approved: 'Добавлена в библиотеку', rejected: 'Отклонена'};
const myOffers = () => S.offers.filter(o => o.user === me().id).sort((a, b) => String(b.created).localeCompare(String(a.created)));
const offerBusy = () => myOffers().filter(o => o.status === 'pending').length + UP.items.filter(u => u.kind === 'offer' && (u.state === 'wait' || u.state === 'up')).length;
function offerForm(){
  if(offerBusy() >= OFFER_MAX){ info('Пока нельзя', `На проверке уже ${OFFER_MAX} ваши книги. Дождитесь решения по ним, потом предложите следующую.`); return; }
  let file = null;
  const fileLine = () => file ? `<b>${esc(file.name)}</b><small>${fsize(file.size)}</small>` : '<small>Файл не выбран</small>';
  openForm({title: 'Предложить книгу', text: `Администратор посмотрит книгу и добавит её в библиотеку. Подходят ${BOOK_TYPES} до 500 МБ.`,
    html: `<div class="offer-file"><button type="button" class="btn" data-dlg="pick">${ICON.file}<span>Выбрать файл</span></button><span class="of-name" id="of-name">${fileLine()}</span></div>`,
    fields: [{key: 'note', label: 'Пара слов о книге (необязательно)', type: 'textarea', rows: 3, max: 1000, placeholder: 'Например: почему её стоит добавить'}],
    submit: 'Отправить',
    async onClick(el){
      if(el.dataset.dlg !== 'pick') return;
      pickFile(BOOK_ACCEPT, false, ([f]) => {
        if(!UP_EXT.offer.test(f.name)){ formErr(`Подходят только ${BOOK_TYPES}.`); return; }
        if(f.size > UP_MAX.offer){ formErr('Файл больше 500 МБ.'); return; }
        formErr(''); file = f; const n = $('#of-name'); if(n) n.innerHTML = fileLine();
      });
    },
    async onSave(v){
      if(!file) throw {message: 'Выберите файл книги.'};
      addUploads([file], 'offer', v.note);
    }});
}
function offerRow(o){
  const b = o.status === 'approved' && o.book ? byId('books', o.book) : null;
  const t = `<b>${esc(o.title || o.file_name || 'Книга')}</b>`;
  return `<div class="offer-row ${o.status}">${b ? `<a href="#/b/${b.id}">${t}</a>` : t}
    <small>${esc(fmtDate(o.created))} · <span class="st">${OFFER_ST[o.status] || ''}</span></small>
    ${o.status === 'rejected' && o.reason ? `<small class="reason">Причина: ${esc(o.reason)}</small>` : ''}</div>`;
}
// Список «На проверке» и экран проверки одной книги (только администратор)
function whoHTML(id){
  const u = S.users.find(x => x.id === id);
  return u ? `<span class="who-chip">${faceHTML(u, 'xs')}${esc(u.name || u.email)}</span>` : '<span class="who-chip">читатель</span>';
}
const offerOfBook = id => S.offers.find(o => o.book === id && o.status === 'pending') || S.offers.find(o => o.book === id);
VIEWS.review = r => {
  if(!isAdmin()) return notFound();
  if(r.id) return reviewOne(r.id);
  const list = [...S.pbooks].sort((a, b) => String(b.created).localeCompare(String(a.created)));
  const done = S.offers.filter(o => o.status !== 'pending').sort((a, b) => String(b.decided_at || b.updated).localeCompare(String(a.decided_at || a.updated))).slice(0, 10);
  return `<header class="head"><h1>На проверке</h1>${meLink()}</header>
    <p class="hint">Книги, которые предложили читатели. Их видите только вы, пока не одобрите.</p>
    ${list.length ? `<div class="rows rev-list">${list.map(b => { const o = offerOfBook(b.id) || {};
      return `<a class="brow rev-row" href="#/review/${b.id}">${coverHTML(b, 'sm')}<span class="brow-t"><b>${esc(b.title)}</b><span>${esc(authorsText(b))}</span>
        <small>${whoHTML(o.user || b.offered_by)} · ${esc(fmtWhen(o.created || b.created))}${b.status === 'processing' ? ' · обрабатывается' : b.status === 'error' ? ' · ошибка обработки' : ''}</small>
        ${o.note ? `<small class="rev-note">«${esc(o.note)}»</small>` : ''}</span>${ICON.chev}</a>`; }).join('')}</div>`
      : '<p class="empty">Новых книг на проверке нет.</p>'}
    ${done.length ? `<section class="card"><h2>Недавние решения</h2><div class="rows">${done.map(o => `<div class="offer-row ${o.status}">${o.book && byId('books', o.book) ? `<a href="#/b/${o.book}"><b>${esc(o.title)}</b></a>` : `<b>${esc(o.title)}</b>`}
      <small>${whoHTML(o.user)} · ${esc(fmtDate(o.decided_at || o.updated))} · <span class="st">${OFFER_ST[o.status]}</span></small>${o.reason ? `<small class="reason">Причина: ${esc(o.reason)}</small>` : ''}</div>`).join('')}</div></section>` : ''}`;
};
function reviewOne(id){
  const b = S.pbooks.find(x => x.id === id);
  if(!b){
    const o = S.offers.find(x => x.book === id);
    return `${backLink('#/review', 'На проверке')}<div class="card"><p>${o ? `Решение по этой книге уже принято: ${OFFER_ST[o.status].toLowerCase()}.` : 'Этой книги нет среди книг на проверке.'}</p>
      ${o && o.status === 'approved' && byId('books', o.book) ? `<a class="btn" href="#/b/${o.book}">Открыть карточку</a>` : ''}</div>`;
  }
  const o = offerOfBook(b.id) || {};
  const files = filesOfBook(b.id);
  const fmt = defaultFormat(b), f = fileOf(b.id, fmt);
  const busy = b.status === 'processing';
  if(!UI.revShelves[b.id]) UI.revShelves[b.id] = new Set();
  const chosen = UI.revShelves[b.id];
  const flat = [];
  const walk = (parent, lvl) => shelfKids(parent, true).forEach(sh => { flat.push({sh, lvl}); if(lvl < 3) walk(sh.id, lvl + 1); });
  walk('', 1);
  if(S.mail == null) loadMail();
  const readBtn = busy ? '<p class="soon">Книга обрабатывается: через минуту её можно будет открыть.</p>'
    : canRead(f) ? `<a class="btn" href="${readHref(b.id, fmt)}">${ICON.book}<span>Открыть в читалке</span></a>`
    : f && f.format === 'djvu' ? '<p class="soon">DjVu: читалка появится позже.</p>' : '';
  return `${backLink('#/review', 'На проверке')}
    <article class="book">
      <div class="book-cover">${coverHTML(b, 'lg')}</div>
      <div class="book-info">
        <h1>${esc(b.title)}</h1>
        ${(b.authors || []).length ? `<p class="book-authors">${esc(authorsText(b))}</p>` : '<p class="hint">Автор не указан</p>'}
        <p class="facts">${[b.year ? b.year + ' г.' : '', ...files.map(x => `${FORMATS[x.format]}${x.pages ? ', ' + x.pages + ' с.' : ''}, ${fsize(x.file_size || 0)}`)].filter(Boolean).map(esc).join(' · ')}</p>
        ${files.map(x => x.orig_name ? `<p class="hint">Файл: ${esc(x.orig_name)}</p>` : '').join('')}
        ${files.filter(x => x.status_note).map(x => `<p class="${x.status === 'error' ? 'form-err' : 'hint'}">${esc(x.status_note)}</p>`).join('')}
        <div class="book-acts">${readBtn}
          <button type="button" class="btn" data-act="rev-edit" data-id="${b.id}">${ICON.pen}<span>Данные книги</span></button>
          <button type="button" class="btn" data-act="rev-cover" data-id="${b.id}">${ICON.camera}<span>Обложка</span></button></div>
        ${b.description ? `<details class="desc"><summary>Описание</summary><p>${esc(b.description).replace(/\n/g, '<br>')}</p></details>` : ''}
      </div>
    </article>
    <section class="card"><h2>Кто предложил</h2>
      <p>${whoHTML(o.user || b.offered_by)} <span class="muted">${esc(fmtWhen(o.created || b.created))}</span></p>
      ${o.note ? `<p class="rev-quote">${esc(o.note)}</p>` : '<p class="hint">Без комментария.</p>'}</section>
    <section class="card"><h2>Общие полки</h2>
      ${flat.length ? `<div class="rev-shelves">${flat.map(x => `<label class="check-row lvl${x.lvl}"><input type="checkbox" data-shelf="${x.sh.id}" data-book="${b.id}"${chosen.has(x.sh.id) ? ' checked' : ''}><span><b>${esc(x.sh.name)}</b></span></label>`).join('')}</div>
        <p class="hint">Книга встанет на отмеченные полки, когда вы её одобрите.</p>` : '<p class="hint">Общих полок пока нет. Книгу можно поставить на полку и потом.</p>'}</section>
    <div class="rev-acts">
      <button type="button" class="btn primary big" data-act="rev-ok" data-id="${b.id}"${busy ? ' disabled' : ''}>${ICON.check}<span>Одобрить</span></button>
      <button type="button" class="btn big danger" data-act="rev-no" data-id="${b.id}"${busy ? ' disabled' : ''}>Отклонить</button></div>
    <p class="hint">${S.mail ? 'Человеку придёт письмо с решением.' : S.mail === false ? 'Почта в приложении не настроена: человек увидит решение у себя в профиле.' : ''}</p>`;
}
async function loadMail(){ S.mail = 0; try { S.mail = (await pb.send('/api/knigi/admin/mail', {})).ready; } catch(e){ S.mail = false; } schedule(); }
async function reviewApprove(id, btn){
  const o = offerOfBook(id); if(!o){ toast('Предложение не найдено. Обновите страницу.'); return; }
  btn.disabled = true;
  try {
    await pb.send(`/api/knigi/offers/${o.id}/approve`, {method: 'POST', body: {shelves: [...(UI.revShelves[id] || [])]}});
    delete UI.revShelves[id];
    await loadAll(['books', 'pbooks', 'bfiles', 'sbooks', 'offers']);
    toast('Книга добавлена в библиотеку');
    go('#/review', true);
  } catch(e){ toast(errText(e)); btn.disabled = false; }
}
function reviewReject(id){
  const o = offerOfBook(id), b = byId('books', id); if(!o || !b){ toast('Предложение не найдено. Обновите страницу.'); return; }
  openForm({title: 'Отклонить книгу?', text: `«${b.title}»: файл, текст и обложка удалятся с сервера. Человек увидит причину у себя в профиле${S.mail ? ' и получит письмо' : ''}.`,
    fields: [{key: 'reason', label: 'Причина', type: 'textarea', rows: 3, max: 1000, required: true, placeholder: 'Например: такая книга уже есть в другом издании'}],
    submit: 'Отклонить', danger: true,
    async onSave(v){
      await pb.send(`/api/knigi/offers/${o.id}/reject`, {method: 'POST', body: {reason: v.reason}});
      removeLocal('pbooks', id); S.bfiles = S.bfiles.filter(x => x.book !== id);
      loadAll(['offers', 'authors']).catch(() => {});
      toast('Книга отклонена'); go('#/review', true);
    }});
}

/* ---------- Группы чтения (этап 3) ---------- */
// Группа читает одну книгу: кто сегодня читал и сколько, неделя кружками, план (по желанию создателя),
// цитаты и заметки участников с комментариями. Всё, что видно в группе, видят только её участники.
const MEMBERS_W = ['участник', 'участника', 'участников'], GROUPS_W = ['группе', 'группах', 'группах'];
const byCreated = (a, b) => String(a.created).localeCompare(String(b.created));
const myGroups = () => S.groups.filter(g => S.gmembers.some(m => m.group === g.id && m.user === me().id)).sort((a, b) => collator.compare(a.name || '', b.name || '') || byCreated(a, b));
const membersOf = gid => S.gmembers.filter(m => m.group === gid).sort(byCreated);
const isMemberOf = (gid, uid) => S.gmembers.some(m => m.group === gid && m.user === uid);
const myMember = gid => S.gmembers.find(m => m.group === gid && m.user === me().id);
const isGroupOwner = g => !!g && g.owner === me().id;
const person = uid => uid === me().id ? me() : S.people.find(u => u.id === uid) || S.users.find(u => u.id === uid) || {id: uid, name: ''};
const nameOf = u => (u && u.name) || 'Без имени';
// Группы, которые сейчас читают эту книгу (в них можно отправить заметку или цитату)
const groupsOfBook = bookId => bookId ? myGroups().filter(g => g.book === bookId) : [];
const gbooksOf = gid => S.gbooks.filter(x => x.group === gid).sort((a, b) => String(b.started_at || b.created).localeCompare(String(a.started_at || a.created)));
const curGBook = g => gbooksOf(g.id).find(x => !x.finished_at);
const planOn = () => !!S.gcfg.plan;
const planOf = g => { const gb = curGBook(g); return gb ? S.gplan.filter(p => p.gbook === gb.id).sort((a, b) => String(a.due).localeCompare(String(b.due)) || byCreated(a, b)) : []; };
const groupNotes = (gid, bookId) => S.notes.filter(n => n.group === gid && n.book === bookId && (n.kind === 'note' || n.kind === 'highlight'));
const commentsOf = noteId => S.comments.filter(c => c.note === noteId).sort(byCreated);
const groupLink = g => `${location.origin}/?group=${g.invite_code || ''}`;
const groupGone = () => `${backLink('#/groups', 'Группы')}<div class="card"><p>Группа не найдена: возможно, её удалили или вас из неё исключили.</p><a class="btn" href="#/groups">К группам</a></div>`;
// Новое с прошлого захода: заметки и цитаты других участников и комментарии к заметкам группы
function groupNew(g){
  const m = myMember(g.id); if(!m) return false;
  const seen = String(m.last_seen || '');
  if(S.notes.some(n => n.group === g.id && n.owner !== me().id && String(n.created) > seen)) return true;
  return S.comments.some(c => c.group === g.id && c.user !== me().id && String(c.created) > seen && S.notes.some(n => n.id === c.note && n.group === g.id));
}
const newBook = g => { const m = myMember(g.id); return !!(m && m.book_seen && g.book && m.book_seen !== g.book); };
const anyGroupNew = () => myGroups().some(g => groupNew(g) || newBook(g));
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return ymd(d); };
const addDays = (s, k) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + k); return ymd(d); };
const WD_LETTER = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'];
const WD_TO = ['понедельнику', 'вторнику', 'среде', 'четвергу', 'пятнице', 'субботе', 'воскресенью'];
// «к пятнице, 7 ноября»
function dueText(s){ const d = new Date(s + 'T12:00:00'); if(isNaN(d)) return ''; return `к ${WD_TO[(d.getDay() + 6) % 7]}, ${d.getDate()} ${MONF[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`; }
// «2 ч назад», дальше дата
function agoText(s){
  const d = dateOf(s); if(isNaN(d)) return '';
  const min = Math.floor((Date.now() - d.getTime()) / 60e3);
  if(min < 1) return 'только что';
  if(min < 60) return `${min} мин назад`;
  if(min < 24 * 60) return `${Math.floor(min / 60)} ч назад`;
  return fmtDate(s);
}
// Текст комментария: без оформления, ссылки кликабельны
function linkify(t){
  return esc(t).replace(/https?:\/\/[^\s<]+/g, u => { const m = /[.,!?;:)»]+$/.exec(u); const tail = m ? m[0] : ''; const url = tail ? u.slice(0, -tail.length) : u;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${tail}`; });
}

// Состояние группы с сервера: кто сегодня читал, неделя, где каждый в книге (обновляется при заходе, не чаще раза в 30 с)
async function loadGState(gid, force){
  const st = UI.gState[gid];
  if(st && st.loading) return;
  if(st && !force && Date.now() - st.at < 30e3) return;
  UI.gState[gid] = {...(st || {}), loading: true, at: st ? st.at : 0};
  try { UI.gState[gid] = {data: await pb.send(`/api/knigi/groups/${gid}/state?day=${todayStr()}&from=${weekStart()}`, {}), at: Date.now()}; }
  catch(e){ UI.gState[gid] = {data: st && st.data, at: Date.now(), err: errText(e)}; }
  schedule();
}
// Человек открыл группу: запоминаем прошлый заход (чтобы пометить новое), сервер ставит новый
function gVisit(gid){
  const g = byId('groups', gid), m = myMember(gid);
  if(!g || !m) return;
  UI.gPrev[gid] = m.last_seen || '';
  UI.gBanner[gid] = newBook(g) ? g.book : ''; // плашка о новой книге: только при первом заходе после смены
  gSeen(gid);
  loadGState(gid, true);
}
let gSeenT = 0;
function gSeen(gid){
  clearTimeout(gSeenT);
  pb.send(`/api/knigi/groups/${gid}/seen`, {method: 'POST'}).then(res => upsert('gmembers', {id: res.id, last_seen: res.last_seen, book_seen: res.book_seen})).catch(() => {});
}
// Состав групп поменялся (вступили, вышли, исключили, удалили): права на заметки, комментарии и фото
// зависят от состава, поэтому всё связанное с группами перечитывается целиком
let gRefreshT = 0;
const G_KEYS = ['groups', 'gmembers', 'gbooks', 'gplan', 'people', 'notes', 'comments'];
function refreshGroups(){ clearTimeout(gRefreshT); gRefreshT = setTimeout(() => loadAll(G_KEYS).catch(() => {}), 400); }

// Обложка, название и мой прогресс в книге группы
function gBookCard(g){
  const b = g.book ? byId('books', g.book) : null;
  // книга группы скрыта (правки 4.1): лента и комментарии остаются, читать нельзя
  if(g.book && (!b || bookNA(b))){
    const gb = curGBook(g), title = b ? b.title : (gb && gb.book_title) || 'Книга группы';
    return `<section class="card g-book"><div class="gb-row">${b ? `<a href="#/b/${b.id}" class="gb-cover" aria-label="Карточка книги">${coverHTML(b, 'sm')}</a>` : `<span class="gb-cover"><span class="cover sm na"><span class="cover-ph" style="--spine:${spineColor(g.book)}"><b>${esc(title)}</b></span></span></span>`}
      <div class="gb-t"><small>Читаем${gb && gb.started_at ? ' с ' + esc(fmtDate(gb.started_at)) : ''}</small>${b ? `<a href="#/b/${b.id}"><b>${esc(title)}</b></a>` : `<b>${esc(title)}</b>`}<span class="na-line">Книга временно недоступна</span></div></div>
      <button type="button" class="btn primary" disabled>${ICON.book}<span>Читать в группе</span></button></section>`;
  }
  if(!b){
    return `<section class="card g-book"><p class="hint">Книги группы больше нет в библиотеке.${isGroupOwner(g) ? ' Выберите следующую книгу.' : ' Создатель может выбрать следующую.'}</p>
      ${isGroupOwner(g) ? `<button type="button" class="btn" data-act="g-next" data-id="${g.id}">Выбрать книгу</button>` : ''}</section>`;
  }
  const r = readingOf(b.id), fmt = defaultFormat(b), f = fileOf(b.id, fmt), gb = curGBook(g);
  const btn = canRead(f) ? `<a class="btn primary" href="${readHref(b.id, fmt, '&g=' + g.id)}">${ICON.book}<span>Читать в группе</span></a>`
    : f && f.status === 'processing' ? '<p class="soon">Книга обрабатывается.</p>' : '<p class="soon">Этот формат пока не открывается в читалке.</p>';
  return `<section class="card g-book"><div class="gb-row"><a href="#/b/${b.id}" class="gb-cover" aria-label="Карточка книги">${coverHTML(b, 'sm')}</a>
      <div class="gb-t"><small>Читаем${gb && gb.started_at ? ' с ' + esc(fmtDate(gb.started_at)) : ''}</small><a href="#/b/${b.id}"><b>${esc(b.title)}</b></a><span>${esc(authorsText(b))}</span>
        ${r ? `<span class="prog wide"><i style="width:${progPct(r)}%"></i></span><small>Я: ${esc(progText(r))}</small>` : '<small>Вы ещё не открывали эту книгу.</small>'}</div></div>
    ${btn}</section>`;
}

/* ---------- План чтения ---------- */
// Где участник в книге по отношению к цели этапа. Если он читает другой формат, сравниваем по проценту.
function stageStatus(st, u){
  const p = u && u.pdf, e = u && u.epub;
  const pdfPct = p && p.pages ? p.page / p.pages * 100 : null;
  if(viewOf(st.format) === 'pdf'){
    // этап по страницам (PDF или DjVu); другой файл той же читалки и EPUB сравниваются по проценту
    const pf = fileOf(curBookOfStage(st), st.format), pages = (pf && pf.pages) || (p && p.pages) || 0;
    const same = p && (p.f || 'pdf') === st.format;
    if(same && p.page >= st.page) return {done: true};
    if(p && !same && pdfPct != null && pages && pdfPct >= st.page / pages * 100) return {done: true};
    if(e && pages && e.pct >= st.page / pages * 100) return {done: true};
    if(p) return {text: `читает (с. ${p.page})`};
    if(e) return {text: `читает (${Math.round(e.pct)}%)`};
    return {text: 'не начинал'};
  }
  if(e && e.pct >= st.pct) return {done: true};
  if(pdfPct != null && pdfPct >= st.pct) return {done: true};
  if(e) return {text: `читает (${Math.round(e.pct)}%)`};
  if(p) return {text: `читает (с. ${p.page})`};
  return {text: 'не начинал'};
}
const curBookOfStage = st => (S.gbooks.find(x => x.id === st.gbook) || {}).book || '';
const stageTarget = st => viewOf(st.format) === 'pdf' ? `До с. ${st.page}` : `До ${st.chapter ? '«' + st.chapter + '», ' : ''}${String(Math.round(st.pct * 10) / 10).replace('.', ',')}%`;
function planBlock(g, state){
  if(!planOn()) return '';
  const stages = planOf(g);
  if(!stages.length) return '';
  const ms = membersOf(g.id), mem = (state && state.members) || {};
  const doneOf = st => ms.filter(m => stageStatus(st, mem[m.user]).done).length;
  const next = stages.find(st => doneOf(st) < ms.length) || stages[stages.length - 1];
  const k = doneOf(next);
  const late = next.due < todayStr() && k < ms.length;
  return `<section class="card g-plan"><div class="block-h"><h2>План чтения</h2>${stages.length > 1 ? `<button type="button" class="btn sm ghost" data-act="g-plan-all" data-id="${g.id}">Весь план · ${stages.length}</button>` : ''}</div>
    <p class="gp-goal"><b>${esc(stageTarget(next))}</b> ${esc(dueText(next.due))}${late ? ' <span class="tag">срок прошёл</span>' : ''}</p>
    <div class="gp-bar"><span class="prog wide"><i style="width:${ms.length ? Math.round(k / ms.length * 100) : 0}%"></i></span><small>Дошли: ${k} из ${ms.length}</small></div>
    ${state ? `<div class="gp-who">${ms.map(m => { const s = stageStatus(next, mem[m.user]);
      return `<div class="gp-row">${faceHTML(person(m.user), 'xs')}<span class="nm">${esc(nameOf(person(m.user)))}${m.user === me().id ? ' (вы)' : ''}</span><span class="st${s.done ? ' done' : ''}">${s.done ? ICON.check + 'дошёл' : esc(s.text)}</span></div>`; }).join('')}</div>` : '<p class="hint">Загружаю…</p>'}
  </section>`;
}
function openPlanAll(g){
  const stages = planOf(g), ms = membersOf(g.id), st = UI.gState[g.id], mem = (st && st.data && st.data.members) || {};
  openForm({title: 'План чтения', noSubmit: false, submit: 'Готово', noCancel: true, async onSave(){},
    html: `<div class="rows">${stages.map(s => { const k = ms.filter(m => stageStatus(s, mem[m.user]).done).length;
      return `<div class="plan-row"><b>${esc(stageTarget(s))}</b><small>${esc(dueText(s.due))} · дошли ${k} из ${ms.length}</small></div>`; }).join('')}</div>`});
}
// Меню «План чтения» у создателя: этапы, добавить, изменить, удалить, удалить весь план
function openPlan(g){
  const stages = planOf(g);
  openForm({title: 'План чтения', text: stages.length ? 'План видят все участники. Отметка «дошёл» ставится сама, когда человек дочитал до цели этапа.' : 'Плана пока нет. Добавьте этап: до какой страницы или главы и к какой дате. Участники увидят его на экране группы.',
    html: `${stages.length ? `<div class="rows">${stages.map(s => `<div class="plan-row"><span><b>${esc(stageTarget(s))}</b><small>${esc(dueText(s.due))}</small></span>
        <span class="pr-acts"><button type="button" class="btn sm" data-dlg="edit" data-id="${s.id}">Изменить</button><button type="button" class="btn sm ghost danger" data-dlg="del" data-id="${s.id}">Удалить</button></span></div>`).join('')}</div>` : ''}
      <button type="button" class="btn" data-dlg="add">${ICON.plus}<span>Добавить этап</span></button>
      ${stages.length > 1 ? '<button type="button" class="btn ghost danger" data-dlg="drop">Удалить весь план</button>' : ''}`,
    noSubmit: true,
    async onClick(b){
      const a = b.dataset.dlg, s = stages.find(x => x.id === b.dataset.id);
      if(a === 'add') thenOpen(() => stageForm(g, null)), dlg.close();
      else if(a === 'edit' && s) thenOpen(() => stageForm(g, s)), dlg.close();
      else if(a === 'del' && s){ if(!arm(b, 'Удалить?')) return; await pb.collection('group_plan').delete(s.id); removeLocal('gplan', s.id); toast('Этап удалён'); thenOpen(() => openPlan(byId('groups', g.id) || g)); dlg.close(); }
      else if(a === 'drop'){ if(!arm(b, 'Точно удалить весь план?')) return; for(const x of stages){ await pb.collection('group_plan').delete(x.id); removeLocal('gplan', x.id); } toast('План удалён'); dlg.close(); }
    }});
}
function stageForm(g, s){
  const b = byId('books', g.book); if(!b){ info('Нет книги', 'У группы сейчас нет книги.'); return; }
  const fmts = bookFormats(b).filter(f => canRead(fileOf(b.id, f)));
  if(!fmts.length){ info('План не получится', 'У книги нет файла, который открывается в читалке.'); return; }
  const pdf = filesOfBook(b.id).find(f => viewOf(f.format) === 'pdf' && f.pages);
  const fmt0 = s ? s.format : (fmts.includes(defaultFormat(b)) ? defaultFormat(b) : fmts[0]);
  const fields = [];
  if(fmts.length > 1) fields.push({key: 'format', type: 'select', label: 'Формат', options: fmts.map(f => [f, FORMATS[f]]), hint: 'Участник, который читает другой формат, тоже получит «дошёл»: сравнение по проценту книги.'});
  fields.push({key: 'page', type: 'number', label: `До какой страницы${pdf && pdf.pages ? ` (из ${pdf.pages})` : ''}`});
  fields.push({key: 'pct', type: 'number', label: 'До какого процента книги'}, {key: 'chapter', label: 'Глава (необязательно, для подписи)', max: 200, placeholder: 'Например: Глава 5'});
  fields.push({key: 'due', type: 'date', label: 'К какой дате', required: true});
  const show = f => { form.querySelectorAll('#fld-page, #fld-pct, #fld-chapter').forEach(el => { const box = el.closest('.field'); if(box) box.hidden = (el.id === 'fld-page') !== (viewOf(f) === 'pdf'); }); };
  openForm({title: s ? 'Этап плана' : 'Новый этап', fields, values: {format: fmt0, page: s && s.page || '', pct: s && s.pct || '', chapter: s ? s.chapter : '', due: s ? s.due : addDays(todayStr(), 7)},
    onChange(el){ if(el.id === 'fld-format') show(el.value); },
    async onSave(v){
      const f = v.format || fmt0;
      const byPage = viewOf(f) === 'pdf';
      const data = {format: f, due: v.due, page: byPage ? +v.page || 0 : 0, pct: !byPage ? +String(v.pct).replace(',', '.') || 0 : 0, chapter: !byPage ? v.chapter : ''};
      if(byPage && !(data.page >= 1)) throw {message: 'Укажите страницу.'};
      if(!byPage && !(data.pct > 0 && data.pct <= 100)) throw {message: 'Укажите процент от 1 до 100.'};
      const rec = s ? await pb.collection('group_plan').update(s.id, data) : await pb.collection('group_plan').create({...data, group: g.id});
      upsert('gplan', rec); toast(s ? 'Этап изменён' : 'Этап добавлен');
      thenOpen(() => openPlan(byId('groups', g.id) || g));
    }});
  show(fmt0);
}

/* ---------- Сегодня читали и неделя группы ---------- */
const readAmount = t => [t.pages ? `${t.pages} стр.` : '', t.pct ? `+${String(t.pct).replace('.', ',')}%` : ''].filter(Boolean).join(' и ') || 'меньше страницы';
function todayBlock(g, state){
  const ms = membersOf(g.id), mem = (state && state.members) || {};
  const today = todayStr(), from = weekStart(), days = WD_LETTER.map((_, k) => addDays(from, k)), wi = days.indexOf(today);
  const readers = ms.filter(m => mem[m.user] && mem[m.user].today && mem[m.user].today.read);
  const head = `<span></span>${WD_LETTER.map((l, k) => `<span class="gw-l${k === wi ? ' today' : ''}" aria-hidden="true">${l}</span>`).join('')}`;
  const rows = ms.map(m => {
    const u = person(m.user), on = (mem[m.user] && mem[m.user].days) || [], mine = m.user === me().id;
    return `<span class="gw-who">${faceHTML(u, 'xs')}<span class="nm${mine ? ' self' : ''}">${esc(nameOf(u))}${mine ? ' (вы)' : ''}</span>
        <span class="sr">: на этой неделе читал${on.length ? ' ' + on.length + ' из 7 дней' : 'и 0 дней'}</span></span>` +
      days.map((d, k) => `<i class="gw-d${on.includes(d) ? ' on' : ''}${k === wi ? ' today' : ''}${k > wi ? ' future' : ''}" aria-hidden="true"></i>`).join('');
  }).join('');
  return `<section class="card g-today"><div class="block-h"><h2>Сегодня читали</h2><span class="muted">${readers.length} из ${ms.length}</span></div>
    ${!state ? '<p class="hint">Загружаю…</p>' : readers.length ? `<div class="gt-list">${readers.map(m => `<div class="gt-row">${faceHTML(person(m.user), 'sm')}<span class="nm">${esc(nameOf(person(m.user)))}${m.user === me().id ? ' (вы)' : ''}</span><b>${esc(readAmount(mem[m.user].today))}</b></div>`).join('')}</div>`
      : '<p class="empty">Сегодня ещё никто не читал.</p>'}
    <p class="hint sm">Считается по открытым страницам: быстро пролистанная тоже засчитывается. У EPUB прирост процента за день.</p>
    <div class="gw-grid" aria-label="Неделя группы">${head}${rows}</div></section>`;
}

/* ---------- Лента: цитаты и заметки группы ---------- */
function gFeedItem(n, g, prev){
  const u = person(n.owner), mine = n.owner === me().id, b = n.book ? byId('books', n.book) : null;
  const fresh = !mine && prev && String(n.created) > prev;
  const cm = commentsOf(n.id), cmNew = prev && cm.some(c => c.user !== me().id && String(c.created) > prev);
  const open = `#/note/${n.id}?g=${g.id}`;
  const current = b && g.book === b.id;
  const href = noteHref(n, current ? g.id : '');
  const where = placeText(n, b);
  const former = !isMemberOf(g.id, n.owner);
  return `<article class="gf-item${fresh ? ' new' : ''}">
    <div class="gf-head">${faceHTML(u, 'sm')}<span class="gf-who"><b>${former ? 'Бывший участник' : esc(nameOf(u)) + (mine ? ' (вы)' : '')}</b><small>${esc(fmtWhen(n.created))}</small></span>${fresh ? '<span class="tag new">новое</span>' : ''}</div>
    <a class="gf-body" href="${esc(open)}">
      ${n.kind === 'highlight' ? `<span class="gf-quote" style="--hl:${(HL[n.color] || HL.yellow)[1]}">${esc(n.quote || '')}</span>` : `<b class="gf-title">${esc(n.title || 'Заметка')}</b>`}
      ${n.body_text ? `<span class="gf-text">${esc(n.body_text)}</span>` : ''}</a>
    <div class="gf-foot">${where ? (href ? `<a class="page-link" href="${esc(href)}">${esc(where)}</a>` : `<span>${esc(where)}</span>`) : ''}
      <a class="gf-cm${cmNew ? ' new' : ''}" href="${esc(open)}">${ICON.chat}<span>${cm.length ? cm.length + ' ' + plural(cm.length, ['комментарий', 'комментария', 'комментариев']) : 'Комментировать'}</span></a></div>
  </article>`;
}
function feedBlock(g, bookId, title){
  const all = groupNotes(g.id, bookId).sort((a, b) => String(b.created).localeCompare(String(a.created)));
  const f = UI.gFeed[g.id] || '';
  const list = all.filter(n => !f || (f === 'me' ? n.owner === me().id : n.owner === f));
  const authors = [...new Set(all.map(n => n.owner))].filter(id => id !== me().id);
  const prev = UI.gPrev[g.id] || '';
  const chips = all.length ? `<div class="gf-filter" role="group" aria-label="Чьи записи показать">
      <button type="button" class="chip sm" data-act="g-feed" data-id="${g.id}" data-f="" aria-pressed="${!f}">Все</button>
      <button type="button" class="chip sm" data-act="g-feed" data-id="${g.id}" data-f="me" aria-pressed="${f === 'me'}">Только мои</button>
      ${authors.map(id => `<button type="button" class="chip sm" data-act="g-feed" data-id="${g.id}" data-f="${id}" aria-pressed="${f === id}">${faceHTML(person(id), 'xs')}${esc(isMemberOf(g.id, id) ? nameOf(person(id)) : 'Бывший участник')}</button>`).join('')}</div>` : '';
  return `<section class="block g-feed"><div class="block-h"><h2>${esc(title)}${all.length ? ` <span class="n">${all.length}</span>` : ''}</h2></div>${chips}
    ${list.length ? `<div class="gf-list">${list.map(n => gFeedItem(n, g, prev)).join('')}</div>`
      : `<p class="empty">${all.length ? 'Под этот фильтр записей нет.' : 'Пока пусто. Откройте книгу кнопкой «Читать в группе»: новые цитаты и заметки сразу будут видны группе.'}</p>`}</section>`;
}

/* ---------- Экраны ---------- */
VIEWS.groups = () => {
  const list = myGroups(), max = S.gcfg.maxPerUser || 5, full = list.length >= max;
  const cards = list.map(g => {
    const ms = membersOf(g.id), b = g.book ? byId('books', g.book) : null, dot = groupNew(g) || newBook(g);
    const faces = ms.slice(0, 7).map(m => faceHTML(person(m.user), 'sm')).join('') + (ms.length > 7 ? `<span class="face sm more" aria-hidden="true">+${ms.length - 7}</span>` : '');
    return `<a class="group-card${dot ? ' dot' : ''}" href="#/g/${g.id}">${b ? coverHTML(b, 'xs') : `<span class="gc-noc">${ICON.people}</span>`}
      <span class="gc-main"><span class="gc-top"><b>${esc(g.name)}</b>${dot ? '<span class="sr">, есть новое</span>' : ''}</span>
        <small>${b ? 'Читаем «' + esc(b.title) + '»' + (bookNA(b) ? ' · временно недоступна' : '') : g.book && curGBook(g) ? 'Читаем «' + esc(curGBook(g).book_title) + '» · временно недоступна' : 'Книга не выбрана'}</small>
        <span class="faces">${faces}</span><small>${ms.length} ${plural(ms.length, MEMBERS_W)}${isGroupOwner(g) ? ' · вы создатель' : ''}</small></span>${ICON.chev}</a>`;
  }).join('');
  return `<header class="head"><h1>Группы</h1>${meLink()}</header>
    ${list.length ? `<div class="groups">${cards}</div>`
      : '<section class="card"><p>Группа нужна, чтобы читать одну книгу вместе: видеть, кто сегодня читал, делиться цитатами и заметками и обсуждать их.</p><p class="hint">Создайте группу и отправьте ссылку тем, с кем хотите читать. Вступить смогут те, у кого уже есть аккаунт в библиотеке.</p></section>'}
    ${readOnly() ? roNote() : ''}<button type="button" class="${list.length ? 'dashed' : 'btn primary big wide'}" data-act="g-new"${full || readOnly() ? ' disabled' : ''}>${full ? `Вы уже в ${max} ${plural(max, GROUPS_W)}` : list.length ? '+ Создать группу' : 'Создать группу'}</button>
    ${full ? `<p class="hint">Можно состоять не больше чем в ${max} ${plural(max, GROUPS_W)}, вместе с созданными. Чтобы создать новую, выйдите из одной из старых.</p>` : ''}`;
};
VIEWS.g = r => {
  const g = byId('groups', r.id);
  if(!g || !myMember(g.id)) return groupGone();
  const gbId = r.q.get('gb');
  if(gbId) return gPastBook(g, gbId);
  const ms = membersOf(g.id), own = isGroupOwner(g);
  loadGState(g.id);
  if(groupNew(g)) { clearTimeout(gSeenT); gSeenT = setTimeout(() => { if(route().name === 'g' && route().id === g.id) gSeen(g.id); }, 3000); }
  const st = UI.gState[g.id], state = st && st.data && st.data.book === g.book ? st.data : null;
  const faces = ms.slice(0, 9).map(m => faceHTML(person(m.user), 'sm')).join('') + (ms.length > 9 ? `<span class="face sm more" aria-hidden="true">+${ms.length - 9}</span>` : '');
  const banner = UI.gBanner[g.id] && UI.gBanner[g.id] === g.book && byId('books', g.book)
    ? `<div class="g-banner"><span>Группа начала новую книгу: <b>${esc(byId('books', g.book).title)}</b></span><button type="button" class="icon-btn" data-act="g-banner" data-id="${g.id}" aria-label="Закрыть">${ICON.close}</button></div>` : '';
  const alone = own && ms.length < 2 ? `<section class="card"><h2>Пригласите участников</h2><p class="hint">Отправьте ссылку тем, с кем хотите читать эту книгу. Вступить смогут те, у кого уже есть аккаунт в библиотеке.</p>
      <button type="button" class="btn primary" data-act="g-invite" data-id="${g.id}">Пригласить</button></section>` : '';
  const past = gbooksOf(g.id).filter(x => x.finished_at);
  return `<div class="nav-head">${backLink('#/groups', 'Группы')}<span class="row-acts">${own && !readOnly() ? `<button type="button" class="btn sm" data-act="g-invite" data-id="${g.id}">Пригласить</button>` : ''}
      <button type="button" class="icon-btn" data-act="g-menu" data-id="${g.id}" aria-label="Действия с группой" aria-haspopup="menu" title="Действия с группой">${ICON.more}</button></span></div>
    ${banner}
    <header class="g-head"><h1>${esc(g.name)}</h1>
      ${g.description ? `<details class="desc g-desc"><summary>Описание</summary><p>${esc(g.description).replace(/\n/g, '<br>')}</p></details>` : ''}
      <button type="button" class="g-faces" data-act="g-members" data-id="${g.id}" aria-label="Участники: ${ms.length}"><span class="faces">${faces}</span><small>${ms.length} ${plural(ms.length, MEMBERS_W)} · ${own ? 'вы создатель' : 'создатель ' + esc(nameOf(person(g.owner)))}</small></button></header>
    ${alone}
    ${gBookCard(g)}
    ${planBlock(g, state)}
    ${todayBlock(g, state)}
    ${g.book ? feedBlock(g, g.book, 'Цитаты и заметки группы') : ''}
    ${past.length ? `<section class="card"><h2>Прочитанные книги группы</h2><div class="rows">${past.map(x => { const b = x.book ? byId('books', x.book) : null; const n = x.book ? groupNotes(g.id, x.book).length : 0;
      return `<a class="brow" href="#/g/${g.id}?gb=${x.id}">${b ? coverHTML(b, 'sm') : `<span class="cover sm"><span class="cover-ph" style="--spine:${spineColor(x.id)}"><b>${esc(x.book_title)}</b></span></span>`}
        <span class="brow-t"><b>${esc(b ? b.title : x.book_title)}</b><small>с ${esc(fmtDate(x.started_at))} по ${esc(fmtDate(x.finished_at))}${n ? ' · ' + n + ' ' + plural(n, ['запись', 'записи', 'записей']) : ''}${b && !bookNA(b) ? '' : x.book ? ' · книга временно недоступна' : ' · книга удалена'}</small></span>${ICON.chev}</a>`; }).join('')}</div></section>` : ''}`;
};
// Прочитанная книга группы: заметки и цитаты по ней (комментировать можно)
function gPastBook(g, gbId){
  const x = S.gbooks.find(y => y.id === gbId && y.group === g.id);
  if(!x) return `${backLink('#/g/' + g.id, g.name)}${notFound()}`;
  const b = x.book ? byId('books', x.book) : null;
  return `${backLink('#/g/' + g.id, g.name)}
    <header class="head"><div><p class="crumbs">Прочитанная книга группы</p><h1>${esc(b ? b.title : x.book_title)}</h1></div></header>
    <p class="hint">Читали с ${esc(fmtDate(x.started_at))} по ${esc(fmtDate(x.finished_at))}.${b && !bookNA(b) ? '' : x.book ? ' Книга временно недоступна.' : ' Книги больше нет в библиотеке.'}</p>
    ${x.book ? feedBlock(g, x.book, 'Цитаты и заметки группы') : '<p class="empty">Записи к удалённой книге не показываются.</p>'}`;
}
// Приглашение по ссылке ?group=КОД
VIEWS.join = r => {
  const code = r.id;
  if(!UI.join || UI.join.code !== code){ UI.join = {code, data: null, err: ''}; loadJoin(code); }
  const j = UI.join, head = '<header class="head"><h1>Приглашение в группу</h1></header>';
  if(j.err) return head + `<section class="card"><p>${esc(j.err)}</p><a class="btn" href="#/groups">К группам</a></section>`;
  if(!j.data) return head + '<div class="loading">Проверяю ссылку…</div>';
  const d = j.data;
  const top = `<span class="join-ic" aria-hidden="true">${ICON.people}</span><h2>${esc(d.name)}</h2>
    <p class="muted">Создатель: ${esc(d.owner || 'без имени')} · ${d.members} ${plural(d.members, MEMBERS_W)}${d.book ? ' · читаем «' + esc(d.book) + '»' : ''}</p>
    ${d.description ? `<p>${esc(d.description)}</p>` : ''}`;
  if(d.member) return head + `<section class="card join-card">${top}<p>Вы уже участник этой группы.</p><a class="btn primary big wide" href="#/g/${esc(d.id)}">Открыть группу</a></section>`;
  if(d.full) return head + `<section class="card join-card">${top}<p>В группе уже ${d.max} участников, больше вступить нельзя.</p><a class="btn wide" href="#/groups">К группам</a></section>`;
  return head + `<section class="card join-card">${top}
    <p class="hint">Участники увидят ваше имя и фото, сколько вы читаете книгу группы и где вы в ней, а ещё цитаты и заметки, которые вы сами отправите в группу. Остальные ваши заметки по-прежнему видите только вы.</p>
    ${readOnly() ? roNote() : `<button type="button" class="btn primary big wide" data-act="g-join" data-code="${esc(code)}">Вступить</button>`}
    <a class="btn ghost wide" href="#/groups">Не сейчас</a></section>`;
};
async function loadJoin(code){
  try { const d = await pb.send('/api/knigi/join/' + encodeURIComponent(code), {}); if(UI.join && UI.join.code === code) UI.join.data = d; }
  catch(e){ if(UI.join && UI.join.code === code) UI.join.err = errText(e); }
  schedule();
}
async function joinGroup(code, btn){
  if(btn) btn.disabled = true;
  try {
    const res = await pb.send('/api/knigi/join/' + encodeURIComponent(code), {method: 'POST'});
    await loadAll(G_KEYS);
    UI.join = null;
    const g = byId('groups', res.id);
    toast(g ? `Вы в группе «${g.name}»` : 'Вы вступили в группу');
    go('#/g/' + res.id, true);
  } catch(e){ toast(errText(e)); if(btn) btn.disabled = false; throw e; }
}

/* ---------- Окна групп ---------- */
// Выбор книги из библиотеки с поиском (для новой группы и следующей книги)
// Выбор книги для группы. Книгу без текста (только аудио, правки 4.3), скрытую ото всех (правки 4.1)
// и скрытую, но открытую не всем участникам (правки 4.3, blocked) выбрать нельзя: строка неактивна с подсказкой.
function bookPickHTML(q, sel, skip, blocked){
  const h = searchHits(q);
  const why = b => !bookFormats(b).length ? 'Только аудио: читать в группе нечем'
    : blocked ? (blocked.has(b.id) ? 'Книга открыта не всем участникам группы' : '')
    : b.hidden && isAdmin() && !bookReaders(b.id).length ? 'Книга скрыта ото всех читателей' : '';
  const list = (h ? h.books : [...libBooks()].sort(titleSort)).filter(b => b.id !== skip).slice(0, 60);
  return list.map(b => { const w = why(b); return w
    ? `<button type="button" class="pick-row off" disabled aria-disabled="true">${coverHTML(b, 'xs')}<span><b>${esc(b.title)}</b><small>${esc(w)}</small></span></button>`
    : `<button type="button" class="pick-row${b.id === sel ? ' on' : ''}" data-dlg="book" data-id="${b.id}" aria-pressed="${b.id === sel}">${coverHTML(b, 'xs')}<span><b>${esc(b.title)}</b><small>${esc(authorsText(b))}</small></span>${b.id === sel ? ICON.check : ''}</button>`; }).join('') || '<p class="empty">Ничего не нашлось.</p>';
}
function openNewGroup(){
  const max = S.gcfg.maxPerUser || 5;
  if(myGroups().length >= max){ info('Групп уже много', `Можно состоять не больше чем в ${max} ${plural(max, GROUPS_W)}, вместе с созданными. Чтобы создать новую, выйдите из одной из старых.`); return; }
  let q = '', sel = '';
  openForm({title: 'Новая группа', fields: [{key: 'name', label: 'Название', required: true, max: 100, placeholder: 'Например: Читаем вместе'}, {key: 'description', label: 'Описание (необязательно)', type: 'textarea', rows: 3, max: 1000}],
    html: `<div class="field"><span class="flabel">Первая книга</span><label class="search"><span class="sr">Поиск книги</span>${ICON.search}<input type="search" id="gb-q" placeholder="Название или автор" autocomplete="off"></label>
      <div class="pick-list" id="gb-list">${bookPickHTML('', '')}</div></div>`, submit: 'Создать',
    onInput(el){ if(el.id === 'gb-q'){ q = el.value; $('#gb-list').innerHTML = bookPickHTML(q, sel); } },
    onClick(el){ if(el.dataset.dlg === 'book'){ sel = el.dataset.id; $('#gb-list').innerHTML = bookPickHTML(q, sel); formErr(''); } },
    async onSave(v){
      if(!sel) throw {message: 'Выберите первую книгу группы.'};
      const res = await pb.send('/api/knigi/groups', {method: 'POST', body: {name: v.name, description: v.description, book: sel}});
      await loadAll(G_KEYS);
      toast('Группа создана'); go('#/g/' + res.id);
    }});
}
function openNextBook(g){
  let q = '', sel = '', blocked = new Set();
  const cur = g.book ? byId('books', g.book) : null;
  openForm({title: cur ? 'Следующая книга' : 'Книга группы', text: cur ? `«${cur.title}» уйдёт в прочитанные книги группы с сегодняшней датой, план по ней закроется. Её заметки и цитаты останутся доступны группе.` : 'Выберите книгу, которую группа будет читать.',
    html: `<label class="search"><span class="sr">Поиск книги</span>${ICON.search}<input type="search" id="gb-q" placeholder="Название или автор" autocomplete="off"></label><div class="pick-list" id="gb-list">${bookPickHTML('', '', g.book, blocked)}</div>`,
    submit: 'Начать эту книгу',
    onInput(el){ if(el.id === 'gb-q'){ q = el.value; $('#gb-list').innerHTML = bookPickHTML(q, sel, g.book, blocked); } },
    onClick(el){ if(el.dataset.dlg === 'book'){ sel = el.dataset.id; $('#gb-list').innerHTML = bookPickHTML(q, sel, g.book, blocked); formErr(''); } },
    async onSave(){
      if(!sel) throw {message: 'Выберите книгу.'};
      if(blocked.has(sel)) throw {message: 'Книга открыта не всем участникам группы.'};
      await pb.send(`/api/knigi/groups/${g.id}/book`, {method: 'POST', body: {book: sel}});
      await loadAll(['groups', 'gbooks', 'gmembers', 'gplan']);
      delete UI.gState[g.id]; loadGState(g.id, true);
      toast('Группа начала новую книгу');
    }});
  // скрытые книги, которые открыты не всем участникам (правки 4.3): узнаём у сервера, он видит списки
  pb.send(`/api/knigi/groups/${g.id}/blocked-books`, {}).then(r => {
    blocked = new Set(r.blocked || []);
    const el = $('#gb-list'); if(el) el.innerHTML = bookPickHTML(q, sel, g.book, blocked);
  }).catch(() => {});
}

function openInvite(g){
  const link = groupLink(g);
  openForm({title: 'Пригласить в группу',
    text: 'Отправьте ссылку тем, с кем хотите читать вместе. Вступить смогут те, у кого уже есть аккаунт в библиотеке: регистрация по-прежнему только по приглашению администратора.',
    html: `<div class="field"><label for="g-link">Ссылка на группу «${esc(g.name)}»</label><input type="text" id="g-link" readonly value="${esc(link)}"></div>
      <div class="share-btns"><button type="button" class="btn primary" data-dlg="copy">Скопировать</button>${navigator.share ? '<button type="button" class="btn" data-dlg="share">Поделиться</button>' : ''}</div>`,
    submit: 'Готово', noCancel: true, async onSave(){},
    onClick(b){
      if(b.dataset.dlg === 'copy') copyText(link);
      if(b.dataset.dlg === 'share') navigator.share({title: 'Библиотека', text: `Приглашаю в группу «${g.name}» в Библиотеке`, url: link}).catch(() => {});
    }});
}
const personRow = (uid, extra) => { const u = person(uid); return `<div class="member">${faceHTML(u, 'md')}<div class="mb-main"><b>${esc(nameOf(u))}${uid === me().id ? ' (вы)' : ''}</b>${extra || ''}</div></div>`; };
function openMembers(g){
  const own = isGroupOwner(g);
  const rows = membersOf(g.id).map(m => {
    const acts = own && m.user !== me().id ? `<div class="mb-acts"><button type="button" class="btn sm" data-dlg="owner" data-id="${esc(m.user)}">Сделать создателем</button><button type="button" class="btn sm ghost danger" data-dlg="kick" data-id="${esc(m.user)}">Исключить</button></div>` : '';
    return personRow(m.user, `<small>${m.user === g.owner ? 'создатель' : 'участник'} · с ${esc(fmtDate(m.created))}</small>` + acts);
  }).join('');
  openForm({title: 'Участники', text: own ? 'Если исключить участника, его цитаты и заметки пропадут из ленты группы и станут личными, а комментарии останутся.' : '',
    html: `<div class="members">${rows}</div>`, submit: 'Готово', noCancel: true, async onSave(){},
    async onClick(b){
      const kick = b.dataset.dlg === 'kick';
      if(!arm(b, kick ? 'Точно исключить?' : 'Точно передать?')) return;
      b.disabled = true;
      try {
        await pb.send(`/api/knigi/groups/${g.id}/${kick ? 'remove' : 'owner'}`, {method: 'POST', body: {user: b.dataset.id}});
        await loadAll(G_KEYS);
        toast(kick ? 'Участник исключён' : 'Роль создателя передана');
        const g2 = byId('groups', g.id);
        if(g2 && dlg.open && cur && cur.title === 'Участники') openMembers(g2);
      } catch(e){ toast(errText(e)); b.disabled = false; }
    }});
}
function openRenameGroup(g){
  openForm({title: 'Название и описание', fields: [{key: 'name', label: 'Название', required: true, max: 100}, {key: 'description', label: 'Описание', type: 'textarea', rows: 3, max: 1000}], values: g,
    async onSave(v){ upsert('groups', await pb.collection('groups').update(g.id, {name: v.name, description: v.description})); toast('Сохранено'); }});
}
function openNewLink(g){
  openForm({title: 'Сделать новую ссылку?', text: 'Старая ссылка сразу перестанет работать. Те, кто уже вступил, останутся в группе.', submit: 'Сделать новую',
    async onSave(){
      const res = await pb.send(`/api/knigi/groups/${g.id}/link`, {method: 'POST'});
      const g2 = {...g, invite_code: res.invite_code};
      upsert('groups', g2); thenOpen(() => openInvite(g2));
    }});
}
function leaveGroup(g){
  const own = isGroupOwner(g);
  if(own && membersOf(g.id).length > 1){
    info('Сначала передайте роль создателя', 'Создатель не может просто выйти из группы. Откройте «Участники» и нажмите «Сделать создателем» рядом с тем, кто будет вести группу. После этого можно выйти.');
    return;
  }
  openForm({title: 'Выйти из группы?', submit: 'Выйти', danger: true,
    text: own ? `Вы единственный участник, поэтому группа «${g.name}» удалится.` : `Ваши цитаты и заметки пропадут из ленты группы «${g.name}» и станут личными. Ваши комментарии останутся с подписью «Бывший участник».`,
    async onSave(){
      await pb.send(`/api/knigi/groups/${g.id}/leave`, {method: 'POST'});
      await loadAll(G_KEYS);
      toast(own ? 'Группа удалена' : 'Вы вышли из группы'); go('#/groups', true);
    }});
}
function deleteGroup(g){
  openForm({title: 'Удалить группу?', submit: 'Удалить', danger: true,
    text: `Группа «${g.name}» удалится у всех участников вместе с комментариями и планом. Цитаты и заметки участников останутся у них как личные.`,
    async onSave(){ await pb.collection('groups').delete(g.id); await loadAll(G_KEYS); toast('Группа удалена'); go('#/groups', true); }});
}
function groupMenu(btn, g){
  // без доступа (правки 4.1): только участники (передать роль создателя) и выход
  if(readOnly()){ openMenu(btn, [{label: 'Участники', run: () => openMembers(g)}, {label: 'Выйти из группы', run: () => leaveGroup(g)}]); return; }
  const own = isGroupOwner(g);
  openMenu(btn, [
    ...(own ? [{label: 'Пригласить', run: () => openInvite(g)}] : []),
    {label: 'Участники', run: () => openMembers(g)},
    ...(own && planOn() ? [{label: 'План чтения', run: () => openPlan(g)}] : []),
    ...(own ? [{label: g.book ? 'Книга прочитана, выбрать следующую' : 'Выбрать книгу', run: () => openNextBook(g)},
      {label: 'Название и описание', run: () => openRenameGroup(g)}, {label: 'Новая ссылка', run: () => openNewLink(g)}] : []),
    {label: 'Выйти из группы', danger: !own, run: () => leaveGroup(g)},
    ...(own ? [{label: 'Удалить группу', danger: true, run: () => deleteGroup(g)}] : [])
  ]);
}
// «Видно группе»: в какую группу отправить заметку или цитату (только группы, которые сейчас читают эту книгу)
function pickNoteGroup(n, done){
  const gs = groupsOfBook(n.book);
  const curG = n.group && byId('groups', n.group);
  if(curG && !gs.includes(curG)) gs.push(curG);
  if(!gs.length){ info('Нет группы с этой книгой', 'Отправить запись можно в группу, которая сейчас читает эту книгу.'); return; }
  const what = n.kind === 'highlight' ? 'цитату' : 'заметку';
  openForm({title: 'Видно группе', text: `Кто увидит эту ${what}.`,
    html: `<fieldset class="checks"><label class="check-row"><input type="radio" name="ng" value=""${!n.group ? ' checked' : ''}><span><b>Только мне</b></span></label>
      ${gs.map(g => `<label class="check-row"><input type="radio" name="ng" value="${g.id}"${n.group === g.id ? ' checked' : ''}><span><b>Группе «${esc(g.name)}»</b><small>${membersOf(g.id).length} ${plural(membersOf(g.id).length, MEMBERS_W)}${g.book !== n.book ? ' · прошлая книга группы' : ''}</small></span></label>`).join('')}</fieldset>`,
    async onSave(){
      const v = (form.querySelector('input[name=ng]:checked') || {}).value || '';
      if(v === (n.group || '')) return;
      const rec = await pb.collection('notes').update(n.id, {group: v}, {fields: hlFields});
      upsert('notes', hlStrip(rec));
      if(done) done(rec);
      toast(v ? `Видно группе «${(byId('groups', v) || {}).name || ''}»` : 'Теперь видно только вам');
    }});
}

/* ---------- Комментарии ---------- */
function commentsHTML(n){
  if(!n || !n.group || !myMember(n.group)) return '';
  const g = byId('groups', n.group), list = commentsOf(n.id), own = isGroupOwner(g);
  const prev = UI.gPrev[n.group] || '';
  const rows = list.map(c => {
    const mine = c.user === me().id, member = isMemberOf(n.group, c.user), u = person(c.user);
    const canDel = mine || n.owner === me().id || own;
    const editing = UI.cmEdit === c.id;
    return `<div class="cm${prev && !mine && String(c.created) > prev ? ' new' : ''}" id="cm-${c.id}">${member ? faceHTML(u, 'sm') : '<span class="face sm gone" aria-hidden="true">?</span>'}
      <div class="cm-main"><div class="cm-head"><b>${member ? esc(nameOf(u)) + (mine ? ' (вы)' : '') : 'Бывший участник'}</b><small>${esc(agoText(c.created))}${c.edited ? ' · изменено' : ''}</small></div>
        ${editing ? `<textarea id="cm-edit" rows="3" maxlength="2000" aria-label="Изменить комментарий">${esc(c.text)}</textarea><div class="cm-acts"><button type="button" class="btn sm primary" data-act="cm-save" data-id="${c.id}">Сохранить</button><button type="button" class="btn sm ghost" data-act="cm-cancel">Отмена</button></div>`
          : `<p class="cm-text">${linkify(c.text)}</p>${mine || canDel ? `<div class="cm-acts">${mine ? `<button type="button" class="linkbtn sm" data-act="cm-edit" data-id="${c.id}">Изменить</button>` : ''}${canDel ? `<button type="button" class="linkbtn sm danger" data-act="cm-del" data-id="${c.id}">Удалить</button>` : ''}</div>` : ''}`}</div></div>`;
  }).join('');
  return `<section class="card comments" id="cm-box" data-note="${n.id}"><h2>Комментарии${list.length ? ` <span class="n">${list.length}</span>` : ''}</h2>
    <p class="hint sm">Видят участники группы «${esc(g ? g.name : '')}».</p>
    ${rows ? `<div class="cm-list">${rows}</div>` : ''}
    ${readOnly() ? roNote() : `<div class="cm-form"><label class="sr" for="cm-text">Комментарий</label><textarea id="cm-text" rows="2" maxlength="2000" placeholder="Написать комментарий">${esc(UI.cmDraft[n.id] || '')}</textarea>
      <button type="button" class="btn primary" data-act="cm-send" data-id="${n.id}">Отправить</button></div>`}</section>`;
}
// Перерисовать только комментарии (экран заметки с редактором не перерисовывается целиком)
function cmPaint(){
  const box = $('#cm-box'); if(!box) return;
  const n = byId('notes', box.dataset.note) || (ED.rec && ED.rec.id === box.dataset.note ? ED.rec : null);
  const act = document.activeElement, fid = act && (act.id === 'cm-text' || act.id === 'cm-edit') ? act.id : '';
  const pos = fid ? act.selectionStart : 0, editVal = fid === 'cm-edit' ? act.value : null;
  const html = commentsHTML(n);
  if(!html){ box.remove(); return; }
  box.outerHTML = html;
  if(editVal != null){ const e = $('#cm-edit'); if(e) e.value = editVal; }
  if(fid){ const el = document.getElementById(fid); if(el){ el.focus(); try { el.setSelectionRange(pos, pos); } catch(e){} } }
}
async function cmSend(noteId, btn){
  const ta = $('#cm-text'), text = ta ? ta.value.trim() : '';
  if(!text){ toast('Напишите комментарий.'); return; }
  if(text.length > 2000){ toast('Комментарий длиннее 2000 знаков.'); return; }
  btn.disabled = true;
  try {
    upsert('comments', await pb.collection('note_comments').create({note: noteId, user: me().id, text}));
    UI.cmDraft[noteId] = ''; if(ta) ta.value = '';
    cmPaint();
  } catch(e){ toast(errText(e)); }
  finally { btn.disabled = false; }
}
async function cmSave(id){
  const ta = $('#cm-edit'), text = ta ? ta.value.trim() : '';
  if(!text){ toast('Комментарий пустой. Чтобы убрать его, нажмите «Удалить».'); return; }
  try { upsert('comments', await pb.collection('note_comments').update(id, {text})); UI.cmEdit = ''; cmPaint(); } catch(e){ toast(errText(e)); }
}
async function cmDelete(id, btn){
  if(!arm(btn, 'Удалить?')) return;
  try { await pb.collection('note_comments').delete(id); removeLocal('comments', id); cmPaint(); toast('Комментарий удалён'); } catch(e){ toast(errText(e)); }
}

/* ---------- Профиль ---------- */
VIEWS.profile = () => {
  const u = me();
  const inv = S.invites.slice().sort((a, b) => String(b.created).localeCompare(String(a.created)));
  const myNotes = S.notes.filter(n => n.owner === u.id).length;
  const used = i => (i.used_by || []).map(id => S.users.find(x => x.id === id)).filter(Boolean);
  const reading = S.marks.filter(m => m.status === 'reading' && byId('books', m.book)).sort((a, b) => String(b.started_at || b.updated).localeCompare(String(a.started_at || a.updated)));
  const finished = S.marks.filter(m => m.status === 'finished' && byId('books', m.book)).sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at)) || String(b.updated).localeCompare(String(a.updated)));
  const FIN_SHOW = 5;
  const offers = myOffers(), waiting = offers.filter(o => o.status === 'pending').length;
  return `<header class="head"><h1>Профиль</h1></header>
    ${!isAdmin() && waiting ? '<p class="offer-sent">Ваша книга отправлена на проверку. Обычно это занимает около суток.</p>' : ''}
    <section class="card me-card">
      <button type="button" class="face-btn" data-act="avatar" aria-label="Фото профиля" aria-haspopup="menu" title="Фото профиля">${faceHTML(u, 'lg')}<span class="face-cam" aria-hidden="true">${ICON.camera}</span></button>
      <div class="who"><b>${esc(u.name || 'Без имени')}</b><span>${esc(u.email || '')}</span><small>${isAdmin() ? 'Администратор библиотеки' : 'Читатель'}</small></div>
      ${readOnly() ? '' : `<button type="button" class="icon-btn" data-act="edit-name" aria-label="Изменить имя" title="Изменить имя">${ICON.pen}</button>`}</section>
    ${S.access && !isAdmin() ? `<p class="acc-line${S.access.active ? '' : ' off'}">${accessLine()}</p>` : ''}
    <section class="card"><h2>Читаю${reading.length ? ` <span class="n">${reading.length}</span>` : ''}</h2>
      ${reading.length ? `<div class="rows">${reading.map(m => bookRow(byId('books', m.book))).join('')}</div>` : '<p class="empty">Отметьте книгу «Читаю» в её карточке.</p>'}</section>
    <section class="card"><h2>Прочитанные${finished.length ? ` <span class="n">${finished.length}</span>` : ''}</h2>
      ${finished.length ? `<div class="rows">${(UI.finAll ? finished : finished.slice(0, FIN_SHOW)).map(m => bookRow(byId('books', m.book), `<small class="fin-day">прочитана ${esc(fmtDate(m.finished_at))}</small>`)).join('')}</div>
        ${finished.length > FIN_SHOW ? `<button type="button" class="btn sm ghost" data-act="fin-all">${UI.finAll ? 'Свернуть' : 'Показать все · ' + finished.length}</button>` : ''}` : '<p class="empty">Здесь появятся книги с отметкой «Прочитано».</p>'}</section>
    ${isAdmin() ? '' : `<section class="card"><div class="block-h"><h2>Мои предложенные книги</h2></div>
      ${offers.length ? `<div class="rows">${offers.map(offerRow).join('')}</div>` : '<p class="hint">Если в библиотеке нет нужной книги, предложите её. Администратор проверит и добавит.</p>'}
      ${readOnly() ? roNote() : `<button type="button" class="btn" data-act="offer-book">${ICON.upload}<span>Предложить книгу</span></button>`}</section>`}
    <section class="card"><h2>Оформление</h2>
      <div class="seg3" role="radiogroup" aria-label="Тема">${[['light','Светлая'],['dark','Тёмная'],['auto','Как в системе']].map(([k, l]) =>
        `<input type="radio" name="p-theme" id="p-theme-${k}" value="${k}"${themePref() === k ? ' checked' : ''}><label for="p-theme-${k}">${l}</label>`).join('')}</div></section>
    <nav class="links">
      <a href="#/notes">${ICON.notes}${isAdmin() ? 'Мои заметки и уроки' : 'Мои заметки'}<span class="n">${myNotes}</span>${ICON.chev}</a>
      ${isAdmin() ? `<a href="#/review">${ICON.inbox}На проверке<span class="n${reviewCount() ? ' hot' : ''}">${reviewCount()}</span>${ICON.chev}</a>` : ''}
      ${isAdmin() ? `<a href="#/log">${ICON.log}Журнал чтения${ICON.chev}</a>` : ''}
      ${isAdmin() ? `<a href="#/ai">${ICON.ai}Подключение к ИИ${ICON.chev}</a>` : ''}
    </nav>
    ${isAdmin() ? `<p class="hint">Групп в библиотеке: ${S.gcount == null ? '…' : S.gcount}</p>` : ''}
    ${isAdmin() ? ocrSection() : ''}
    ${isAdmin() ? `<details class="fold" id="inv-fold"${UI.invOpen ? ' open' : ''}><summary><span>Приглашения</span>${ICON.chev}</summary><div class="fold-body">
      <p class="hint">Новый человек может зарегистрироваться только по приглашению. Создайте его и отправьте ссылку.</p>
      <div class="field"><label for="i-note">Для кого (заметка)</label><input type="text" id="i-note" placeholder="Например: мама"></div>
      <div class="field"><label for="i-max">Сколько регистраций</label><select id="i-max"><option value="1">1 человек</option><option value="5">до 5 человек</option><option value="0">без ограничения</option></select></div>
      <div class="field"><label for="i-exp">Действует до (необязательно)</label><input type="date" id="i-exp"></div>
      <div class="field"><label for="i-period">Срок доступа для новых пользователей</label><select id="i-period">${Object.entries(ACC_PERIODS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <button type="button" class="btn primary" data-act="new-invite">Создать и скопировать ссылку</button>
      <div>${inv.length ? inv.map(i => `<div class="inv"><code>${esc(i.code)}</code><span class="muted">${i.note ? esc(i.note) + ' · ' : ''}использовано ${i.uses || 0}${i.max_uses > 0 ? ' из ' + i.max_uses : ', без ограничения'}${i.expires ? ' · до ' + fmtDate(i.expires) : ''} · доступ ${esc(ACC_PERIODS[i.access_period || ''] || i.access_period)}</span>
        ${used(i).length ? `<span class="inv-who">${used(i).map(x => `<span class="who-chip">${faceHTML(x, 'xs')}${esc(x.name || x.email)}</span>`).join('')}</span>` : ''}
        <div class="acts"><button type="button" class="btn sm" data-act="copy-invite" data-code="${esc(i.code)}">Скопировать ссылку</button><button type="button" class="btn sm ghost danger" data-act="del-invite" data-id="${esc(i.id)}">Удалить</button></div></div>`).join('') : '<p class="hint">Приглашений пока нет.</p>'}</div>
    </div></details>
    ${usersSection()}` : ''}
    <details class="fold"><summary><span>Сменить пароль</span>${ICON.chev}</summary><div class="fold-body">
      <div class="field"><label for="p-old">Текущий пароль</label><input type="password" id="p-old" autocomplete="current-password"></div>
      <div class="field"><label for="p-new">Новый пароль (не короче 8 символов)</label><input type="password" id="p-new" autocomplete="new-password"></div>
      <div class="field"><label for="p-new2">Повторите новый</label><input type="password" id="p-new2" autocomplete="new-password"></div>
      <button type="button" class="btn" data-act="save-pass">Сменить пароль</button></div></details>
    ${isAdmin() && S.disk ? `<p class="hint">Книг: ${S.disk.count}, ${fsize(S.disk.books || 1)}.${S.disk.audio_count ? ` Глав аудио: ${S.disk.audio_count}, ${fsize(S.disk.audio || 1)}.` : ''} Свободно на диске сервера ${fsize(S.disk.free)}.</p>` : ''}
    <button type="button" class="btn wide" data-act="logout">Выйти</button>
    <p class="hint"><a href="/privacy.html" target="_blank" rel="noopener">Политика конфиденциальности</a></p>`;
};
/* ---------- Раздел «Пользователи»: срок доступа (правки 4.1, только администратору) ---------- */
const ACC_PERIODS = {'': 'бессрочно', '1m': '1 месяц', '3m': '3 месяца', '6m': '6 месяцев'};
const ACC_DONE = {extend: 'Доступ продлён', set: 'Дата доступа изменена', unlimited: 'Доступ бессрочный', suspend: 'Доступ приостановлен', resume: 'Доступ возобновлён', note: 'Заметка сохранена',
  mark_off: 'Подпись на страницах выключена', mark_on: 'Подпись на страницах включена'};
const ACC_LOG = {set: 'новая дата', unlimited: 'бессрочно', suspend: 'приостановлен', resume: 'возобновлён', note: 'заметка', mark_off: 'Подпись выключена', mark_on: 'Подпись включена'};
function accLogText(a){
  const m = /^extend:(\d+)$/.exec(a || '');
  return m ? `продлён на ${m[1]} ${plural(+m[1], MONTHS_W)}` : ACC_LOG[a] || a;
}
function userState(x, today){
  if(x.role === 'admin') return '<span class="tag">администратор</span>';
  if(x.suspended) return '<span class="tag bad">приостановлен</span>';
  if(x.access_until && today && x.access_until < today) return `<span class="tag bad">срок закончился ${fmtDay(x.access_until)}</span>`;
  if(!x.access_until) return '<span class="tag ok">бессрочно</span>';
  const k = today ? Math.round(dnum(x.access_until) - dnum(today)) : 99;
  return `<span class="tag${k <= 7 ? ' warn' : ' ok'}">до ${fmtDay(x.access_until)}${k <= 7 ? ', ' + leftText(k) : ''}</span>`;
}
const untilText = d => d ? fmtDay(d) : 'бессрочно';
function usersSection(){
  const t = S.access && S.access.today;
  // сначала без доступа, потом с датой (ближайшие сверху), потом бессрочные, вы в конце
  const rank = x => x.role === 'admin' ? 3 : x.active === false ? 0 : x.access_until ? 1 : 2;
  const list = S.users.slice().sort((a, b) => rank(a) - rank(b) || (a.access_until || '').localeCompare(b.access_until || '') || collator.compare(a.name || a.email || '', b.name || b.email || ''));
  return `<details class="fold" id="users-fold"${UI.usersOpen ? ' open' : ''}><summary><span>Пользователи · ${S.users.length}</span>${ICON.chev}</summary><div class="fold-body">
    <p class="hint">Когда срок доступа заканчивается или вы ставите паузу, человек видит карточки книг, полки и свои записи, но книги не открываются, а добавлять и менять ничего нельзя. Всё сохраняется, после продления работает как раньше. Продление считается от даты окончания, если она ещё не прошла, иначе от сегодня (по времени Хабаровска).</p>
    <div class="users">${list.map(x => {
      const id = esc(x.id), adm = x.role === 'admin';
      const log = (x.log || []).map(l => `<li><span class="d">${fmtDate(l.created)}</span> ${esc(accLogText(l.action))}${l.until_before !== l.until_after ? `: ${untilText(l.until_before)} → ${untilText(l.until_after)}` : ''}${l.note ? ` · ${esc(l.note)}` : ''}${l.by ? ` <span class="muted">(${esc(l.by)})</span>` : ''}</li>`).join('');
      return `<div class="usr">
        <div class="usr-head">${faceHTML(x, 'md')}
          <div class="usr-main"><b>${esc(x.name || x.email)}</b><span class="muted">${x.name ? esc(x.email) + ' · ' : ''}${adm ? 'администратор' : 'читатель'} · с ${esc(fmtDate(x.created))}</span><span>${userState(x, t)}${x.no_mark ? ' <span class="tag nomark">без подписи</span>' : ''}</span></div></div>
        ${adm ? '' : `<div class="usr-acts">${[1, 3, 6].map(m => `<button type="button" class="btn sm" data-act="acc" data-action="extend" data-months="${m}" data-id="${id}">+${m} ${plural(m, MONTHS_W)}</button>`).join('')}${x.suspended ? `<button type="button" class="btn sm" data-act="acc" data-action="resume" data-id="${id}">Возобновить</button>` : `<button type="button" class="btn sm ghost danger" data-act="acc" data-action="suspend" data-id="${id}">Приостановить</button>`}</div>
          <label class="check-chip sm usr-mark"><input type="checkbox" data-nomark="${id}"${x.no_mark ? ' checked' : ''}><span>Без подписи на страницах</span></label>
          ${userBooksHTML(x.id)}`}
        <details class="usr-more"${UI.openUser === x.id ? ' open' : ''} data-user="${id}"><summary>${adm ? 'Заметки' : 'Дата, заметка и история'}</summary>
          ${adm ? '' : `<div class="usr-row"><div class="field"><label for="ud-${id}">Доступ до (своя дата)</label><input type="date" id="ud-${id}" value="${esc(x.access_until || '')}"></div><div class="usr-btns"><button type="button" class="btn sm" data-act="acc" data-action="set" data-id="${id}">Поставить дату</button><button type="button" class="btn sm ghost" data-act="acc" data-action="unlimited" data-id="${id}">Бессрочно</button></div></div>`}
          <div class="usr-row"><div class="field"><label for="un-${id}">Заметка (видите только вы; добавится и к продлению)</label><input type="text" id="un-${id}" maxlength="1000" placeholder="Например: оплатил 500 ₽ 1 ноября"></div><div class="usr-btns"><button type="button" class="btn sm ghost" data-act="acc" data-action="note" data-id="${id}">Сохранить заметку</button></div></div>
          ${log ? `<ul class="usr-log">${log}</ul>` : '<p class="hint">Истории пока нет.</p>'}
        </details>
      </div>`;
    }).join('') || '<p class="hint">Пока никого.</p>'}</div>
    <p class="hint">Удалить пользователя совсем можно в панели администратора: <a href="/_/" target="_blank" rel="noopener">${esc(location.host)}/_/</a>, коллекция users.</p>
  </div></details>`;
}
// «Книги, открытые лично» (правки 4.3): скрытые книги, открытые этому читателю, с крестиком «Убрать»
function userBooksHTML(uid){
  const list = S.bacc.filter(x => x.user === uid).map(x => byId('books', x.book)).filter(Boolean).sort(titleSort);
  return `<div class="usr-books"><span class="flabel">Книги, открытые лично</span>${list.length ? `<div class="chips">${list.map(b => `<span class="chip ub-chip"><a href="#/b/${b.id}">${esc(b.title)}</a>${b.hidden ? '' : '<small>видна всем</small>'}<button type="button" class="ub-x" data-act="acc-book-rm" data-user="${esc(uid)}" data-book="${b.id}" aria-label="Убрать «${esc(b.title)}»" title="Убрать">${ICON.close}</button></span>`).join('')}</div>` : '<span class="hint">нет</span>'}</div>`;
}
async function loadInvites(){ try { S.invites = await pb.collection('invites').getFullList(); schedule(); } catch(e){} }
async function loadUsers(){ try { S.users = await pb.send('/api/knigi/admin/users', {}); schedule(); } catch(e){} }
async function loadGroupCfg(){ try { S.gcfg = await pb.send('/api/knigi/group-config', {}); } catch(e){} }
async function loadGCount(){ if(!isAdmin()) return; try { S.gcount = (await pb.send('/api/knigi/admin/groups-count', {})).count; schedule(); } catch(e){} }
async function loadOwner(){ try { S.owner = await pb.send('/api/knigi/owner', {}); schedule(); } catch(e){} }
async function loadDisk(){ if(!isAdmin()) return; try { S.disk = await pb.send('/api/knigi/disk', {}); schedule(); } catch(e){} }

/* ---------- Распознавание текста в сканах (правки 3.1, только администратор) ---------- */
// Очередь живёт на сервере. Пока открыт профиль или карточка книги, а в очереди что-то есть,
// приложение раз в 6 секунд спрашивает, как идут дела: страница и примерное время до конца.
async function loadOcr(){ if(!isAdmin()) return; try { S.ocr = await pb.send('/api/knigi/ocr', {}); schedule(); } catch(e){} }
const ocrActive = () => !!(S.ocr && S.ocr.jobs.some(j => j.status === 'queued' || j.status === 'running'));
setInterval(() => {
  if(!S.loaded || !isAdmin() || document.visibilityState !== 'visible' || !ocrActive()) return;
  const n = route().name;
  if(n === 'profile' || n === 'b') loadOcr();
}, 6000);
// «примерно 1 ч 20 мин»
function durText(sec){
  sec = Math.max(0, Math.round(sec));
  if(sec < 90) return 'меньше 2 минут';
  const m = Math.round(sec / 60);
  if(m < 60) return `${m} мин`;
  const h = Math.floor(m / 60), mm = m % 60;
  if(h < 48) return `${h} ч${mm ? ' ' + mm + ' мин' : ''}`;
  return `${Math.round(h / 24)} ${plural(Math.round(h / 24), ['день', 'дня', 'дней'])}`;
}
const OCR_LANG = {rus: 'русский', eng: 'английский', grc: 'древнегреческий', ell: 'греческий', deu: 'немецкий', fra: 'французский', ukr: 'украинский', lat: 'латынь', heb: 'иврит'};
// «примерно 20 мин» или «меньше 2 минут»
const aboutDur = sec => sec < 90 ? 'меньше 2 минут' : 'примерно ' + durText(sec);
const ocrJobOf = fileId => S.ocr && S.ocr.jobs.find(j => j.file === fileId && (j.status === 'queued' || j.status === 'running'));
// Сколько осталось у текущей книги: по скорости этой книги, а пока её нет, по средней
function ocrLeft(j){
  const sec = j.sec_page || (S.ocr && S.ocr.sec_page) || 10;
  return Math.max(0, (j.pages || 0) - (j.done || 0)) * sec;
}
function ocrProgress(j){
  if(j.status === 'queued') return 'В очереди на распознавание';
  if(S.ocr && S.ocr.paused) return `Пауза: сервер обрабатывает новую книгу. Готово ${j.done} из ${j.pages} стр.`;
  if(j.stage === 'merge') return 'Почти готово: собираю файл книги';
  return `Распознаётся: стр. ${j.done} из ${j.pages}${j.done ? ', осталось ' + aboutDur(ocrLeft(j)) : ''}`;
}
// В карточке: кнопка у скана без текста или ход работы
function ocrCardHTML(b, f){
  if(!scanFile(f)) return '';
  const j = ocrJobOf(f.id);
  if(j) return `<div class="ocr-box"><p class="hint">${esc(ocrProgress(j))}</p>${j.status === 'running' && j.pages ? `<span class="prog wide"><i style="width:${Math.round(j.done / j.pages * 100)}%"></i></span>` : ''}
    <button type="button" class="btn sm ghost" data-act="ocr-cancel" data-id="${j.id}">Отменить</button></div>`;
  if(S.ocr && !S.ocr.available) return '<p class="hint">Распознавание текста недоступно: на сервере не установлена программа. Запустите обновление приложения.</p>';
  const sec = (S.ocr && S.ocr.sec_page) || 10;
  return `<div class="ocr-box"><button type="button" class="btn" data-act="ocr-book" data-id="${b.id}">${ICON.ocr}<span>Распознать текст</span></button>
    <p class="hint">После распознавания в книге можно будет сохранять цитаты и искать текст. ${f.pages ? `Займёт ${aboutDur(f.pages * sec)}.` : ''}</p></div>`;
}
function ocrSection(){
  const st = S.ocr;
  if(!st) return '<section class="card"><h2>Распознавание текста</h2><p class="hint">Загружаю…</p></section>';
  const run = st.jobs.filter(j => j.status === 'running'), queue = st.jobs.filter(j => j.status === 'queued');
  const past = st.jobs.filter(j => j.status !== 'running' && j.status !== 'queued');
  const titleOf = j => { const b = byId('books', j.book); return b ? `<a href="#/b/${b.id}">${esc(b.title)}</a>` : `<span>${esc(j.title || 'Книга удалена')}</span>`; };
  const rowRun = j => `<div class="ocr-row"><div class="ocr-t">${titleOf(j)}<small>${esc(ocrProgress(j))}</small>
      ${j.pages ? `<span class="prog wide"><i style="width:${Math.round(j.done / j.pages * 100)}%"></i></span>` : ''}</div>
    <button type="button" class="btn sm ghost" data-act="ocr-cancel" data-id="${j.id}">Отменить</button></div>`;
  const rowQ = j => `<div class="ocr-row"><div class="ocr-t">${titleOf(j)}<small>В очереди · ${j.pages} ${plural(j.pages, PAGES_W)}</small></div>
    <button type="button" class="btn sm ghost" data-act="ocr-cancel" data-id="${j.id}">Отменить</button></div>`;
  const rowPast = j => `<div class="ocr-row"><div class="ocr-t">${titleOf(j)}<small class="${j.status === 'error' ? 'form-err' : ''}">${
    j.status === 'done' ? `Готово ${esc(fmtDate(j.finished_at))} · ${j.pages} ${plural(j.pages, PAGES_W)}` :
    j.status === 'error' ? `Ошибка ${esc(fmtDate(j.finished_at))}: ${esc(j.error || 'причина неизвестна')}` :
    `Отменено ${esc(fmtDate(j.finished_at))}${j.error ? ': ' + esc(j.error) : ''}`}</small></div></div>`;
  const waitPages = queue.reduce((n, j) => n + (j.pages || 0), 0);
  const total = run.reduce((n, j) => n + ocrLeft(j), 0) + waitPages * (st.sec_page || 10);
  return `<section class="card ocr-card"><h2>Распознавание текста</h2>
    ${!st.available ? '<p class="form-err">На сервере не установлена программа распознавания. Запустите обновление приложения (update.sh).</p>' : ''}
    <p class="hint">Сканы без текста превращаются в книги с текстом: в них можно сохранять цитаты, их найдёт поиск и Claude. Работа идёт в фоне по одной книге. Языки: ${esc(st.langs.split('+').map(l => OCR_LANG[l] || l).join(', '))}.</p>
    ${run.length || queue.length ? `<div class="rows">${run.map(rowRun).join('')}${queue.map(rowQ).join('')}</div>
      ${queue.length ? `<p class="hint">Вся очередь займёт ${aboutDur(total)}.</p>` : ''}` : ''}
    ${st.scans.count ? `<button type="button" class="btn" data-act="ocr-all">${ICON.ocr}<span>Распознать все сканы · ${st.scans.count}</span></button>`
      : !run.length && !queue.length ? '<p class="hint">Сканов без текста, которые ждут распознавания, нет.</p>' : ''}
    ${past.length ? `<details class="fold"${UI.ocrPast ? ' open' : ''} id="ocr-past"><summary><span>Готовые и ошибки · ${past.length}</span>${ICON.chev}</summary><div class="fold-body rows">${past.map(rowPast).join('')}</div></details>` : ''}
  </section>`;
}
async function ocrBook(id){
  try { const r = await pb.send(`/api/knigi/books/${id}/ocr`, {method: 'POST'}); S.ocr = r.state; toast('Книга встала в очередь на распознавание'); render(); }
  catch(e){ toast(errText(e)); }
}
function ocrAllAsk(){
  const st = S.ocr; if(!st) return;
  const n = st.scans.count, pages = st.scans.pages;
  openForm({title: 'Распознать все сканы?', text: `В очередь ${plural(n, ['встанет', 'встанут', 'встанут'])} ${n} ${plural(n, BOOKS_W)} без текста, всего ${pages} ${plural(pages, PAGES_W)}. Это займёт ${aboutDur(pages * (st.sec_page || 10))}: сервер распознаёт по одной книге в фоне с низким приоритетом, остальные приложения не тормозят. Любую книгу можно отменить.`,
    submit: 'Распознать', async onSave(){
      const r = await pb.send('/api/knigi/ocr/all', {method: 'POST'});
      S.ocr = r.state; toast(r.added ? `В очереди: ${r.added} ${plural(r.added, BOOKS_W)}` : 'Новых сканов для очереди нет'); render();
    }});
}
async function ocrCancel(id, btn){
  if(btn && !arm(btn, 'Точно отменить?')) return;
  try { const r = await pb.send(`/api/knigi/ocr/${id}/cancel`, {method: 'POST'}); S.ocr = r.state; toast('Распознавание отменено, книга осталась как была'); render(); }
  catch(e){ toast(errText(e)); }
}

/* ---------- Подключение к ИИ-помощникам (этап 4, только администратор) ---------- */
// Адрес сервера MCP, как подключить Claude, ChatGPT и Perplexity, список подключений с «Отключить»
// и журнал последних 100 обращений. Данные даёт маршрут /api/knigi/admin/mcp.
const MCP_TOOL = {search_books: 'поиск книг', list_shelves: 'полки', get_book: 'книга', read_book: 'текст книги', search_in_books: 'поиск в тексте',
  list_notes: 'заметки', get_note: 'заметка', list_groups: 'группы', get_group_notes: 'заметки группы', create_note: 'новая заметка', search: 'поиск', fetch: 'найденное'};
VIEWS.ai = () => {
  if(!isAdmin()) return notFound();
  const M = UI.mcp;
  const head = `${backLink('#/profile', 'Профиль')}<header class="head"><h1>Подключение к ИИ</h1></header>`;
  if(!M){ loadMcp(); return head + '<div class="loading">Загружаю…</div>'; }
  if(!UI.mcpBusy && Date.now() - (UI.mcpAt || 0) > 15000) setTimeout(loadMcp, 0); // при каждом заходе свежий список
  const url = M.url;
  const step = (name, items) => `<details class="fold ai-how"><summary><span>${name}</span>${ICON.chev}</summary><div class="fold-body"><ol class="ai-steps">${items.map(x => `<li>${x}</li>`).join('')}</ol></div></details>`;
  const conns = M.connections || [];
  return head + `
    ${M.enabled ? '' : '<p class="form-err">Подключение выключено на сервере (MCP_ENABLED=0): помощники не войдут, пока вы не включите его в knigi.env.</p>'}
    <section class="card"><h2>Адрес библиотеки для помощника</h2>
      <p class="hint">Claude, ChatGPT или Perplexity смогут искать книги, читать их текст, ваши заметки, цитаты и заметки групп, а также сохранять новые заметки с пометкой «Создано …». Подключать можете только вы.</p>
      <div class="ai-url"><code>${esc(url)}</code><button type="button" class="btn sm" data-act="mcp-copy">Скопировать</button></div>
      ${step('Claude', ['claude.ai → «Настройки» → «Коннекторы» → «Добавить свой коннектор».', 'Название: Библиотека. Адрес: вставьте адрес выше. Нажмите «Добавить».', 'Нажмите «Подключить»: откроется окно «Библиотеки». Войдите и нажмите «Разрешить».', 'В новом чате откройте меню инструментов (кнопка «+» или значок с ползунками) и включите «Библиотека». На iPhone так же, коннектор уже будет в списке.'])}
      ${step('ChatGPT', ['chatgpt.com → «Настройки» → «Приложения и коннекторы» → «Дополнительные настройки» → включите «Режим разработчика».', 'Там же «Создать»: название Библиотека, адрес выше, вход OAuth. Отметьте, что доверяете приложению, нажмите «Создать».', 'Откроется окно «Библиотеки»: войдите и нажмите «Разрешить».', 'В новом чате: «+» → «Режим разработчика» → включите «Библиотека». В приложении на iPhone коннектор появится сам после входа тем же аккаунтом.'])}
      ${step('Perplexity', ['perplexity.ai → «Настройки» → «Коннекторы» → «+ Свой коннектор» → Remote (удалённый).', 'Название: Библиотека. Адрес выше, вход OAuth, транспорт Streamable HTTP. Сохраните.', 'Нажмите «Подключить»: войдите в окне «Библиотеки» и нажмите «Разрешить».', 'В строке запроса откройте список источников и включите «Библиотека». В приложении на iPhone так же.'])}
    </section>
    <section class="card"><h2>Подключения${conns.length ? ` <span class="n">${conns.length}</span>` : ''}</h2>
      ${conns.length ? `<div class="rows">${conns.map(c => `<div class="ai-conn">${ICON.ai}<span class="ai-t"><b>${esc(c.service || c.host)}</b>
          <small>подключено ${esc(fmtWhen(c.created))} · ${c.last_used ? 'последний раз ' + esc(fmtWhen(c.last_used)) : 'ещё не пользовались'}</small></span>
          <button type="button" class="btn sm ghost danger" data-act="mcp-off" data-id="${esc(c.id)}">Отключить</button></div>`).join('')}</div>
        <p class="hint">«Отключить» сразу закрывает доступ этому подключению. Чтобы помощник снова работал, подключите его заново.</p>`
        : '<p class="empty">Подключений пока нет.</p>'}
    </section>
    <section class="card"><h2>Последние обращения</h2>
      ${(M.log || []).length ? `<div class="ai-log">${(UI.mcpAll ? M.log : M.log.slice(0, 20)).map(l => `<div class="ai-row${l.error ? ' bad' : ''}"><span class="ai-when">${esc(fmtWhen(l.created))}</span>
          <span class="ai-what"><b>${esc(l.service)}</b> · ${esc(MCP_TOOL[l.tool] || l.tool)}${l.book ? ` · ${byId('books', l.book) ? `<a href="#/b/${esc(l.book)}">${esc(l.book_title)}</a>` : esc(l.book_title)}` : ''}${l.note ? `<br><small>${esc(l.note)}</small>` : ''}</span></div>`).join('')}</div>
        ${M.log.length > 20 ? `<button type="button" class="btn sm ghost" data-act="mcp-all">${UI.mcpAll ? 'Свернуть' : 'Показать все · ' + M.log.length}</button>` : ''}
        <p class="hint">Здесь последние 100 обращений, журнал хранится 90 дней.</p>` : '<p class="empty">Обращений пока не было.</p>'}
    </section>`;
};
async function loadMcp(){
  if(UI.mcpBusy) return; UI.mcpBusy = true;
  try { UI.mcp = await pb.send('/api/knigi/admin/mcp', {}); UI.mcpAt = Date.now(); }
  catch(e){ UI.mcp = {url: location.origin + '/mcp', enabled: true, connections: [], log: []}; toast(errText(e)); }
  finally { UI.mcpBusy = false; render(true); }
}
async function mcpOff(id, btn){
  if(btn && !arm(btn, 'Точно отключить?')) return;
  try { await pb.send('/api/knigi/admin/mcp/' + encodeURIComponent(id), {method: 'DELETE'}); toast('Помощник отключён'); UI.mcp = null; render(true); }
  catch(e){ toast(errText(e)); }
}

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
          <span class="lr-num">${r.pages_seen || !r.listen_sec ? `${r.pages_seen} ${plural(r.pages_seen, ['стр.', 'стр.', 'стр.'])}<br>${fsize(r.bytes_sent || 0)}` : ''}${r.listen_sec ? `${r.pages_seen ? '<br>' : ''}слушал ${minText(r.listen_sec)}` : ''}${r.over_limit ? '<br><b>лимит</b>' : ''}</span>
          ${r.listen_sec && (r.listen || []).length ? `<span class="lr-listen">${ICON.head}${(r.listen || []).map(x => `${esc(x.t)} (${minText(x.s)})`).join(', ')}</span>` : ''}</div>`; }).join('')}</section>`).join('') : '<p class="empty">За это время записей нет.</p>'}`;
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
  // без доступа (правки 4.1) своя заметка открывается только для чтения
  if(isNew && readOnly()) return `${backLink(bookId ? '#/b/' + bookId : '#/notes', 'Назад')}<section class="card">${roNote()}</section>`;
  const fromG = r.q.get('g') ? byId('groups', r.q.get('g')) : null; // открыли из ленты группы: «Назад» в группу
  const back = fromG ? '#/g/' + fromG.id : b ? '#/b/' + b.id + (kind === 'lesson' ? '?tab=lessons' : '') : '#/notes';
  const backText = fromG ? fromG.name : b ? b.title : 'Заметки';
  if(!isNew && n.kind === 'highlight') return hlPage(n, b, own, back, backText);
  const page = isNew ? (+r.q.get('page') || '') : (n.page || '');
  const ctx = isNew && UI.noteCtx && UI.noteCtx.book === bookId ? UI.noteCtx : null;
  const pf0 = b ? pageFileOf(b.id) : null;
  const fmt = isNew ? (ctx ? ctx.format : (pf0 ? pf0.format : '')) : (n.format || (n.page ? (pf0 ? pf0.format : 'pdf') : ''));
  const bookLine = b ? `<a href="#/b/${b.id}">${noteBookText(n || {}, b)}</a>` : n ? noteBookText(n, null) || '<span class="muted">Без книги</span>' : '<span class="muted">Без книги</span>';
  // страница относится к PDF или DjVu этой заметки, иначе к первому файлу со страницами
  const pageFmt = b && viewOf(fmt) === 'pdf' && fmt && canRead(fileOf(b.id, fmt)) ? fmt : pf0 ? pf0.format : '';
  const pdfOk = !!(b && pageFmt);
  const pageLink = p => pdfOk && p ? `<a class="page-link" href="${readHref(b.id, pageFmt, '&p=' + p)}">с. ${p}</a>` : p ? `с. ${p}` : '';
  const epubPlace = isEpView(fmt) ? (isNew ? (ctx && ctx.place) : n.place) || '' : '';
  const epubHref = !isNew && isEpView(fmt) ? noteHref(n) : '';
  if(!own || readOnly()){
    // заметка участника группы или общая заметка автора библиотеки (или своя без доступа)
    const grpNote = n.group && !n.shared;
    const who = own ? `<p class="note-kind">${kind === 'lesson' ? 'Урок' : 'Заметка'}</p>` : grpNote ? `${faceHTML(person(n.owner), 'xs')}<p class="note-kind">Заметка · ${esc(isMemberOf(n.group, n.owner) ? nameOf(person(n.owner)) : 'бывший участник')}</p>`
      : `${S.owner ? faceHTML(S.owner, 'xs') : ''}<p class="note-kind">${kind === 'lesson' ? 'Урок' : 'Заметка'} автора библиотеки</p>`;
    return `${backLink(back, backText)}
      <article class="card note-view"><div class="note-top">${who}<span class="ed-state"></span>${fullBtnHTML()}</div>
        <h1>${esc(n.title || 'Без заголовка')}</h1>${n.ai ? `<p class="note-ai">${ICON.ai}Создано ${esc(n.ai)}</p>` : ''}<p class="note-meta">${bookLine}${epubPlace ? ' · ' + (epubHref ? `<a class="page-link" href="${esc(epubHref)}">${esc(placeText(n, b))}</a>` : esc(epubPlace)) : n.page ? ' · ' + pageLink(n.page) : ''} · изменено ${esc(fmtWhen(n.updated))}</p>
        <div class="prose" id="note-body"><p class="muted">Загружаю…</p></div></article>
      ${own ? roNote() : ''}${kind === 'lesson' ? filesBlock(n, false) : ''}${commentsHTML(n)}`;
  }
  // «Видно группе»: у новой заметки из группового режима сразу включено, у отправленной в группу можно выключить
  const ng = kind !== 'note' ? null : isNew ? newNoteGroup(r, bookId) : n.group ? byId('groups', n.group) : null;
  const groupCtl = ng ? `<label class="check-chip sm grp-chip"><input type="checkbox" id="ed-group" value="${ng.id}"${isNew || n.group ? ' checked' : ''}><span>Видно группе «${esc(ng.name)}»</span></label>` : '';
  return `${backLink(back, backText)}
    <article class="card note-edit">
      <div class="note-top"><p class="note-kind">${kind === 'lesson' ? 'Урок' : 'Заметка'}</p>${n && n.shared ? '<span class="tag shared">Видна всем</span>' : ''}${groupCtl}
        <span class="ed-state" id="ed-state" role="status">${esc(ED.state)}</span>
        <button type="button" class="icon-btn" data-act="note-menu" aria-label="Действия с заметкой" aria-haspopup="menu">${ICON.more}</button></div>
      <label class="sr" for="ed-title">Заголовок</label><input type="text" id="ed-title" class="ed-title" maxlength="300" placeholder="Заголовок" value="${esc(n ? n.title : '')}">
      ${n && n.ai ? `<p class="note-ai">${ICON.ai}Создано ${esc(n.ai)}</p>` : ''}
      <div class="note-meta">${bookLine}${epubPlace || isEpView(fmt) ? `<span class="ed-place">${esc(FORMATS[fmt] || 'EPUB')}, ${esc(epubPlace || 'место не указано')}</span>${epubHref ? `<a class="btn sm ghost" href="${esc(epubHref)}">Открыть книгу</a>` : ''}`
        : `<label class="ed-page">страница <input type="number" id="ed-page" min="0" max="99999" inputmode="numeric" value="${esc(page)}"></label>${pdfOk ? `<a class="btn sm ghost" id="ed-open" data-f="${pageFmt}" href="${readHref(b.id, pageFmt, page ? '&p=' + page : '')}">Открыть книгу</a>` : ''}`}</div>
      <div id="ed-box" class="ed-box"><p class="muted">Загружаю редактор…</p></div>
    </article>
    ${kind === 'lesson' && n ? filesBlock(n, true) : kind === 'lesson' ? '<p class="hint">Файлы можно будет прикрепить, когда в уроке появится текст или заголовок.</p>' : ''}${n ? commentsHTML(n) : ''}`;
};
// Группа для новой заметки: открыли из группового режима, человек в группе, группа читает эту книгу
function newNoteGroup(r, bookId){ const g = byId('groups', r.q.get('g') || ''); return g && bookId && g.book === bookId && myMember(g.id) ? g : null; }
// Экран цитаты: текст цитаты, мысль, место в книге; своя цитата меняется здесь же; у групповой комментарии
function hlPage(n, b, own, back, backText){
  const g = n.group ? byId('groups', n.group) : null, u = person(n.owner);
  const href = noteHref(n, g && b && g.book === b.id && myMember(g.id) ? g.id : '');
  const where = placeText(n, b);
  const author = n.group && !n.shared && !isMemberOf(n.group, n.owner) ? 'бывший участник' : nameOf(u);
  return `${backLink(back, backText)}
    <article class="card hl-view" style="--hl:${(HL[n.color] || HL.yellow)[1]}">
      <div class="note-top">${own ? '' : faceHTML(n.shared ? (S.owner || u) : u, 'xs')}<p class="note-kind">${own ? 'Цитата' : n.shared && !n.group ? 'Цитата автора библиотеки' : 'Цитата · ' + esc(author)}</p>
        ${own && n.group ? `<span class="tag grp">Видно группе${g ? ' «' + esc(g.name) + '»' : ''}</span>` : ''}${own && n.shared ? '<span class="tag">Видна всем</span>' : ''}</div>
      <blockquote class="hl-quote">${esc(n.quote || '')}</blockquote>
      <div class="prose hl-thought" id="note-body">${n.body_text ? `<p>${esc(n.body_text)}</p>` : ''}</div>
      <p class="note-meta">${b ? `<a href="#/b/${b.id}">${noteBookText(n, b)}</a>` : noteBookText(n, null) || 'Без книги'}${where ? ' · ' + (href ? `<a class="page-link" href="${esc(href)}">${esc(where)}</a>` : esc(where)) : ''} · ${esc(fmtWhen(n.created))}</p>
      ${own && !readOnly() ? `<div class="row-acts hl-acts"><button type="button" class="btn sm" data-act="hl-thought" data-id="${n.id}">${ICON.pen}<span>Мысль</span></button>
        ${groupsOfBook(n.book).length || n.group ? `<button type="button" class="btn sm" data-act="hl-group" data-id="${n.id}">${ICON.people}<span>Видно группе</span></button>` : ''}
        <button type="button" class="btn sm ghost danger" data-act="hl-del" data-id="${n.id}">Удалить цитату</button></div>` : ''}
    </article>
    ${commentsHTML(n)}`;
}
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
  const own = !readOnly() && (r.id === 'new' || ((ED.rec && ED.rec.id === r.id ? ED.rec : byId('notes', r.id)) || {}).owner === me().id);
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
  if(!own || (rec && rec.kind === 'highlight')){
    const box = $('#note-body');
    if(box) box.innerHTML = cleanHtml(rec.body) || (rec.kind === 'highlight' ? (own ? '<p class="muted">Мысли пока нет.</p>' : '') : '<p class="muted">Текста нет.</p>');
    return;
  }
  try { await loadQuill(); } catch(e){ $('#ed-box').innerHTML = `<p class="form-err">${esc(e.message)}</p>`; return; }
  const box = $('#ed-box'); if(!box || ED.id !== id) return;
  box.innerHTML = '<div id="ed-q"></div>';
  const q = new Quill('#ed-q', {theme: 'snow', placeholder: 'Текст заметки',
    modules: {toolbar: {container: [[{header: 2}, {header: 3}], ['bold', 'italic', 'underline'], [{list: 'bullet'}, {list: 'ordered'}], ['blockquote', 'link'], ['undo']],
      handlers: {undo(){ this.quill.history.undo(); }}}, history: {delay: 700, maxStack: 300, userOnly: true}}});
  ED.quill = q;
  // русские подсказки на кнопках
  const tips = {'.ql-header[value="2"]': 'Заголовок', '.ql-header[value="3"]': 'Подзаголовок', '.ql-bold': 'Жирный', '.ql-italic': 'Курсив', '.ql-underline': 'Подчёркнутый',
    '.ql-list[value="bullet"]': 'Список', '.ql-list[value="ordered"]': 'Нумерованный список', '.ql-blockquote': 'Цитата', '.ql-link': 'Ссылка', '.ql-undo': 'Отменить'};
  for(const [s, t] of Object.entries(tips)){ const el = box.querySelector(s); if(el){ el.title = t; el.setAttribute('aria-label', t); } }
  const hb = box.querySelectorAll('.ql-header'); if(hb[0]) hb[0].innerHTML = '<b class="h1">З1</b>'; if(hb[1]) hb[1].innerHTML = '<b class="h2">З2</b>';
  const tb = box.querySelector('.ql-toolbar'); if(tb) tb.insertAdjacentHTML('beforeend', `<span class="ql-formats ed-full-wrap">${fullBtnHTML()}</span>`);
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
  const pg = $('#ed-page');
  return {title: ($('#ed-title') || {}).value || '', body, ...(pg ? {page: +(pg.value || 0) || 0} : {})};
}
function edChanged(){
  const d = edData(); if(!d) return;
  ED.dirty = true;
  saveLS(draftKey(ED.id), {...d, at: Date.now()});
  edState('Есть несохранённые изменения');
  clearTimeout(ED.timer); ED.timer = setTimeout(edSave, 1500);
  const o = $('#ed-open'); if(o && o.href){ const r = route(); const bid = ED.rec ? ED.rec.book : r.q.get('book'); if(bid) o.href = readHref(bid, o.dataset.f || 'pdf', d.page ? '&p=' + d.page : ''); }
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
      const book = r.q.get('book') || '';
      // заметка из читалки: формат и место в книге (у EPUB глава и процент)
      const ctx = UI.noteCtx && UI.noteCtx.book === book ? UI.noteCtx : null;
      const pfb = book ? pageFileOf(book) : null;
      const extra = ctx ? {format: ctx.format, place: ctx.place || '', anchor: ctx.anchor || null} : pfb && d.page ? {format: pfb.format} : {};
      const ge = $('#ed-group'), group = kind === 'note' && ge && ge.checked ? ge.value : '';
      rec = await pb.collection('notes').create({id, owner: me().id, kind, book, ...extra, ...d, ...(group ? {group} : {})});
      UI.noteCtx = null;
      ED.isNew = false;
      if(route().name === 'note' && route().id === 'new'){ history.replaceState(history.state, '', '#/note/' + id + (r.q.get('g') ? '?g=' + r.q.get('g') : '')); UI.fullFor = id; curRoute = route(); curHash = location.hash; }
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
  items.push({label: UI.fullNow ? 'Свернуть' : 'На весь экран', run: () => setFull(!UI.fullNow)});
  if(isAdmin()) items.push({label: 'Настройки', run: () => noteSettings()});
  if(n && n.kind === 'note' && n.book && (n.group || groupsOfBook(n.book).length)) items.push({label: 'Видно группе', run: () => edSave().then(() => pickNoteGroup(ED.rec || n, rec => { if(ED.rec && ED.rec.id === rec.id) ED.rec = {...ED.rec, group: rec.group}; render(true); }))});
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
  const list = () => { const h = searchHits(q); return (h ? h.books : [...libBooks()].sort(titleSort)).slice(0, 60); };
  const rows = () => list().map(b => `<button type="button" class="pick-row" data-dlg="pick" data-id="${b.id}">${coverHTML(b, 'xs')}<span><b>${esc(b.title)}</b><small>${esc(authorsText(b))}</small></span></button>`).join('') || '<p class="empty">Ничего не нашлось.</p>';
  openForm({title: 'Книга для заметки', html: `<label class="search"><span class="sr">Поиск</span>${ICON.search}<input type="search" id="pick-q" placeholder="Название или автор" autocomplete="off"></label><div class="pick-list" id="pick-list">${rows()}</div>
      ${n && n.book ? '<button type="button" class="btn sm ghost" data-dlg="pick" data-id="">Оставить без книги</button>' : ''}`, noSubmit: true,
    onInput(el){ if(el.id === 'pick-q'){ q = el.value; $('#pick-list').innerHTML = rows(); } },
    async onClick(el){
      await edSave();
      const book = el.dataset.id;
      if(!ED.rec){ dlg.close(); go('#/note/new?book=' + book, true); return; }
      const rec = await pb.collection('notes').update(ED.rec.id, {book, ...(ED.rec.group && !groupsOfBook(book).some(g => g.id === ED.rec.group) ? {group: ''} : {})});
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
  const rows = () => { const h = searchHits(q); const list = (h ? h.books : [...libBooks()].sort((a, b) => (want.has(b.id) - want.has(a.id)) || titleSort(a, b))).slice(0, 150);
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
  const fmts = bookFormats(b);
  const items = [{label: 'Изменить данные', run: () => openBookForm(b)}, {label: 'Заменить обложку', run: () => pickCover(b)}];
  if(!b.pending) items.push({label: 'Настройки', run: () => bookSettings(b)});
  if(fmts.length < FMT_ORDER.length && !b.pending) items.push({label: 'Добавить формат', run: () => addFormat(b)});
  if(!b.pending) items.push({label: tracksOf(b.id).length ? 'Аудио: добавить главу' : 'Добавить аудио', run: () => audioAdd(b)});
  if(!b.pending) items.push({label: 'Объединить с другой книгой', run: () => mergeBook(b)});
  if(fmts.length > 1) items.push({label: 'Убрать формат', run: () => removeFormat(b)});
  if(b.status !== 'processing') items.push({label: 'Обработать заново', run: async () => {
    try { await pb.send(`/api/knigi/books/${b.id}/reprocess`, {method: 'POST'}); kickProcess(); toast('Книга снова обрабатывается'); loadAll(['books', 'bfiles']).catch(() => {}); } catch(e){ toast(errText(e)); } }});
  items.push({label: 'Удалить книгу', danger: true, run: () => confirmDeleteBook(b)});
  openMenu(btn, items);
}
// «Видна всем читателям» (правки 4.1): новая книга скрыта, пока администратор её не откроет.
// «Открыта отдельным читателям» (правки 4.3): скрытая книга видна только отмеченным. Список хранится,
// когда книга видна всем, и снова работает, если её скрыть.
const namesText = list => list.map(u => u.name || u.email).join(', ');
// Пользователей может быть сотни: в окне только те, кому книга уже открыта, поиск идёт на сервере
// (/api/knigi/admin/user-search, от 2 букв, до 10 совпадений), участников своей группы чтения можно добавить разом.
// Связи с группой не остаётся: новые участники группы книгу сами не получают.
async function bookSettings(b){
  let sel = [];
  try { sel = (await pb.send(`/api/knigi/books/${b.id}/readers`, {})).readers || []; } catch(e){ toast(errText(e)); return; }
  let hits = [], q = '', qT = 0, seq = 0, groupsOpen = false;
  const has = id => sel.some(u => u.id === id);
  const who = u => `${faceHTML(u, 'xs')}<span class="rr-t">${esc(u.name || u.email)}${u.email && u.name ? `<small>${esc(u.email)}</small>` : ''}</span>`;
  const selHTML = () => sel.length ? sel.map(u => `<div class="reader-row">${who(u)}<button type="button" class="btn sm ghost rr-x" data-dlg="rd-rm" data-id="${esc(u.id)}" aria-label="Убрать ${esc(u.name || u.email)}">${ICON.close}<span>Убрать</span></button></div>`).join('')
    : '<p class="hint rr-empty">Пока никому: книгу видите только вы.</p>';
  const hitsHTML = () => q.length < 2 ? '' : !hits.length ? '<p class="hint">Никого не нашлось.</p>'
    : hits.map(u => `<button type="button" class="reader-row rr-hit" data-dlg="rd-add" data-id="${esc(u.id)}"${has(u.id) ? ' disabled' : ''}>${who(u)}<span class="rr-add">${has(u.id) ? 'уже в списке' : ICON.plus}</span></button>`).join('');
  const groups = () => myGroups().filter(g => membersOf(g.id).some(m => m.user !== me().id));
  const groupsHTML = () => !groupsOpen ? '' : groups().length
    ? groups().map(g => { const n = membersOf(g.id).filter(m => m.user !== me().id).length; return `<button type="button" class="pick-row" data-dlg="rd-group" data-id="${g.id}">${ICON.people}<span><b>${esc(g.name)}</b><small>${n} ${plural(n, ['участник', 'участника', 'участников'])}, кроме вас</small></span></button>`; }).join('')
    : '<p class="hint">Вы не состоите ни в одной группе чтения с другими участниками.</p>';
  const paint = () => {
    const a = form.querySelector('#rd-sel'), h = form.querySelector('#rd-hits'), g = form.querySelector('#rd-groups'), n = form.querySelector('#rd-n');
    if(a) a.innerHTML = selHTML(); if(h) h.innerHTML = hitsHTML(); if(g) g.innerHTML = groupsHTML(); if(n) n.textContent = sel.length ? ' · ' + sel.length : '';
  };
  const allHint = '<p class="hint" id="rd-allhint">Сейчас книга видна всем. Список заработает, если книгу снова скрыть.</p>';
  const block = `<fieldset class="field readers-box"><legend class="flabel">Открыта читателям<span id="rd-n">${sel.length ? ' · ' + sel.length : ''}</span></legend>
      ${b.hidden ? '' : allHint}
      <div class="readers-list" id="rd-sel">${selHTML()}</div>
      <label class="search rd-search"><span class="sr">Найти читателя</span>${ICON.search}<input type="search" id="rd-q" placeholder="Найти читателя: имя или почта" autocomplete="off"></label>
      <div class="readers-hits" id="rd-hits"></div>
      <button type="button" class="btn sm" data-dlg="rd-groups">${ICON.people}<span>Открыть участникам группы</span></button>
      <div class="pick-list" id="rd-groups"></div>
      <p class="hint">Тем, кому книга открыта, скрытая книга видна как обычная: в библиотеке, в поиске, на полках, читалка, заметки и цитаты. Уберёте человека: у него всё сохранится, книга станет «временно недоступна». Изменения вступят в силу после «Сохранить».</p></fieldset>`;
  openForm({title: 'Настройки', fields: [{key: 'open', type: 'check', label: 'Видна всем читателям',
      hint: 'Пока переключатель выключен, книгу видите только вы и читатели из списка ниже. У остальных, кто уже начал её читать или писал к ней заметки, она останется в списках с пометкой «Книга временно недоступна», всё их сохранится.'}],
    values: {open: !b.hidden}, html: block,
    onChange(el){
      if(el.id === 'fld-open'){
        const box = form.querySelector('.readers-box'), h = form.querySelector('#rd-allhint');
        if(el.checked && !h && box) box.querySelector('legend').insertAdjacentHTML('afterend', allHint);
        if(!el.checked && h) h.remove();
      }
    },
    onInput(el){
      if(el.id !== 'rd-q') return;
      q = el.value.trim(); clearTimeout(qT);
      if(q.length < 2){ hits = []; paint(); return; }
      const my = ++seq;
      qT = setTimeout(async () => {
        try { const r = await pb.send('/api/knigi/admin/user-search', {query: {q}}); if(my === seq){ hits = r.users || []; paint(); } }
        catch(e){ formErr(errText(e)); }
      }, 250);
    },
    onClick(el){
      const d = el.dataset;
      if(d.dlg === 'rd-rm'){ sel = sel.filter(u => u.id !== d.id); paint(); }
      else if(d.dlg === 'rd-add'){ const u = hits.find(x => x.id === d.id); if(u && !has(u.id)) sel.push(u); paint(); }
      else if(d.dlg === 'rd-groups'){ groupsOpen = !groupsOpen; paint(); }
      else if(d.dlg === 'rd-group'){
        let n = 0;
        for(const m of membersOf(d.id)){ if(m.user === me().id || has(m.user)) continue; const p = person(m.user); sel.push({id: m.user, name: p.name || '', email: '', avatar: p.avatar || ''}); n++; }
        groupsOpen = false; paint();
        toast(n ? `Добавлено: ${n}` : 'Все участники уже в списке');
      }
    },
    async onSave(v){
      const rr = await pb.send(`/api/knigi/books/${b.id}/readers`, {method: 'POST', body: {users: sel.map(u => u.id)}});
      const res = await pb.send(`/api/knigi/books/${b.id}/visibility`, {method: 'POST', body: {hidden: !v.open}});
      upsert('books', {id: b.id, hidden: res.hidden, opened_at: res.opened_at});
      await loadAll(['bacc']).catch(() => {});
      toast(!res.hidden ? 'Книга открыта всем читателям' : rr.readers.length ? 'Книга открыта: ' + namesText(rr.readers) : 'Книга скрыта ото всех читателей');
      render(true);
    }});
}
// Ещё один формат к этой книге: обычная загрузка, обработка в фоне
function addFormat(b){
  const have = bookFormats(b);
  const exts = {pdf: '.pdf,application/pdf', epub: '.epub,application/epub+zip', djvu: '.djvu,.djv', fb2: '.fb2,.fbz,.zip', mobi: '.mobi', azw3: '.azw3', txt: '.txt,text/plain'};
  const free = FMT_ORDER.filter(f => !have.includes(f));
  if(!free.length){ info('Все форматы уже есть', `У книги уже есть ${BOOK_TYPES}.`); return; }
  pickFile(free.map(f => exts[f]).join(','), false, files => { loadDisk(); addUploads(files, 'book', '', b.id); });
}
// Объединить: поиск второй книги, предпросмотр (что куда перейдёт), подтверждение
function mergeBook(b){
  let q = '';
  const list = () => { const h = searchHits(q); return (h ? h.books : [...libBooks()].sort(titleSort)).filter(x => x.id !== b.id).slice(0, 60); };
  const rows = () => list().map(x => `<button type="button" class="pick-row" data-dlg="merge" data-id="${x.id}">${coverHTML(x, 'xs')}<span><b>${esc(x.title)}</b><small>${esc([authorsText(x), bookFormats(x).map(f => FORMATS[f]).join(', ')].filter(Boolean).join(' · '))}</small></span></button>`).join('') || '<p class="empty">Ничего не нашлось.</p>';
  openForm({title: 'Объединить с другой книгой', text: `Останется карточка «${b.title}». Выберите вторую книгу: её файлы, полки, заметки и прогресс перейдут сюда.`,
    html: `<label class="search"><span class="sr">Поиск</span>${ICON.search}<input type="search" id="merge-q" placeholder="Название или автор" autocomplete="off"></label><div class="pick-list" id="merge-list">${rows()}</div>`, noSubmit: true,
    onInput(el){ if(el.id === 'merge-q'){ q = el.value; $('#merge-list').innerHTML = rows(); } },
    async onClick(el){
      const other = byId('books', el.dataset.id); if(!other) return;
      const m = await pb.send(`/api/knigi/books/${b.id}/merge/${other.id}`, {});
      if(m.conflict.length){
        thenOpen(() => info('Объединить нельзя', `У обеих книг есть файл ${m.conflict.map(f => FORMATS[f]).join(' и ')}. Сначала уберите лишний формат в одной из книг («⋯» → «Убрать формат»), потом объединяйте.`));
        dlg.close(); return;
      }
      const parts = [`файлы: ${m.formats.map(f => FORMATS[f]).join(', ') || 'нет'}`];
      if(m.shelves) parts.push(`места на полках: ${m.shelves}`);
      if(m.audio) parts.push(`главы аудио: ${m.audio} (с прогрессом слушания)`);
      const notes = [m.notes ? `${m.notes} ${plural(m.notes, NOTES_W)}` : '', m.lessons ? `${m.lessons} ${plural(m.lessons, ['урок','урока','уроков'])}` : '', m.highlights ? `${m.highlights} ${plural(m.highlights, ['цитата','цитаты','цитат'])}` : ''].filter(Boolean);
      if(notes.length) parts.push(notes.join(', ') + ' (у всех пользователей)');
      if(m.readers) parts.push(`прогресс чтения: ${m.readers} ${plural(m.readers, ['человек','человека','человек'])}`);
      thenOpen(() => openForm({title: 'Объединить книги?', text: `Останется «${b.title}» (эта карточка). Из «${other.title}» сюда перейдут: ${parts.join('; ')}. Если у этой книги нет года, описания или обложки, они возьмутся у второй. Карточка «${other.title}» пропадёт. Отменить объединение нельзя.`,
        submit: 'Объединить', async onSave(){
          await pb.send(`/api/knigi/books/${b.id}/merge/${other.id}`, {method: 'POST'});
          await loadAll();
          toast('Книги объединены'); render(true);
        }}));
      dlg.close();
    }});
}
// Убрать один формат: файл, текст, прогресс и выделения в этом формате
function removeFormat(b){
  const files = filesOfBook(b.id);
  if(files.length < 2){ info('Это последний формат', 'Последний формат убрать нельзя. Чтобы убрать книгу совсем, выберите «Удалить книгу».'); return; }
  const ask = async f => {
    const m = await pb.send(`/api/knigi/book-files/${f.id}`, {});
    thenOpen(() => openForm({title: `Убрать ${FORMATS[f.format]}?`, text: `Из книги «${b.title}» удалятся файл ${FORMATS[f.format]} и его текст, прогресс чтения в ${FORMATS[f.format]}${m.readers ? ` (у ${m.readers} ${plural(m.readers, ['человека','человек','человек'])})` : ''} и цитаты в этом формате у всех: ${m.highlights}. Заметки останутся. Вернуть можно только новой загрузкой файла.`,
      submit: 'Убрать', danger: true, async onSave(){
        await pb.send(`/api/knigi/book-files/${f.id}`, {method: 'DELETE'});
        delete UI.cardFmt[b.id];
        await loadAll(['books', 'bfiles', 'reading', 'notes']);
        toast(`${FORMATS[f.format]} убран`);
      }}));
    dlg.close();
  };
  openForm({title: 'Убрать формат', text: 'Какой формат убрать из книги?', noSubmit: true,
    html: `<div class="pick-list">${files.map(f => `<button type="button" class="pick-row" data-dlg="fmt" data-id="${f.id}"><span><b>${FORMATS[f.format]}</b><small>${esc([f.orig_name || '', fsize(f.file_size || 0)].filter(Boolean).join(' · '))}</small></span></button>`).join('')}</div>`,
    async onClick(el){ const f = files.find(x => x.id === el.dataset.id); if(f) await ask(f); }});
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
    html: dl + filesOfBook(b.id).map(f => `<p class="hint">${esc(fmtLong(f.format))}: ${esc(f.orig_name || '')}, ${fsize(f.orig_size || f.file_size || 0)}</p>`).join(''),
    async onSave(v){
      const ids = await authorIds(v.authors);
      upsert(bookKey(b.id), await pb.collection('books').update(b.id, {title: v.title, authors: ids, year: +v.year || 0, description: v.description}, {fields: BOOK_FIELDS + ',offered_by,pending'}));
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
    try { const r = await pb.send(`/api/knigi/books/${b.id}/cover`, {method: 'POST', body: fd}); upsert(bookKey(b.id), {id: b.id, cover: r.cover}); toast('Обложка заменена'); }
    catch(e){ toast(errText(e)); }
  });
}
function confirmDeleteBook(b){
  const mine = notesOfBook(b.id).filter(n => n.owner === me().id);
  const fields = mine.length ? [{key: 'notes', type: 'select', label: `Ваши заметки и уроки к этой книге (${mine.length})`, options: [['keep', 'оставить без книги'], ['delete', 'удалить вместе с книгой']], hint: 'Оставленные будут в разделе «Заметки» с пометкой «книга удалена».'}] : [];
  const au = tracksOf(b.id).length;
  openForm({title: 'Удалить книгу?', text: `«${b.title}»: удалятся все файлы книги (${[...bookFormats(b).map(f => FORMATS[f]), au ? `аудио: ${au} ${plural(au, TRACKS_W)}` : ''].filter(Boolean).join(', ') || 'нет'}), текст, обложка, место на полках, прогресс чтения и слушания у всех. Вернуть можно только новой загрузкой. Заметки читателей останутся у них без книги.`,
    fields, values: {notes: 'keep'}, submit: 'Удалить', danger: true,
    async onSave(v){
      await pb.send(`/api/knigi/books/${b.id}?notes=${v.notes === 'delete' ? 'delete' : 'keep'}`, {method: 'DELETE'});
      removeLocal('books', b.id);
      S.sbooks = S.sbooks.filter(x => x.book !== b.id); S.reading = S.reading.filter(x => x.book !== b.id); S.bfiles = S.bfiles.filter(x => x.book !== b.id);
      if(AP.book === b.id) apStop();
      S.atracks = S.atracks.filter(x => x.book !== b.id); S.aprog = S.aprog.filter(x => x.book !== b.id);
      loadAll(['notes', 'authors']).catch(() => {});
      toast('Книга удалена'); go('#/', true);
    }});
}

/* ---------- Загрузка книг и файлов уроков (только администратор) ---------- */
// Файл идёт кусками по 8 МБ, по одному файлу за раз. Оборвавшийся кусок отправляется заново.
const UP = {items: [], running: false, hidden: false};
const UP_EXT = {book: BOOK_RE, offer: BOOK_RE, file: /\.(pdf|docx?|pptx?|jpe?g|png|webp|gif|heic)$/i, audio: AU_EXT};
const UP_MAX = {book: 500 * MB, offer: 500 * MB, file: 50 * MB, audio: AU_MAX};
const upShown = u => u.kind === 'book' || u.kind === 'offer' || u.kind === 'audio'; // в панели загрузок: книги, предложенные книги, главы аудио
// extra: для главы аудио {title, pos, duration} или {track} (заменить файл главы)
function addUploads(files, kind, note, book, extra){
  for(const f of files){
    const it = {id: newId(), file: f, kind, note: note || '', book: book || '', extra: extra || null, state: 'wait', pct: 0, msg: '', bookId: ''};
    if(!UP_EXT[kind].test(f.name)){ it.state = 'err'; it.msg = kind === 'audio' ? 'Подходят только MP3 и M4A.' : kind !== 'file' ? `Подходят только ${BOOK_TYPES}.` : 'Этот вид файла не подходит.'; }
    else if(f.size > UP_MAX[kind]){ it.state = 'err'; it.msg = `Больше ${UP_MAX[kind] / MB} МБ.`; }
    else if(kind === 'book' && S.bfiles.some(x => x.orig_name === f.name && x.file_size === f.size)){ it.state = 'skip'; it.msg = 'Такой файл уже есть в библиотеке.'; }
    UP.items.push(it);
  }
  UP.hidden = false;
  runUploads();
  render(true);
}
function upText(u){
  return {wait: 'ждёт очереди', up: `загружается, ${u.pct}%`, proc: 'обрабатывается', done: u.kind === 'offer' ? 'отправлена на проверку' : u.kind === 'audio' ? (u.extra && u.extra.track ? 'файл главы заменён' : 'глава загружена: черновик') : 'готово', err: 'ошибка: ' + u.msg, skip: u.msg, dup: u.msg}[u.state] || '';
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
  const st = await pb.send('/api/knigi/upload/start', {method: 'POST', body: {name: f.name, size: f.size, kind: it.kind, note: it.note, book: it.book, ...(it.extra || {})}});
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
        if(res.kind === 'offer'){
          // книга от читателя: повтор не принимается, новая уходит на проверку и обрабатывается сразу
          if(res.duplicate || res.pending){
            it.state = 'dup'; it.msg = res.message; it.bookId = res.duplicate ? res.duplicate.id : '';
            const dupId = it.bookId;
            thenOpen(() => openForm({title: res.message, text: res.duplicate ? `«${res.duplicate.title}» уже есть в библиотеке, второй раз её добавлять не нужно.` : 'Эту книгу уже предложили, и она ждёт проверки. Второй раз отправлять её не нужно.',
              submit: dupId ? 'Открыть книгу' : 'Понятно', noCancel: !dupId, async onSave(){ if(dupId) go('#/b/' + dupId); }}));
          } else {
            it.state = 'done'; kickProcess();
            thenOpen(() => info('Книга отправлена', 'Ваша книга отправлена на проверку. Обычно это занимает около суток. Решение появится в профиле, в разделе «Мои предложенные книги».'));
          }
          loadAll(['offers']).catch(() => {});
          upPaint(); continue;
        }
        if(res.kind === 'audio'){ it.state = 'done'; it.bookId = res.id; loadAll(['atracks']).catch(() => {}); upPaint(); continue; }
        if(res.kind === 'book'){ it.state = 'proc'; it.bookId = res.id; kickProcess(); }
        else { it.state = 'done'; }
        loadAll(it.kind === 'book' ? ['books', 'bfiles', 'authors'] : ['nfiles']).catch(() => {});
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
  const books = UP.items.filter(upShown);
  if(!books.length || UP.hidden || RD.open){ if(el) el.remove(); return; }
  if(!el){ el = document.createElement('section'); el.id = 'uploads'; el.className = 'uploads'; el.setAttribute('aria-label', 'Загрузка книг'); $('#app').appendChild(el); }
  const active = books.filter(u => u.state === 'wait' || u.state === 'up' || u.state === 'proc').length;
  const onlyOffers = books.every(u => u.kind === 'offer'), onlyAudio = books.every(u => u.kind === 'audio');
  el.innerHTML = `<div class="up-head"><b>${onlyOffers ? 'Отправка книги' : onlyAudio ? 'Загрузка аудио' : 'Загрузка книг'}${active ? ` · осталось ${active}` : ''}</b>
      <button type="button" class="icon-btn" data-act="up-close" aria-label="${active ? 'Свернуть' : 'Закрыть'}">${active ? ICON.down : ICON.close}</button></div>
    ${active ? '<p class="hint">Не закрывайте вкладку, пока файлы загружаются.</p>' : ''}
    <div class="up-list">${books.map(u => `<div class="up-row ${u.state}"><span class="up-t"><b>${(u.state === 'done' || u.state === 'dup') && u.bookId ? `<a href="#/b/${u.bookId}">${esc(u.kind === 'audio' && u.extra && u.extra.title ? u.extra.title : u.file.name)}</a>` : esc(u.kind === 'audio' && u.extra && u.extra.title ? u.extra.title : u.file.name)}</b>
      <small>${fsize(u.file.size)} · ${esc(upText(u))}</small><span class="prog wide"><i style="width:${u.state === 'done' || u.state === 'proc' || u.state === 'dup' ? 100 : u.pct}%"></i></span></span>
      ${u.state === 'skip' ? `<button type="button" class="btn sm ghost" data-act="up-force" data-id="${u.id}">Всё равно</button>` : ''}
      ${u.state === 'wait' || u.state === 'up' ? `<button type="button" class="icon-btn" data-act="up-cancel" data-id="${u.id}" aria-label="Отменить">${ICON.close}</button>` : ''}</div>`).join('')}</div>
    ${S.disk && isAdmin() ? `<p class="hint">Свободно на диске сервера: ${fsize(S.disk.free)}.</p>` : ''}`;
}

/* ---------- Аудио к книгам (правки 4.3, часть Б) ---------- */
// Главы лежат на сервере отдельно от базы и отдаются по ссылке на 2 часа, только в браузере, где выполнен вход
// (та же защищённая кука, что у книг). В памяти телефона звук не остаётся: sw.js адреса /api/ не трогает.
// Читатель получает от сервера только опубликованные главы книг, которые ему открыты; администратор все, черновики тоже.
// Один элемент <audio> живёт вне экранов приложения: звук не прерывается при переходах, мини-плеер внизу.
const AU_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const AU_SKIP = 15;
const TRACKS_W = ['глава', 'главы', 'глав'];
const tracksOf = id => S.atracks.filter(t => t.book === id).sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.created).localeCompare(String(b.created)));
const hasAudio = b => !!b && S.atracks.some(t => t.book === b.id);
const progOf = tid => S.aprog.find(p => p.track === tid);
const trackById = id => S.atracks.find(t => t.id === id);
const durShort = sec => { sec = Math.max(0, Math.round(sec || 0)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`; };
const minText = sec => { const m = Math.max(1, Math.round(sec / 60)); return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`; };
const trackLeft = t => { const p = progOf(t.id); return !p || p.done || !t.duration ? 0 : Math.max(0, t.duration - (p.pos || 0)); };
// «Новая»: глава опубликована после того, как человек начал слушать эту книгу, и он её ещё не открывал
function trackNew(t){
  if(isAdmin() || !t.published || progOf(t.id)) return false;
  const first = S.aprog.filter(p => p.book === t.book).map(p => String(p.created || p.updated)).sort()[0];
  return !!first && String(t.published_at || '') > first;
}
const audioNew = id => tracksOf(id).some(trackNew);
// С какой главы продолжать: последняя начатая, если не дослушана, иначе следующая за ней, иначе первая
function contTrack(bookId){
  const list = tracksOf(bookId);
  if(!list.length) return null;
  const last = S.aprog.filter(p => p.book === bookId && list.some(t => t.id === p.track)).sort((a, b) => String(b.updated).localeCompare(String(a.updated)))[0];
  if(last){
    const i = list.findIndex(t => t.id === last.track);
    if(!last.done) return list[i];
    const rest = list.slice(i + 1).find(t => !(progOf(t.id) || {}).done) || list.slice(i + 1)[0];
    if(rest) return rest;
  }
  return list.find(t => !(progOf(t.id) || {}).done) || list[0];
}
const nextTrack = t => { const list = tracksOf(t.book); const i = list.findIndex(x => x.id === t.id); return i >= 0 ? list[i + 1] || null : null; };

// Тишина в несколько кадров MP3: её «играем» прямо в нажатии, пока сервер готовит ссылку.
// Так iPhone разрешает этому элементу звук, и настоящая глава потом включается без второго нажатия.
const AU_SILENT = (() => {
  const f = [0xff, 0xfb, 0x10, 0xc0].concat(Array(100).fill(0));
  return 'data:audio/mpeg;base64,' + btoa(String.fromCharCode(...Array(8).fill(f).flat()));
})();
const AP = {el: null, real: false, book: '', track: '', want: null, played: 0, prevT: null, saveAt: 0, tries: 0, next: null, msg: '', seeking: false, rate: +loadLS('apRate', 1) || 1};
function apEl(){
  if(AP.el) return AP.el;
  const el = document.createElement('audio');
  el.preload = 'metadata'; el.hidden = true; el.setAttribute('playsinline', '');
  document.body.appendChild(el);
  el.addEventListener('loadedmetadata', apLoaded);
  el.addEventListener('timeupdate', apTime);
  for(const ev of ['play', 'playing', 'pause', 'waiting']) el.addEventListener(ev, () => { if(AP.real){ apPaint(); schedule(); } });
  el.addEventListener('pause', () => { if(AP.real) apSave(true); });
  el.addEventListener('ended', apEnded);
  el.addEventListener('error', apError);
  AP.el = el;
  return el;
}
const apOn = () => !!(AP.el && AP.real && !AP.el.paused && !AP.el.ended);
async function apLink(tid){ return pb.send(`/api/knigi/audio/${tid}/link`, {}); }
// Включить главу. opts.restart: с начала. Вызывать прямо из нажатия: тогда iPhone разрешает звук.
async function apPlay(tid, opts = {}){
  const t = trackById(tid);
  if(!t) return;
  if(roBook(byId('books', t.book))){ toast(`${accHead(S.access)}: слушать сейчас нельзя.`); return; }
  const el = apEl();
  if(AP.track === tid && AP.real && el.getAttribute('src') && !opts.restart){ el.play().catch(apPlayErr); return; }
  if(AP.track && AP.track !== tid) apSave(true);
  const p = progOf(tid);
  let want = opts.restart || !p || p.done ? 0 : (p.pos || 0);
  if(want && t.duration && t.duration - want < 5) want = 0;
  Object.assign(AP, {book: t.book, track: tid, want, played: 0, prevT: null, tries: 0, msg: '', real: false});
  const pre = AP.next && AP.next.track === tid && Date.now() - AP.next.at < 90 * 60e3 ? AP.next : null;
  AP.next = null;
  apSession(t); renderMini(); schedule();
  if(pre){ AP.real = true; el.src = pre.url; el.load(); el.play().catch(apPlayErr); }
  else {
    try { el.src = AU_SILENT; el.play().catch(() => {}); } catch(e){}
    try {
      const l = await apLink(tid);
      if(AP.track !== tid) return;
      AP.real = true; el.src = l.url; el.load(); el.play().catch(apPlayErr);
    } catch(e){ if(AP.track === tid){ AP.msg = errText(e); AP.real = false; try { el.pause(); el.removeAttribute('src'); } catch(_){} apPaint(); schedule(); } return; }
  }
  apSave(true); // глава открыта: «Новая» снимается, на других устройствах видно, где человек
}
function apPlayErr(e){ if(e && e.name === 'NotAllowedError'){ AP.msg = 'Нажмите «Играть», чтобы включить звук.'; apPaint(); } }
function apLoaded(){
  if(!AP.real) return;
  const el = AP.el;
  el.defaultPlaybackRate = AP.rate; el.playbackRate = AP.rate;
  if(AP.want != null){ const w = AP.want; AP.want = null; if(w > 1 && el.duration && w < el.duration - 2){ try { el.currentTime = w; } catch(e){} } }
  AP.prevT = el.currentTime;
  apPos(); apPaint();
}
// Время идёт: считаем, сколько человек действительно слушал (для журнала), сохраняем место раз в 10 секунд
function apTime(){
  if(!AP.real) return;
  const el = AP.el, t = el.currentTime || 0;
  if(AP.prevT != null){ const dt = t - AP.prevT; if(dt > 0 && dt < 3) AP.played += dt / (el.playbackRate || 1); }
  AP.prevT = t;
  if(!el.paused && Date.now() - AP.saveAt > 10000) apSave(false);
  // заранее берём ссылку на следующую главу: после конца она включится сразу, даже при выключенном экране
  const tr = trackById(AP.track), nx = tr && nextTrack(tr);
  if(nx && el.duration && el.duration - t < 120 && !(AP.next && AP.next.track === nx.id) && !AP.nextBusy && !roBook(byId('books', nx.book))){
    AP.nextBusy = true;
    apLink(nx.id).then(l => { AP.next = {track: nx.id, url: l.url, at: Date.now()}; }).catch(() => {}).finally(() => { AP.nextBusy = false; });
  }
  apTick();
}
// Сохранить место. Дослушано почти до конца (меньше 15 секунд или 98%): глава «прослушана».
function apSave(force, ended){
  const el = AP.el, tid = AP.track;
  if(!el || !tid || !AP.real || roBook(byId('books', (trackById(tid) || {}).book))) return;
  // пока глава загружается и ещё не перемотана на место остановки, сохраняем само это место, а не ноль
  const pos = ended ? (el.duration || 0) : AP.want != null ? AP.want : (el.currentTime || 0), dur = el.duration || (trackById(tid) || {}).duration || 0;
  if(!force && Date.now() - AP.saveAt < 10000) return;
  AP.saveAt = Date.now();
  const done = !!ended || (dur > 0 && (dur - pos <= 15 || pos / dur >= 0.98));
  const body = {pos: Math.round(pos * 10) / 10, played: Math.round(AP.played)};
  if(done) body.done = true;
  AP.played = 0;
  if(document.visibilityState === 'hidden'){
    fetch(`/api/knigi/audio/${tid}/progress`, {method: 'POST', keepalive: true, headers: {'Content-Type': 'application/json', Authorization: pb.authStore.token}, body: JSON.stringify(body)}).catch(() => {});
    return;
  }
  pb.send(`/api/knigi/audio/${tid}/progress`, {method: 'POST', body}).then(r => {
    const had = S.aprog.find(p => p.id === r.id);
    upsert('aprog', had ? r : {...r});
  }).catch(() => {});
}
function apEnded(){
  if(!AP.real) return;
  apSave(true, true);
  const t = trackById(AP.track), nx = t && nextTrack(t);
  if(nx) apPlay(nx.id, {restart: !!(progOf(nx.id) || {}).done});
  else { apPaint(); schedule(); }
}
// Ссылка устарела (прошло больше двух часов) или оборвалась связь: новая ссылка и то же место
function apError(){
  const el = AP.el;
  if(!AP.real || !el.getAttribute('src')) return;
  if(AP.tries >= 2){ AP.msg = 'Файл не открылся. Проверьте интернет и включите главу заново.'; apPaint(); return; }
  AP.tries++;
  AP.want = el.currentTime || (progOf(AP.track) || {}).pos || 0;
  const resume = !el.paused || el.ended === false, tid = AP.track;
  apLink(tid).then(l => { if(AP.track !== tid) return; el.src = l.url; el.load(); if(resume) el.play().catch(apPlayErr); })
    .catch(e => { AP.msg = errText(e); apPaint(); });
}
function apToggle(tid){
  const el = apEl();
  if(tid && tid !== AP.track){ apPlay(tid); return; }
  if(!AP.real){ if(AP.track) apPlay(AP.track); return; }
  if(el.paused) el.play().catch(apPlayErr); else el.pause();
}
function apSkip(k){
  const el = AP.el;
  if(!el || !AP.real || !el.duration) return;
  el.currentTime = Math.max(0, Math.min(el.duration - 0.5, (el.currentTime || 0) + k));
  AP.prevT = el.currentTime; apTick(); apPos(); apSave(true);
}
function apRate(r){
  AP.rate = r; saveLS('apRate', r);
  if(AP.el){ AP.el.defaultPlaybackRate = r; AP.el.playbackRate = r; }
  apPos(); apPaint();
}
function apStop(){
  if(AP.el){ apSave(true); try { AP.el.pause(); AP.el.removeAttribute('src'); AP.el.load(); } catch(e){} }
  Object.assign(AP, {real: false, book: '', track: '', want: null, played: 0, prevT: null, next: null, msg: ''});
  if('mediaSession' in navigator){ try { navigator.mediaSession.metadata = null; } catch(e){} }
  renderMini();
}
// Экран блокировки и пульт: название главы и книги, обложка, кнопки
function apSession(t){
  if(!('mediaSession' in navigator)) return;
  const b = byId('books', t.book) || {};
  try {
    const art = b.cover ? [{src: location.origin + coverUrl(b), sizes: '400x600', type: 'image/jpeg'}] : [{src: location.origin + '/icons/icon-512.png?v=2', sizes: '512x512', type: 'image/png'}];
    navigator.mediaSession.metadata = new MediaMetadata({title: t.title, artist: authorsText(b) || 'Библиотека', album: b.title || '', artwork: art});
    const set = (k, fn) => { try { navigator.mediaSession.setActionHandler(k, fn); } catch(e){} };
    set('play', () => apToggle());
    set('pause', () => { if(AP.el) AP.el.pause(); });
    set('seekbackward', d => apSkip(-((d && d.seekOffset) || AU_SKIP)));
    set('seekforward', d => apSkip((d && d.seekOffset) || AU_SKIP));
    set('seekto', d => { if(AP.el && d && d.seekTime != null){ AP.el.currentTime = d.seekTime; AP.prevT = d.seekTime; apTick(); apPos(); } });
    set('previoustrack', () => { const el = AP.el; const cur = trackById(AP.track); if(!cur) return; if(el && el.currentTime > 5){ el.currentTime = 0; return; } const list = tracksOf(cur.book); const i = list.findIndex(x => x.id === cur.id); if(i > 0) apPlay(list[i - 1].id, {restart: true}); });
    set('nexttrack', () => { const cur = trackById(AP.track), nx = cur && nextTrack(cur); if(nx) apPlay(nx.id, {restart: !!(progOf(nx.id) || {}).done}); });
  } catch(e){}
}
function apPos(){
  const el = AP.el;
  if(!el || !('mediaSession' in navigator) || !navigator.mediaSession.setPositionState || !isFinite(el.duration) || !el.duration) return;
  try { navigator.mediaSession.setPositionState({duration: el.duration, playbackRate: el.playbackRate || 1, position: Math.min(el.currentTime || 0, el.duration)}); } catch(e){}
}
// Обновить время и ползунок без перерисовки экрана
function apTick(){
  const el = AP.el;
  if(!el) return;
  const t = el.currentTime || 0, d = isFinite(el.duration) && el.duration ? el.duration : ((trackById(AP.track) || {}).duration || 0);
  const box = document.querySelector(`.ap-ctl[data-track="${AP.track}"]`);
  if(box){
    const sk = box.querySelector('.ap-seek');
    if(sk && !AP.seeking){ sk.max = Math.max(1, Math.floor(d)); sk.value = Math.floor(t); }
    const n = box.querySelector('.ap-now'), r = box.querySelector('.ap-left');
    if(n && !AP.seeking) n.textContent = durShort(t);
    if(r) r.textContent = d ? '−' + durShort(Math.max(0, d - t)) : '';
  }
  const bar = $('#mini .prog i'); if(bar && d) bar.style.width = Math.min(100, t / d * 100) + '%';
}
function apPaint(){
  const on = apOn();
  $$('.ap-play').forEach(b => { if(b.dataset.track && b.dataset.track !== AP.track) return; b.innerHTML = on ? ICON.pause : ICON.play; b.setAttribute('aria-label', on ? 'Пауза' : 'Играть'); });
  $$('.ap-msg').forEach(p => { p.textContent = AP.msg; p.hidden = !AP.msg; });
  $$('.ap-rates button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.r === AP.rate)));
  if('mediaSession' in navigator){ try { navigator.mediaSession.playbackState = on ? 'playing' : AP.track ? 'paused' : 'none'; } catch(e){} }
  apTick(); renderMini();
}

/* ---------- Мини-плеер ---------- */
// Внизу экрана, пока глава выбрана: звук не прерывается на других экранах. Нажатие открывает плеер целиком.
function renderMini(){
  let el = $('#mini');
  const r = route(), t = trackById(AP.track), b = t && byId('books', t.book);
  const show = !!(t && b && S.loaded && r.name !== 'listen' && !RD.open);
  document.documentElement.classList.toggle('has-mini', show);
  if(!show){ if(el) el.remove(); return; }
  if(!el){ el = document.createElement('div'); el.id = 'mini'; el.className = 'mini'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Плеер'); $('#app').appendChild(el); }
  const on = apOn();
  const key = [t.id, on, AP.msg, b.cover, t.title].join('|');
  if(el.dataset.key === key) return;
  el.dataset.key = key;
  el.innerHTML = `<a class="mini-open" href="#/listen/${b.id}" aria-label="Открыть плеер">${coverHTML(b, 'xs')}<span class="mini-t"><b>${esc(t.title)}</b><small>${esc(AP.msg || b.title)}</small></span></a>
    <button type="button" class="mini-play ap-play" data-mini="toggle" aria-label="${on ? 'Пауза' : 'Играть'}">${on ? ICON.pause : ICON.play}</button>
    <button type="button" class="icon-btn mini-x" data-mini="stop" aria-label="Закрыть плеер" title="Закрыть плеер">${ICON.close}</button>
    <span class="prog"><i></i></span>`;
  apTick();
}
document.addEventListener('click', e => {
  const b = e.target.closest('#mini [data-mini]');
  if(!b) return;
  if(b.dataset.mini === 'toggle') apToggle(); else apStop();
});

/* ---------- Карточка книги: кнопка «Слушать» и главы ---------- */
function listenBtn(b, primary){
  const list = tracksOf(b.id);
  if(!list.length || bookNA(b)) return '';
  const nw = audioNew(b.id);
  return `<a class="btn${primary ? ' primary big' : ''} listen-btn${nw ? ' dot' : ''}" href="#/listen/${b.id}" data-act="au-listen" data-id="${b.id}">${ICON.head}<span>Слушать</span>${nw ? '<span class="tag new">Новая глава</span>' : ''}</a>`;
}
function trackRow(t, b){
  const p = progOf(t.id), cur = AP.track === t.id, ro = roBook(b);
  const tag = !t.published ? '<span class="tag wait">Черновик</span>' : trackNew(t) ? '<span class="tag new">Новая</span>' : p && p.done ? '<span class="tag ok">прослушано</span>' : '';
  const left = trackLeft(t);
  const sub = [t.duration ? durShort(t.duration) : '', p && !p.done && p.pos > 5 && left ? 'осталось ' + minText(left) : ''].filter(Boolean).join(' · ');
  const icon = ro ? ICON.head : cur && apOn() ? ICON.pause : ICON.play;
  return `<div class="au-row${cur ? ' on' : ''}"><button type="button" class="au-main" data-act="au-track" data-id="${t.id}"${ro ? ' disabled' : ''} aria-label="${cur && apOn() ? 'Пауза' : 'Слушать'}: ${esc(t.title)}">
      <span class="au-ic${cur ? ' ap-play' : ''}"${cur ? ` data-track="${t.id}"` : ''}>${icon}</span><span class="au-t"><b>${esc(t.title)}</b>${sub ? `<small>${sub}</small>` : ''}</span>${tag}</button>
    ${isAdmin() ? `<button type="button" class="icon-btn" data-act="au-menu" data-id="${t.id}" aria-label="Действия с главой" aria-haspopup="menu" title="Действия с главой">${ICON.more}</button>` : ''}</div>`;
}
function audioBlock(b){
  const list = tracksOf(b.id);
  if(!list.length || bookNA(b)) return '';
  const total = list.reduce((n, t) => n + (t.duration || 0), 0);
  const drafts = list.filter(t => !t.published).length;
  return `<section class="card audio-card" id="audio"><div class="block-h"><h2>Аудио <span class="n">${list.length}</span></h2><span class="muted">${total ? minText(total) : ''}</span></div>
    ${isAdmin() && drafts ? `<p class="hint">Черновики видите и слушаете только вы. Читателям глава откроется, когда вы нажмёте «⋯» → «Опубликовать».</p>` : ''}
    <div class="au-list">${list.map(t => trackRow(t, b)).join('')}</div>
    ${isAdmin() ? `<button type="button" class="btn" data-act="au-add" data-id="${b.id}">${ICON.plus}<span>Добавить главу</span></button>` : ''}</section>`;
}

/* ---------- Плеер целиком: #/listen/ID_КНИГИ ---------- */
VIEWS.listen = r => {
  const b = byId('books', r.id);
  if(!b || bookNA(b)) return notFound();
  const list = tracksOf(b.id);
  const back = backLink('#/b/' + b.id, b.title);
  if(!list.length) return `${back}<div class="card"><p>У этой книги пока нет аудио.</p></div>`;
  const mine = AP.book === b.id && trackById(AP.track);
  const t = mine || contTrack(b.id);
  const el = AP.el, pl = mine && AP.real && el;
  const dur = (pl && isFinite(el.duration) && el.duration) || t.duration || 0;
  const pos = pl ? (el.currentTime || 0) : ((progOf(t.id) || {}).done ? 0 : ((progOf(t.id) || {}).pos || 0));
  const on = apOn() && mine;
  const ro = roBook(b);
  const ctl = ro ? roNote() : `<div class="ap-ctl" data-track="${t.id}">
      <input type="range" class="ap-seek" min="0" max="${Math.max(1, Math.floor(dur))}" value="${Math.floor(pos)}" step="1" aria-label="Перемотка"${mine ? '' : ' disabled'}>
      <div class="ap-time"><span class="ap-now">${durShort(pos)}</span><span class="ap-left">${dur ? '−' + durShort(Math.max(0, dur - pos)) : ''}</span></div>
      <div class="ap-main">
        <button type="button" class="btn ap-skip" data-act="au-skip" data-k="-${AU_SKIP}" aria-label="Назад на 15 секунд">−15 с</button>
        <button type="button" class="ap-play big" data-act="au-toggle" data-id="${t.id}" data-track="${t.id}" aria-label="${on ? 'Пауза' : 'Играть'}">${on ? ICON.pause : ICON.play}</button>
        <button type="button" class="btn ap-skip" data-act="au-skip" data-k="${AU_SKIP}" aria-label="Вперёд на 15 секунд">+15 с</button>
      </div>
      <div class="ap-rates" role="group" aria-label="Скорость">${AU_RATES.map(x => `<button type="button" data-act="au-rate" data-r="${x}" aria-pressed="${x === AP.rate}">${String(x).replace('.', ',')}×</button>`).join('')}</div>
      <p class="ap-msg form-err"${AP.msg && mine ? '' : ' hidden'}>${esc(mine ? AP.msg : '')}</p>
    </div>`;
  return `${back}
    <section class="ap-full">
      <div class="ap-cover">${coverHTML(b, 'lg')}</div>
      <div class="ap-head"><small>${esc(b.title)}${authorsText(b) ? ' · ' + esc(authorsText(b)) : ''}</small><h1>${esc(t.title)}</h1>${!t.published ? '<span class="tag wait">Черновик</span>' : ''}</div>
      ${ctl}
    </section>
    <section class="card audio-card" aria-label="Главы"><div class="au-list">${list.map(x => trackRow(x, b)).join('')}</div>
      ${isAdmin() ? `<button type="button" class="btn" data-act="au-add" data-id="${b.id}">${ICON.plus}<span>Добавить главу</span></button>` : ''}</section>`;
};

/* ---------- «Продолжить слушание» на главной ---------- */
function contListenHTML(){
  const last = S.aprog.filter(p => { const t = trackById(p.track), b = t && byId('books', t.book); return b && !bookNA(b); })
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated)))[0];
  if(!last) return '';
  const b = byId('books', last.book) || byId('books', (trackById(last.track) || {}).book);
  const t = b && contTrack(b.id);
  if(!t) return '';
  const p = progOf(t.id);
  // всё дослушано и следующей главы нет: блок не нужен
  if(p && p.done && t.id === last.track && !nextTrack(t)) return '';
  const left = trackLeft(t), on = apOn() && AP.track === t.id;
  return `<section class="block"><h2>Продолжить слушание</h2><div class="cont"><button type="button" class="cont-item au-cont" data-act="au-cont" data-id="${t.id}" aria-label="${on ? 'Пауза' : 'Слушать дальше'}: ${esc(b.title)}, ${esc(t.title)}">
    ${coverHTML(b, 'sm')}<span><b>${esc(b.title)}</b><small>${esc(t.title)}${audioNew(b.id) ? ' · <span class="new-txt">есть новая глава</span>' : ''}</small>
    <small>${left && p && p.pos > 5 ? 'осталось ' + minText(left) : t.duration ? durShort(t.duration) : ''}</small></span><span class="au-ic ap-play" data-track="${t.id}">${on ? ICON.pause : ICON.play}</span></button></div></section>`;
}

/* ---------- Главы: добавить, переименовать, заменить файл, опубликовать, переставить, удалить (администратор) ---------- */
// Длительность узнаёт браузер (сервер проверит её по заголовкам файла сам, это запасной вариант)
function fileDuration(file){
  return new Promise(res => {
    const a = document.createElement('audio'), url = URL.createObjectURL(file);
    const done = v => { clearTimeout(tm); URL.revokeObjectURL(url); res(v > 0 && isFinite(v) ? v : 0); };
    const tm = setTimeout(() => done(0), 8000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(a.duration); a.onerror = () => done(0);
    a.src = url;
  });
}
const AU_ABOUT = 'MP3 или M4A (AAC) до 200 МБ. Для голоса хватит MP3 моно 64 кбит/с: час записи около 28 МБ.';
function audioAdd(b, track){
  const list = tracksOf(b.id);
  const t = track ? trackById(track) : null;
  const fields = t ? [] : [{key: 'title', label: 'Название главы', required: true, max: 200, placeholder: 'Например: Предисловие, Глава 1'},
    ...(list.length ? [{key: 'pos', type: 'select', label: 'Место в списке', options: [['', 'в конце'], ...list.map((x, i) => [String(i + 1), `перед «${x.title}»`])]}] : [])];
  openForm({title: t ? `Заменить файл: «${t.title}»` : 'Новая глава аудио', fields, values: {title: t ? t.title : `Глава ${list.length ? list.length : 1}`, pos: ''},
    text: t ? 'Прогресс слушателей останется. Опубликованная глава сразу будет играть новый файл.' : 'Глава появится черновиком: её видите и можете прослушать только вы. Читателям она откроется после «Опубликовать».',
    html: `<div class="field"><label for="au-file">Файл главы</label><input type="file" id="au-file" accept=".mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a"><p class="hint">${AU_ABOUT}</p></div>`,
    submit: 'Загрузить',
    async onSave(v){
      const f = ($('#au-file').files || [])[0];
      if(!f) throw {message: 'Выберите файл главы.'};
      if(!AU_EXT.test(f.name)) throw {message: 'Подходят только MP3 и M4A.'};
      if(f.size > AU_MAX) throw {message: 'Файл больше 200 МБ. Сохраните главу с меньшим битрейтом, для голоса хватит 64 кбит/с.'};
      const duration = await fileDuration(f);
      loadDisk();
      addUploads([f], 'audio', '', b.id, t ? {track: t.id} : {title: v.title, pos: v.pos ? +v.pos : 0, duration});
    }});
}
function audioMenu(btn, t){
  const b = byId('books', t.book);
  const list = tracksOf(t.book), i = list.findIndex(x => x.id === t.id);
  const items = [
    {label: t.published ? 'Снять с публикации' : 'Опубликовать', run: async () => {
      try { const r = await pb.send(`/api/knigi/audio/${t.id}`, {method: 'POST', body: {published: !t.published}}); upsert('atracks', r); toast(r.published ? 'Глава открыта читателям' : 'Глава снова черновик'); } catch(e){ toast(errText(e)); } }},
    {label: 'Переименовать', run: () => openForm({title: 'Название главы', fields: [{key: 'title', label: 'Название', required: true, max: 200}], values: {title: t.title},
      async onSave(v){ upsert('atracks', await pb.send(`/api/knigi/audio/${t.id}`, {method: 'POST', body: {title: v.title}})); toast('Сохранено'); }})},
    {label: 'Заменить файл', run: () => b && audioAdd(b, t.id)},
  ];
  if(i > 0) items.push({label: 'Выше', run: () => audioMove(t, -1)});
  if(i >= 0 && i < list.length - 1) items.push({label: 'Ниже', run: () => audioMove(t, 1)});
  items.push({label: 'Удалить главу', danger: true, run: () => openForm({title: 'Удалить главу?', text: `«${t.title}»: файл удалится с сервера, прогресс слушания этой главы у всех тоже. Вернуть можно только новой загрузкой.`,
    submit: 'Удалить', danger: true, async onSave(){
      if(AP.track === t.id) apStop();
      await pb.send(`/api/knigi/audio/${t.id}`, {method: 'DELETE'});
      removeLocal('atracks', t.id); S.aprog = S.aprog.filter(p => p.track !== t.id); loadDisk();
      toast('Глава удалена');
    }})});
  openMenu(btn, items);
}
async function audioMove(t, dir){
  try { await pb.send(`/api/knigi/audio/${t.id}/move`, {method: 'POST', body: {dir}}); await loadAll(['atracks']); } catch(e){ toast(errText(e)); }
}
// «Добавить книги» → «Аудиокнига без текста»: название, автор, по желанию обложка. Книга создаётся скрытой.
function audioBookForm(){
  const dl = `<datalist id="authors-dl">${S.authors.map(a => `<option value="${esc(a.name)}">`).join('')}</datalist>`;
  openForm({title: 'Аудиокнига без текста', text: 'Книга появится скрытой, как любая новая: её видите только вы. Потом добавьте главы, опубликуйте их и откройте книгу всем или отдельным читателям («⋯» → «Настройки»). Текстовый файл можно добавить позже: «⋯» → «Добавить формат».',
    fields: [{key: 'title', label: 'Название', required: true, max: 500}, {key: 'authors', label: 'Автор (через запятую, если несколько)', max: 1000, list: 'authors-dl'}],
    html: dl + `<div class="field"><label for="ab-cover">Картинка обложки (необязательно)</label><input type="file" id="ab-cover" accept="image/jpeg,image/png,image/webp,image/gif"><p class="hint">Без картинки будет простая обложка с названием.</p></div>`,
    submit: 'Создать',
    async onSave(v){
      const cover = ($('#ab-cover').files || [])[0];
      if(cover && cover.size > 10 * MB) throw {message: 'Картинка больше 10 МБ.'};
      const res = await pb.send('/api/knigi/audio-books', {method: 'POST', body: {title: v.title, authors: v.authors}});
      if(cover){ const fd = new FormData(); fd.append('cover', cover); try { await pb.send(`/api/knigi/books/${res.id}/cover`, {method: 'POST', body: fd}); } catch(e){ toast(errText(e)); } }
      await loadAll(['books', 'authors']);
      go('#/b/' + res.id);
      thenOpen(() => { const b = byId('books', res.id); if(b) audioAdd(b); });
    }});
}

/* ---------- Читалка PDF ---------- */
// pdf.js (лицензия Apache 2.0) лежит в vendor/pdfjs. Файл книги целиком не передаётся: читалка просит у сервера
// только нужные куски по 512 КБ (свой загрузчик PDFDataRangeTransport, каждый кусок отдельным запросом с Range).
// Сохранения, печати и кнопки «Скачать» в читалке нет. Подпись читателя рисуется прямо на холсте страницы.
// Текстовый слой есть у всех (READER_TEXT_LAYER), у читателей копирование, контекстное меню и перетаскивание выключены.
// Выделения рисуются отдельным слоем под текстовым (.hl-layer), подпись остаётся на холсте.
const READER = {mode: ''}; // 'pdf' или 'epub': какая читалка сейчас на экране
const RD = {open: false, key: '', fmt: 'pdf', src: null, doc: null, lib: null, link: null, linkAt: 0, mark: '', title: '', page: 1, pages: 0, zoom: 1,
  cache: new Map(), seq: 0, seen: new Set(), saveT: 0, pending: [], pause: 0, bars: true, outline: null, back: '#/',
  hls: [], marker: false, mk: null, flash: '', group: null, ghls: [], focusO: ''};
const rdText = () => isAdmin() || READER_TEXT_LAYER;
// Телефон и планшет: у читателя обычное выделение выключено (иначе Safari покажет «Скопировать» и «Поделиться»), выделяет «Маркер»
const touchUI = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;
let pdfjsLoad = null;
function loadPdfjs(){
  if(!pdfjsLoad) pdfjsLoad = import('/vendor/pdfjs/pdf.min.mjs').then(lib => { lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'; return lib; }).catch(e => { pdfjsLoad = null; throw e; });
  return pdfjsLoad;
}
async function rdGetLink(force){
  if(!force && RD.link && Date.now() - RD.linkAt < (RD.link.ttl - 600) * 1000) return RD.link;
  const s = RD.src;
  RD.link = await pb.send(s.kind === 'book' ? `/api/knigi/books/${s.id}/link?f=${RD.fmt}` : `/api/knigi/files/${s.id}/link`, {});
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
  if(READER.mode === 'epub'){ const k = EP.key; EP.key = ''; epShow(route(), byId('books', EP.bookId), k); return; }
  const p = RD.pending; RD.pending = [];
  for(const [t, b, e] of p) rdQueue(t, b, e);
}
function rdMsg(text, isErr){
  const m = $('#rd-msg'); if(!m) return;
  if(!text){ m.hidden = true; return; }
  m.innerHTML = `<div class="rd-msg-box"><p${isErr ? ' class="form-err"' : ''}>${esc(text)}</p>${isErr ? '<button type="button" class="btn" data-rd="close">Закрыть</button>' : ''}</div>`;
  m.hidden = false;
}
const markerBtn = () => `<button type="button" class="icon-btn mk-btn" data-rd="marker" id="rd-marker" aria-pressed="false" aria-label="Маркер" title="Маркер: выделять текст пальцем или мышью">${ICON.marker}</button>`;
function rdShell(){
  const box = $('#reader');
  const book = RD.src.kind === 'book';
  box.innerHTML = `<div class="rd-top"><button type="button" class="icon-btn" data-rd="close" aria-label="Закрыть книгу" title="Закрыть книгу">${ICON.back}</button>
      <h1 class="rd-title"><button type="button" class="rd-title-btn" data-rd="close" id="rd-title" title="Карточка книги"></button></h1>
      <button type="button" class="icon-btn" data-rd="toc" id="rd-toc" aria-label="Оглавление" title="Оглавление" hidden>${ICON.toc}</button>
      ${book && !readOnly() ? markerBtn() + `<button type="button" class="btn sm" data-rd="note" title="Заметка к этой странице">${ICON.pen}<span>Заметка</span></button>` : ''}
      <button type="button" class="icon-btn" data-rd="menu" aria-label="Ещё" aria-haspopup="menu" title="Ещё">${ICON.more}</button></div>
    <div class="rd-gline" id="rd-gline" aria-hidden="true"></div>
    <div class="rd-stage" id="rd-stage"><div class="rd-pagebox" id="rd-pagebox"></div></div>
    <div class="rd-bottom"><button type="button" class="icon-btn" data-rd="prev" aria-label="Предыдущая страница" title="Предыдущая страница">${ICON.left}</button>
      <button type="button" class="rd-num" data-rd="goto" id="rd-num" aria-label="Перейти к странице" title="Перейти к странице">…</button>
      <button type="button" class="icon-btn" data-rd="next" aria-label="Следующая страница" title="Следующая страница">${ICON.right}</button>
      <span class="rd-sp"></span>
      <button type="button" class="icon-btn" data-rd="zout" aria-label="Уменьшить" title="Уменьшить">${ICON.zout}</button>
      <button type="button" class="icon-btn" data-rd="zin" aria-label="Увеличить" title="Увеличить">${ICON.zin}</button>
      ${document.fullscreenEnabled ? `<button type="button" class="icon-btn" data-rd="full" aria-label="Во весь экран" title="Во весь экран">${ICON.full}</button>` : ''}</div>
    <input type="range" class="rd-slider" id="rd-slider" min="1" max="1" value="1" aria-label="Страница">
    <div class="rd-msg" id="rd-msg" hidden></div>`;
  rdReaderClasses();
  RD.marker = false;
}
function rdReaderClasses(){
  const box = $('#reader');
  RD.bars = true; box.classList.remove('bars-off');
  box.classList.toggle('reader-free', isAdmin());
  box.classList.toggle('touch', touchUI());
  box.classList.toggle('dark-pages', !!loadLS('darkPages', false));
  box.classList.toggle('epub', READER.mode === 'epub');
  box.classList.remove('marker');
}
function rdOpenScreen(){
  // при каждом открытии книги панели видны (спрятать их можно нажатием в середину страницы)
  if(!RD.open){ RD.bars = true; $('#reader').classList.remove('bars-off'); }
  $('#app').hidden = true; $('#reader').hidden = false; RD.open = true;
  document.documentElement.classList.add('reading');
}
function rdFail(text){
  $('#reader').innerHTML = `<div class="rd-msg"><div class="rd-msg-box"><p>${esc(text)}</p><button type="button" class="btn" data-rd="close">Назад</button></div></div>`;
}
// Групповой режим (#/read/ID?g=ГРУППА): человек в группе, группа сейчас читает эту книгу.
// Новые цитаты и заметки по умолчанию видны группе, можно показать цитаты других участников.
function readerGroup(r, bookId){ const g = byId('groups', r.q.get('g') || ''); return g && g.book === bookId && myMember(g.id) ? g : null; }
const rdGroup = () => READER.mode === 'epub' ? EP.group : RD.group;
const grpShow = () => !!loadLS('grpHls', false);
async function rdShow(r){
  rdOpenScreen();
  hpHide();
  let fmt = 'pdf';
  if(r.name === 'read'){
    const b = byId('books', r.id);
    // срок доступа закончился (правки 4.1): книги не открываются
    if(roBook(b)){ if(READER.mode === 'epub') epDispose(); READER.mode = ''; RD.back = b ? '#/b/' + b.id : '#/'; rdFail(`${accHead(S.access)}: книги сейчас не открываются. Чтобы продлить, напишите: ${S.access.contact || 'администратору'}.`); return; }
    // скрытая книга (правки 4.1): читатель её не открывает
    if(!isAdmin() && (b ? bookNA(b) : S.notes.some(n => n.book === r.id))){ if(READER.mode === 'epub') epDispose(); READER.mode = ''; RD.back = b ? '#/b/' + b.id : '#/'; rdFail(NA_TEXT); return; }
    fmt = r.q.get('f') || (b ? defaultFormat(b) : 'pdf');
    if(b && !VIEW[fmt]){ READER.mode = ''; RD.back = '#/b/' + b.id; rdFail('Такой формат читалка не открывает.'); return; }
    // FB2, MOBI, AZW3, TXT сервер перевёл в EPUB, DjVu в PDF: открываются этими читалками
    if(isEpView(fmt)) return epShow(r, b);
  }
  if(READER.mode === 'epub') epDispose();
  READER.mode = 'pdf';
  const src = r.name === 'read' ? {kind: 'book', id: r.id} : {kind: 'file', id: r.id};
  const key = src.kind + ':' + src.id + (src.kind === 'book' ? ':' + fmt : '');
  const want = +r.q.get('p') || 0;
  RD.flash = r.q.get('hl') || '';
  RD.focusO = RD.flash;
  const grp = src.kind === 'book' ? readerGroup(r, src.id) : null, grpChanged = (RD.group && RD.group.id) !== (grp && grp.id);
  RD.group = grp;
  if(RD.key === key && RD.doc){
    if($('#rd-pagebox') == null){ RD.src = src; rdShell(); $('#rd-slider').max = RD.pages; rdMarkerState(); const t = $('#rd-toc'); if(t) t.hidden = !RD.outline; }
    rdHeader();
    if(grpChanged || RD.flash) rdLoadGHls(); else rdDrawAll();
    if(want && want !== RD.page) rdGo(want); else rdGo(RD.page, true);
    return;
  }
  // другая книга: прежнюю закрываем
  rdDispose();
  RD.key = key; RD.src = src; RD.fmt = src.kind === 'book' ? fmt : 'pdf'; RD.zoom = 1; RD.seen = new Set(); RD.pause = 0; RD.pending = []; RD.hls = []; RD.ghls = [];
  if(src.kind === 'book'){
    const b = byId('books', src.id);
    if(!b){ RD.key = ''; rdFail('Книга не найдена.'); return; }
    RD.title = b.title; RD.back = '#/b/' + b.id;
    const f = fileOf(b.id, RD.fmt);
    if(!f){ RD.key = ''; rdFail(`У этой книги нет файла ${FORMATS[RD.fmt] || RD.fmt}.`); return; }
    if(f.status === 'processing'){ RD.key = ''; rdFail('Книга ещё обрабатывается. Попробуйте через минуту.'); return; }
  } else {
    const f = byId('nfiles', src.id);
    RD.title = f ? f.name : 'Файл урока'; RD.back = r.q.get('note') ? '#/note/' + r.q.get('note') : '#/notes';
  }
  rdShell(); rdHeader(); rdMarkerState();
  rdMsg('Открываю…');
  try {
    const [lib, link] = await Promise.all([loadPdfjs(), rdGetLink(true)]);
    if(RD.key !== key) return;
    RD.lib = lib; RD.mark = link.mark || ''; RD.markCfg = link.mark_cfg || null;
    RD.transport = rdMakeTransport(lib, link.size);
    const task = lib.getDocument({range: RD.transport, length: link.size, rangeChunkSize: CHUNK_PDF, disableAutoFetch: true, disableStream: true,
      isEvalSupported: false, enableXfa: false, cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/'});
    RD.task = task;
    const doc = await task.promise;
    if(RD.key !== key){ doc.destroy(); return; }
    RD.doc = doc; RD.pages = doc.numPages;
    rdMsg('');
    const rd = src.kind === 'book' ? readOf(src.id, RD.fmt) : null;
    const start = Math.min(RD.pages, Math.max(1, want || (rd ? rd.page : 1)));
    $('#rd-slider').max = RD.pages;
    if(src.kind === 'book'){ rdLoadHls(); rdLoadGHls(); }
    rdGo(start, true);
    doc.getOutline().then(o => { RD.outline = o && o.length ? o : null; const t = $('#rd-toc'); if(t) t.hidden = !RD.outline; }).catch(() => {});
  } catch(e){
    if(RD.key !== key) return;
    rdMsg(e && e.name === 'PasswordException' ? 'Файл защищён паролем, его нельзя открыть.' : e && e.name === 'InvalidPDFException' ? 'Файл повреждён или это не PDF.' : errText(e), true);
  }
}
function rdHeader(){
  const t = $('#rd-title'); if(!t) return;
  const g = rdGroup();
  t.innerHTML = `<span class="rd-t1">${esc(READER.mode === 'epub' ? EP.title : RD.title)}</span>${g ? `<small class="rd-grp">Группа: ${esc(g.name)}</small>` : ''}`;
  t.title = g ? 'Назад в группу' : 'Карточка книги';
  const gl = $('#rd-gline'); if(gl) gl.textContent = g ? 'Группа: ' + g.name : '';
  $('#reader').classList.toggle('in-group', !!g);
}
function rdDispose(){
  clearTimeout(RD.saveT); clearTimeout(RD.pauseT);
  if(RD.doc) RD.doc.destroy().catch(() => {});
  else if(RD.task) RD.task.destroy().catch(() => {});
  RD.doc = null; RD.task = null; RD.transport = null; RD.cache.clear(); RD.key = ''; RD.link = null; RD.outline = null; RD.pause = 0; RD.pending = []; RD.hls = []; RD.ghls = []; RD.mk = null;
}
function rdClose(){
  askHide();
  if(READER.mode === 'epub') epSave(true);
  else if(RD.doc) rdSave(true);
  hpHide();
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
  // снизу поверх страницы лежит ползунок: оставляем под него место, чтобы он не закрывал нижнее поле страницы
  // (там номер страницы и строка подписи читателя)
  const W = Math.max(200, st.clientWidth - 16), H = Math.max(200, st.clientHeight - 64);
  return Math.min(W / vp.width, H / vp.height);
}
// Подпись читателя прямо на холсте (настройки WATERMARK_MODE и WATERMARK_OPACITY приходят со ссылкой):
// мелкая приглушённая строка «Имя · почта · дата» на нижнем поле и одна бледная тонкая надпись по диагонали.
// dark: рисуем светлым по тёмному фону (подпись EPUB в тёмной теме). Одинаковая прозрачность на тёмном фоне
// заметнее, чем на светлом (глаз чувствительнее к разнице в темноте), поэтому там она умножается на DARK_K:
// тогда разница светлоты с фоном в обеих темах примерно одна (около 2,5 единицы L* при 4%).
const WM_DARK_K = 0.65;
function rdWatermark(ctx, w, h, text, cfg, dark, inverted){
  text = text == null ? RD.mark : text; if(!text) return;
  cfg = cfg || RD.markCfg || {};
  const mode = cfg.mode || 'both', op = Math.min(30, Math.max(1, +cfg.opacity || 4)) / 100;
  // inverted: страница PDF в «Тёмных страницах» (холст переворачивается CSS): чернила те же, бледность как в тёмной теме
  const k = dark || inverted ? WM_DARK_K : 1, ink = dark ? '232, 226, 214' : '40, 40, 40';
  if(mode !== 'edge'){
    const diag = Math.hypot(w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2); ctx.rotate(-Math.atan2(h, w));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let fs = h * 0.045;
    ctx.font = `400 ${fs}px "Golos Text", Arial, sans-serif`;
    const mw = ctx.measureText(text).width;
    if(mw > diag * 0.7){ fs *= diag * 0.7 / mw; ctx.font = `400 ${fs}px "Golos Text", Arial, sans-serif`; }
    ctx.fillStyle = `rgba(${ink}, ${(op * k).toFixed(3)})`;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  if(mode !== 'center'){
    ctx.save();
    const small = Math.max(8, Math.min(w / 95, h / 70));
    ctx.font = `400 ${small}px "Golos Text", Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = `rgba(${ink}, ${(0.2 * k).toFixed(3)})`;
    const d = new Date();
    // у самого нижнего края: на поле страницы, ниже текста
    ctx.fillText(`${text} · ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`, w / 2, cfg.bottom || h - Math.max(2, small * 0.35));
    ctx.restore();
  }
}
// Нарисовать страницу n в новый элемент (холст, слой выделений и, если можно, текстовый слой)
async function rdRender(n){
  const inv = !!loadLS('darkPages', false);
  const key = n + '@' + RD.zoom + '@' + window.innerWidth + 'x' + window.innerHeight + (inv ? '@d' : '');
  const hit = RD.cache.get(n);
  if(hit && hit.key === key) return hit.el;
  const page = await RD.doc.getPage(n);
  const scale = rdFit(page) * RD.zoom;
  const vp = page.getViewport({scale});
  let out = Math.min(window.devicePixelRatio || 1, 2);
  if(vp.width * vp.height * out * out > 12e6) out = Math.sqrt(12e6 / (vp.width * vp.height));
  const el = document.createElement('div');
  el.className = 'rd-page';
  el.dataset.n = n;
  el.style.width = Math.floor(vp.width) + 'px'; el.style.height = Math.floor(vp.height) + 'px';
  el.style.setProperty('--scale-factor', vp.scale);
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width * out); canvas.height = Math.floor(vp.height * out);
  canvas.setAttribute('draggable', 'false');
  el.appendChild(canvas);
  const ctx = canvas.getContext('2d', {alpha: false});
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({canvasContext: ctx, viewport: vp, transform: out !== 1 ? [out, 0, 0, out, 0, 0] : null}).promise;
  rdWatermark(ctx, canvas.width, canvas.height, null, null, false, inv);
  const hl = document.createElement('div'); hl.className = 'hl-layer'; el.appendChild(hl);
  const tmp = document.createElement('div'); tmp.className = 'hl-layer hl-tmp'; el.appendChild(tmp);
  if(rdText()){
    const tl = document.createElement('div'); tl.className = 'textLayer'; el.appendChild(tl);
    try { await new RD.lib.TextLayer({textContentSource: page.streamTextContent(), container: tl, viewport: vp}).render(); } catch(e){}
  }
  rdDrawHls(el, n);
  RD.cache.set(n, {key, el});
  // держим в памяти только соседние страницы
  for(const k of [...RD.cache.keys()]) if(Math.abs(k - n) > 2 && Math.abs(k - RD.page) > 2) RD.cache.delete(k);
  return el;
}
async function rdGo(n, force){
  if(!RD.doc) return;
  n = Math.min(RD.pages, Math.max(1, n | 0));
  if(n === RD.page && !force && $('#rd-pagebox .rd-page')){ rdFlash(); return; }
  if(n !== RD.page) hpHide();
  RD.page = n;
  const seq = ++RD.seq;
  $('#rd-num').textContent = `${n} из ${RD.pages}`;
  const sl = $('#rd-slider'); if(sl) sl.value = n;
  const box = $('#rd-pagebox');
  box.classList.add('busy');
  try {
    const el = await rdRender(n);
    if(seq !== RD.seq || !RD.open || READER.mode !== 'pdf') return;
    box.replaceChildren(el);
    box.classList.remove('busy');
    $('#rd-stage').classList.toggle('zoomed', RD.zoom > 1);
    if(RD.zoom === 1) $('#rd-stage').scrollTo(0, 0);
    RD.seen.add(n);
    rdSaveSoon();
    if(RD.src.kind === 'book') askCheck(RD.src.id, n, null);
    rdFlash();
    // следующую страницу готовим заранее, чтобы листалось без ожидания
    if(n < RD.pages) setTimeout(() => { if(seq === RD.seq) rdRender(n + 1).catch(() => {}); }, 250);
  } catch(e){
    if(seq === RD.seq && !(e instanceof RangeError429) && e && e.name !== 'RenderingCancelledException') rdMsg(errText(e), true);
  }
}
function rdSaveSoon(){ clearTimeout(RD.saveT); RD.saveT = setTimeout(() => rdSave(false), 1500); }
// Прогресс и открытые страницы (для журнала): только у книг
function saveReading(id, fmt, res){
  const old = readOf(id, fmt);
  upsert('reading', {...(old || {}), id: res.id || (old && old.id) || 'tmp-' + id + fmt, book: id, user: me().id, format: fmt, page: res.page, pages: res.pages, pct: res.pct || 0, pos: res.pos || '', updated: res.updated || new Date().toISOString().replace('T', ' ')});
}
function rdSave(leaving){
  clearTimeout(RD.saveT);
  if(!RD.src || RD.src.kind !== 'book' || !RD.doc) return;
  const fmt = RD.fmt;
  const body = {format: fmt, page: RD.page, pages: RD.pages, seen: [...RD.seen], day: todayStr()};
  RD.seen = new Set();
  const id = RD.src.id;
  const r = readOf(id, fmt);
  if(r && r.page === body.page && !body.seen.length) return;
  if(leaving){
    fetch(`/api/knigi/books/${id}/progress`, {method: 'POST', keepalive: true, headers: {'Content-Type': 'application/json', Authorization: pb.authStore.token}, body: JSON.stringify(body)}).catch(() => {});
    if(r) saveReading(id, fmt, {...r, page: body.page, updated: ''});
    return;
  }
  pb.send(`/api/knigi/books/${id}/progress`, {method: 'POST', body}).then(res => saveReading(id, fmt, res))
    .catch(() => { body.seen.forEach(p => RD.seen.add(p)); });
}
function rdZoom(k){
  const z = Math.min(4, Math.max(1, Math.round(RD.zoom * k * 100) / 100));
  if(z === RD.zoom) return;
  hpHide();
  RD.zoom = z; RD.cache.clear(); rdGo(RD.page, true);
}
function rdGoto(){
  openForm({title: 'Перейти к странице', fields: [{key: 'p', label: `Страница (от 1 до ${RD.pages})`, type: 'number', required: true}], values: {p: RD.page}, submit: 'Перейти',
    async onSave(v){ const p = +v.p; if(!(p >= 1 && p <= RD.pages)) throw {message: `Введите число от 1 до ${RD.pages}.`}; rdGo(p); }});
}
async function rdToc(){
  if(READER.mode === 'epub') return epToc();
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
// «Заметка»: новая заметка к книге с местом (у PDF страница, у EPUB глава и процент) и выделенным текстом цитатой
function rdNote(){
  const sel = HP.pending ? HP.pending.quote : '';
  let text = sel;
  if(!text && READER.mode === 'pdf'){
    const s = String(window.getSelection() || '').trim();
    text = s || (RD.sel && Date.now() - RD.sel.at < 15e3 ? RD.sel.text : '');
  }
  UI.quote = text ? text.slice(0, 3000) : '';
  UI.normalOnce = true;
  hpHide();
  if(READER.mode === 'epub'){
    const c = EP.cur || {};
    UI.noteCtx = {book: EP.bookId, format: EP.fmt, place: epPlace(c.chapter, c.pct), anchor: c.cfi ? {v: 1, cfi: c.cfi, pct: c.pct, chapter: c.chapter || ''} : null};
    epSave(false);
    go(`#/note/new?book=${EP.bookId}${EP.group ? '&g=' + EP.group.id : ''}`);
    return;
  }
  UI.noteCtx = {book: RD.src.id, format: RD.fmt, place: 'с. ' + RD.page};
  rdSave(false);
  go(`#/note/new?book=${RD.src.id}&page=${RD.page}${RD.group ? '&g=' + RD.group.id : ''}`);
}
function rdMenu(btn){
  const dark = !!loadLS('darkPages', false);
  const g = rdGroup(), bookId = READER.mode === 'epub' ? EP.bookId : RD.src.kind === 'book' ? RD.src.id : '';
  // в групповом режиме: цитаты других участников и путь обратно в группу
  const grpItems = g ? [{label: grpShow() ? 'Скрыть цитаты группы' : 'Показать цитаты группы', run: toggleGroupHls},
    {label: `Группа «${g.name}»`, run: readerBack}, {label: 'Карточка книги', run: () => { rdClose(); go('#/b/' + bookId); }}]
    : bookId ? [{label: 'Карточка книги', run: readerBack}] : [];
  if(READER.mode === 'epub'){
    openMenu(btn, [{label: 'Оглавление', run: epToc}, ...grpItems]);
    return;
  }
  openMenu(btn, [
    {label: dark ? 'Обычные страницы' : 'Тёмные страницы', run: () => { saveLS('darkPages', !dark); $('#reader').classList.toggle('dark-pages', !dark); if(RD.mark && RD.doc){ RD.cache.clear(); rdGo(RD.page, true); } }},
    {label: 'Перейти к странице', run: rdGoto},
    ...grpItems,
  ]);
}
// «Показать цитаты группы»: цитаты других участников бледнее моих, с кружком автора (выбор запоминается на устройстве)
function toggleGroupHls(){
  const on = !grpShow();
  saveLS('grpHls', on); hpHide();
  if(READER.mode === 'epub') epGroupDraw(); else rdDrawAll();
  toast(on ? (((READER.mode === 'epub' ? EP.ghls : RD.ghls).length) ? 'Цитаты группы показаны: они бледнее ваших.' : 'Других цитат группы в этом формате пока нет.') : 'Цитаты группы скрыты');
}
// Цитаты других участников группы в этой книге (загружаются в групповом режиме; рисуются, если включено или к ним перешли из ленты)
async function rdLoadGHls(){
  const g = RD.group, key = RD.key;
  if(!g || !RD.src || RD.src.kind !== 'book'){ RD.ghls = []; rdDrawAll(); return; }
  try {
    const list = await pb.collection('notes').getFullList({filter: pb.filter('book = {:b} && kind = "highlight" && group = {:g} && owner != {:u} && format = {:f}', {b: RD.src.id, g: g.id, u: me().id, f: RD.fmt}), fields: hlFields});
    if(RD.key !== key || !RD.group || RD.group.id !== g.id) return;
    RD.ghls = list; rdDrawAll(); rdFlash();
  } catch(e){}
}
// Живое обновление цитаты другого участника в открытой книге
function ghlLive(r, deleted){
  if(r.kind !== 'highlight' || r.owner === me().id) return;
  const upd = list => { const i = list.findIndex(x => x.id === r.id); if(deleted || !r.group){ if(i >= 0) list.splice(i, 1); } else if(r.anchor){ if(i >= 0) list[i] = {...r}; else list.push({...r}); } };
  if(RD.group && RD.src && RD.src.kind === 'book' && RD.src.id === r.book && (deleted || r.format === RD.fmt) && (deleted || r.group === RD.group.id)){ upd(RD.ghls); rdDrawAll(); }
  if(EP.group && EP.view && EP.bookId === r.book && (deleted || r.format === EP.fmt) && (deleted || r.group === EP.group.id)){
    const old = EP.ghls.find(x => x.id === r.id);
    if(old) epDelOther(old);
    upd(EP.ghls);
    const now = EP.ghls.find(x => x.id === r.id);
    if(now && (grpShow() || now.id === EP.focusO)) epAddOther(now);
  }
}
// Панель чужой цитаты: автор, текст, мысль, комментарии
function hpShowOther(h, rect){
  hpHide();
  Object.assign(HP, {mode: 'other', h, pending: null});
  const el = document.createElement('div');
  el.className = 'hl-pop other'; el.id = 'hl-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Цитата участника группы');
  const u = person(h.owner), k = commentsOf(h.id).length, q = h.quote || '', t = h.body_text || '';
  el.innerHTML = `<div class="hp-who">${faceHTML(u, 'xs')}<b>${esc(nameOf(u))}</b><small>${esc(fmtWhen(h.created))}</small></div>
    <p class="hp-q" style="--hl:${(HL[h.color] || HL.yellow)[1]}">${esc(q.slice(0, 240))}${q.length > 240 ? '…' : ''}</p>
    ${t ? `<p class="hp-t">${esc(t.slice(0, 300))}${t.length > 300 ? '…' : ''}</p>` : ''}
    <div class="hp-row"><button type="button" class="hp-b" data-hp="open">${ICON.chat}<span>${k ? k + ' ' + plural(k, ['комментарий', 'комментария', 'комментариев']) : 'Комментировать'}</span></button></div>`;
  $('#reader').appendChild(el);
  HP.el = el;
  hpPlace(el, rect);
}

/* ---------- Выделения ---------- */
// Выделения хранятся в notes (kind = "highlight"): quote = выделенный текст, page и format = где,
// place = «с. 45» или «Глава 3 · 41%», color = цвет, body = мысль, anchor = точное место:
//   PDF:  {v: 1, rects: [[x, y, w, h], …] в долях страницы, s, e: номера первой и последней буквы в тексте страницы}
//   EPUB: {v: 1, cfi: место в книге (EPUB CFI), pct, chapter}
// Каждый видит и меняет только свои выделения. Общие выделения администратора у читателей только в списках.
const HP = {mode: '', h: null, pending: null, el: null};
const hlFields = 'id,owner,book,book_title,kind,page,format,place,color,anchor,quote,body_text,shared,group,created,updated';
function hlStrip(rec){ return {...rec, body_text: String(rec.body_text || '').slice(0, 400), body: undefined, search: undefined, anchor: undefined}; }
// Панель выделения: цвета, «Заметка», у администратора «Копировать»; у готового выделения ещё мысль, удалить и «⋯»
function hpShow(o){
  hpHide();
  // своя книга без доступа (правки 4.3): читать можно, новые цитаты нельзя
  if(readOnly() && o.mode === 'new'){ toast(`${accHead(S.access)}: новые цитаты и заметки сейчас не сохраняются.`); return; }
  Object.assign(HP, {mode: o.mode, h: o.h || null, pending: o.pending || null});
  const el = document.createElement('div');
  el.className = 'hl-pop'; el.id = 'hl-pop'; el.setAttribute('role', 'toolbar'); el.setAttribute('aria-label', o.mode === 'new' ? 'Сохранить цитату' : 'Цитата');
  const cur = o.h ? o.h.color : '';
  const g = rdGroup();
  if(o.mode === 'new') HP.grp = true; // в групповом режиме новая цитата сразу видна группе
  const grpRow = g && o.mode === 'new' ? `<div class="hp-row hp-grp"><button type="button" class="hp-g" data-hp="grp" aria-pressed="true" title="Цитату увидят участники группы «${esc(g.name)}»">${ICON.check}<span>Видно группе</span></button></div>`
    : o.h && o.h.group ? `<p class="hp-note">${ICON.people}<span>Видно группе${byId('groups', o.h.group) ? ' «' + esc(byId('groups', o.h.group).name) + '»' : ''}</span></p>` : '';
  const thought = o.h && o.h.body_text ? `<p class="hp-t">${esc(o.h.body_text.slice(0, 220))}${o.h.body_text.length > 220 ? '…' : ''}</p>` : '';
  el.innerHTML = `<div class="hp-row"><span class="hp-colors">${HL_KEYS.map(c => `<button type="button" class="hp-c${cur === c ? ' on' : ''}" data-hp="color" data-c="${c}" style="--hl:${HL[c][1]}" aria-label="${o.mode === 'new' ? 'Сохранить цитату: ' + HL[c][0].toLowerCase() : HL[c][0]}" title="${o.mode === 'new' ? 'Сохранить цитату: ' + HL[c][0].toLowerCase() : HL[c][0]}"></button>`).join('')}</span>
    ${o.mode === 'new'
      ? `<button type="button" class="hp-b" data-hp="note" title="Сохранить цитату и написать мысль">${ICON.pen}<span>Заметка</span></button>${isAdmin() ? `<button type="button" class="hp-i" data-hp="copy" aria-label="Копировать" title="Копировать">${ICON.copy}</button>` : ''}`
      : `<button type="button" class="hp-b" data-hp="thought" title="${o.h.body_text ? 'Изменить мысль' : 'Написать мысль'}">${ICON.pen}<span>Мысль</span></button>
        <button type="button" class="hp-i" data-hp="del" aria-label="Удалить цитату" title="Удалить цитату">${ICON.trash}</button>
        <button type="button" class="hp-i" data-hp="more" aria-label="Ещё" aria-haspopup="menu" title="Ещё">${ICON.more}</button>`}</div>${grpRow}${thought}`;
  $('#reader').appendChild(el);
  HP.el = el;
  hpPlace(el, o.rect);
}
function hpPlace(el, rect){
  const r = rect || {left: innerWidth / 2, right: innerWidth / 2, top: innerHeight / 2, bottom: innerHeight / 2};
  const w = el.offsetWidth, h = el.offsetHeight;
  // выделение в верхней половине экрана: панель под ним, в нижней: над ним (с запасом на ручки выделения)
  const gap = touchUI() ? 26 : 12;
  let top = (r.top + r.bottom) / 2 < innerHeight / 2 ? r.bottom + gap : r.top - h - gap;
  top = Math.max(8, Math.min(top, innerHeight - h - 8));
  el.style.top = top + 'px';
  el.style.left = Math.max(8, Math.min((r.left + r.right) / 2 - w / 2, innerWidth - w - 8)) + 'px';
}
function hpHide(){
  if(HP.el) HP.el.remove();
  HP.el = null; HP.mode = ''; HP.h = null; HP.pending = null;
  $$('#reader .hl-tmp').forEach(x => { x.innerHTML = ''; });
  const t = $('#ep-tmp'); if(t) t.innerHTML = '';
}
// Сохранить новое выделение (PDF или EPUB) с цветом
async function hlCreate(color){
  const p = HP.pending; if(!p) return null;
  const isEpub = READER.mode === 'epub', g = rdGroup();
  const data = {id: newId(), owner: me().id, kind: 'highlight', book: isEpub ? EP.bookId : RD.src.id, format: isEpub ? EP.fmt : RD.fmt,
    quote: p.quote.slice(0, 20000), color, page: isEpub ? 0 : p.n, place: isEpub ? epPlace(p.chapter, p.pct) : 'с. ' + p.n, anchor: p.anchor, body: '',
    ...(g && HP.grp !== false ? {group: g.id} : {})};
  hpHide();
  try { window.getSelection().removeAllRanges(); } catch(e){}
  if(isEpub) epDeselect();
  try {
    const rec = await pb.collection('notes').create(data, {fields: hlFields});
    hlLocal(rec);
    return rec;
  } catch(e){ toast(errText(e)); return null; }
}
// Свои выделения открытой книги и общий список заметок
function hlLocal(rec, deleted){
  // список открытой в памяти книги меняется, только если цитата из неё (правка с экрана цитаты бывает и при другой книге в читалке)
  const epub = isEpView(rec.format);
  const open = epub ? EP.bookId === rec.book && EP.fmt === rec.format : !!(RD.src && RD.src.kind === 'book' && RD.src.id === rec.book && RD.fmt === rec.format);
  const list = !open ? [] : epub ? EP.hls : RD.hls;
  const i = list.findIndex(x => x.id === rec.id);
  if(deleted){ if(i >= 0) list.splice(i, 1); removeLocal('notes', rec.id); }
  else { if(i >= 0) list[i] = {...list[i], ...rec}; else if(open && rec.anchor) list.push(rec); upsert('notes', hlStrip(rec)); }
  if(!open) return;
  if(epub) epDrawHl(rec, deleted); else rdDrawAll();
}
// Живое обновление (другая вкладка или устройство): своё выделение в открытой книге
function hlLive(r, deleted){
  if(r.kind !== 'highlight' || r.owner !== me().id) return;
  if(r.format === RD.fmt && RD.src && RD.src.kind === 'book' && RD.src.id === r.book){
    const i = RD.hls.findIndex(x => x.id === r.id);
    if(deleted){ if(i >= 0) RD.hls.splice(i, 1); } else if(r.anchor){ if(i >= 0) RD.hls[i] = {...r}; else RD.hls.push({...r}); }
    rdDrawAll();
  }
  if(r.format === EP.fmt && EP.bookId === r.book && EP.view){
    const i = EP.hls.findIndex(x => x.id === r.id);
    const old = i >= 0 ? EP.hls[i] : null;
    if(deleted){ if(i >= 0) EP.hls.splice(i, 1); epDrawHl(old || r, true); }
    else if(r.anchor){ if(i >= 0) EP.hls[i] = {...r}; else EP.hls.push({...r}); epDrawHl(r); }
  }
}
async function hlUpdate(h, patch){
  const rec = await pb.collection('notes').update(h.id, patch, {fields: hlFields});
  hlLocal(rec);
  return rec;
}
async function hlDelete(h){
  await pb.collection('notes').delete(h.id);
  hlLocal(h, true);
  toast('Цитата удалена');
}
const textToHtml = t => String(t || '').split(/\n+/).map(x => x.trim()).filter(Boolean).map(x => `<p>${esc(x)}</p>`).join('');
function hlThought(h){
  openForm({title: h.body_text ? 'Мысль к цитате' : 'Новая мысль', text: '«' + h.quote.slice(0, 400) + (h.quote.length > 400 ? '…' : '') + '»',
    fields: [{key: 't', type: 'textarea', label: 'Ваша мысль', rows: 5, max: 20000, placeholder: 'Что вы об этом думаете'}], values: {t: h.body_text || ''},
    async onSave(v){ await hlUpdate(h, {body: textToHtml(v.t)}); toast('Сохранено'); if(route().name === 'note'){ ED.rec = null; render(true); } }});
}
function hlSettings(h){
  openForm({title: 'Настройки', fields: [{key: 'shared', type: 'check', label: 'Видна всем читателям', hint: 'Читатели увидят цитату и вашу мысль в карточке книги, в блоке «Заметки автора библиотеки». На страницах книги у них она не рисуется.'}],
    values: {shared: !!h.shared}, async onSave(v){ await hlUpdate(h, {shared: v.shared}); toast(v.shared ? 'Теперь видно всем читателям' : 'Теперь видно только вам'); }});
}
// «Сделать заметкой»: новая заметка с цитатой в начале и местом в книге, цитата остаётся.
// Цитата была видна группе: заметка тоже видна той же группе (если группа ещё читает эту книгу).
async function hlToNote(h){
  try {
    const grp = h.group && groupsOfBook(h.book).some(g => g.id === h.group) ? h.group : '';
    const rec = await pb.collection('notes').create({id: newId(), owner: me().id, kind: 'note', book: h.book, format: h.format, page: h.page || 0, place: h.place || '', ...(grp ? {group: grp} : {}),
      anchor: h.anchor || null, title: '', body: `<blockquote>${esc(h.quote)}</blockquote>${h.body_text ? textToHtml(h.body_text) : '<p></p>'}`});
    upsert('notes', hlStrip(rec));
    UI.normalOnce = true;
    toast('Заметка создана');
    go('#/note/' + rec.id);
  } catch(e){ toast(errText(e)); }
}
async function hpAction(btn){
  const a = btn.dataset.hp, h = HP.h;
  if(a === 'color'){
    if(HP.mode === 'new'){ const rec = await hlCreate(btn.dataset.c); if(rec) toast(rec.group ? 'Цитата сохранена, её видит группа' : 'Цитата сохранена'); }
    else if(h){ const c = btn.dataset.c; hpHide(); try { await hlUpdate(h, {color: c}); } catch(e){ toast(errText(e)); } }
  } else if(a === 'note'){
    const rec = await hlCreate('yellow');
    if(rec) hlThought(rec);
  } else if(a === 'copy'){
    const t = HP.pending ? HP.pending.quote : '';
    hpHide();
    try { window.getSelection().removeAllRanges(); } catch(e){}
    if(READER.mode === 'epub') epDeselect();
    try { await navigator.clipboard.writeText(t); toast('Скопировано'); } catch(e){ toast('Не удалось скопировать.'); }
  } else if(a === 'grp'){
    HP.grp = HP.grp === false; btn.setAttribute('aria-pressed', String(HP.grp)); btn.innerHTML = `${HP.grp ? ICON.check : ''}<span>Видно группе</span>`;
  } else if(a === 'open' && h){ hpHide(); go(`#/note/${h.id}?g=${h.group}`); }
  else if(a === 'thought' && h){ hpHide(); hlThought(h); }
  else if(a === 'del' && h){ if(!arm(btn, 'Удалить?')) return; hpHide(); try { await hlDelete(h); } catch(e){ toast(errText(e)); } }
  else if(a === 'more' && h){
    const items = [{label: 'Сделать заметкой', run: () => { hpHide(); hlToNote(h); }}];
    if(h.group || groupsOfBook(h.book).length) items.push({label: 'Видно группе', run: () => { hpHide(); pickNoteGroup(h, rec => hlLocal({...h, ...rec})); }});
    if(h.group) items.push({label: 'Комментарии', run: () => { hpHide(); go(`#/note/${h.id}?g=${h.group}`); }});
    if(isAdmin()) items.push({label: 'Настройки', run: () => { hpHide(); hlSettings(h); }});
    items.push({label: 'Удалить цитату', danger: true, run: () => { hpHide(); hlDelete(h).catch(e => toast(errText(e))); }});
    openMenu(btn, items);
  }
}
const clientBox = r => ({left: r.left, right: r.right, top: r.top, bottom: r.bottom});

/* ---------- Выделения в PDF ---------- */
async function rdLoadHls(){
  const key = RD.key, id = RD.src.id;
  try {
    const list = await pb.collection('notes').getFullList({filter: pb.filter('owner = {:u} && book = {:b} && kind = "highlight" && format = {:f}', {u: me().id, b: id, f: RD.fmt}), fields: hlFields});
    if(RD.key !== key) return;
    RD.hls = list; rdDrawAll(); rdFlash();
  } catch(e){}
}
function rdDrawAll(){ for(const [n, c] of RD.cache) rdDrawHls(c.el, n); }
const rdOthers = n => RD.group ? RD.ghls.filter(h => (grpShow() || h.id === RD.focusO) && h.page === n && h.anchor && Array.isArray(h.anchor.rects) && h.anchor.rects.length) : [];
function rdDrawHls(el, n){
  const layer = el.querySelector('.hl-layer:not(.hl-tmp)'); if(!layer) return;
  const mark = (h, cls) => h.anchor.rects.map(([x, y, w, hh]) => `<i class="hl-mark${cls}" data-h="${h.id}" style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${hh * 100}%;--hl:${(HL[h.color] || HL.yellow)[1]}"></i>`).join('');
  // цитаты других участников группы: бледнее, у начала кружок автора
  const others = rdOthers(n).map(h => { const [x, y] = h.anchor.rects[0];
    return mark(h, ' other') + `<span class="hl-who" style="left:${x * 100}%;top:${y * 100}%;--hl:${(HL[h.color] || HL.yellow)[1]}">${faceHTML(person(h.owner), 'hw')}</span>`; }).join('');
  layer.innerHTML = others + RD.hls.filter(h => h.page === n && h.anchor && Array.isArray(h.anchor.rects)).map(h => mark(h, '')).join('');
}
// Переход к выделению из списка: оно коротко мигает
function rdFlash(){
  const id = RD.flash; if(!id) return;
  const marks = $$(`#rd-pagebox .hl-mark[data-h="${id}"]`);
  if(!marks.length) return;
  RD.flash = '';
  marks.forEach(m => { m.classList.remove('flash'); void m.offsetWidth; m.classList.add('flash'); });
  setTimeout(() => marks.forEach(m => m.classList.remove('flash')), 2000);
}
// Прямоугольники выделения в долях страницы: куски одной строки склеиваются, мусорные отбрасываются
function rangeRects(range, box){
  const B = box.getBoundingClientRect();
  const raw = [];
  for(const r of range.getClientRects()){
    if(r.width < 1 || r.height < 1) continue;
    const x = (r.left - B.left) / B.width, y = (r.top - B.top) / B.height, w = r.width / B.width, h = r.height / B.height;
    if(h > 0.12 || w > 1.01 || x < -0.01 || y < -0.01 || x + w > 1.01 || y + h > 1.01) continue;
    raw.push([x, y, w, h]);
  }
  raw.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const lines = [];
  for(const r of raw){
    const L = lines.find(l => { const t = Math.max(l[1], r[1]), b = Math.min(l[1] + l[3], r[1] + r[3]); return b - t > 0.5 * Math.min(l[3], r[3]) && r[0] <= l[0] + l[2] + 0.02 && r[0] + r[2] >= l[0] - 0.02; });
    if(L){ const x0 = Math.min(L[0], r[0]), y0 = Math.min(L[1], r[1]), x1 = Math.max(L[0] + L[2], r[0] + r[2]), y1 = Math.max(L[1] + L[3], r[1] + r[3]); L[0] = x0; L[1] = y0; L[2] = x1 - x0; L[3] = y1 - y0; }
    else lines.push([...r]);
  }
  return lines.slice(0, 200).map(r => r.map(v => Math.round(v * 1e4) / 1e4));
}
// Текст выделения в текстовом слое PDF: между строками пробел, перенос слова со знаком «-» склеивается
function tlRangeText(range, tl){
  const w = document.createTreeWalker(tl, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let out = '', node, pos = 0, s = -1, e = -1;
  while((node = w.nextNode())){
    if(node.nodeType === 1){ if(node.tagName === 'BR' && range.intersectsNode(node) && out) out += ' '; continue; }
    const t = node.nodeValue || '';
    if(range.intersectsNode(node)){
      const a = node === range.startContainer ? range.startOffset : 0, b = node === range.endContainer ? range.endOffset : t.length;
      if(s < 0) s = pos + a;
      e = pos + b;
      out += t.slice(a, b);
    }
    pos += t.length;
  }
  return {text: out.replace(/(\S)[-­] +(?=\p{Ll})/gu, '$1').replace(/\s+/g, ' ').trim(), s: Math.max(0, s), e: Math.max(0, e)};
}
// Выделение в PDF → данные для сохранения
function pdfPending(range, pageEl){
  const tl = pageEl.querySelector('.textLayer'); if(!tl) return null;
  const {text, s, e} = tlRangeText(range, tl);
  const rects = rangeRects(range, pageEl);
  if(!text || !rects.length) return null;
  return {n: +pageEl.dataset.n, quote: text, anchor: {v: 1, rects, s, e}, rect: clientBox(range.getBoundingClientRect())};
}
// Выделение мышью (и пальцем у администратора): после отпускания показываем панель
function rdSelCheck(){
  if(READER.mode !== 'pdf' || RD.marker || !RD.open || HP.mode === 'edit') return;
  const sel = window.getSelection();
  if(!sel || sel.isCollapsed || !sel.rangeCount){ if(HP.mode === 'new' && !RD.mk) hpHide(); return; }
  const range = sel.getRangeAt(0);
  const pg = $('#rd-pagebox .rd-page');
  if(!pg || !pg.contains(range.commonAncestorContainer)) return;
  const p = pdfPending(range, pg);
  if(p) hpShow({mode: 'new', pending: p, rect: p.rect});
}
function rdHitHl(x, y){
  const pg = $('#rd-pagebox .rd-page'); if(!pg) return null;
  const B = pg.getBoundingClientRect(), fx = (x - B.left) / B.width, fy = (y - B.top) / B.height;
  if(fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  return RD.hls.slice().reverse().find(h => h.page === RD.page && h.anchor && (h.anchor.rects || []).some(([a, b, w, hh]) => fx >= a - 0.003 && fx <= a + w + 0.003 && fy >= b - 0.003 && fy <= b + hh + 0.003)) || null;
}
function rdHitOther(x, y){
  const pg = $('#rd-pagebox .rd-page'); if(!pg) return null;
  const B = pg.getBoundingClientRect(), fx = (x - B.left) / B.width, fy = (y - B.top) / B.height;
  if(fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  return rdOthers(RD.page).reverse().find(h => h.anchor.rects.some(([a, b, w, hh]) => fx >= a - 0.012 && fx <= a + w + 0.003 && fy >= b - 0.006 && fy <= b + hh + 0.003)) || null;
}
function hlBox(id){
  const marks = $$(`#rd-pagebox .hl-mark[data-h="${id}"]`).map(m => m.getBoundingClientRect());
  if(!marks.length) return null;
  return {left: Math.min(...marks.map(r => r.left)), right: Math.max(...marks.map(r => r.right)), top: Math.min(...marks.map(r => r.top)), bottom: Math.max(...marks.map(r => r.bottom))};
}
// «Маркер»: ведёшь пальцем по строкам, текст выделяется без системного меню. Своё определение буквы под пальцем
// по текстовому слою: ближайший кусок строки и ближайшая буква в нём (по ширине букв).
function rdMarkerState(){
  const b = $('#rd-marker'); if(!b) return;
  const f = RD.src && RD.src.kind === 'book' ? fileOf(RD.src.id, RD.fmt) : null;
  const noText = !!f && !f.has_text;
  b.classList.toggle('off', noText);
  b.setAttribute('aria-pressed', String(RD.marker));
  $('#reader').classList.toggle('marker', RD.marker);
}
function toggleMarker(){
  if(READER.mode === 'epub'){ EP.marker = !EP.marker; epMarkerState(); toast(EP.marker ? 'Маркер: проведите пальцем по строкам. Листание выключено.' : 'Маркер выключен'); return; }
  const f = RD.src && RD.src.kind === 'book' ? fileOf(RD.src.id, RD.fmt) : null;
  if(f && !f.has_text){ toast(isAdmin() ? 'В этом скане нет текста, выделять нельзя. Распознать текст можно в карточке книги.' : 'В этой книге нет текстового слоя, выделять нельзя.'); return; }
  RD.marker = !RD.marker; hpHide();
  try { window.getSelection().removeAllRanges(); } catch(e){}
  rdMarkerState();
  toast(RD.marker ? 'Маркер: проведите пальцем или мышью по строкам. Листание выключено.' : 'Маркер выключен');
}
function tlSpans(tl){
  return [...tl.querySelectorAll('span')].filter(s => s.firstChild && s.firstChild.nodeType === 3 && s.firstChild.nodeValue.length && !s.classList.contains('markedContent'))
    .map(s => ({s, r: s.getBoundingClientRect()})).filter(x => x.r.width > 0 && x.r.height > 0);
}
function tlCaret(spans, x, y){
  let best = null, bd = Infinity;
  for(const it of spans){
    const r = it.r;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const d = dy * 3 + dx;
    if(d < bd){ bd = d; best = it; }
  }
  if(!best || bd > 120) return null;
  const node = best.s.firstChild, len = node.nodeValue.length, rg = document.createRange();
  if(x <= best.r.left) return {node, offset: 0};
  if(x >= best.r.right) return {node, offset: len};
  for(let i = 0; i < len; i++){
    rg.setStart(node, i); rg.setEnd(node, i + 1);
    const cr = rg.getBoundingClientRect();
    if(x < cr.left + cr.width / 2) return {node, offset: i};
  }
  return {node, offset: len};
}
function caretRange(a, b){
  const r = document.createRange();
  r.setStart(a.node, a.offset); r.collapse(true);
  if(r.comparePoint(b.node, b.offset) < 0){ r.setStart(b.node, b.offset); r.setEnd(a.node, a.offset); }
  else r.setEnd(b.node, b.offset);
  return r;
}
function mkDraw(){
  const m = RD.mk; if(!m) return;
  const tmp = m.page.querySelector('.hl-tmp'); if(!tmp) return;
  const range = caretRange(m.start, m.end);
  const rects = range.collapsed ? [] : rangeRects(range, m.page);
  tmp.innerHTML = rects.map(([x, y, w, h]) => `<i class="hl-mark tmp" style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%;--hl:${HL.yellow[1]}"></i>`).join('');
  return range;
}
function mkDown(e){
  if(READER.mode !== 'pdf' || !RD.marker || !e.isPrimary) return;
  if(e.target.closest('.hl-pop, [data-rd]')) return;
  const page = e.target.closest('.rd-page'); if(!page) return;
  const tl = page.querySelector('.textLayer'); if(!tl) return;
  e.preventDefault();
  hpHide();
  const spans = tlSpans(tl);
  const start = tlCaret(spans, e.clientX, e.clientY);
  RD.mk = {page, spans, start, end: start, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false};
  try { $('#rd-stage').setPointerCapture(e.pointerId); } catch(err){}
}
function mkMove(e){
  const m = RD.mk; if(!m || e.pointerId !== m.id) return;
  e.preventDefault();
  if(Math.hypot(e.clientX - m.x, e.clientY - m.y) > 6) m.moved = true;
  if(!m.start){ m.start = tlCaret(m.spans, e.clientX, e.clientY); if(!m.start) return; }
  const c = tlCaret(m.spans, e.clientX, e.clientY);
  if(c){ m.end = c; mkDraw(); }
}
function mkUp(e){
  const m = RD.mk; if(!m || e.pointerId !== m.id) return;
  RD.mk = null;
  if(!m.moved){
    // нажатие без движения: может быть по готовому выделению
    m.page.querySelector('.hl-tmp').innerHTML = '';
    const h = rdHitHl(e.clientX, e.clientY);
    if(h){ hpShow({mode: 'edit', h, rect: hlBox(h.id)}); return; }
    const o = rdHitOther(e.clientX, e.clientY);
    if(o) hpShowOther(o, hlBox(o.id));
    return;
  }
  if(!m.start || !m.end){ m.page.querySelector('.hl-tmp').innerHTML = ''; return; }
  const range = caretRange(m.start, m.end);
  const p = range.collapsed ? null : pdfPending(range, m.page);
  if(!p){ m.page.querySelector('.hl-tmp').innerHTML = ''; return; }
  RD.mk = null;
  hpShow({mode: 'new', pending: p, rect: p.rect});
  // временная подсветка остаётся, пока не выбран цвет
  mkKeep(m.page, p.anchor.rects);
}
function mkKeep(page, rects){
  const tmp = page.querySelector('.hl-tmp'); if(!tmp) return;
  tmp.innerHTML = rects.map(([x, y, w, h]) => `<i class="hl-mark tmp" style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%;--hl:${HL.yellow[1]}"></i>`).join('');
}

/* ---------- Нажатия в читалке ---------- */
// нажатие на панель не сбрасывает выделение; нажатие мимо открытой панели только закрывает её (без листания)
$('#reader').addEventListener('pointerdown', e => { const inPop = !!e.target.closest('.hl-pop'); if(inPop) e.preventDefault(); HP.eat = !!HP.el && !inPop; }, true);
$('#reader').addEventListener('pointerdown', mkDown);
$('#reader').addEventListener('pointermove', mkMove, {passive: false});
$('#reader').addEventListener('pointerup', mkUp);
$('#reader').addEventListener('pointercancel', e => { if(RD.mk && e.pointerId === RD.mk.id){ const t = RD.mk.page.querySelector('.hl-tmp'); if(t) t.innerHTML = ''; RD.mk = null; } });
$('#reader').addEventListener('pointerup', e => { if(e.pointerType === 'mouse' && !RD.marker && !e.target.closest('.hl-pop, .menu, [data-rd]')) setTimeout(rdSelCheck, 30); });
let selT = 0;
document.addEventListener('selectionchange', () => {
  if(!RD.open || READER.mode !== 'pdf') return;
  const t = String(window.getSelection() || '').trim();
  if(t) RD.sel = {text: t, at: Date.now()};
  // палец (у администратора): панель после паузы, когда человек закончил тянуть границы
  clearTimeout(selT);
  if(touchUI()) selT = setTimeout(rdSelCheck, 600);
  else if(!t && HP.mode === 'new' && !RD.marker) hpHide();
});
$('#reader').addEventListener('click', e => {
  const hp = e.target.closest('[data-hp]');
  if(hp){ hpAction(hp).catch(err => toast(errText(err))); return; }
  if(menu){
    const it = e.target.closest('.menu [data-i]');
    const m = menu; closeMenu();
    if(it){ m.items[+it.dataset.i].run(); return; }
    if(e.target.closest('[data-rd="menu"], [data-hp="more"]') === m.btn) return;
  }
  const b = e.target.closest('[data-rd]');
  if(!b) return;
  const a = b.dataset.rd;
  if(a !== 'marker') hpHide();
  const ep = READER.mode === 'epub';
  if(a === 'close') readerBack();
  else if(a === 'prev') ep ? epGo(-1) : rdGo(RD.page - 1);
  else if(a === 'next') ep ? epGo(1) : rdGo(RD.page + 1);
  else if(a === 'zin') ep ? epFont(1) : rdZoom(1.25);
  else if(a === 'zout') ep ? epFont(-1) : rdZoom(0.8);
  else if(a === 'goto') ep ? epToc() : rdGoto();
  else if(a === 'toc') rdToc();
  else if(a === 'note') rdNote();
  else if(a === 'menu') rdMenu(b);
  else if(a === 'marker') toggleMarker();
  else if(a === 'resume') rdResume();
  else if(a === 'ask-close') askHide();
  else if(a === 'ask-mark'){ const id = (b.closest('#mk-ask') || {dataset: {}}).dataset.book; askHide(); if(id) markReading(id); }
  else if(a === 'full'){ if(document.fullscreenElement) document.exitFullscreen().catch(() => {}); else $('#reader').requestFullscreen().catch(() => {}); }
});
$('#reader').addEventListener('change', e => {
  if(e.target.id === 'rd-slider'){ if(READER.mode === 'epub') epToFraction(+e.target.value / 1000); else rdGo(+e.target.value); }
});
$('#reader').addEventListener('input', e => { if(e.target.id === 'rd-slider' && READER.mode === 'pdf') $('#rd-num').textContent = `${e.target.value} из ${RD.pages}`; });
// Листание пальцем и нажатием по краям, щипок для масштаба (в режиме «Маркер» выключено)
const TP = {x: 0, y: 0, t: 0, pinch: 0, z: 1, moved: false};
$('#reader').addEventListener('touchstart', e => {
  if(READER.mode !== 'pdf' || !e.target.closest('#rd-stage')) return;
  if(RD.marker){ if(e.touches.length === 1 && e.target.closest('.rd-page')) e.preventDefault(); return; }
  if(e.touches.length === 2){ TP.pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); TP.z = 1; return; }
  const t = e.touches[0]; TP.x = t.clientX; TP.y = t.clientY; TP.t = Date.now(); TP.moved = false; TP.pinch = 0;
  TP.sel = !!String(window.getSelection() || '').trim();
}, {passive: false});
$('#reader').addEventListener('touchmove', e => {
  if(READER.mode !== 'pdf') return;
  if(RD.marker){ if(e.target.closest('#rd-stage')) e.preventDefault(); return; }
  if(TP.pinch && e.touches.length === 2){
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    TP.z = d / TP.pinch;
    const pg = $('#rd-pagebox .rd-page'); if(pg) pg.style.transform = `scale(${TP.z})`;
    e.preventDefault(); return;
  }
  TP.moved = true;
}, {passive: false});
$('#reader').addEventListener('touchend', e => {
  if(READER.mode !== 'pdf' || RD.marker) return;
  if(TP.pinch){
    if(e.touches.length) return;
    const pg = $('#rd-pagebox .rd-page'); if(pg) pg.style.transform = '';
    const z = TP.z; TP.pinch = 0;
    if(Math.abs(z - 1) > 0.08) rdZoom(z);
    return;
  }
  if(!e.target.closest('#rd-stage') || !e.changedTouches.length) return;
  if(TP.sel || String(window.getSelection() || '').trim()) return; // тянут выделение, а не листают
  const t = e.changedTouches[0], dx = t.clientX - TP.x, dy = t.clientY - TP.y;
  if(RD.zoom === 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - TP.t < 900){ rdGo(RD.page + (dx < 0 ? 1 : -1)); TP.swiped = Date.now(); }
});
$('#reader').addEventListener('click', e => {
  const st = e.target.closest('#rd-stage');
  if(READER.mode !== 'pdf' || !st || e.target.closest('[data-rd], .hl-pop') || (TP.swiped && Date.now() - TP.swiped < 500)) return;
  if(RD.marker) return; // в режиме «Маркер» нажатия обрабатывает сам маркер
  if(String(window.getSelection() || '').trim()) return; // выделяют текст
  if(HP.el || HP.eat){ HP.eat = false; hpHide(); return; } // нажатие мимо панели только закрывает её
  const h = rdHitHl(e.clientX, e.clientY);
  if(h){ hpShow({mode: 'edit', h, rect: hlBox(h.id)}); return; }
  const o = rdHitOther(e.clientX, e.clientY);
  if(o){ hpShowOther(o, hlBox(o.id)); return; }
  const r = st.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
  if(x < 0.28) rdGo(RD.page - 1);
  else if(x > 0.72) rdGo(RD.page + 1);
  else toggleBars();
});
$('#reader').addEventListener('wheel', e => {
  if(READER.mode !== 'pdf' || !(e.ctrlKey || e.metaKey)) return;
  e.preventDefault(); rdZoom(e.deltaY < 0 ? 1.1 : 0.9);
}, {passive: false});
document.addEventListener('keydown', e => {
  if(!RD.open || dlg.open) return;
  const k = e.key;
  if((e.ctrlKey || e.metaKey) && /^[psPS]$/.test(k)){ e.preventDefault(); return; } // печать и сохранение страницы выключены
  if(e.target.closest && e.target.closest('input, textarea, select')) return;
  if(k === 'Escape' && HP.el){ hpHide(); return; }
  if(READER.mode === 'epub'){
    if(k === 'ArrowRight' || k === 'PageDown' || k === ' '){ e.preventDefault(); epGo(1); }
    else if(k === 'ArrowLeft' || k === 'PageUp'){ e.preventDefault(); epGo(-1); }
    return;
  }
  if(k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && RD.zoom === 1)){ e.preventDefault(); rdGo(RD.page + 1); }
  else if(k === 'ArrowLeft' || k === 'PageUp'){ e.preventDefault(); rdGo(RD.page - 1); }
  else if(k === 'Home'){ rdGo(1); } else if(k === 'End'){ rdGo(RD.pages); }
  else if(k === '+' || k === '='){ rdZoom(1.25); } else if(k === '-'){ rdZoom(0.8); }
});
// У читателей: без копирования, контекстного меню и перетаскивания. Администратору можно.
// Копирование перехватывается на всей странице, пока открыта читалка: в буфер обмена попадает пустая строка.
function noCopy(e){
  if(isAdmin()) return;
  e.preventDefault();
  if(e.type === 'copy' || e.type === 'cut'){ try { e.clipboardData && e.clipboardData.setData('text/plain', ''); } catch(_){} toast('Копировать текст книги нельзя.'); }
}
for(const ev of ['contextmenu', 'dragstart']) $('#reader').addEventListener(ev, noCopy);
for(const ev of ['copy', 'cut']) document.addEventListener(ev, e => { if(RD.open) noCopy(e); }, true);
let rsT = 0;
window.addEventListener('resize', () => {
  if(!RD.open) return;
  hpHide();
  clearTimeout(rsT);
  rsT = setTimeout(() => { if(READER.mode === 'epub') epMarkDraw(); else if(RD.doc){ RD.cache.clear(); rdGo(RD.page, true); } }, 250);
});
document.addEventListener('fullscreenchange', () => { if(RD.open && READER.mode === 'pdf' && RD.doc){ RD.cache.clear(); setTimeout(() => rdGo(RD.page, true), 150); } else if(RD.open) setTimeout(epMarkDraw, 150); });

/* ---------- Читалка EPUB ---------- */
// foliate-js (лицензия MIT, vendor/foliate): книга листается страницами, выделения рисует его слой
// (overlayer), место в книге хранится как EPUB CFI. Файл приходит целиком по той же защищённой ссылке,
// что и PDF, считается в лимите и журнале и лежит только в памяти вкладки (fetch без кэша).
// Скрипты из книги не загружаются и вырезаются из страниц. Подпись читателя рисуется холстом поверх страницы.
const EP = {key: '', bookId: '', fid: '', fmt: 'epub', view: null, lib: null, title: '', back: '', mark: '', cur: null, hls: [], marker: false, group: null, ghls: [], focusO: '',
  saveT: 0, seen: new Set(), docs: new Map(), mk: null, flash: '', toc: null, annAt: 0};
const EP_FONT = [90, 100, 115, 130];
let foliateLoad = null;
function loadFoliate(){
  if(!foliateLoad) foliateLoad = Promise.all([import('/vendor/foliate/view.js'), import('/vendor/foliate/overlayer.js')])
    .then(([v, o]) => ({makeBook: v.makeBook, Overlayer: o.Overlayer})).catch(e => { foliateLoad = null; throw e; });
  return foliateLoad;
}
const epPlace = (chapter, pct) => [String(chapter || '').replace(/\s+/g, ' ').trim().slice(0, 80), isFinite(pct) ? Math.round(pct) + '%' : ''].filter(Boolean).join(' · ');
// Скрипты и обработчики событий из страниц книги вырезаются: книга не должна ничего делать в приложении
const epClean = s => String(s)
  .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<script\b[^>]*\/>/gi, '')
  .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  .replace(/((?:xlink:)?href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2');
function epShell(){
  $('#reader').innerHTML = `<div class="rd-top"><button type="button" class="icon-btn" data-rd="close" aria-label="Закрыть книгу" title="Закрыть книгу">${ICON.back}</button>
      <h1 class="rd-title"><button type="button" class="rd-title-btn" data-rd="close" id="rd-title" title="Карточка книги"></button></h1>
      <button type="button" class="icon-btn" data-rd="toc" id="rd-toc" aria-label="Оглавление" title="Оглавление" hidden>${ICON.toc}</button>
      ${readOnly() ? '' : markerBtn() + `<button type="button" class="btn sm" data-rd="note" title="Заметка к этому месту">${ICON.pen}<span>Заметка</span></button>`}
      <button type="button" class="icon-btn" data-rd="menu" aria-label="Ещё" aria-haspopup="menu" title="Ещё">${ICON.more}</button></div>
    <div class="rd-gline" id="rd-gline" aria-hidden="true"></div>
    <div class="ep-stage" id="ep-stage"><div class="ep-host" id="ep-host"></div><canvas class="ep-mark" id="ep-mark" aria-hidden="true"></canvas><div class="ep-tmp" id="ep-tmp"></div></div>
    <div class="rd-bottom"><button type="button" class="icon-btn" data-rd="prev" aria-label="Назад" title="Назад">${ICON.left}</button>
      <button type="button" class="rd-num ep-num" data-rd="goto" id="rd-num" aria-label="Оглавление" title="Оглавление">…</button>
      <button type="button" class="icon-btn" data-rd="next" aria-label="Дальше" title="Дальше">${ICON.right}</button>
      <span class="rd-sp"></span>
      <button type="button" class="icon-btn fs-btn" data-rd="zout" aria-label="Шрифт мельче" title="Шрифт мельче"><b>А</b><small>−</small></button>
      <button type="button" class="icon-btn fs-btn" data-rd="zin" aria-label="Шрифт крупнее" title="Шрифт крупнее"><b class="big">А</b><small>+</small></button>
      ${document.fullscreenEnabled ? `<button type="button" class="icon-btn" data-rd="full" aria-label="Во весь экран" title="Во весь экран">${ICON.full}</button>` : ''}</div>
    <input type="range" class="rd-slider" id="rd-slider" min="0" max="1000" value="0" aria-label="Место в книге">
    <div class="rd-msg" id="rd-msg" hidden></div>`;
  rdReaderClasses();
  EP.marker = false;
}
async function epFetch(link, attempt){
  attempt = attempt || 0;
  let res;
  try { res = await fetch(link.url, {cache: 'no-store', credentials: 'same-origin'}); }
  catch(e){ if(attempt < 3){ await sleep(1500 * (attempt + 1)); return epFetch(link, attempt + 1); } throw {status: 0}; }
  if(res.ok) return await res.blob();
  let j = {}; try { j = await res.json(); } catch(e){}
  if(res.status === 429){ const err = new RangeError429(j.message || ''); err.wait = j.wait || 10; throw err; }
  throw {status: res.status, response: j};
}
async function epShow(r, b, again){
  READER.mode = 'epub';
  if(RD.doc) rdSave(true);
  RD.flash = '';
  if(!b){ rdFail('Книга не найдена.'); return; }
  let fmt = r.q.get('f');
  if(!isEpView(fmt)) fmt = isEpView(defaultFormat(b)) ? defaultFormat(b) : 'epub';
  const f = fileOf(b.id, fmt);
  EP.back = '#/b/' + b.id;
  if(!f){ rdFail(`У этой книги нет файла ${FORMATS[fmt] || fmt}.`); return; }
  if(f.status !== 'ready'){ rdFail(f.status === 'processing' ? 'Книга ещё обрабатывается. Попробуйте через минуту.' : 'Этот файл не открывается: при обработке была ошибка.'); return; }
  const hl = r.q.get('hl') || '';
  const grp = readerGroup(r, b.id), grpChanged = (EP.group && EP.group.id) !== (grp && grp.id);
  EP.group = grp; EP.focusO = hl;
  if(EP.key === f.id && EP.view){
    if(!$('#ep-host')){ epShell(); $('#ep-host').appendChild(EP.view); epTocBtn(); epStyle(); epNum(); requestAnimationFrame(epMarkDraw); }
    rdHeader();
    if(grpChanged || hl) await epLoadGHls();
    if(hl) epGoNote(hl);
    return;
  }
  epDispose();
  const key = f.id;
  Object.assign(EP, {key, bookId: b.id, fid: f.id, fmt, title: b.title, hls: [], ghls: [], seen: new Set(), cur: null, flash: hl, docs: new Map(), toc: null});
  epShell(); rdHeader(); epMarkerState();
  rdMsg('Открываю…');
  try {
    const [lib, link] = await Promise.all([loadFoliate(), pb.send(`/api/knigi/books/${b.id}/link?f=${fmt}`, {})]);
    if(EP.key !== key) return;
    EP.lib = lib; EP.mark = link.mark || ''; EP.markCfg = link.mark_cfg || null;
    let blob;
    try { blob = await epFetch(link); }
    catch(err){
      if(err && err.status === 401){ blob = await epFetch(await pb.send(`/api/knigi/books/${b.id}/link?f=${fmt}`, {})); }
      else throw err;
    }
    if(EP.key !== key) return;
    const book = await lib.makeBook(new File([blob], 'book.epub', {type: 'application/epub+zip'}));
    blob = null;
    if(book.transformTarget){
      book.transformTarget.addEventListener('load', ev => { if(ev.detail.isScript) ev.detail.allow = false; });
      book.transformTarget.addEventListener('data', ev => {
        const d = ev.detail;
        if(/html|xml|svg/.test(d.type || '')) d.data = Promise.resolve(d.data).then(x => typeof x === 'string' ? epClean(x) : x);
      });
    }
    const view = document.createElement('foliate-view');
    EP.view = view;
    view.addEventListener('load', epOnLoad);
    view.addEventListener('relocate', epOnRelocate);
    view.addEventListener('create-overlay', ev => epOverlay(ev.detail.index));
    view.addEventListener('draw-annotation', ev => {
      const {draw, annotation} = ev.detail;
      if(annotation.other) draw(epOtherDraw, {color: annotation.color, who: annotation.who});
      else draw(annotation.flash ? EP.lib.Overlayer.outline : EP.lib.Overlayer.highlight, {color: annotation.color, width: 3});
    });
    view.addEventListener('show-annotation', ev => epShowAnn(ev.detail));
    view.addEventListener('external-link', ev => ev.preventDefault()); // внешние ссылки из книги не открываем
    $('#ep-host').appendChild(view);
    await view.open(book);
    if(EP.key !== key) return;
    EP.toc = book.toc && book.toc.length ? book.toc : null;
    epTocBtn();
    epStyle();
    const own = await epLoadHls();
    if(EP.key !== key) return;
    await epLoadGHls();
    if(EP.key !== key) return;
    let start = null;
    if(hl){ const n = await epNoteAnchor(hl); if(n) start = n.cfi; }
    if(!start){ const rd = readOf(b.id, fmt); if(rd && rd.pos) start = rd.pos; }
    rdMsg('');
    await view.init({lastLocation: start, showTextStart: !start});
    if(hl) setTimeout(() => epFlash(hl), 300);
    epMarkDraw();
    if(!loadLS('epHint', false)){ saveLS('epHint', true); setTimeout(() => toast('Нажатие в середину страницы прячет и показывает панели. Кнопка «Маркер» вверху выделяет текст пальцем.'), 600); }
    void own;
  } catch(e){
    if(EP.key !== key) return;
    if(e instanceof RangeError429){ rdPause(e); return; }
    rdMsg(errText(e), true);
  }
}
function epTocBtn(){ const t = $('#rd-toc'); if(t) t.hidden = !EP.toc; }
function epDispose(){
  clearTimeout(EP.saveT);
  if(EP.view){ try { EP.view.close(); } catch(e){} EP.view.remove(); }
  Object.assign(EP, {key: '', view: null, cur: null, hls: [], ghls: [], docs: new Map(), mk: null, toc: null});
}
// Тема и размер шрифта: светлая или тёмная вместе с приложением, 4 шага шрифта
function epStyle(){
  const v = EP.view; if(!v || !v.renderer) return;
  const step = Math.min(EP_FONT.length - 1, Math.max(0, loadLS('epubFont', 1)));
  const dark = isDark();
  const plain = !isAdmin() && touchUI() && !EP.marker; // у читателя на телефоне выделяет только «Маркер»
  v.style.setProperty('--overlayer-highlight-opacity', dark ? '.38' : '.45');
  v.style.setProperty('--overlayer-highlight-blend-mode', dark ? 'normal' : 'multiply');
  v.renderer.setAttribute('margin', '36px');
  v.renderer.setAttribute('max-inline-size', '680px');
  const UR = {cyrillic: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116', latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2212,U+FEFF,U+FFFD'};
  const ff = (w, st, sub) => `@font-face { font-family: Literata; font-style: ${st}; font-weight: ${w}; font-display: swap; src: url(${location.origin}/fonts/literata-${sub}-${w}-${st}.woff2) format("woff2"); unicode-range: ${UR[sub]}; }`;
  v.renderer.setStyles(`
    ${['cyrillic', 'latin'].map(sub => ff(400, 'normal', sub) + ff(400, 'italic', sub) + ff(600, 'normal', sub) + ff(600, 'italic', sub)).join('\n')}
    html { color-scheme: ${dark ? 'dark' : 'light'}; font-size: ${EP_FONT[step]}% !important; }
    html, body { background: ${dark ? '#1E2226' : '#FFFCF6'} !important; color: ${dark ? '#E6E0D4' : '#26231F'} !important; }
    body { font-family: Literata, Georgia, serif; }
    p, li, blockquote, dd { line-height: 1.55; hyphens: auto; -webkit-hyphens: auto; }
    a:link, a:visited { color: ${dark ? '#9DBEDC' : '#2C4A66'}; }
    img, svg { max-width: 100%; }
    ${dark ? 'img { filter: brightness(.9); }' : ''}
    ${plain ? 'html, body, * { -webkit-user-select: none !important; user-select: none !important; -webkit-touch-callout: none !important; }' : ''}
    ${EP.marker ? 'html, body { touch-action: none !important; } * { cursor: text; }' : ''}
    ${!isAdmin() ? '* { -webkit-touch-callout: none !important; }' : ''}`);
}
function epFont(d){
  const step = Math.min(EP_FONT.length - 1, Math.max(0, loadLS('epubFont', 1) + d));
  if(step === loadLS('epubFont', 1)){ toast(d > 0 ? 'Это самый крупный шрифт.' : 'Это самый мелкий шрифт.'); return; }
  saveLS('epubFont', step); hpHide(); epStyle();
}
function epGo(d){ if(!EP.view) return; hpHide(); d > 0 ? EP.view.next() : EP.view.prev(); }
function epToFraction(x){ if(EP.view) EP.view.goToFraction(Math.min(1, Math.max(0, x))).catch(() => {}); }
function epNum(){
  const c = EP.cur, el = $('#rd-num');
  if(el) el.textContent = c ? epPlace(c.chapter, c.pct) || '…' : '…';
  const sl = $('#rd-slider'); if(sl && c && document.activeElement !== sl) sl.value = Math.round((c.fraction || 0) * 1000);
}
function epOnRelocate(ev){
  const d = ev.detail || {};
  EP.cur = {cfi: d.cfi || '', fraction: d.fraction || 0, pct: Math.round((d.fraction || 0) * 1000) / 10, chapter: (d.tocItem && d.tocItem.label) || '',
    page: d.location ? d.location.current + 1 : 0, pages: d.location ? d.location.total : 0};
  if(EP.cur.page) EP.seen.add(EP.cur.page);
  epNum();
  askCheck(EP.bookId, EP.cur.page, EP.cur.pct);
  hpHide();
  clearTimeout(EP.saveT); EP.saveT = setTimeout(() => epSave(false), 1500);
}
function epSave(leaving){
  clearTimeout(EP.saveT);
  const c = EP.cur; if(!c || !EP.bookId || !EP.view) return;
  const fmt = EP.fmt;
  const body = {format: fmt, pct: c.pct, pos: c.cfi, page: c.page || 1, pages: c.pages || 0, seen: [...EP.seen], day: todayStr()};
  EP.seen = new Set();
  const id = EP.bookId, r = readOf(id, fmt);
  if(r && r.pos === body.pos && !body.seen.length) return;
  if(leaving){
    fetch(`/api/knigi/books/${id}/progress`, {method: 'POST', keepalive: true, headers: {'Content-Type': 'application/json', Authorization: pb.authStore.token}, body: JSON.stringify(body)}).catch(() => {});
    saveReading(id, fmt, {...(r || {}), pct: body.pct, pos: body.pos, page: body.page, pages: body.pages, updated: ''});
    return;
  }
  pb.send(`/api/knigi/books/${id}/progress`, {method: 'POST', body}).then(res => saveReading(id, fmt, res)).catch(() => { body.seen.forEach(p => EP.seen.add(p)); });
}
function epToc(){
  if(!EP.toc){ toast('В этой книге нет оглавления.'); return; }
  const flat = [];
  const walk = (items, lvl) => { for(const it of items){ flat.push({it, lvl}); if(it.subitems && it.subitems.length && lvl < 3) walk(it.subitems, lvl + 1); } };
  walk(EP.toc, 1);
  openForm({title: 'Оглавление', noSubmit: true, html: `<div class="toc">${flat.slice(0, 600).map((x, i) => `<button type="button" class="toc-row lvl${x.lvl}" data-dlg="toc" data-i="${i}">${esc(x.it.label || 'Без названия')}</button>`).join('')}</div>`,
    async onClick(el){ const it = flat[+el.dataset.i].it; dlg.close(); if(it.href) EP.view.goTo(it.href).catch(() => toast('Не удалось открыть раздел.')); }});
}
// Страница книги загрузилась (каждая глава в своём фрейме): запреты для читателя, выделение, «Маркер», края для листания
function epOnLoad(ev){
  const {doc, index} = ev.detail;
  EP.docs.set(doc, index);
  if(!isAdmin()) for(const t of ['copy', 'cut', 'contextmenu', 'dragstart']) doc.addEventListener(t, noCopy);
  doc.addEventListener('keydown', e => {
    if((e.ctrlKey || e.metaKey) && /^[psPS]$/.test(e.key)){ e.preventDefault(); return; }
    if(e.key === 'ArrowRight' || e.key === 'PageDown'){ e.preventDefault(); epGo(1); }
    else if(e.key === 'ArrowLeft' || e.key === 'PageUp'){ e.preventDefault(); epGo(-1); }
    else if(e.key === 'Escape') hpHide();
  });
  // мышь: выделили и отпустили → панель
  doc.addEventListener('pointerup', e => { if(e.pointerType === 'mouse' && !EP.marker) setTimeout(() => epSelCheck(doc), 30); });
  doc.addEventListener('selectionchange', () => { if(touchUI() && !EP.marker){ clearTimeout(selT); selT = setTimeout(() => epSelCheck(doc), 600); } });
  // Пока на странице есть выделение или включён «Маркер», касания не доходят до листания foliate:
  // палец и ручки выделения двигают только выделение, страница стоит. Место страницы запоминается
  // в начале касания и после отпускания восстанавливается, если что-то её всё же сдвинуло.
  const hasSel = () => { const sl = doc.getSelection(); return !!sl && !sl.isCollapsed && !!String(sl).trim(); };
  const guard = e => {
    if(e.type === 'touchstart') EP.hold = null;
    if(!(EP.marker || hasSel() || EP.hold != null)) return;
    if(EP.hold == null && EP.view && EP.view.renderer) EP.hold = EP.view.renderer.start;
    e.stopPropagation();
    if(EP.marker && e.cancelable) e.preventDefault(); // в «Маркере» и системное выделение не начинается
    if(e.type === 'touchend' || e.type === 'touchcancel'){ const at = EP.hold; EP.hold = null; setTimeout(() => epHoldPage(at), 60); }
  };
  for(const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) doc.addEventListener(t, guard, {capture: true, passive: false});
  // касания пальцем не считаются «выделением мышью»: иначе foliate сам листает, когда выделение доходит до края
  const stopPtr = e => { if(e.pointerType !== 'mouse') e.stopPropagation(); };
  doc.addEventListener('pointerdown', stopPtr, true);
  doc.addEventListener('pointerup', stopPtr, true);
  doc.addEventListener('pointerdown', e => epMkDown(e, doc, index), true);
  doc.addEventListener('pointermove', e => epMkMove(e, doc), true);
  doc.addEventListener('pointerup', e => epMkUp(e, doc, index), true);
  // нажатие по краю листает, в середине прячет панели
  doc.addEventListener('click', e => {
    if(EP.marker || e.target.closest('a[href]')) return;
    const t = Date.now();
    setTimeout(() => {
      if(EP.annAt >= t - 5) return; // нажали на выделение
      if(String(doc.getSelection() || '').trim()) return;
      if(HP.el){ hpHide(); return; }
      const fr = doc.defaultView.frameElement, st = $('#ep-stage');
      if(!fr || !st) return;
      const x0 = fr.getBoundingClientRect().left + e.clientX, sr = st.getBoundingClientRect(), x = (x0 - sr.left) / sr.width;
      if(x < 0.28) epGo(-1); else if(x > 0.72) epGo(1);
      else toggleBars();
    }, 0);
  });
}
// Страница EPUB возвращается ровно туда, где была в начале касания (если её сдвинули при выделении)
function epHoldPage(at){
  const r = EP.view && EP.view.renderer;
  if(at == null || !r || r.scrolled) return;
  try {
    const d = at - r.start;
    if(Math.abs(d) >= 0.5) r.scrollBy(d, 0);
    const size = r.size, off = r.start % size;
    if(size > 0 && off > 1 && off < size - 1) r.snap(0, 0); // на всякий случай: ровно на границу страницы
  } catch(e){}
}
// Нажатие в середину страницы прячет и показывает верхнюю и нижнюю панели (первые разы с подсказкой)
function toggleBars(){
  RD.bars = !RD.bars;
  $('#reader').classList.toggle('bars-off', !RD.bars);
  if(READER.mode === 'epub') setTimeout(epMarkDraw, 260); // строка подписи над ползунком или у края
  if(!RD.bars){
    const n = loadLS('barsHint', 0);
    if(n < 3){ saveLS('barsHint', n + 1); toast('Панели спрятаны. Нажмите в середину страницы, чтобы вернуть их.'); }
  }
}
// Прямоугольник из координат страницы книги (фрейм) в координаты экрана
function epScreenRect(range){
  const doc = range.startContainer.ownerDocument, fr = doc.defaultView.frameElement;
  const f = fr ? fr.getBoundingClientRect() : {left: 0, top: 0};
  const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
  if(!rects.length) return null;
  return {rects: rects.map(r => ({left: r.left + f.left, top: r.top + f.top, width: r.width, height: r.height})),
    box: {left: Math.min(...rects.map(r => r.left)) + f.left, right: Math.max(...rects.map(r => r.right)) + f.left, top: Math.min(...rects.map(r => r.top)) + f.top, bottom: Math.max(...rects.map(r => r.bottom)) + f.top}};
}
function epPending(range, index){
  const quote = String(range.toString() || '').replace(/[­]/g, '').replace(/\s+/g, ' ').trim();
  if(!quote || !EP.view) return null;
  const cfi = EP.view.getCFI(index, range);
  let chapter = EP.cur ? EP.cur.chapter : '';
  try { const p = EP.view.getProgressOf(index, range); if(p && p.tocItem && p.tocItem.label) chapter = p.tocItem.label; } catch(e){}
  const pct = EP.cur ? EP.cur.pct : 0;
  const sr = epScreenRect(range);
  return {quote, chapter, pct, anchor: {v: 1, cfi, pct, chapter}, rect: sr ? sr.box : null, range};
}
function epSelCheck(doc){
  if(READER.mode !== 'epub' || EP.marker || HP.mode === 'edit') return;
  const sel = doc.getSelection();
  if(!sel || sel.isCollapsed || !sel.rangeCount){ if(HP.mode === 'new') hpHide(); return; }
  const p = epPending(sel.getRangeAt(0).cloneRange(), EP.docs.get(doc));
  if(p) hpShow({mode: 'new', pending: p, rect: p.rect});
}
function epDeselect(){ try { EP.view && EP.view.deselect(); } catch(e){} }
// Буква под пальцем в странице книги: средствами браузера, иначе ближайшая буква вручную
function epCaret(doc, x, y){
  let node = null, offset = 0;
  try {
    if(doc.caretPositionFromPoint){ const p = doc.caretPositionFromPoint(x, y); if(p){ node = p.offsetNode; offset = p.offset; } }
    else if(doc.caretRangeFromPoint){ const r = doc.caretRangeFromPoint(x, y); if(r){ node = r.startContainer; offset = r.startOffset; } }
  } catch(e){}
  if(node && node.nodeType === 3) return {node, offset};
  const el = doc.elementFromPoint(x, y);
  if(!el) return null;
  const w = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const rg = doc.createRange();
  let best = null, bd = Infinity, t;
  while((t = w.nextNode())){
    for(let i = 0; i < t.nodeValue.length; i++){
      rg.setStart(t, i); rg.setEnd(t, i + 1);
      const r = rg.getBoundingClientRect(); if(!r.width) continue;
      const d = Math.abs(y - (r.top + r.bottom) / 2) * 3 + Math.abs(x - (r.left + r.right) / 2);
      if(d < bd){ bd = d; best = {node: t, offset: x > (r.left + r.right) / 2 ? i + 1 : i}; }
    }
  }
  return best;
}
function epMkDown(e, doc, index){
  if(!EP.marker || !e.isPrimary) return;
  e.preventDefault(); e.stopPropagation();
  hpHide();
  const c = epCaret(doc, e.clientX, e.clientY);
  EP.mk = {doc, index, start: c, end: c, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false};
  try { doc.documentElement.setPointerCapture(e.pointerId); } catch(err){}
}
function epMkRange(m){
  if(!m.start || !m.end) return null;
  const r = m.doc.createRange();
  r.setStart(m.start.node, m.start.offset); r.collapse(true);
  if(r.comparePoint(m.end.node, m.end.offset) < 0){ r.setStart(m.end.node, m.end.offset); r.setEnd(m.start.node, m.start.offset); }
  else r.setEnd(m.end.node, m.end.offset);
  return r;
}
function epTmpDraw(rects){
  const tmp = $('#ep-tmp'), st = $('#ep-stage'); if(!tmp || !st) return;
  const s = st.getBoundingClientRect();
  tmp.innerHTML = (rects || []).map(r => `<i class="hl-mark tmp" style="left:${r.left - s.left}px;top:${r.top - s.top}px;width:${r.width}px;height:${r.height}px;--hl:${HL.yellow[1]}"></i>`).join('');
}
function epMkMove(e, doc){
  const m = EP.mk; if(!m || e.pointerId !== m.id) return;
  e.preventDefault(); e.stopPropagation();
  if(Math.hypot(e.clientX - m.x, e.clientY - m.y) > 6) m.moved = true;
  const c = epCaret(doc, e.clientX, e.clientY);
  if(!c) return;
  if(!m.start) m.start = c;
  m.end = c;
  const r = epMkRange(m), sr = r && !r.collapsed ? epScreenRect(r) : null;
  epTmpDraw(sr ? sr.rects : []);
}
function epMkUp(e, doc, index){
  const m = EP.mk; if(!m || e.pointerId !== m.id) return;
  e.preventDefault(); e.stopPropagation();
  EP.mk = null;
  if(!m.moved){
    // нажатие без движения: может быть по готовому выделению (касания в «Маркере» foliate не видит)
    epTmpDraw([]);
    try {
      const c = EP.view.renderer.getContents().find(x => x.doc === doc);
      const [value, range] = c && c.overlayer ? c.overlayer.hitTest({x: e.clientX, y: e.clientY}) : [];
      if(value) epShowAnn({value, range});
    } catch(err){}
    return;
  }
  const r = epMkRange(m);
  const p = r && !r.collapsed ? epPending(r, index) : null;
  if(!p){ epTmpDraw([]); return; }
  hpShow({mode: 'new', pending: p, rect: p.rect});
  const sr = epScreenRect(r); epTmpDraw(sr ? sr.rects : []);
}
function epMarkerState(){
  const b = $('#rd-marker'); if(b){ b.setAttribute('aria-pressed', String(EP.marker)); b.classList.remove('off'); }
  $('#reader').classList.toggle('marker', EP.marker);
  hpHide();
  epDeselect();
  epStyle();
}
// Свои выделения этой книги в EPUB
async function epLoadHls(){
  const key = EP.key;
  try {
    const list = await pb.collection('notes').getFullList({filter: pb.filter('owner = {:u} && book = {:b} && kind = "highlight" && format = {:f}', {u: me().id, b: EP.bookId, f: EP.fmt}), fields: hlFields});
    if(EP.key !== key) return [];
    EP.hls = list.filter(h => h.anchor && h.anchor.cfi);
    for(const h of EP.hls) epAdd(h);
    return EP.hls;
  } catch(e){ return []; }
}
function epAdd(h){ if(EP.view && h.anchor && h.anchor.cfi) EP.view.addAnnotation({value: h.anchor.cfi, color: (HL[h.color] || HL.yellow)[1]}).catch(() => {}); }
// Глава загрузилась: рисуем на ней цитаты (свои и, если включено, других участников группы)
function epOverlay(){ for(const h of EP.hls) epAdd(h); if(EP.group) for(const h of EP.ghls) if(grpShow() || h.id === EP.focusO) epAddOther(h); }
// Цитаты других участников группы в EPUB: бледная заливка и кружок с первой буквой имени автора
const epMineAt = cfi => EP.hls.some(x => x.anchor && x.anchor.cfi === cfi);
function epAddOther(h){
  if(!EP.view || !h.anchor || !h.anchor.cfi || epMineAt(h.anchor.cfi)) return;
  EP.view.addAnnotation({value: h.anchor.cfi, color: (HL[h.color] || HL.yellow)[1], other: true, who: initial(person(h.owner))}).catch(() => {});
}
function epDelOther(h){ if(EP.view && h.anchor && h.anchor.cfi && !epMineAt(h.anchor.cfi)) EP.view.deleteAnnotation({value: h.anchor.cfi}).catch(() => {}); }
function epGroupDraw(){ for(const h of EP.ghls){ if(grpShow() || h.id === EP.focusO) epAddOther(h); else epDelOther(h); } }
function epOtherDraw(rects, o){
  const ns = 'http://www.w3.org/2000/svg';
  const out = document.createElementNS(ns, 'g');
  const g = EP.lib.Overlayer.highlight(rects, {color: o.color});
  g.style.opacity = '.2';
  out.append(g);
  const r0 = rects[0];
  if(r0){
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', Math.max(8, r0.left - 9)); c.setAttribute('cy', r0.top + 7); c.setAttribute('r', 7.5);
    c.setAttribute('fill', o.color); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', '1.5');
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', Math.max(8, r0.left - 9)); t.setAttribute('y', r0.top + 10.5); t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-size', '10'); t.setAttribute('font-weight', '700'); t.setAttribute('font-family', 'sans-serif'); t.setAttribute('fill', '#222');
    t.textContent = o.who || '';
    out.append(c, t);
  }
  return out;
}
async function epLoadGHls(){
  const g = EP.group, key = EP.key;
  for(const h of EP.ghls) epDelOther(h);
  EP.ghls = [];
  if(!g || !EP.bookId) return;
  try {
    const list = await pb.collection('notes').getFullList({filter: pb.filter('book = {:b} && kind = "highlight" && group = {:g} && owner != {:u} && format = {:f}', {b: EP.bookId, g: g.id, u: me().id, f: EP.fmt}), fields: hlFields});
    if(EP.key !== key || !EP.group || EP.group.id !== g.id) return;
    EP.ghls = list.filter(h => h.anchor && h.anchor.cfi);
    epGroupDraw();
  } catch(e){}
}
function epDrawHl(h, removed){
  if(!EP.view || !h || !h.anchor || !h.anchor.cfi) return;
  if(removed){ EP.view.deleteAnnotation({value: h.anchor.cfi}).catch(() => {}); return; }
  epAdd(h);
}
function epShowAnn(d){
  EP.annAt = Date.now();
  if(EP.marker && EP.mk) return;
  const h = EP.hls.find(x => x.anchor && x.anchor.cfi === d.value);
  const sr = d.range ? epScreenRect(d.range) : null;
  if(!h){ const o = EP.ghls.find(x => x.anchor && x.anchor.cfi === d.value); if(o) hpShowOther(o, sr ? sr.box : null); return; }
  hpShow({mode: 'edit', h, rect: sr ? sr.box : null});
}
// Переход к заметке или цитате: её место из anchor (своя, общая или групповая)
async function epNoteAnchor(id){
  let n = EP.hls.find(x => x.id === id) || EP.ghls.find(x => x.id === id);
  if(!n){ try { n = await pb.collection('notes').getOne(id, {fields: 'id,anchor,format,book'}); } catch(e){ n = null; } }
  return n && n.anchor && n.anchor.cfi ? {cfi: n.anchor.cfi, id} : null;
}
async function epGoNote(id){
  const a = await epNoteAnchor(id);
  if(!a || !EP.view) return;
  await EP.view.goTo(a.cfi).catch(() => {});
  setTimeout(() => epFlash(id), 300);
}
// Мигнуть цитатой: на миг рамка вместо заливки
function epFlash(id){
  const h = EP.hls.find(x => x.id === id), o = h ? null : EP.ghls.find(x => x.id === id);
  if(!(h || o) || !EP.view) return;
  const v = {value: (h || o).anchor.cfi, color: '#C2410C', flash: true};
  EP.view.addAnnotation(v).catch(() => {});
  setTimeout(() => h ? epAdd(h) : epAddOther(o), 1600);
}
// Подпись читателя поверх страниц: холст на весь экран читалки, сквозь него нажатия проходят
function epMarkDraw(){
  const c = $('#ep-mark'), st = $('#ep-stage');
  if(!c || !st) return;
  const w = st.clientWidth, h = st.clientHeight, k = Math.min(window.devicePixelRatio || 1, 2);
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if(!EP.mark) return;
  // строка внизу: над ползунком (он лежит поверх нижнего края страницы), без панелей у самого края
  const sl = $('#reader .rd-slider'), sr = st.getBoundingClientRect(), r = sl && sl.offsetParent ? sl.getBoundingClientRect() : null;
  const bottom = r && r.top < sr.bottom && r.top > sr.top + sr.height / 2 ? (r.top - sr.top - 4) * k : 0;
  rdWatermark(ctx, c.width, c.height, EP.mark, Object.assign({}, EP.markCfg, {bottom}), isDark());
}
darkMQ.addEventListener && darkMQ.addEventListener('change', () => { if(READER.mode === 'epub' && EP.view){ epStyle(); epMarkDraw(); } });

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
  // пришли по ссылке в группу: после входа человек сразу вступает в неё
  const jn = loadLS('join', null);
  const joinNote = jn && jn.code ? `<p class="join-note">${authMode === 'register' ? 'Вас пригласили в группу чтения. После регистрации вы сразу окажетесь в ней.' : 'Вас пригласили в группу чтения. Войдите, и вы сразу окажетесь в ней.'}</p>` : '';
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
// Переход к месту в книге, которая скрыта от читателя (правки 4.1): вместо читалки сообщение
document.addEventListener('click', e => {
  const a = e.target.closest(`a[href="${NA_HREF}"]`);
  if(!a) return;
  e.preventDefault(); e.stopPropagation(); toast(NA_TEXT);
}, true);
// «Библиотека» в меню всегда открывает обычную главную: с поиском адрес меняется сам (#/?q= → #/), без поиска наверх
document.addEventListener('click', e => {
  const t = e.target.closest('.tab[data-tab="lib"]');
  if(!t || e.metaKey || e.ctrlKey) return;
  const r = route();
  if(r.name === 'home' && !r.q.get('q')){ e.preventDefault(); window.scrollTo({top: 0, behavior: 'smooth'}); const q = $('#q'); if(q) q.blur(); }
});
// Ctrl+Enter (Cmd+Enter) в поле комментария отправляет его
document.addEventListener('keydown', e => {
  if(e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
  if(e.target.id === 'cm-text'){ e.preventDefault(); const b = $('#cm-box [data-act="cm-send"]'); if(b) b.click(); }
  else if(e.target.id === 'cm-edit' && UI.cmEdit){ e.preventDefault(); cmSave(UI.cmEdit); }
});
// Esc на главной стирает поиск
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape' || !searchQ() || dlg.open || cropDlg.open || menu || RD.open) return;
  e.preventDefault(); setSearch('');
});
document.addEventListener('click', async e => {
  if(menu && !RD.open){
    const it = e.target.closest('.menu [data-i]');
    const m = menu; closeMenu();
    if(it){ m.items[+it.dataset.i].run(); return; }
    if(e.target.closest('[data-act$="-menu"]') === m.btn) return;
  }
  // вкладки карточки: без новой записи в истории
  const sw = e.target.closest('#main a[data-swap]');
  if(sw && !e.metaKey && !e.ctrlKey){ e.preventDefault(); swapHash(sw.getAttribute('href')); return; }
  // «Назад»: по истории, если пришли изнутри приложения (у карточки книги источник записан в state.from)
  const bk = e.target.closest('#main a[data-back]');
  if(bk && !e.metaKey && !e.ctrlKey){
    if(history.state && history.state.from){ e.preventDefault(); history.back(); return; }
    if(history.state && history.state.knRoot){ e.preventDefault(); go(bk.dataset.back, true); return; }
    if(UI.hops > 0){ e.preventDefault(); history.back(); return; }
  }
  const up = e.target.closest('#uploads [data-act]');
  const a = up || e.target.closest('#main [data-act]');
  if(!a || !S.loaded) return;
  const d = a.dataset;
  switch(d.act){
    case 'search-clear': setSearch(''); { const q = $('#q'); if(q && !touchUI()) q.focus(); } break;
    case 'mark-reading': markReading(d.id); break;
    case 'mark-finish': markFinish(d.id); break;
    case 'mark-again': markAgain(d.id); break;
    case 'fin-all': UI.finAll = !UI.finAll; render(true); break;
    case 'mcp-copy': try { await navigator.clipboard.writeText(UI.mcp.url); toast('Адрес скопирован'); } catch(_){ window.prompt && window.prompt('Скопируйте:', UI.mcp.url); } break;
    case 'mcp-off': mcpOff(d.id, a); break;
    case 'mcp-all': UI.mcpAll = !UI.mcpAll; render(true); break;
    case 'ocr-book': ocrBook(d.id); break;
    case 'ocr-all': ocrAllAsk(); break;
    case 'ocr-cancel': ocrCancel(d.id, a); break;
    case 'offer-book': offerForm(); break;
    case 'rev-edit': { const b = byId('books', d.id); if(b) openBookForm(b); break; }
    case 'rev-cover': { const b = byId('books', d.id); if(b) pickCover(b); break; }
    case 'rev-ok': reviewApprove(d.id, a); break;
    case 'rev-no': reviewReject(d.id); break;
    case 'add-books': openMenu(a, [{label: 'Файлы книг', run: () => pickFile(BOOK_ACCEPT, true, files => { loadDisk(); addUploads(files, 'book'); })},
      {label: 'Аудиокнига без текста', run: audioBookForm}]); break;
    // аудио (правки 4.3)
    case 'au-listen': { if(roBook(byId('books', d.id)) || AP.book === d.id) break; const t = contTrack(d.id); if(t) apPlay(t.id); break; }
    case 'au-track': { if(AP.track === d.id && AP.real){ apToggle(); break; } apPlay(d.id); const t = trackById(d.id); if(t && route().name !== 'listen') go('#/listen/' + t.book); break; }
    case 'au-toggle': apToggle(d.id); break;
    case 'au-cont': apToggle(d.id); break;
    case 'au-skip': apSkip(+d.k); break;
    case 'au-rate': apRate(+d.r); break;
    case 'au-add': { const b = byId('books', d.id); if(b) audioAdd(b); break; }
    case 'au-menu': { const t = trackById(d.id); if(t) audioMenu(a, t); break; }
    case 'acc-book-rm': {
      a.disabled = true;
      try { await pb.send(`/api/knigi/books/${d.book}/readers`, {method: 'POST', body: {remove: [d.user]}}); await loadAll(['bacc']); UI.usersOpen = true; toast('Книга убрана у читателя'); }
      finally { a.disabled = false; }
      break;
    }
    case 'up-close': UP.hidden = true; if(!UP.items.some(u => ['wait','up','proc'].includes(u.state))) UP.items = UP.items.filter(u => !upShown(u)); renderUploadsPanel(); break;
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
    case 'avatar': if(readOnly()){ toast('Без доступа фото не меняется.'); break; } avatarMenu(a); break;
    case 'card-fmt': UI.cardFmt[d.id] = d.f; render(true); break;
    case 'hl-color': UI.hlColor = d.c; render(true); break;
    case 'hl-more': { UI.hlOpen.has(d.id) ? UI.hlOpen.delete(d.id) : UI.hlOpen.add(d.id); render(true); break; }
    case 'note-full': setFull(!UI.fullNow); break;
    // группы
    case 'g-new': openNewGroup(); break;
    case 'g-menu': { const g = byId('groups', d.id); if(g) groupMenu(a, g); break; }
    case 'g-invite': { const g = byId('groups', d.id); if(g) openInvite(g); break; }
    case 'g-members': { const g = byId('groups', d.id); if(g) openMembers(g); break; }
    case 'g-plan-all': { const g = byId('groups', d.id); if(g) openPlanAll(g); break; }
    case 'g-next': { const g = byId('groups', d.id); if(g) openNextBook(g); break; }
    case 'g-feed': UI.gFeed[d.id] = d.f; render(true); break;
    case 'g-banner': UI.gBanner[d.id] = ''; render(true); break;
    case 'g-join': joinGroup(d.code, a).catch(() => {}); break;
    // комментарии
    case 'cm-send': cmSend(d.id, a); break;
    case 'cm-edit': { UI.cmEdit = d.id; cmPaint(); const t = $('#cm-edit'); if(t){ t.focus(); t.setSelectionRange(t.value.length, t.value.length); } break; }
    case 'cm-save': cmSave(d.id); break;
    case 'cm-cancel': UI.cmEdit = ''; cmPaint(); break;
    case 'cm-del': cmDelete(d.id, a); break;
    // экран цитаты
    case 'hl-thought': { const h = hlRec(d.id); if(h) hlThought(h); break; }
    case 'hl-group': { const h = hlRec(d.id); if(h) pickNoteGroup(h, () => { ED.rec = null; render(true); }); break; }
    case 'hl-del': {
      const h = hlRec(d.id); if(!h || !arm(a, 'Удалить?')) return;
      try { await hlDelete(h); ED.rec = null; goBack(h.book ? '#/b/' + h.book + '?tab=highlights' : '#/notes'); } catch(err){ toast(errText(err)); }
      break;
    }
    case 'edit-name': openForm({title: 'Имя', fields: [{key: 'name', label: 'Как вас называть', max: 100}], values: {name: me().name || ''},
      async onSave(v){ const rec = await pb.collection('users').update(me().id, {name: v.name}); pb.authStore.save(pb.authStore.token, rec); render(true); }}); break;
    default: accountAction(a, d);
  }
});
const hlRec = id => ED.rec && ED.rec.id === id ? ED.rec : byId('notes', id);
// «Видно группе» в редакторе: у сохранённой заметки меняется сразу, у новой запишется при первом сохранении
async function edGroupToggle(t){
  const n = ED.rec;
  if(!n || ED.isNew) return;
  try {
    await edSave();
    const rec = await pb.collection('notes').update(n.id, {group: t.checked ? t.value : ''}, {fields: hlFields});
    ED.rec = {...ED.rec, group: rec.group}; upsert('notes', hlStrip(rec));
    toast(rec.group ? 'Заметку видит группа' : 'Теперь заметку видите только вы');
    const box = $('#cm-box'), html = commentsHTML(ED.rec);
    if(box) cmPaint(); else if(html){ const art = $('.note-edit'); if(art) art.insertAdjacentHTML('afterend', html); }
  } catch(err){ t.checked = !t.checked; toast(errText(err)); }
}
document.addEventListener('change', e => {
  const t = e.target;
  if(t.name === 'p-theme'){ setTheme(t.value); return; }
  if(t.id === 'ed-group'){ edGroupToggle(t); return; }
  if(t.id === 'books-sort'){ UI.booksSort = t.value; saveLS('booksSort', t.value); render(true); return; }
  if(t.id === 'books-fmt'){ UI.booksFmt = t.value; render(true); return; }
  if(t.id === 'books-scan'){ UI.booksScan = t.checked; render(true); return; }
  if(t.id === 'books-hidden'){ UI.booksHidden = t.checked; render(true); return; }
  if(t.id === 'books-audio'){ UI.booksAudio = t.checked; render(true); return; }
  if(t.classList && t.classList.contains('ap-seek')){ AP.seeking = false; const el = AP.el; if(el && AP.real && el.duration){ el.currentTime = Math.min(+t.value, el.duration - 0.3); AP.prevT = el.currentTime; apTick(); apPos(); apSave(true); } return; }
  // «Без подписи на страницах» у читателя (правки 4.2): решает сервер при выдаче ссылки на книгу
  if(t.dataset && t.dataset.nomark){
    const id = t.dataset.nomark, action = t.checked ? 'mark_off' : 'mark_on';
    t.disabled = true;
    pb.send('/api/knigi/admin/access', {method: 'POST', body: {user: id, action}})
      .then(() => { UI.openUser = id; toast(ACC_DONE[action]); return loadUsers(); })
      .catch(err => { t.checked = !t.checked; toast(errText(err)); })
      .finally(() => { t.disabled = false; render(true); });
    return;
  }
  if(t.id === 'hl-thought'){ UI.hlThought = t.checked; render(true); return; }
  if(t.dataset && t.dataset.shelf){ const set = UI.revShelves[t.dataset.book] || (UI.revShelves[t.dataset.book] = new Set()); t.checked ? set.add(t.dataset.shelf) : set.delete(t.dataset.shelf); return; }
  if(t.id === 'log-user' || t.id === 'log-book' || t.id === 'log-days'){ UI.logQ[t.id.slice(4)] = t.value; UI.log = null; render(true); return; }
  if(t.id === 'note-files'){ const files = [...t.files]; t.value = ''; if(files.length) addUploads(files, 'file', t.dataset.note); return; }
});
document.addEventListener('input', e => {
  if(e.target.id === 'cm-text'){ const box = e.target.closest('#cm-box'); if(box) UI.cmDraft[box.dataset.note] = e.target.value; }
  if(e.target.id === 'q') setSearch(e.target.value);
  if(e.target.id === 'nq'){ UI.notesQ = e.target.value; notesSearch(); schedule(); }
  // перемотка в плеере: пока тянут, только время на экране
  if(e.target.classList && e.target.classList.contains('ap-seek')){ AP.seeking = true; const box = e.target.closest('.ap-ctl'); const n = box && box.querySelector('.ap-now'); if(n) n.textContent = durShort(+e.target.value); }
});
document.addEventListener('toggle', e => {
  // событие приходит и при отрисовке уже раскрытого блока: реагируем только на настоящее изменение
  if(e.target.id === 'inv-fold' && e.target.open !== UI.invOpen){ UI.invOpen = e.target.open; if(UI.invOpen && isAdmin()){ loadInvites(); loadUsers(); } }
  if(e.target.id === 'users-fold' && e.target.open !== UI.usersOpen){ UI.usersOpen = e.target.open; if(UI.usersOpen && isAdmin()) loadUsers(); }
  if(e.target.classList && e.target.classList.contains('desc')) UI.descOpen = e.target.open;
  if(e.target.id === 'ocr-past') UI.ocrPast = e.target.open;
  if(e.target.classList && e.target.classList.contains('usr-more')){ if(e.target.open) UI.openUser = e.target.dataset.user; else if(UI.openUser === e.target.dataset.user) UI.openUser = ''; }
}, true);
window.addEventListener('hashchange', () => {
  if(route().name === 'profile' && isAdmin()){ loadDisk(); loadGCount(); loadOcr(); }
  if(route().name === 'b' && isAdmin()){ const b = byId('books', route().id); if(b && isScan(b)) loadOcr(); }
});

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
        const body = {code: inviteCode(), note: $('#i-note').value.trim(), max_uses: Number($('#i-max').value), uses: 0, expires: $('#i-exp').value, access_period: $('#i-period').value};
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
      case 'acc': {
        const note = ($('#un-' + d.id) || {}).value || '';
        if(d.action === 'suspend' && !arm(a, 'Точно приостановить?')) return;
        if(d.action === 'set' && !($('#ud-' + d.id) || {}).value){ toast('Выберите дату.'); return; }
        a.disabled = true;
        try {
          await pb.send('/api/knigi/admin/access', {method: 'POST', body: {user: d.id, action: d.action, months: Number(d.months || 0), date: ($('#ud-' + d.id) || {}).value || '', note: note.trim()}});
        } finally { a.disabled = false; }
        UI.openUser = d.id;
        await loadUsers(); render(true); toast(ACC_DONE[d.action] || 'Сохранено'); break;
      }
      case 'logout': {
        apStop();
        dropLS('accHide');
        await fetch('/api/knigi/logout', {method: 'POST'}).catch(() => {});
        Object.keys(localStorage).filter(k => k.startsWith('kn_draft_')).forEach(k => localStorage.removeItem(k));
        pb.authStore.clear(); location.hash = ''; location.reload(); break;
      }
    }
  }catch(e){ toast(errText(e)); }
}

let tt = 0;
function toast(msg){
  // подсказка могла уйти вместе с читалкой, когда её содержимое собрали заново: создаём снова
  let el = $('#toast');
  if(!el){ el = document.createElement('div'); el.className = 'toast'; el.id = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); } const host = dlg.open ? dlg : RD.open ? $('#reader') : document.body; if(el.parentNode !== host) host.appendChild(el); el.textContent = msg; el.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), 2800); }

boot();
})();
