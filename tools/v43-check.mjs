#!/usr/bin/env node
// Проверка правок 4.3 на локальном PocketBase: скрытая книга для отдельных читателей (часть А). Без внешних пакетов, Node 18+. Обычно запускается из tools/v43-check.sh,
// который сам поднимает чистый PocketBase. Настройки: KN_BASE, KN_DATA (папка pb_data, для просроченной ссылки),
// KN_AUDIO (папка аудио, для проверки удаления файлов).
//
// Пользователи: администратор, Анна и Борис (читатели), Дина (удаляет свой аккаунт).
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHmac } from "node:crypto";
import { join } from "node:path";

const BASE = (process.env.KN_BASE || "http://127.0.0.1:8093").replace(/\/+$/, "");
const DATA = process.env.KN_DATA || "";
const AUDIO = process.env.KN_AUDIO || "";
const ADMIN = { email: "admin@example.com", password: "proverka-admin-12345", name: "Григорий" };
const ANNA = { email: "anna@example.com", password: "proverka-anna-12345", name: "Анна" };
const BORIS = { email: "boris@example.com", password: "proverka-boris-12345", name: "Борис" };
const DINA = { email: "dina@example.com", password: "proverka-dina-12345", name: "Дина" };
let fails = 0, oks = 0;
const ok = (cond, what, extra) => {
  if (cond) { oks++; console.log("  ОК      " + what); }
  else { fails++; console.log("  ОШИБКА  " + what + (extra !== undefined ? "\n          " + String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 600) : "")); }
  return cond;
};
const section = (t) => console.log("\n" + t);

async function req(method, path, { json, headers = {}, token, raw } = {}) {
  const h = { ...headers };
  let body;
  if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (raw) body = raw;
  if (token) h.Authorization = token;
  const r = await fetch(BASE + path, { method, headers: h, body, redirect: "manual" });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  return { status: r.status, headers: r.headers, text, data };
}
const uid = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url")).id;
const flt = (s) => "filter=" + encodeURIComponent(s);

/* ---------- Тестовые книги (делаются здесь же) ---------- */
function makePdf(label) {
  const pages = [];
  for (let i = 1; i <= 5; i++) pages.push(`BT /F1 14 Tf 72 720 Td (${label} page ${i}) Tj 0 -24 Td (The quick brown fox jumps over the lazy dog, page ${i}.) Tj 0 -24 Td (Patience and prayer go together, again and again.) Tj ET`);
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add(null), pagesObj = add(null), font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const ids = [];
  for (const c of pages) {
    const content = add(`<< /Length ${Buffer.byteLength(c)} >>\nstream\n${c}\nendstream`);
    ids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${ids.map((p) => p + " 0 R").join(" ")}] /Count ${ids.length} >>`;
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function makeZip(files) {
  const parts = [], central = [];
  let off = 0;
  for (const [name, data] of files) {
    const nb = Buffer.from(name), d = Buffer.from(data), crc = crc32(d);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(nb.length, 26);
    parts.push(h, nb, d);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, nb);
    off += 30 + nb.length + d.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
function makeEpub(title) {
  const long = "Терпение и молитва идут рядом. ".repeat(40);
  const ch = (t, body) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${t}</title></head><body><h1>${t}</h1>${body}</body></html>`;
  return makeZip([
    ["mimetype", "application/epub+zip"],
    ["META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ["OEBPS/content.opf", `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">kn-${Date.now()}</dc:identifier><dc:title>${title}</dc:title><dc:creator>Иван Проверкин</dc:creator><dc:language>ru</dc:language></metadata>` +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>'],
    ["OEBPS/nav.xhtml", '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Глава первая</a></li></ol></nav></body></html>'],
    ["OEBPS/c1.xhtml", ch("Глава первая", `<p>${title}: утром зажгли ёлку.</p><p>${long}</p>`)],
  ]);
}

/* ---------- Пользователи, загрузка ---------- */
async function login(u) {
  const r = await req("POST", "/api/collections/users/auth-with-password", { json: { identity: u.email, password: u.password } });
  if (r.status !== 200) throw new Error("Не получилось войти как " + u.email + ": " + r.text);
  return r.data.token;
}
async function invite(admin, period) {
  const code = "KN" + Math.random().toString(36).slice(2, 10).toUpperCase();
  const r = await req("POST", "/api/collections/invites/records", { token: admin, json: { code, note: "проверка", max_uses: 1, access_period: period || "" } });
  return { code, r };
}
async function register(admin, u, period) {
  const s = await req("POST", "/api/collections/users/auth-with-password", { json: { identity: u.email, password: u.password } });
  if (s.status === 200) return s.data.token;
  const { code } = await invite(admin, period);
  const r = await req("POST", "/api/collections/users/records", { json: { ...u, passwordConfirm: u.password, invite: code } });
  if (r.status !== 200) throw new Error("регистрация " + u.email + ": " + r.text);
  return login(u);
}
async function upload(token, name, buf, kind) {
  let r = await req("POST", "/api/knigi/upload/start", { token, json: { name, size: buf.length, kind: kind || "book" } });
  if (r.status !== 200) return { error: r };
  const up = r.data.upload;
  const fd = new FormData();
  fd.append("chunk", new Blob([buf]), "chunk");
  const c = await fetch(`${BASE}/api/knigi/upload/${up}/0`, { method: "POST", headers: { Authorization: token }, body: fd });
  if (c.status !== 200) return { error: { status: c.status, text: await c.text() } };
  r = await req("POST", `/api/knigi/upload/${up}/finish`, { token, json: {} });
  if (r.status !== 200) return { error: r };
  await req("POST", "/api/knigi/process", { token, json: {} });
  return r.data;
}
async function waitReady(admin, bookId) {
  for (let i = 0; i < 80; i++) {
    const b = await req("GET", `/api/collections/books/records/${bookId}`, { token: admin });
    if (b.data && b.data.status && b.data.status !== "processing") return b.data;
    await sleep(400);
  }
  throw new Error("Книга не обработалась за 30 секунд");
}
// Ссылка на файл и первый кусок файла (как читалка: с кукой из ответа ссылки)
async function readFile(token, bookId, fmt) {
  const l = await req("GET", `/api/knigi/books/${bookId}/link?f=${fmt || "pdf"}`, { token });
  if (l.status !== 200) return { link: l };
  const cookie = (l.headers.get("set-cookie") || "").split(";")[0];
  const f = await fetch(BASE + l.data.url, { headers: { Cookie: cookie, Range: "bytes=0-1023" } });
  return { link: l, file: f.status };
}
const setVis = (admin, id, hidden) => req("POST", `/api/knigi/books/${id}/visibility`, { token: admin, json: { hidden } });
const viewBook = (t, id) => req("GET", `/api/collections/books/records/${id}`, { token: t });
const listIds = async (t, col, filter) => ((await req("GET", `/api/collections/${col}/records?perPage=500${filter ? "&" + flt(filter) : ""}`, { token: t })).data || { items: [] }).items.map((x) => x.id);
const progress = (t, id, body) => req("POST", `/api/knigi/books/${id}/progress`, { token: t, json: body });

// Живые обновления: подключиться к /api/realtime, подписаться на тему и собирать сообщения
async function realtime(token, topics) {
  const ctl = new AbortController();
  const res = await fetch(BASE + "/api/realtime", { signal: ctl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const events = [];
  let buf = "", clientId = "";
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event:(.*)$/m.exec(chunk), data = /^data:(.*)$/m.exec(chunk);
          if (!ev) continue;
          const name = ev[1].trim();
          if (name === "PB_CONNECT") clientId = JSON.parse(data[1]).clientId;
          else events.push({ name, data: data ? data[1] : "" });
        }
      }
    } catch (_) {}
  })();
  for (let i = 0; i < 50 && !clientId; i++) await sleep(50);
  await req("POST", "/api/realtime", { token, json: { clientId, subscriptions: topics } });
  return { events, close: () => { ctl.abort(); return pump; } };
}

const setReaders = (admin, id, users) => req("POST", `/api/knigi/books/${id}/readers`, { token: admin, json: { users } });
const cookieOf = (r) => (r.headers.get("set-cookie") || "").split(";")[0];
async function coverStatus(token, id) {
  const s = await req("GET", "/api/knigi/session", { token });
  const r = await fetch(`${BASE}/api/knigi/f/cover/${id}?v=x`, { headers: { Cookie: cookieOf(s) } });
  return r.status;
}

/* ---------- Часть А: книга для отдельных читателей ---------- */
async function partA(T) {
  const { admin, anna, boris } = T;
  const annaId = uid(anna), borisId = uid(boris);
  section("А1. Книга X открыта только Анне, книга Y только Борису");
  const X = await waitReady(admin, (await upload(admin, "Тестов - Книга X.pdf", makePdf("Book X"))).id);
  const Y = await waitReady(admin, (await upload(admin, "Тестов - Книга Y.pdf", makePdf("Book Y"))).id);
  ok(X.hidden && Y.hidden, "обе новые книги скрыты");
  ok(X.cover && Y.cover, "у обеих есть обложка (для проверки обложек)");
  let r = await setReaders(admin, X.id, [annaId]);
  ok(r.status === 200 && r.data.readers.length === 1 && r.data.readers[0].name === "Анна", "X открыта Анне, ответ с именем", r.text);
  r = await setReaders(admin, Y.id, [borisId]);
  ok(r.status === 200 && r.data.readers.map((x) => x.name).join() === "Борис", "Y открыта Борису", r.text);
  const cs = await req("POST", "/api/collections/shelves/records", { token: admin, json: { name: "Общая полка 4.3", owner: uid(admin), common: true, sort: 1 } });
  for (const b of [X, Y]) await req("POST", "/api/collections/shelf_books/records", { token: admin, json: { shelf: cs.data.id, book: b.id, sort: 1 } });
  for (const [who, t, mine, other] of [["Анна", anna, X, Y], ["Борис", boris, Y, X]]) {
    const ids = await listIds(t, "books");
    ok(ids.includes(mine.id) && !ids.includes(other.id), `${who}: своя книга в списке, чужой нет`);
    ok((await viewBook(t, mine.id)).status === 200 && (await viewBook(t, other.id)).status === 404, `${who}: своя по адресу 200, чужая 404`);
    ok((await listIds(t, "book_files", `book = '${mine.id}'`)).length === 1 && (await listIds(t, "book_files", `book = '${other.id}'`)).length === 0, `${who}: файлы своей видны, чужой нет`);
    let rf = await readFile(t, mine.id);
    ok(rf.link.status === 200 && rf.file === 206, `${who}: своя книга открывается (ссылка и кусок файла 206)`, rf.link.text);
    rf = await readFile(t, other.id);
    ok(rf.link.status === 404, `${who}: ссылку на чужую не получает (404)`, rf.link.text);
    ok(await coverStatus(t, mine.id) === 200 && await coverStatus(t, other.id) === 404, `${who}: обложка своей 200, чужой 404`);
    const sb = await listIds(t, "shelf_books", `shelf = '${cs.data.id}'`);
    ok(sb.length === 1, `${who}: на общей полке видна только своя книга`, sb);
    const acc = (await req("GET", "/api/collections/book_access/records", { token: t })).data.items;
    ok(acc.length === 1 && acc[0].book === mine.id, `${who}: в book_access видна только своя строка`, acc);
  }
  const pg = await progress(anna, X.id, { format: "pdf", page: 3, pages: 5, seen: [1, 2, 3] });
  ok(pg.status === 200, "Анна читает X: прогресс с. 3", pg.text);
  ok((await progress(boris, X.id, { format: "pdf", page: 2, pages: 5 })).status === 404, "Борис не пишет прогресс по X");

  section("А2. Права на список");
  ok((await setReaders(anna, X.id, [annaId, borisId])).status === 403, "читатель не меняет список (403)");
  ok((await req("POST", "/api/collections/book_access/records", { token: anna, json: { book: Y.id, user: annaId } })).status >= 400, "читатель не добавляет себя в book_access через API");
  ok((await req("POST", "/api/collections/book_access/records", { token: admin, json: { book: Y.id, user: annaId } })).status >= 400, "через API не пишет никто, только маршрут");
  const pr = await req("PATCH", `/api/collections/books/records/${X.id}`, { token: admin, json: { title: "Книга X", hidden: false } });
  ok(pr.status === 200 && pr.data.hidden === true, "обычное изменение книги не открывает её");
  r = await req("GET", `/api/knigi/books/${X.id}/readers`, { token: admin });
  ok(r.status === 200 && r.data.readers.length === 1, "администратор получает список читателей", r.text);

  section("А3. Анна с цитатой и «Читаю»; её убрали из списка и вернули");
  const hl = await req("POST", "/api/collections/notes/records", { token: anna, json: { owner: annaId, kind: "highlight", book: X.id, format: "pdf", page: 3, quote: "Patience and prayer", color: "green", anchor: { v: 1, rects: [[0.1, 0.1, 0.3, 0.02]], s: 0, e: 10 } } });
  ok(hl.status === 200, "цитата Анны к X сохранена", hl.text);
  ok((await req("POST", "/api/collections/marks/records", { token: anna, json: { user: annaId, book: X.id, status: "reading" } })).status === 200, "Анна отметила «Читаю»");
  const mine = await req("POST", "/api/collections/shelves/records", { token: anna, json: { name: "Моя", owner: annaId, common: false, sort: 1 } });
  ok((await req("POST", "/api/collections/shelf_books/records", { token: anna, json: { shelf: mine.data.id, book: X.id, sort: 1 } })).status === 200, "Анна поставила X на свою полку");
  const rt = await realtime(anna, ["knigi_books"]);
  r = await setReaders(admin, X.id, []);
  ok(r.status === 200 && r.data.readers.length === 0, "Анну убрали из списка X");
  const va = await viewBook(anna, X.id);
  ok(va.status === 200 && va.data.hidden === true, "у Анны карточка X осталась (у неё есть записи)", va.text);
  let rf = await readFile(anna, X.id);
  ok(rf.link.status === 403 && /временно недоступна/.test(rf.link.data.message), "ссылку на файл не получает: «Книга временно недоступна»", rf.link.text);
  ok((await listIds(anna, "book_files", `book = '${X.id}'`)).length === 0, "файлы X Анне не видны");
  ok((await listIds(anna, "notes", `id = '${hl.data.id}'`)).length === 1, "цитата цела");
  ok((await listIds(anna, "shelf_books", `shelf = '${cs.data.id}'`)).length === 0, "на общей полке X у Анны нет");
  ok((await listIds(anna, "shelf_books", `shelf = '${mine.data.id}'`)).length === 1, "на своей полке X осталась");
  ok((await progress(anna, X.id, { format: "pdf", page: 4, pages: 5 })).status === 403, "прогресс не пишется");
  await sleep(300);
  ok(rt.events.some((e) => e.name === "knigi_books"), "приложение Анны получило сообщение о видимости");
  await rt.close();
  r = await setReaders(admin, X.id, [annaId]);
  rf = await readFile(anna, X.id);
  ok(rf.link.status === 200 && rf.file === 206, "Анну вернули: файл снова открывается");
  const rd = await req("GET", `/api/collections/reading/records?${flt(`book = '${X.id}'`)}`, { token: anna });
  ok(rd.data.items[0] && rd.data.items[0].page === 3, "чтение продолжается со с. 3");
  ok((await listIds(anna, "shelf_books", `shelf = '${cs.data.id}'`)).length === 1, "X снова на общей полке у Анны");

  section("А4. Видна всем: список хранится");
  await setVis(admin, X.id, false);
  ok((await viewBook(boris, X.id)).status === 200, "X открыта всем: Борис её видит");
  r = await req("GET", `/api/knigi/books/${X.id}/readers`, { token: admin });
  ok(r.data.readers.length === 1, "список отдельных читателей сохранился");
  await setVis(admin, X.id, true);
  ok((await viewBook(boris, X.id)).status === 404 && (await viewBook(anna, X.id)).status === 200, "снова скрыта: Анне видна по списку, Борису нет");

  section("А5. Группа с Анной и Борисом");
  const C = await waitReady(admin, (await upload(admin, "Тестов - Книга C.epub", makeEpub("Книга C"))).id);
  await setVis(admin, C.id, false);
  let gr = await req("POST", "/api/knigi/groups", { token: anna, json: { name: "Анна и Борис", book: C.id } });
  ok(gr.status === 200, "Анна создала группу с открытой книгой", gr.text);
  const g = (await req("GET", `/api/collections/groups/records/${gr.data.id}`, { token: anna })).data;
  await req("POST", `/api/knigi/join/${g.invite_code}`, { token: boris, json: {} });
  let bl = await req("GET", `/api/knigi/groups/${g.id}/blocked-books`, { token: anna });
  ok(bl.status === 200 && bl.data.blocked.includes(X.id) && bl.data.blocked.includes(Y.id), "X и Y в списке «нельзя выбрать» для этой группы", bl.text);
  ok((await req("GET", `/api/knigi/groups/${g.id}/blocked-books`, { token: boris })).status === 403, "список видит только создатель группы");
  let nb = await req("POST", `/api/knigi/groups/${g.id}/book`, { token: anna, json: { book: X.id } });
  ok(nb.status === 400 && /не всем участникам/.test(nb.data.message), "X нельзя выбрать книгой группы: «Книга открыта не всем участникам группы»", nb.text);
  await setVis(admin, X.id, false);
  nb = await req("POST", `/api/knigi/groups/${g.id}/book`, { token: anna, json: { book: X.id } });
  ok(nb.status === 200, "после «Видна всем» X выбирается", nb.text);
  await setVis(admin, X.id, true);
  ok((await viewBook(boris, X.id)).status === 200, "X снова скрыта: Борис видит её карточку как участник группы");
  rf = await readFile(boris, X.id);
  ok(rf.link.status === 403, "у Бориса «Книга временно недоступна»: ссылки нет", rf.link.text);
  rf = await readFile(anna, X.id);
  ok(rf.link.status === 200, "у Анны (в списке) книга группы открывается");
  ok((await req("GET", `/api/collections/groups/records/${g.id}`, { token: boris })).status === 200 && (await req("GET", `/api/knigi/groups/${g.id}/state`, { token: boris })).status === 200, "группа и «Сегодня читали» у Бориса видны");
  const g2 = await req("POST", "/api/knigi/groups", { token: anna, json: { name: "Только Анна", book: Y.id } });
  ok(g2.status === 400, "группу с книгой Y (Анне не открыта) не создать", g2.text);

  section("А6. Удаление пользователя убирает его из списков");
  const dina = await register(admin, DINA);
  await setReaders(admin, Y.id, [borisId, uid(dina)]);
  ok((await req("GET", `/api/knigi/books/${Y.id}/readers`, { token: admin })).data.readers.length === 2, "Y открыта Борису и Дине");
  const su = await req("POST", "/api/collections/_superusers/auth-with-password", { json: { identity: "su@example.com", password: "proverka-su-12345" } });
  const del = await req("DELETE", `/api/collections/users/records/${uid(dina)}`, { token: su.data && su.data.token });
  ok(del.status === 204, "аккаунт Дины удалён в панели", del.text);
  r = await req("GET", `/api/knigi/books/${Y.id}/readers`, { token: admin });
  ok(r.data.readers.map((x) => x.name).join() === "Борис", "в списке Y остался только Борис", r.data);
  section("А7. Поиск читателя на сервере, добавить и убрать по одному");
  for (let i = 1; i <= 12; i++) await register(admin, { email: `reader${i}@example.com`, password: "proverka-reader-12345", name: `Читатель Номер ${i}` });
  let sr = await req("GET", "/api/knigi/admin/user-search?q=" + encodeURIComponent("ч"), { token: admin });
  ok(sr.status === 200 && sr.data.users.length === 0, "одна буква: пусто (ищем от 2 букв)", sr.text);
  sr = await req("GET", "/api/knigi/admin/user-search?q=" + encodeURIComponent("читатель"), { token: admin });
  ok(sr.data.users.length === 10, "совпадений больше 10: отдаётся 10", sr.data.users.length);
  sr = await req("GET", "/api/knigi/admin/user-search?q=" + encodeURIComponent("АНН"), { token: admin });
  ok(sr.data.users.length === 1 && sr.data.users[0].name === "Анна" && sr.data.users[0].email === "anna@example.com", "по имени без учёта регистра (кириллица): «АНН» → Анна", sr.data);
  sr = await req("GET", "/api/knigi/admin/user-search?q=" + encodeURIComponent("BORIS@EX"), { token: admin });
  ok(sr.data.users.length === 1 && sr.data.users[0].name === "Борис", "по почте: «BORIS@EX» → Борис", sr.data);
  sr = await req("GET", "/api/knigi/admin/user-search?q=" + encodeURIComponent("Григорий"), { token: admin });
  ok(sr.data.users.length === 0, "администратора в поиске нет");
  ok((await req("GET", "/api/knigi/admin/user-search?q=an", { token: anna })).status === 403, "читатель искать не может (403)");
  r = await req("POST", `/api/knigi/books/${Y.id}/readers`, { token: admin, json: { add: [annaId] } });
  ok(r.status === 200 && r.data.readers.map((x) => x.name).sort().join() === "Анна,Борис", "«добавить» Анну: Борис остался, Анна добавилась", r.data);
  ok(r.data.readers.every((x) => x.email), "в ответе есть почта (для окна настроек)");
  r = await req("POST", `/api/knigi/books/${Y.id}/readers`, { token: admin, json: { remove: [borisId] } });
  ok(r.data.readers.map((x) => x.name).join() === "Анна", "«убрать» Бориса: осталась Анна", r.data);
  ok((await viewBook(boris, Y.id)).status === 404 && (await viewBook(anna, Y.id)).status === 200, "Y теперь видна Анне и не видна Борису");
  r = await req("POST", `/api/knigi/books/${Y.id}/readers`, { token: admin, json: { add: [borisId] } });
  ok(r.data.readers.length === 2, "Бориса вернули");
  return { X, Y, C, group: g };
}

async function main() {
  const s = await req("POST", "/api/collections/users/auth-with-password", { json: { identity: ADMIN.email, password: ADMIN.password } });
  let admin = s.status === 200 ? s.data.token : null;
  if (!admin) {
    const r = await req("POST", "/api/collections/users/records", { json: { ...ADMIN, passwordConfirm: ADMIN.password } });
    if (r.status !== 200) throw new Error("администратор: " + r.text);
    admin = await login(ADMIN);
  }
  const anna = await register(admin, ANNA), boris = await register(admin, BORIS);
  const T = { admin, anna, boris };
  const A = await partA(T);
  console.log(`\nПроверок: ${oks + fails}, прошло ${oks}, ошибок ${fails}.`);
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.log("Сбой проверки:", e); process.exit(1); });
