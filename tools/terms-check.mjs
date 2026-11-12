#!/usr/bin/env node
// Проверка правок 4.4 на локальном PocketBase: условия пользования (часть А) и надписи о продлении (часть Б).
// Без внешних пакетов, Node 18+. Обычно запускается из tools/terms-check.sh, который сам поднимает чистый PocketBase.
// Настройки: KN_BASE (адрес сервера), KN_SU (почта:пароль суперпользователя, им создаются «старые» читатели
// без согласия, как после миграции, и удаляется аккаунт: удаляют только в панели).
//
// Пользователи: администратор, Анна (новая регистрация), Борис и Вера («старые» читатели без согласия), Дина (удаление).
import { setTimeout as sleep } from "node:timers/promises";

const BASE = (process.env.KN_BASE || "http://127.0.0.1:8093").replace(/\/+$/, "");
const [SU_EMAIL, SU_PASS] = (process.env.KN_SU || "su@example.com:proverka-su-12345").split(":");
const ADMIN = { email: "admin@example.com", password: "proverka-admin-12345", name: "Григорий" };
const ANNA = { email: "anna@example.com", password: "proverka-anna-12345", name: "Анна" };
const BORIS = { email: "boris@example.com", password: "proverka-boris-12345", name: "Борис" };
const VERA = { email: "vera@example.com", password: "proverka-vera-12345", name: "Вера" };
const DINA = { email: "dina@example.com", password: "proverka-dina-12345", name: "Дина" };
const TERMS = "Нужно принять условия пользования библиотекой.";
const RENEW = "Чтобы продлить доступ или сделать пожертвование, напишите на owner@example.com и укажите имя и почту, с которыми вы зарегистрированы в библиотеке.";
let fails = 0, oks = 0;
const ok = (cond, what, extra) => {
  if (cond) { oks++; console.log("  ОК      " + what); }
  else { fails++; console.log("  ОШИБКА  " + what + (extra !== undefined ? "\n          " + String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 600) : "")); }
  return cond;
};
const section = (t) => console.log("\n" + t);
const cookieOf = (r) => (r.headers.get("set-cookie") || "").split(";")[0];
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
  const r = await req("POST", "/api/collections/users/records", { json: { ...u, passwordConfirm: u.password, invite: code, terms: (await req("GET", "/api/knigi/terms")).data.version } });
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
function makeMp3(seconds, kbps = 128) {
  const idx = { 64: 5, 128: 9 }[kbps];
  const len = Math.floor(144 * kbps * 1000 / 44100);
  const n = Math.ceil(seconds * 44100 / 1152);
  const frame = Buffer.alloc(len);
  frame[0] = 0xff; frame[1] = 0xfb; frame[2] = idx << 4; frame[3] = 0xc0;
  const id3 = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]); // пустой заголовок ID3v2
  return Buffer.concat([id3, ...Array(n).fill(frame)]);
}
// M4A: коробки ftyp, moov (mvhd, дорожка со звуком mp4a), mdat. Для проверки сервера, не для прослушивания.
async function uploadAudio(token, buf, { name, book, track, title }) {
  let r = await req("POST", "/api/knigi/upload/start", { token, json: { name, size: buf.length, kind: "audio", book, track, title } });
  if (r.status !== 200) return { error: r };
  const up = r.data.upload;
  for (let i = 0; i < r.data.chunks; i++) {
    const fd = new FormData();
    fd.append("chunk", new Blob([buf.subarray(i * r.data.chunk, (i + 1) * r.data.chunk)]), "chunk");
    const c = await fetch(`${BASE}/api/knigi/upload/${up}/${i}`, { method: "POST", headers: { Authorization: token }, body: fd });
    if (c.status !== 200) return { error: { status: c.status, text: await c.text() } };
  }
  r = await req("POST", `/api/knigi/upload/${up}/finish`, { token, json: {} });
  return r.status === 200 ? r.data : { error: r };
}
async function audioFile(token, trackId, range, noCookie) {
  const l = await req("GET", `/api/knigi/audio/${trackId}/link`, { token });
  if (l.status !== 200) return { link: l };
  const h = {};
  if (!noCookie) h.Cookie = cookieOf(l);
  if (range) h.Range = range;
  const f = await fetch(BASE + l.data.url, { headers: h });
  const body = Buffer.from(await f.arrayBuffer());
  return { link: l, status: f.status, type: f.headers.get("content-type"), range: f.headers.get("content-range"), cache: f.headers.get("cache-control"), len: body.length, cookie: cookieOf(l) };
}

/* ---------- Вспомогательное ---------- */
const access = (t) => req("GET", "/api/knigi/access", { token: t });
const terms = (t) => req("GET", "/api/knigi/terms", { token: t });
const accept = (t, version) => req("POST", "/api/knigi/terms/accept", { token: t, json: { version } });
const saveTerms = (t, body) => req("POST", "/api/knigi/admin/terms", { token: t, json: body });
const adminUsers = async (admin) => (await req("GET", "/api/knigi/admin/users", { token: admin })).data;
const userRow = async (admin, id) => (await adminUsers(admin)).find((x) => x.id === id);
const note = (t, owner, book) => req("POST", "/api/collections/notes/records", { token: t, json: { owner, kind: "note", book, title: "Проверка", body: "<p>текст</p>" } });
const today = () => new Date().toISOString().slice(0, 10);
let SU = "";
// «Старый» читатель: создан до правок 4.4 (как после миграции: условия не приняты). Создаёт суперпользователь.
async function oldReader(u) {
  const r = await req("POST", "/api/collections/users/records", { token: SU, json: { ...u, passwordConfirm: u.password, role: "user", theme: "auto" } });
  if (r.status !== 200) throw new Error("старый читатель " + u.email + ": " + r.text);
  return login(u);
}

async function main() {
  const su = await req("POST", "/api/collections/_superusers/auth-with-password", { json: { identity: SU_EMAIL, password: SU_PASS } });
  if (su.status !== 200) throw new Error("суперпользователь: " + su.text);
  SU = su.data.token;
  const s = await req("POST", "/api/collections/users/auth-with-password", { json: { identity: ADMIN.email, password: ADMIN.password } });
  let admin = s.status === 200 ? s.data.token : null;
  if (!admin) {
    const r = await req("POST", "/api/collections/users/records", { json: { ...ADMIN, passwordConfirm: ADMIN.password } });
    ok(r.status === 200, "первый пользователь (администратор) регистрируется без условий", r.text);
    admin = await login(ADMIN);
  }

  section("А1. Первая редакция условий (миграция)");
  let t = await terms();
  ok(t.status === 200 && t.data.version === 1, "без входа видна действующая редакция 1", t.data);
  ok(/^Эта библиотека является частным собранием/.test(t.data.text) && t.data.text.split("\n").length === 10, "текст первой редакции: 10 строк (абзацы и пункты)", t.data.text);
  ok(t.data.text.split("\n").filter((l) => l.startsWith("- ")).length === 3, "три пункта списка с «- »");
  ok(/\[Политике конфиденциальности\]\(\/privacy\.html\)/.test(t.data.text), "ссылка на /privacy.html в тексте");
  ok(t.data.accepted === undefined, "без входа нет сведений о согласии");
  let a = await access(admin);
  ok(a.data.active && a.data.terms.ok && a.data.reason === "", "на администратора условия не действуют", a.data);
  t = await terms(admin);
  ok(t.data.total === 0 && t.data.accepted === 0, "у администратора число принявших: 0 из 0", t.data);

  // книга и глава аудио для проверок
  const pdf = await upload(admin, "Проверкин - Книга условий.pdf", makePdf("Terms book"));
  await waitReady(admin, pdf.id);
  await req("POST", `/api/knigi/books/${pdf.id}/visibility`, { token: admin, json: { hidden: false } });
  const BOOK = pdf.id;
  const au = await uploadAudio(admin, makeMp3(10, 64), { name: "Глава.mp3", book: BOOK, title: "Глава" });
  await req("POST", `/api/knigi/audio/${au.track}`, { token: admin, json: { published: true } });
  const TRACK = au.track;
  ok((await readFile(admin, BOOK)).link.status === 200, "администратор открывает книгу");

  section("А2. Регистрация по приглашению");
  let inv = await invite(admin);
  let r = await req("POST", "/api/collections/users/records", { json: { ...ANNA, passwordConfirm: ANNA.password, invite: inv.code } });
  ok(r.status === 400 && r.data.message === TERMS, "без согласия: 400 «Нужно принять условия пользования библиотекой»", r.text);
  ok((await req("POST", "/api/collections/users/auth-with-password", { json: { identity: ANNA.email, password: ANNA.password } })).status === 400, "аккаунт не создан");
  r = await req("POST", "/api/collections/users/records", { json: { ...ANNA, passwordConfirm: ANNA.password, invite: inv.code, terms: 2 } });
  ok(r.status === 400 && r.data.message === TERMS, "согласие с несуществующей редакцией 2 не принимается", r.text);
  r = await req("POST", "/api/collections/users/records", { json: { ...ANNA, passwordConfirm: ANNA.password, invite: inv.code, terms_version: 1, terms_at: "2020-01-01 00:00:00.000Z" } });
  ok(r.status === 400, "присланные поля terms_version и terms_at не заменяют согласие", r.text);
  r = await req("POST", "/api/collections/users/records", { json: { ...ANNA, passwordConfirm: ANNA.password, invite: inv.code, terms: 1, terms_version: 7, terms_at: "2020-01-01 00:00:00.000Z" } });
  ok(r.status === 200, "с согласием с редакцией 1 аккаунт создан", r.text);
  let anna = await login(ANNA);
  const annaId = uid(anna);
  a = await access(anna);
  ok(a.data.active && a.data.terms.ok && a.data.terms.accepted === 1, "у Анны принята редакция 1, доступ есть", a.data);
  ok(String(a.data.terms.accepted_at).slice(0, 10) === today(), "дата согласия сегодня (присланная не принята)", a.data.terms);
  let row = await userRow(admin, annaId);
  ok(row.terms_version === 1 && row.terms_ok && String(row.terms_at).slice(0, 10) === today(), "в «Пользователях»: редакция 1 и дата", row);
  ok(row.log.some((l) => l.action === "terms:1" && l.by === "Анна"), "в истории строка «Принял(а) условия, редакция 1»", row.log);
  ok((await readFile(anna, BOOK)).link.status === 200, "Анна открывает книгу");
  ok((await note(anna, annaId, BOOK)).status === 200, "Анна создаёт заметку");

  section("А3. Уже зарегистрированный читатель без согласия (Борис)");
  let boris = await oldReader(BORIS);
  const borisId = uid(boris);
  a = await access(boris);
  ok(!a.data.active && a.data.reason === "terms" && a.data.access_reason === "" && !a.data.terms.ok && a.data.terms.accepted === 0, "доступа нет, причина: условия не приняты", a.data);
  row = await userRow(admin, borisId);
  ok(row.active && row.reason === "" && !row.terms_ok, "в «Пользователях» срок в порядке, отдельно: условия не приняты", row);
  let rf = await readFile(boris, BOOK);
  ok(rf.link.status === 403 && rf.link.data.message === TERMS, "ссылку на книгу не получает: «Нужно принять условия…»", rf.link.text);
  ok(!/Срок доступа|продлить/.test(rf.link.data.message || ""), "в сообщении нет слов про срок и продление");
  let af = await audioFile(boris, TRACK);
  ok(af.link.status === 403 && af.link.data.message === TERMS, "ссылку на аудио не получает", af.link.text);
  r = await note(boris, borisId, BOOK);
  ok(r.status === 403 && r.data.message === TERMS, "заметку не создаёт", r.text);
  ok((await req("POST", "/api/collections/marks/records", { token: boris, json: { user: borisId, book: BOOK, status: "reading" } })).status === 403, "«Читаю» не ставит");
  ok((await req("POST", "/api/collections/shelves/records", { token: boris, json: { owner: borisId, name: "Моя", common: false } })).status === 403, "полку не создаёт");
  ok((await req("POST", `/api/knigi/books/${BOOK}/progress`, { token: boris, json: { format: "pdf", page: 2, pages: 5 } })).status === 403, "прогресс не пишется");
  ok((await req("POST", "/api/knigi/upload/start", { token: boris, json: { name: "x.pdf", size: 1000, kind: "offer" } })).status === 403, "книгу не предлагает");
  ok((await req("GET", `/api/collections/books/records/${BOOK}`, { token: boris })).status === 200, "карточку книги видит");
  ok((await req("PATCH", `/api/collections/users/records/${borisId}`, { token: boris, json: { name: "Боря" } })).status === 403, "имя не меняет");
  ok((await req("PATCH", `/api/collections/users/records/${borisId}`, { token: boris, json: { theme: "dark" } })).status === 200, "тему меняет");
  r = await req("PATCH", `/api/collections/users/records/${borisId}`, { token: boris, json: { terms_version: 1 } });
  ok(r.status >= 400, "сам себе согласие не ставит (terms_version)", r.text);
  r = await req("PATCH", `/api/collections/users/records/${borisId}`, { token: boris, json: { terms_at: "2026-01-01 00:00:00.000Z" } });
  ok(r.status >= 400, "и дату согласия тоже", r.text);
  ok((await access(boris)).data.reason === "terms", "после попыток условия по-прежнему не приняты");
  ok((await req("GET", "/api/collections/terms/records", { token: boris })).status === 403, "коллекцию terms напрямую не читает");
  ok((await req("POST", "/api/collections/terms/records", { token: boris, json: { version: 9, text: "x" } })).status === 403, "редакцию напрямую не создаёт");
  ok((await saveTerms(boris, { text: "Чужой текст", new: true })).status === 403, "текст условий не меняет");
  ok((await req("POST", "/api/knigi/logout", { token: boris })).status < 300, "выйти может");
  r = await accept(boris, 2);
  ok(r.status === 409, "согласие с другой редакцией: 409", r.text);
  r = await accept(boris, 1);
  ok(r.status === 200, "принял редакцию 1", r.text);
  a = await access(boris);
  ok(a.data.active && a.data.terms.accepted === 1, "доступ есть", a.data);
  ok((await readFile(boris, BOOK)).file === 206, "книга открывается");
  af = await audioFile(boris, TRACK, "bytes=0-99");
  ok(af.status === 206, "аудио отдаётся", af.link && af.link.text);
  ok((await note(boris, borisId, BOOK)).status === 200, "заметка создаётся");
  row = await userRow(admin, borisId);
  ok(row.terms_version === 1 && row.log.some((l) => l.action === "terms:1"), "в истории строка о согласии", row.log);
  ok((await accept(boris, 1)).status === 200 && (await userRow(admin, borisId)).log.filter((l) => l.action === "terms:1").length === 1, "повторное «Принять» второй строки не пишет");

  section("А4. Удаление аккаунта без согласия (Дина)");
  const dina = await oldReader(DINA);
  const dinaId = uid(dina);
  ok((await access(dina)).data.reason === "terms", "у Дины условия не приняты");
  ok((await req("DELETE", `/api/collections/users/records/${dinaId}`, { token: SU })).status === 204, "аккаунт удаляется (в панели, как раньше)");

  section("А5. Своя одобренная книга (Вера)");
  let vera = await oldReader(VERA);
  const veraId = uid(vera);
  ok((await accept(vera, 1)).status === 200, "Вера приняла условия");
  const of = await upload(vera, "Вера - Своя книга.pdf", makePdf("Veras own book"), "offer");
  ok(of && of.id, "Вера предложила книгу", of);
  const pend = (await req("GET", `/api/collections/books/records?${flt("pending = true")}`, { token: admin })).data.items[0];
  await waitReady(admin, pend.id);
  ok((await req("POST", `/api/knigi/offers/${of.id}/approve`, { token: admin, json: { shelves: [] } })).status === 200, "администратор одобрил");
  const OWN = pend.id;
  await req("POST", "/api/knigi/admin/access", { token: admin, json: { user: veraId, action: "set", date: "2020-01-01" } });
  a = await access(vera);
  ok(!a.data.active && a.data.reason === "expired", "у Веры срок закончился", a.data);
  ok((await readFile(vera, OWN)).file === 206, "срок закончился, условия приняты: своя книга читается (как в 4.3)");

  section("Б. Новый текст о продлении в сообщениях сервера");
  rf = await readFile(vera, BOOK);
  ok(rf.link.status === 403 && rf.link.data.message === "Срок доступа закончился: книги сейчас не открываются. " + RENEW, "ссылка на книгу: новый текст", rf.link.data);
  r = await note(vera, veraId, OWN);
  ok(r.status === 403 && r.data.message === "Срок доступа закончился: можно смотреть свои записи, а добавлять и менять нельзя. " + RENEW, "заметка: новый текст", r.data);
  ok(!/Чтобы продлить, напишите:/.test(rf.link.text + r.text), "старого «Чтобы продлить, напишите:» нет");
  ok((await access(vera)).data.contact === "owner@example.com", "почта для письма в ответе /api/knigi/access");
  await req("POST", "/api/knigi/admin/access", { token: admin, json: { user: veraId, action: "suspend" } });
  rf = await readFile(vera, BOOK);
  ok(rf.link.data.message === "Доступ приостановлен: книги сейчас не открываются. " + RENEW, "пауза: тот же конец надписи", rf.link.data);
  await req("POST", "/api/knigi/admin/access", { token: admin, json: { user: veraId, action: "set", date: "2020-01-01" } });

  section("А6. Исправление текста той же редакции");
  const fixed = t.data.text.replace("Короткие цитаты", "Короткие цитаты (до абзаца)");
  r = await saveTerms(admin, { text: fixed, new: false, version: 1 });
  ok(r.status === 200 && r.data.version === 1 && r.data.text === fixed && r.data.by === "Григорий", "текст исправлен, редакция та же", r.data);
  ok((await access(anna)).data.active && (await access(boris)).data.active, "Анну и Бориса заново не спрашивают");
  ok((await terms()).data.text === fixed, "все видят исправленный текст");
  ok((await saveTerms(admin, { text: "   ", new: false })).status === 400, "пустой текст не сохраняется");
  ok((await saveTerms(anna, { text: "x" })).status === 403, "читатель текст не сохраняет");
  t = await terms(admin);
  ok(t.data.accepted === 3 && t.data.total === 3, "приняли действующую редакцию: 3 из 3", t.data);

  section("А7. Новая редакция");
  r = await saveTerms(admin, { text: fixed + "\nНовый абзац второй редакции.", new: true, version: 1 });
  ok(r.status === 200 && r.data.version === 2, "сохранена редакция 2", r.data);
  ok(r.data.accepted === 0 && r.data.total === 3, "приняли: 0 из 3", r.data);
  for (const [n, tk] of [["Анна", anna], ["Борис", boris]]) {
    a = await access(tk);
    ok(!a.data.active && a.data.reason === "terms" && a.data.terms.accepted === 1 && a.data.terms.current === 2, `${n}: нужно принять заново`, a.data);
  }
  a = await access(admin);
  ok(a.data.active && a.data.terms.ok, "администратора не касается");
  ok((await readFile(admin, BOOK)).file === 206, "администратор открывает книгу");
  ok((await readFile(anna, BOOK)).link.status === 403, "у Анны книга не открывается");
  ok((await note(anna, annaId, BOOK)).status === 403, "заметку Анна не создаёт");
  rf = await readFile(vera, OWN);
  ok(rf.link.status === 403 && rf.link.data.message === TERMS, "своя книга Веры до согласия не открывается", rf.link.text);
  a = await access(vera);
  ok(a.data.reason === "terms" && a.data.access_reason === "expired", "у Веры две причины: условия первыми, срок отдельно", a.data);
  row = await userRow(admin, veraId);
  ok(!row.active && row.reason === "expired" && !row.terms_ok && row.terms_version === 1, "в «Пользователях» у Веры срок закончился и условия не приняты (прежняя редакция 1)", row);
  const list = await req("GET", "/api/collections/terms/records?sort=version", { token: SU });
  ok(list.data.items.length === 2 && list.data.items[0].version === 1 && list.data.items[0].text === fixed, "старая редакция 1 осталась в базе", list.data);
  ok((await saveTerms(admin, { text: "x", new: false, version: 1 })).status === 400, "исправить «редакцию 1», когда действует 2, нельзя");
  ok((await accept(anna, 1)).status === 409, "Анна не может принять старую редакцию 1");
  ok((await accept(anna, 2)).status === 200 && (await access(anna)).data.active, "Анна приняла редакцию 2, доступ есть");
  ok((await readFile(anna, BOOK)).file === 206, "книга у Анны снова открывается");
  row = await userRow(admin, annaId);
  ok(row.log.some((l) => l.action === "terms:2") && row.log.some((l) => l.action === "terms:1"), "в истории обе строки: редакция 1 и 2", row.log);
  ok((await terms(admin)).data.accepted === 1, "приняли: 1 из 3");
  ok((await accept(vera, 2)).status === 200, "Вера приняла редакцию 2");
  ok((await readFile(vera, OWN)).file === 206, "после согласия своя книга Веры снова читается (срок по-прежнему закончился)");

  console.log(`\nПроверок: ${oks + fails}, прошло ${oks}, ошибок ${fails}.`);
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.log("Сбой проверки:", e); process.exit(1); });
