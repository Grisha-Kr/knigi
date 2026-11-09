#!/usr/bin/env node
// Проверка правок 4.1 на локальном PocketBase: скрытые книги (часть А) и срок доступа читателей (часть Б).
// Без внешних пакетов, Node 18+. Обычно запускается из tools/access-check.sh, который сам поднимает
// чистый PocketBase. Настройка: KN_BASE (http://127.0.0.1:8093).
//
// Пользователи: администратор, Анна (читатель, у неё с книгой есть цитата, заметка, «Читаю», прогресс,
// личная полка), Борис (читатель без связей с книгой, участник группы), Вера (по приглашению на 1 месяц).
import { setTimeout as sleep } from "node:timers/promises";

const BASE = (process.env.KN_BASE || "http://127.0.0.1:8093").replace(/\/+$/, "");
const ADMIN = { email: "admin@example.com", password: "proverka-admin-12345", name: "Григорий" };
const ANNA = { email: "anna@example.com", password: "proverka-anna-12345", name: "Анна" };
const BORIS = { email: "boris@example.com", password: "proverka-boris-12345", name: "Борис" };
const VERA = { email: "vera@example.com", password: "proverka-vera-12345", name: "Вера" };
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

/* ---------- Часть А: скрытые книги ---------- */
async function partA(T) {
  const { admin, anna, boris } = T;
  section("А1. Новая книга скрыта, читатель её не видит");
  const up = await upload(admin, "Тестов - Скрытая книга.pdf", makePdf("Hidden"));
  const A = await waitReady(admin, up.id);
  ok(A.hidden === true, "новая книга, загруженная администратором, скрыта", A);
  ok((await listIds(anna, "books")).indexOf(A.id) < 0, "читатель не видит её в списке книг");
  ok((await viewBook(anna, A.id)).status === 404, "читатель не открывает её по прямому адресу (404)");
  ok((await listIds(anna, "book_files", `book = '${A.id}'`)).length === 0, "читатель не видит её файлы");
  let rf = await readFile(anna, A.id);
  ok(rf.link.status === 404, "ссылку на файл читатель не получает", rf.link.text);
  const cover = await fetch(`${BASE}/api/knigi/f/cover/${A.id}?v=x`, { headers: { Cookie: (await req("GET", "/api/knigi/session", { token: anna })).headers.get("set-cookie").split(";")[0] } });
  ok(cover.status === 404, "обложку читатель не получает");
  rf = await readFile(admin, A.id);
  ok(rf.link.status === 200 && rf.file === 206, "администратор открывает скрытую книгу", rf.link.text);

  section("А2. «Видна всем читателям»: книга открыта, потом снова скрыта");
  const rt = await realtime(boris, ["knigi_books"]);
  let v = await setVis(admin, A.id, false);
  ok(v.status === 200 && v.data.hidden === false && v.data.opened_at, "администратор открыл книгу всем", v.text);
  ok((await listIds(anna, "books")).indexOf(A.id) >= 0, "читатель видит её в списке");
  rf = await readFile(anna, A.id);
  ok(rf.link.status === 200 && rf.file === 206, "читатель получает ссылку и кусок файла", rf.link.text);
  const rv = await setVis(anna, A.id, true);
  ok(rv.status === 403, "читатель не может скрыть книгу сам (403)", rv.text);
  const pr = await req("PATCH", `/api/collections/books/records/${A.id}`, { token: admin, json: { title: "Скрытая книга", hidden: true, kept_for: [uid(anna)] } });
  ok(pr.status === 200 && pr.data.hidden === false, "через обычное изменение книги hidden не меняется", pr.text);
  v = await setVis(admin, A.id, true);
  ok(v.status === 200 && v.data.hidden === true, "администратор снова скрыл книгу");
  ok((await viewBook(anna, A.id)).status === 404, "читатель без записей к книге снова её не видит");
  rf = await readFile(anna, A.id);
  ok(rf.link.status === 404, "и ссылку не получает");
  await sleep(300);
  ok(rt.events.filter((e) => e.name === "knigi_books").length >= 2, "открытые приложения получают сообщение о видимости книги", rt.events);
  await rt.close();
  await setVis(admin, A.id, false);

  section("А3. У Анны есть цитата, заметка, «Читаю», прогресс и своя полка; книгу скрыли");
  const annaId = uid(anna);
  const hl = await req("POST", "/api/collections/notes/records", { token: anna, json: { owner: annaId, kind: "highlight", book: A.id, format: "pdf", page: 3, quote: "Patience and prayer", color: "green", body: "<p>Моя мысль</p>", anchor: { v: 1, rects: [[0.1, 0.1, 0.3, 0.02]], s: 0, e: 10 } } });
  ok(hl.status === 200, "цитата Анны сохранена", hl.text);
  const nt = await req("POST", "/api/collections/notes/records", { token: anna, json: { owner: annaId, kind: "note", book: A.id, title: "Заметка Анны", body: "<p>текст</p>" } });
  ok(nt.status === 200, "заметка Анны сохранена", nt.text);
  const mk = await req("POST", "/api/collections/marks/records", { token: anna, json: { user: annaId, book: A.id, status: "reading" } });
  ok(mk.status === 200, "отметка «Читаю»", mk.text);
  const pg = await progress(anna, A.id, { format: "pdf", page: 3, pages: 5, seen: [1, 2, 3] });
  ok(pg.status === 200 && pg.data.page === 3, "прогресс: страница 3", pg.text);
  const sh = await req("POST", "/api/collections/shelves/records", { token: anna, json: { name: "Моя полка", owner: annaId, common: false, sort: 1 } });
  const sb = await req("POST", "/api/collections/shelf_books/records", { token: anna, json: { shelf: sh.data.id, book: A.id, sort: 1 } });
  ok(sb.status === 200, "книга на личной полке Анны", sb.text);
  const cs = await req("POST", "/api/collections/shelves/records", { token: admin, json: { name: "Общая полка", owner: uid(admin), common: true, sort: 1 } });
  await req("POST", "/api/collections/shelf_books/records", { token: admin, json: { shelf: cs.data.id, book: A.id, sort: 1 } });
  const lesson = await req("POST", "/api/collections/notes/records", { token: admin, json: { owner: uid(admin), kind: "lesson", book: A.id, title: "Урок для всех", body: "<p>урок</p>", shared: true } });
  ok(lesson.status === 200, "общий урок администратора к книге", lesson.text);

  v = await setVis(admin, A.id, true);
  ok(v.status === 200 && v.data.hidden, "книгу скрыли");
  const va = await viewBook(anna, A.id);
  ok(va.status === 200 && va.data.hidden === true, "Анна видит карточку книги с пометкой hidden", va.text);
  ok(va.data && va.data.kept_for === undefined, "список kept_for читателю не показывается", va.data);
  ok((await listIds(anna, "books")).indexOf(A.id) >= 0, "у Анны книга есть в списке (для своих полок, «Читаю», заметок)");
  ok((await viewBook(boris, A.id)).status === 404, "Борис книгу не видит");
  ok((await listIds(anna, "book_files", `book = '${A.id}'`)).length === 0, "файлы скрытой книги Анне не видны");
  rf = await readFile(anna, A.id);
  ok(rf.link.status === 403 && /временно недоступна/.test(rf.link.data.message), "ссылку на файл Анна не получает: «Книга временно недоступна»", rf.link.text);
  ok((await progress(anna, A.id, { format: "pdf", page: 4, pages: 5 })).status === 403, "прогресс по скрытой книге не пишется");
  ok((await listIds(anna, "notes", `book = '${A.id}' && owner = '${annaId}'`)).length === 2, "цитата и заметка Анны на месте");
  const hlView = await req("GET", `/api/collections/notes/records/${hl.data.id}`, { token: anna });
  ok(hlView.status === 200 && hlView.data.quote === "Patience and prayer", "Анна открывает свою цитату");
  ok((await listIds(anna, "notes", `id = '${lesson.data.id}'`)).length === 1 && (await listIds(boris, "notes", `id = '${lesson.data.id}'`)).length === 1, "общий урок к скрытой книге читатели видят");
  ok((await listIds(anna, "marks", `book = '${A.id}'`)).length === 1, "отметка «Читаю» на месте");
  const rd = await req("GET", `/api/collections/reading/records?${flt(`book = '${A.id}'`)}`, { token: anna });
  ok(rd.data.items.length === 1 && rd.data.items[0].page === 3, "прогресс (с. 3) на месте");
  ok((await listIds(anna, "shelf_books", `shelf = '${sh.data.id}'`)).length === 1, "книга на личной полке Анны осталась");
  ok((await listIds(anna, "shelf_books", `shelf = '${cs.data.id}'`)).length === 0, "на общей полке скрытой книги у читателя нет");
  ok((await listIds(admin, "shelf_books", `shelf = '${cs.data.id}'`)).length === 1, "у администратора она на общей полке");
  const ed = await req("PATCH", `/api/collections/notes/records/${nt.data.id}`, { token: anna, json: { title: "Заметка Анны (правка)" } });
  ok(ed.status === 200, "Анна правит свою заметку к скрытой книге", ed.text);
  const sh2 = await req("POST", "/api/collections/shelves/records", { token: anna, json: { name: "Вторая", owner: annaId, common: false, sort: 2 } });
  const sb2 = await req("POST", "/api/collections/shelf_books/records", { token: anna, json: { shelf: sh2.data.id, book: A.id, sort: 1 } });
  ok(sb2.status === 400, "на новую полку скрытую книгу не поставить", sb2.text);
  const bn = await req("POST", "/api/collections/notes/records", { token: boris, json: { owner: uid(boris), kind: "note", book: A.id, title: "x", body: "<p>x</p>" } });
  ok(bn.status === 400, "Борис не пишет заметку к скрытой книге", bn.text);

  section("А4. Книгу снова открыли: всё на месте, чтение с той же страницы");
  v = await setVis(admin, A.id, false);
  const after = await viewBook(anna, A.id);
  ok(after.data.hidden === false, "книга видна");
  rf = await readFile(anna, A.id);
  ok(rf.link.status === 200 && rf.file === 206, "Анна снова получает файл");
  const rd2 = await req("GET", `/api/collections/reading/records?${flt(`book = '${A.id}'`)}`, { token: anna });
  ok(rd2.data.items[0].page === 3, "прогресс по-прежнему с. 3");
  ok((await listIds(anna, "shelf_books", `shelf = '${cs.data.id}'`)).length === 1, "книга снова на общей полке у читателя");
  ok(new Date(after.data.opened_at.replace(" ", "T")) > new Date(A.created.replace(" ", "T")), "дата «открыта всем» позже даты загрузки", after.data);

  section("А5. Группа с текущей скрытой книгой");
  const upB = await upload(admin, "Тестов - Книга группы.epub", makeEpub("Книга группы"));
  const B = await waitReady(admin, upB.id);
  let gr = await req("POST", "/api/knigi/groups", { token: boris, json: { name: "Скрытая не годится", book: B.id } });
  ok(gr.status === 404 || gr.status === 400, "группу со скрытой книгой не создать", gr.text);
  await setVis(admin, B.id, false);
  gr = await req("POST", "/api/knigi/groups", { token: boris, json: { name: "Группа Бориса", book: B.id } });
  ok(gr.status === 200, "Борис создал группу с открытой книгой", gr.text);
  const g = (await req("GET", `/api/collections/groups/records/${gr.data.id}`, { token: boris })).data;
  await req("POST", `/api/knigi/join/${g.invite_code}`, { token: anna, json: {} });
  const gn = await req("POST", "/api/collections/notes/records", { token: boris, json: { owner: uid(boris), kind: "highlight", book: B.id, format: "epub", group: g.id, quote: "утром зажгли ёлку", color: "yellow", place: "Глава первая · 1%", anchor: { v: 1, cfi: "epubcfi(/6/2!/4/2)", pct: 1 } } });
  ok(gn.status === 200, "Борис отправил цитату в группу", gn.text);
  const cm = await req("POST", "/api/collections/note_comments/records", { token: anna, json: { note: gn.data.id, user: annaId, group: g.id, text: "Хорошо" } });
  ok(cm.status === 200, "Анна прокомментировала", cm.text);
  await setVis(admin, B.id, true);
  ok((await viewBook(boris, B.id)).data.hidden === true, "участник группы видит карточку скрытой книги");
  ok((await req("GET", `/api/collections/groups/records/${g.id}`, { token: anna })).status === 200, "группа видна");
  ok((await listIds(anna, "notes", `group = '${g.id}'`)).length === 1, "лента группы видна");
  ok((await listIds(anna, "note_comments", `note = '${gn.data.id}'`)).length === 1, "комментарии видны");
  rf = await readFile(boris, B.id, "epub");
  ok(rf.link.status === 403, "«Читать в группе»: ссылку на файл сервер не выдаёт", rf.link.text);
  const st = await req("GET", `/api/knigi/groups/${g.id}/state`, { token: anna });
  ok(st.status === 200, "состояние группы (кто сегодня читал) отдаётся", st.text);
  const nb = await req("POST", `/api/knigi/groups/${g.id}/book`, { token: boris, json: { book: A.id } });
  ok(nb.status === 200, "следующей книгой группы можно выбрать открытую", nb.text);
  await setVis(admin, A.id, true);
  const nb2 = await req("POST", `/api/knigi/groups/${g.id}/book`, { token: boris, json: { book: B.id } });
  ok(nb2.status === 400, "скрытую книгу следующей выбрать нельзя", nb2.text);
  ok((await viewBook(boris, B.id)).data.hidden === true, "прочитанная скрытая книга группы видна участнику карточкой");
  // новый участник после скрытия тоже видит карточку прочитанной книги
  const vera0 = await register(admin, { email: "gleb@example.com", password: "proverka-gleb-12345", name: "Глеб" });
  const g2 = (await req("GET", `/api/collections/groups/records/${g.id}`, { token: boris })).data;
  await req("POST", `/api/knigi/join/${g2.invite_code}`, { token: vera0, json: {} });
  ok((await viewBook(vera0, B.id)).status === 200, "новый участник группы видит карточку скрытой книги группы");
  await setVis(admin, A.id, false);
  await setVis(admin, B.id, false);

  section("А6. Книги от читателей");
  const offer = await upload(anna, "Анна - Предложенная книга.epub", makeEpub("Предложенная книга"), "offer");
  ok(offer && offer.id, "Анна предложила книгу", offer);
  const pend = (await req("GET", `/api/collections/books/records?${flt("pending = true")}`, { token: admin })).data.items[0];
  await waitReady(admin, pend.id);
  const ap = await req("POST", `/api/knigi/offers/${offer.id}/approve`, { token: admin, json: { shelves: [] } });
  ok(ap.status === 200, "администратор одобрил", ap.text);
  const ob = await viewBook(boris, pend.id);
  ok(ob.status === 200 && ob.data.hidden === false, "одобренная книга сразу видна всем читателям", ob.text);
  ok(ob.data && ob.data.opened_at, "у одобренной книги есть дата «открыта всем»");
  // повтор скрытой книги
  const hidBuf = makePdf("Dup");
  const upC = await upload(admin, "Тестов - Дубль.pdf", hidBuf);
  await waitReady(admin, upC.id);
  const dup = await upload(boris, "Дубль.pdf", hidBuf, "offer");
  ok(dup && dup.duplicate && dup.message === "Эта книга уже есть в библиотеке." && !dup.duplicate.id, "предложить скрытую книгу: «Эта книга уже есть в библиотеке» без ссылки", dup);
  return { A, B, group: g, sh, hl };
}


/* ---------- Часть Б: срок доступа ---------- */
const khToday = () => new Date(Date.now() + 10 * 3600e3).toISOString().slice(0, 10);
function addMonths(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const access = (t) => req("GET", "/api/knigi/access", { token: t });
const act = (admin, user, action, extra) => req("POST", "/api/knigi/admin/access", { token: admin, json: { user, action, ...(extra || {}) } });

async function partB(T) {
  const { admin, boris } = T;
  section("Б1. Приглашение со сроком 1 месяц");
  const bad = await invite(admin, "7d");
  ok(bad.r.status === 400, "срок не из списка (7 дней) не принимается", bad.r.text);
  const { code } = await invite(admin, "1m");
  const reg = await req("POST", "/api/collections/users/records", { json: { ...VERA, passwordConfirm: VERA.password, invite: code, access_until: "2099-01-01", suspended: false } });
  ok(reg.status === 200, "Вера зарегистрировалась по приглашению на 1 месяц", reg.text);
  let vera = await login(VERA);
  const veraId = uid(vera);
  let a = await access(vera);
  const t = khToday();
  ok(a.status === 200 && a.data.until === addMonths(t, 1) && a.data.active, `доступ до ${addMonths(t, 1)} (сегодня + 1 месяц, присланная дата не принята)`, a.data);
  ok(a.data.contact === "owner@example.com", "в ответе почта для связи из CONTACT_EMAIL", a.data);
  const self = await req("PATCH", `/api/collections/users/records/${veraId}`, { token: vera, json: { access_until: "2099-01-01" } });
  ok(self.status >= 400, "сама себе срок Вера не меняет", self.text);
  const self2 = await req("PATCH", `/api/collections/users/records/${veraId}`, { token: vera, json: { suspended: true } });
  ok(self2.status >= 400, "и паузу тоже");

  section("Б2. Продление +3 месяца считается от даты окончания");
  const until1 = a.data.until;
  let r = await act(admin, veraId, "extend", { months: 3, note: "оплатила 1500 ₽" });
  ok(r.status === 200, "администратор продлил на 3 месяца", r.text);
  a = await access(vera);
  ok(a.data.until === addMonths(until1, 3), `новая дата ${addMonths(until1, 3)} (от ${until1}, а не от сегодня)`, a.data);
  r = await act(admin, veraId, "extend", { months: 6 });
  ok(r.status === 200 && (await access(vera)).data.until === addMonths(addMonths(until1, 3), 6), "+6 месяцев тоже от даты окончания");
  ok((await act(admin, veraId, "extend", { months: 30 })).status === 400, "продлить больше чем на 24 месяца нельзя");

  section("Б3. До окончания срока Вера пользуется библиотекой");
  const books = (await req("GET", "/api/collections/books/records?perPage=50&" + flt("hidden = false"), { token: vera })).data.items;
  const pdfBook = books.find((b) => (b.formats || []).indexOf("pdf") >= 0);
  ok(!!pdfBook, "Вера видит открытые книги");
  let rf = await readFile(vera, pdfBook.id);
  ok(rf.link.status === 200 && rf.file === 206, "Вера открывает книгу", rf.link.text);
  const oldLink = rf.link;
  const hl = await req("POST", "/api/collections/notes/records", { token: vera, json: { owner: veraId, kind: "highlight", book: pdfBook.id, format: "pdf", page: 1, quote: "quick brown fox", color: "yellow", anchor: { v: 1, rects: [[0.1, 0.1, 0.2, 0.02]], s: 0, e: 5 } } });
  ok(hl.status === 200, "Вера сохранила цитату", hl.text);
  const sh = await req("POST", "/api/collections/shelves/records", { token: vera, json: { name: "Полка Веры", owner: veraId, common: false, sort: 1 } });
  ok(sh.status === 200, "Вера создала свою полку", sh.text);
  const gr = await req("POST", "/api/knigi/groups", { token: vera, json: { name: "Группа Веры", book: pdfBook.id } });
  ok(gr.status === 200, "Вера создала группу", gr.text);
  const g = (await req("GET", `/api/collections/groups/records/${gr.data.id}`, { token: vera })).data;
  await req("POST", `/api/knigi/join/${g.invite_code}`, { token: boris, json: {} });
  const bv = await req("GET", `/api/collections/users/records/${veraId}`, { token: boris });
  ok(bv.status === 200 && bv.data.access_until === undefined && bv.data.suspended === undefined, "участник группы не видит срок и паузу Веры", bv.data);
  const bn = await req("GET", `/api/collections/users/records?${flt(`access_until != ''`)}`, { token: boris });
  ok(bn.status === 400, "фильтр по сроку доступа другого человека не принимается", bn.text);

  section("Б4. Срок закончился: читать и менять нельзя, смотреть можно");
  r = await act(admin, veraId, "set", { date: addDays(t, -1) });
  ok(r.status === 200, "администратор поставил вчерашнюю дату");
  a = await access(vera);
  ok(!a.data.active && a.data.reason === "expired", "доступа нет: срок закончился", a.data);
  rf = await readFile(vera, pdfBook.id);
  ok(rf.link.status === 403 && /Срок доступа закончился/.test(rf.link.data.message) && /owner@example\.com/.test(rf.link.data.message), "ссылку на книгу сервер не выдаёт, в ответе почта для связи", rf.link.text);
  const ck = (oldLink.headers.get("set-cookie") || "").split(";")[0];
  const old = await fetch(BASE + oldLink.data.url, { headers: { Cookie: ck, Range: "bytes=0-1023" } });
  ok(old.status === 403, "выданная раньше ссылка тоже перестала работать", old.status);
  ok((await progress(vera, pdfBook.id, { format: "pdf", page: 2, pages: 5 })).status === 403, "прогресс не пишется");
  let w = await req("POST", "/api/collections/notes/records", { token: vera, json: { owner: veraId, kind: "note", book: pdfBook.id, title: "Новая", body: "<p>x</p>" } });
  ok(w.status === 403 && /напишите: owner@example\.com/.test(w.data.message), "заметку не создать (ответ по-русски с почтой)", w.text);
  ok((await req("PATCH", `/api/collections/notes/records/${hl.data.id}`, { token: vera, json: { body: "<p>мысль</p>" } })).status === 403, "цитату не изменить");
  ok((await req("DELETE", `/api/collections/notes/records/${hl.data.id}`, { token: vera })).status === 403, "цитату не удалить");
  const mine = await req("GET", `/api/collections/notes/records?${flt(`owner = '${veraId}'`)}`, { token: vera });
  ok(mine.status === 200 && mine.data.items.length === 1 && mine.data.items[0].quote === "quick brown fox", "свою цитату Вера видит");
  ok((await req("GET", `/api/collections/books/records/${pdfBook.id}`, { token: vera })).status === 200, "карточку книги видит");
  ok((await req("GET", `/api/collections/shelves/records/${sh.data.id}`, { token: vera })).status === 200, "свою полку видит");
  ok((await req("POST", "/api/collections/shelves/records", { token: vera, json: { name: "Ещё", owner: veraId, common: false, sort: 2 } })).status === 403, "новую полку не создать");
  ok((await req("POST", "/api/collections/shelf_books/records", { token: vera, json: { shelf: sh.data.id, book: pdfBook.id, sort: 1 } })).status === 403, "книгу на полку не поставить");
  ok((await req("POST", "/api/collections/marks/records", { token: vera, json: { user: veraId, book: pdfBook.id, status: "reading" } })).status === 403, "«Читаю» не поставить");
  ok((await req("POST", "/api/knigi/upload/start", { token: vera, json: { name: "x.pdf", size: 1000, kind: "offer" } })).status === 403, "книгу не предложить");
  ok((await req("POST", "/api/collections/note_comments/records", { token: vera, json: { note: hl.data.id, user: veraId, group: g.id, text: "x" } })).status === 403, "комментарий не написать");
  ok((await req("POST", "/api/knigi/groups", { token: vera, json: { name: "Вторая", book: pdfBook.id } })).status === 403, "группу не создать");
  ok((await req("POST", `/api/knigi/groups/${g.id}/link`, { token: vera, json: {} })).status === 403, "новую ссылку группы не сделать");
  ok((await req("GET", `/api/collections/groups/records/${g.id}`, { token: vera })).status === 200, "свою группу видит");
  ok((await req("PATCH", `/api/collections/users/records/${veraId}`, { token: vera, json: { name: "Вера Новая" } })).status === 403, "имя не поменять");
  const th = await req("PATCH", `/api/collections/users/records/${veraId}`, { token: vera, json: { theme: "dark" } });
  ok(th.status === 200 && th.data.theme === "dark", "тему поменять можно", th.text);
  const pw = await req("PATCH", `/api/collections/users/records/${veraId}`, { token: vera, json: { oldPassword: VERA.password, password: VERA.password + "x", passwordConfirm: VERA.password + "x" } });
  ok(pw.status === 200, "пароль поменять можно", pw.text);
  VERA.password += "x";
  vera = await login(VERA);
  const own = await req("POST", `/api/knigi/groups/${g.id}/owner`, { token: vera, json: { user: uid(boris) } });
  ok(own.status === 200, "роль создателя группы передать можно", own.text);
  const lv = await req("POST", `/api/knigi/groups/${g.id}/leave`, { token: vera, json: {} });
  ok(lv.status === 200, "выйти из группы можно", lv.text);
  ok((await req("GET", "/api/knigi/admin/users", { token: vera })).status === 403, "раздел «Пользователи» Вере закрыт");
  ok((await req("GET", "/api/collections/access_log/records", { token: vera })).status >= 400, "историю продлений через API не прочитать");
  ok((await act(vera, veraId, "extend", { months: 1 })).status === 403, "продлить себе доступ нельзя");

  section("Б5. Приостановить и возобновить; администратор не ограничен");
  r = await act(admin, veraId, "unlimited");
  a = await access(vera);
  ok(a.data.active && a.data.until === "", "«Бессрочно»: доступ снова есть", a.data);
  rf = await readFile(vera, pdfBook.id);
  ok(rf.link.status === 200 && rf.file === 206, "книга снова открывается");
  r = await act(admin, veraId, "suspend");
  a = await access(vera);
  ok(!a.data.active && a.data.reason === "suspended", "«Приостановить»: доступ закрыт", a.data);
  rf = await readFile(vera, pdfBook.id);
  ok(rf.link.status === 403 && /Доступ приостановлен/.test(rf.link.data.message), "книга не открывается: «Доступ приостановлен»", rf.link.text);
  r = await act(admin, veraId, "resume");
  a = await access(vera);
  ok(a.data.active, "«Возобновить»: доступ снова есть", a.data);
  ok((await req("POST", "/api/collections/notes/records", { token: vera, json: { owner: veraId, kind: "note", title: "После возобновления", body: "<p>x</p>" } })).status === 200, "заметка снова создаётся");
  ok((await act(admin, uid(admin), "suspend")).status === 400, "администратора приостановить нельзя");
  const am = await access(admin);
  ok(am.data.active && am.data.admin, "у администратора доступ всегда есть");
  rf = await readFile(admin, pdfBook.id);
  ok(rf.link.status === 200, "администратор открывает книги");
  r = await act(admin, veraId, "note", { note: "проверка заметки" });
  const list = await req("GET", "/api/knigi/admin/users", { token: admin });
  const vr = list.data.find((x) => x.id === veraId);
  ok(vr && vr.log.length >= 7 && vr.log.some((l) => l.action === "extend:3" && l.note === "оплатила 1500 ₽" && l.by === "Григорий"), "история: продление с заметкой и кто сделал", vr && vr.log);
  ok(vr && vr.log[0].action === "note" && vr.log[0].note === "проверка заметки", "заметка о человеке в истории");
  ok(list.data.every((x) => x.role !== "admin" || x.access_until === ""), "администратор в списке бессрочный");
  const ai = (await req("GET", "/api/knigi/admin/users", { token: admin })).data;
  ok(ai.filter((x) => x.role !== "admin" && x.id !== veraId).every((x) => x.access_until === "" && !x.suspended && x.active), "остальные читатели бессрочные");

  section("Б6. «Без подписи на страницах» у отдельного читателя (правки 4.2)");
  const markOf = async (t) => (await req("GET", `/api/knigi/books/${pdfBook.id}/link?f=pdf`, { token: t })).data;
  let m = await markOf(vera);
  ok(m && m.mark === "Вера · " + VERA.email, "по умолчанию у Веры подпись есть", m);
  ok(vr.no_mark === false, "в списке «Пользователи» no_mark = false");
  r = await act(admin, veraId, "mark_off");
  ok(r.status === 200, "администратор выключил подпись у Веры", r.text);
  m = await markOf(vera);
  ok(m && m.mark === "", "у Веры подпись пустая (ни строки внизу, ни надписи по центру)", m);
  const bm = await markOf(boris);
  ok(bm && bm.mark.indexOf("Борис") === 0, "у Бориса подпись осталась", bm);
  const self3 = await req("PATCH", `/api/collections/users/records/${veraId}`, { token: vera, json: { no_mark: false } });
  ok(self3.status >= 400, "сама Вера поле поменять не может", self3.text);
  const me3 = await req("GET", `/api/collections/users/records/${veraId}`, { token: vera });
  ok(me3.status === 200 && me3.data.no_mark === undefined, "и не видит его в своей записи", me3.data);
  ok((await req("GET", `/api/collections/users/records?${flt("no_mark = true")}`, { token: vera })).status === 400, "фильтр по полю не принимается");
  ok((await act(vera, veraId, "mark_on")).status === 403, "включить подпись себе обратно через маршрут администратора нельзя");
  ok((await act(admin, uid(admin), "mark_off")).status === 400, "у администратора переключателя нет");
  let ul = (await req("GET", "/api/knigi/admin/users", { token: admin })).data.find((x) => x.id === veraId);
  ok(ul.no_mark === true && ul.log[0].action === "mark_off" && ul.log[0].by === "Григорий", "в «Пользователях» пометка и запись в истории «Подпись выключена» с автором", ul.log[0]);
  r = await act(admin, veraId, "mark_on");
  m = await markOf(vera);
  ok(m && m.mark === "Вера · " + VERA.email, "администратор включил подпись: она снова есть", m);
  ul = (await req("GET", "/api/knigi/admin/users", { token: admin })).data.find((x) => x.id === veraId);
  ok(ul.no_mark === false && ul.log[0].action === "mark_on", "в истории «Подпись включена»");
}

/* ---------- Запуск ---------- */
async function main() {
  const s = await req("GET", "/api/knigi/setup");
  if (s.status !== 200) { console.log("PocketBase не отвечает на " + BASE); process.exit(2); }
  if (s.data.firstRun) await req("POST", "/api/collections/users/records", { json: { ...ADMIN, passwordConfirm: ADMIN.password } });
  const admin = await login(ADMIN);
  const anna = await register(admin, ANNA);
  const boris = await register(admin, BORIS);
  const T = { admin, anna, boris };
  const only = process.argv[2] || "";
  if (!only || only === "a") await partA(T);
  if ((!only || only === "b") && typeof partB === "function") await partB(T);
  console.log(`\nПроверок: ${oks + fails}, прошло ${oks}, ошибок ${fails}.`);
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.log("Сбой проверки:", e); process.exit(1); });
