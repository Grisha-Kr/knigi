// Сервис-воркер: хранит оболочку приложения (страницу, стили, код, шрифты, читалку pdf.js, редактор),
// чтобы приложение быстро открывалось. Данные и файлы (/api/) никогда не кэшируются:
// книги, их страницы, обложки и файлы уроков идут только через /api/, поэтому в памяти
// телефона от них ничего не остаётся.
const VERSION = 'knigi-v11';
const SHELL = ['/', '/index.html', '/app.css?v=11', '/app.js?v=11', '/vendor/pocketbase.umd.js', '/manifest.webmanifest', '/icons/icon-192.png?v=2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_/')) return;
  // Сначала сеть, при отсутствии связи берём из кэша
  e.respondWith(
    fetch(e.request).then(res => {
      // адреса с ключами из писем и приглашений (/?reset=…, /?invite=…) не кэшируем: подходит только пустой адрес или ?v=
      const plain = !url.search || /^\?v=\d+$/.test(url.search);
      if (res.ok && res.status === 200 && plain && (url.pathname === '/' || /\.(html|css|js|mjs|woff2|png|svg|webmanifest|bcmap|pfb|ttf)$/.test(url.pathname))) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('/') : undefined)))
  );
});
