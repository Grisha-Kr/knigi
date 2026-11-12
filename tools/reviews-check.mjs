#!/usr/bin/env node
// Проверка правок 4.6 (отзывы о книгах) на локальном PocketBase. Без внешних пакетов, Node 18+.
// Обычно запускается из tools/reviews-check.sh, который сам поднимает чистый PocketBase.
// Настройки: KN_BASE (адрес сервера), KN_SU (почта:пароль суперпользователя: им создаётся «старая» читательница
// без согласия и удаляется аккаунт).
//
// Пользователи: администратор, Анна, Борис, Дина (регистрация по приглашению), Вера («старая» читательница без
// согласия с условиями). Книги: X (PDF, видна всем), Y (EPUB, видна всем, потом объединяется с X),
// H (PDF, скрыта, открыта лично Анне), Z (PDF, видна всем, потом удаляется), AB (только аудио),
// P (предложил Борис: сначала на проверке, потом одобрена).
import { setTimeout as sleep } from "node:timers/promises";
import { createHash, randomBytes } from "node:crypto";

const BASE = (process.env.KN_BASE || "http://127.0.0.1:8093").replace(/\/+$/, "");
const [SU_EMAIL, SU_PASS] = (process.env.KN_SU || "su@example.com:proverka-su-12345").split(":");
const ADMIN = { email: "admin@example.com", password: "proverka-admin-12345", name: "Григорий" };
const ANNA = { email: "anna@example.com", password: "proverka-anna-12345", name: "Анна" };
const BORIS = { email: "boris@example.com", password: "proverka-boris-12345", name: "Борис" };
const DINA = { email: "dina@example.com", password: "proverka-dina-12345", name: "Дина" };
const VERA = { email: "vera@example.com", password: "proverka-vera-12345", name: "Вера" };
const TERMS = "Нужно принять условия пользования библиотекой.";
const SECRET = "отзывнаяфраза" + randomBytes(3).toString("hex"); // слово из отзыва: ИИ-помощник не должен его найти
// маленький настоящий JPEG 8×6 (фото профиля Бориса)
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAGAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCzRRRXwR9sf//Z", "base64");

let fails = 0, oks = 0;
const ok = (cond, what, extra) => {
  if (cond) { oks++; console.log("  ОК      " + what); }
  else { fails++; console.log("  ОШИБКА  " + what + (extra !== undefined ? "\n          " + String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 600) : "")); }
  return cond;
};
const section = (t) => console.log("\n" + t);

async function req(method, path, { json, form, headers = {}, token, raw } = {}) {
  const h = { ...headers };
  let body;
  if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (form) { h["Content-Type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(form).toString(); }
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

/* ---------- ИИ-помощник: короткий путь OAuth как у Claude (см. mcp-check.mjs) ---------- */
const b64u = (b) => Buffer.from(b).toString("base64url");
async function mcpToken() {
  const redirect = "https://claude.ai/api/mcp/auth_callback";
  const reg = await req("POST", "/oauth/register", { json: { client_name: "Claude", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] } });
  const v = b64u(randomBytes(40)), ch = b64u(createHash("sha256").update(v).digest());
  const q = { response_type: "code", client_id: reg.data.client_id, redirect_uri: redirect, state: "s1", code_challenge: ch, code_challenge_method: "S256", scope: "library offline_access", resource: BASE + "/mcp" };
  const lg = await req("POST", "/oauth/login", { json: { email: ADMIN.email, password: ADMIN.password } });
  const dec = await req("POST", "/oauth/authorize", { token: lg.data.token, json: { ...q, allow: true } });
  const code = new URL(dec.data.redirect).searchParams.get("code");
  const tok = await req("POST", "/oauth/token", { form: { grant_type: "authorization_code", code, redirect_uri: redirect, code_verifier: v, client_id: reg.data.client_id, resource: BASE + "/mcp" } });
  return tok.data.access_token;
}
let rpcId = 0;
const mcp = (token, method, params) => req("POST", "/mcp", { json: { jsonrpc: "2.0", id: ++rpcId, method, params }, headers: { Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" }, token: "Bearer " + token });
const mcpText = (r) => JSON.stringify((r.data && (r.data.result || r.data.error)) || r.text);


/* ---------- Отзывы ---------- */
const setVis = (admin, id, hidden) => req("POST", `/api/knigi/books/${id}/visibility`, { token: admin, json: { hidden } });
const setReaders = (admin, id, users) => req("POST", `/api/knigi/books/${id}/readers`, { token: admin, json: { users } });
const write = (t, book, text) => req("POST", "/api/knigi/reviews", { token: t, json: { book, text } });
const edit = (t, id, text) => req("POST", `/api/knigi/reviews/${id}`, { token: t, json: { text } });
const del = (t, id) => req("DELETE", `/api/knigi/reviews/${id}`, { token: t });
const view = (t, id) => req("GET", `/api/collections/reviews/records/${id}`, { token: t });
const list = async (t, filter) => ((await req("GET", `/api/collections/reviews/records?perPage=500&sort=-created${filter ? "&" + flt(filter) : ""}`, { token: t })).data || { items: [] }).items;
const ids = (arr) => arr.map((x) => x.id);
const access = (admin, user, body) => req("POST", "/api/knigi/admin/access", { token: admin, json: { user, ...body } });
async function pdfBook(admin, name, label, open = true) {
  const up = await upload(admin, name, makePdf(label));
  if (!up || !up.id) throw new Error("загрузка " + name + ": " + JSON.stringify(up));
  await waitReady(admin, up.id);
  if (open) await setVis(admin, up.id, false);
  return up.id;
}

async function main() {
  section("Подготовка: администратор, Анна, Борис, Дина, Вера без согласия; книги X, Y, H, Z");
  let r = await req("POST", "/api/collections/users/auth-with-password", { json: { identity: ADMIN.email, password: ADMIN.password } });
  let admin = r.status === 200 ? r.data.token : null;
  if (!admin) {
    r = await req("POST", "/api/collections/users/records", { json: { ...ADMIN, passwordConfirm: ADMIN.password } });
    if (r.status !== 200) throw new Error("администратор: " + r.text);
    admin = await login(ADMIN);
  }
  const anna = await register(admin, ANNA), boris = await register(admin, BORIS), dina = await register(admin, DINA);
  const su = (await req("POST", "/api/collections/_superusers/auth-with-password", { json: { identity: SU_EMAIL, password: SU_PASS } })).data.token;
  r = await req("POST", "/api/collections/users/records", { token: su, json: { ...VERA, passwordConfirm: VERA.password, role: "user", terms_version: 0 } });
  ok(r.status === 200, "суперпользователь создал Веру без согласия (как после новой редакции условий)", r.text);
  const vera = await login(VERA);
  const ANNA_ID = uid(anna), BORIS_ID = uid(boris), DINA_ID = uid(dina), ADMIN_ID = uid(admin);
  const X = await pdfBook(admin, "Иван Проверкин - Книга Икс.pdf", "Book X");
  const Z = await pdfBook(admin, "Иван Проверкин - Книга Зет.pdf", "Book Z");
  const H = await pdfBook(admin, "Иван Проверкин - Скрытая книга.pdf", "Book H", false);
  await setReaders(admin, H, [ANNA_ID]);
  const yUp = await upload(admin, "Иван Проверкин - Книга Игрек.epub", makeEpub("Книга Игрек"));
  await waitReady(admin, yUp.id);
  await setVis(admin, yUp.id, false);
  const Y = yUp.id;
  ok(!!(X && Y && Z && H), "книги загружены: X и Z (PDF), Y (EPUB) видны всем, H скрыта и открыта Анне");

  section("1. Читатель пишет отзыв; второй к той же книге нельзя, свой меняется");
  r = await write(anna, X, "Хорошая книга.\nВторая строка. " + SECRET);
  ok(r.status === 200 && r.data.id && r.data.book === X && r.data.user === ANNA_ID, "Анна написала отзыв к X: 200", r.text);
  const aX = r.data;
  ok(aX.user_name === "Анна" && !r.text.includes("@") && aX.seen === undefined, "в ответе имя, почты нет, «просмотрен» читателю не отдаётся", r.text);
  ok(aX.text.includes("\nВторая строка") && !aX.edited, "перенос строки сохранился, «изменён» пусто");
  r = await write(anna, X, "Ещё один отзыв");
  ok(r.status === 400 && /уже написали/.test(r.data.message), "второй отзыв к той же книге: 400 «Вы уже написали отзыв…»", r.text);
  ok((await list(admin, `book = '${X}' && user = '${ANNA_ID}'`)).length === 1, "в базе один отзыв Анны к X");
  r = await edit(anna, aX.id, "Хорошая книга, перечитала.\n" + SECRET);
  ok(r.status === 200 && r.data.text.startsWith("Хорошая книга, перечитала") && !!r.data.edited, "правка своего отзыва: 200, дата правки стоит", r.text);
  r = await write(anna, X, "");
  ok(r.status === 400 && /Напишите текст/.test(r.data.message), "пустой: 400", r.text);
  r = await write(anna, Z, "   \n\n  ");
  ok(r.status === 400, "только пробелы и переносы: 400", r.text);
  r = await write(anna, Z, "ж".repeat(2001));
  ok(r.status === 400 && /2000 знаков/.test(r.data.message), "2001 знак: 400 «Отзыв длиннее 2000 знаков»", r.text);
  r = await write(anna, Z, "ё".repeat(2000));
  ok(r.status === 200, "ровно 2000 знаков (русских): 200", r.text);
  const aZ = r.data;
  r = await edit(anna, aZ.id, "ё".repeat(2001));
  ok(r.status === 400, "правка длиннее 2000 знаков: 400", r.text);
  r = await edit(anna, aZ.id, " ");
  ok(r.status === 400, "правка на пустой: 400", r.text);
  r = await write(anna, "nosuchbook12345", "текст");
  ok(r.status === 404, "к несуществующей книге: 404", r.text);
  r = await req("POST", "/api/knigi/reviews", { json: { book: X, text: "без входа" } });
  ok(r.status === 401, "без входа: 401", r.text);

  section("2. Через обычный API отзывы не пишутся");
  r = await req("POST", "/api/collections/reviews/records", { token: anna, json: { book: Y, user: ANNA_ID, text: "мимо маршрута" } });
  ok(r.status === 403 || r.status === 400, "создать нельзя", r.status);
  r = await req("PATCH", `/api/collections/reviews/records/${aX.id}`, { token: anna, json: { text: "поменяла" } });
  ok(r.status === 403 || r.status === 404, "изменить нельзя", r.status);
  r = await req("PATCH", `/api/collections/reviews/records/${aX.id}`, { token: admin, json: { text: "поменял" } });
  ok(r.status === 403 || r.status === 404, "и администратору нельзя", r.status);
  r = await req("DELETE", `/api/collections/reviews/records/${aX.id}`, { token: anna });
  ok(r.status === 403 || r.status === 404, "удалить нельзя", r.status);

  section("3. Чужой отзыв: читатель не меняет и не удаляет, администратор удаляет любой");
  r = await write(boris, X, "Борис: интересно.");
  ok(r.status === 200, "Борис написал отзыв к X");
  const bX = r.data;
  ok((await edit(boris, aX.id, "влезу")).status === 403, "Борис не меняет отзыв Анны (403)");
  ok((await del(boris, aX.id)).status === 403, "Борис не удаляет отзыв Анны (403)");
  ok((await view(boris, aX.id)).data.text.startsWith("Хорошая книга, перечитала"), "отзыв Анны на месте");
  ok((await edit(admin, aX.id, "правка администратора")).status === 403, "администратор чужой отзыв не меняет (403)");
  r = await del(admin, bX.id);
  ok(r.status === 200, "администратор удалил отзыв Бориса", r.text);
  ok((await view(boris, bX.id)).status === 404, "у Бориса его больше нет");
  r = await write(boris, X, "Борис: интересно, второй раз.");
  ok(r.status === 200, "после удаления Борис пишет к X заново");
  const bX2 = r.data;
  r = await del(boris, bX2.id);
  ok(r.status === 200 && (await view(boris, bX2.id)).status === 404, "свой отзыв Борис удаляет сам");
  r = await write(boris, X, "Борис: интересно, третий раз.");
  const bX3 = r.data;
  r = await write(admin, X, "Отзыв администратора о книге Икс.");
  ok(r.status === 200 && r.data.seen === true, "администратор написал свой отзыв (сразу просмотренный)", r.text);
  const admX = r.data;

  section("4. Видимость: скрытая книга, открытая лично, книга на проверке");
  r = await write(anna, H, "Анна о скрытой книге H.");
  ok(r.status === 200, "Анна (H открыта ей лично) пишет отзыв к H", r.text);
  const aH = r.data;
  ok(ids(await list(anna)).includes(aH.id), "Анна видит его списком");
  ok(!ids(await list(boris)).includes(aH.id), "Борис его списком не видит");
  ok((await view(boris, aH.id)).status === 404, "Борис по адресу: 404");
  ok((await list(boris, `book = '${H}'`)).length === 0, "Борис фильтром по книге: пусто");
  ok((await list(vera)).every((x) => x.book !== H), "Вера тоже не видит");
  r = await write(boris, H, "Борис о скрытой");
  ok(r.status === 404 || r.status === 403, "Борис к H не пишет", r.text);
  ok(ids(await list(admin)).includes(aH.id), "администратор видит все отзывы");
  // «Новые отзывы» на главной считаются из этого же списка: Борису отзыв к H не попадёт
  ok(!(await list(boris)).slice(0, 3).some((x) => x.book === H), "в «Новых отзывах» у Бориса отзыва к H нет");
  await setReaders(admin, H, []);
  ok(ids(await list(anna)).includes(aH.id) && (await view(anna, aH.id)).status === 200, "Анну убрали из списка H: свой отзыв она видит («Мои отзывы»)");
  r = await req("GET", `/api/collections/books/records/${H}`, { token: anna });
  ok(r.status === 200 && r.data.hidden === true, "карточка H у неё осталась (временно недоступна): отзыв держит её в kept_for", r.text);
  r = await edit(anna, aH.id, "правка скрытой");
  ok(r.status === 404, "изменить его она не может (404)", r.text);
  ok((await del(anna, aH.id)).status === 404, "и удалить тоже (404)");
  await setReaders(admin, H, [ANNA_ID]);
  ok(ids(await list(anna)).includes(aH.id), "вернули Анне: снова виден");
  await setVis(admin, X, true);
  r = await list(boris, `book = '${X}'`);
  ok(r.length === 1 && r[0].id === bX3.id, "X скрыли: у Бориса из отзывов X только свой", r.map((x) => x.user_name));
  ok((await view(boris, aX.id)).status === 404 && (await view(boris, admX.id)).status === 404, "чужие по адресу 404");
  ok((await req("GET", `/api/collections/books/records/${X}`, { token: boris })).status === 200, "карточка X у Бориса осталась (временно недоступна)");
  ok((await edit(boris, bX3.id, "правка к скрытой")).status === 404, "свой отзыв к скрытой не меняет (404)");
  ok((await write(boris, X, "к скрытой")).status >= 400, "к скрытой X Борис не пишет");
  ok((await list(admin, `book = '${X}'`)).length === 3, "у администратора отзывы X на месте (3)");
  await setVis(admin, X, false);
  ok((await list(boris, `book = '${X}'`)).length === 3, "X открыли: Борис снова видит все 3 отзыва");
  const of = await upload(boris, "Борис - Своя книга.pdf", makePdf("Boris own"), "offer");
  ok(of && of.id, "Борис предложил книгу", of);
  const P = (await req("GET", `/api/collections/books/records?${flt("pending = true")}`, { token: admin })).data.items[0].id;
  await waitReady(admin, P);
  r = await write(admin, P, "Отзыв к книге на проверке");
  ok(r.status === 400 && /на проверке/.test(r.data.message), "к книге на проверке не пишет даже администратор (400)", r.text);
  ok((await write(boris, P, "своя на проверке")).status === 404, "читатель к книге на проверке: 404");
  ok((await req("POST", `/api/knigi/offers/${of.id}/approve`, { token: admin, json: { shelves: [] } })).status === 200, "книгу Бориса одобрили");
  r = await req("POST", "/api/knigi/audio-books", { token: admin, json: { title: "Аудиокнига без текста", authors: "Иван Чтецов" } });
  const AB = r.data.id;
  await setVis(admin, AB, false);
  r = await write(anna, AB, "Хорошо читает.");
  ok(r.status === 200, "к книге только из аудио отзыв пишется", r.text);

  section("5. Без доступа отзывы видны, но не пишутся, не меняются и не удаляются");
  await access(admin, BORIS_ID, { action: "set", date: "2020-01-01" });
  ok((await list(boris, `book = '${X}'`)).length === 3, "срок закончился: Борис видит отзывы");
  r = await write(boris, Y, "без доступа");
  ok(r.status === 403 && /Срок доступа закончился/.test(r.data.message), "не пишет (403 «Срок доступа закончился…»)", r.text);
  ok((await edit(boris, bX3.id, "без доступа")).status === 403, "свой не меняет (403)");
  ok((await del(boris, bX3.id)).status === 403, "свой не удаляет (403)");
  const rf = await readFile(boris, P);
  ok(rf.link.status === 200, "свою одобренную книгу без доступа читает (правки 4.3)…", rf.link.text);
  r = await write(boris, P, "своя книга");
  ok(r.status === 403, "…но отзыв к ней не пишет: исключение «своя книга» на отзывы не распространяется", r.text);
  await access(admin, BORIS_ID, { action: "unlimited" });
  await access(admin, BORIS_ID, { action: "suspend" });
  ok((await list(boris, `book = '${X}'`)).length === 3, "пауза: видит");
  r = await write(boris, Y, "на паузе");
  ok(r.status === 403 && /приостановлен/.test(r.data.message), "не пишет (403 «Доступ приостановлен…»)", r.text);
  ok((await edit(boris, bX3.id, "на паузе")).status === 403 && (await del(boris, bX3.id)).status === 403, "свой не меняет и не удаляет");
  await access(admin, BORIS_ID, { action: "resume" });
  ok((await edit(boris, bX3.id, "Борис: интересно, после паузы.")).status === 200, "доступ вернули: правка работает");
  ok((await list(vera, `book = '${X}'`)).length === 3, "Вера без принятых условий видит отзывы");
  r = await write(vera, X, "без условий");
  ok(r.status === 403 && r.data.message === TERMS, "не пишет (403 «Нужно принять условия…»)", r.text);
  ok((await req("POST", "/api/knigi/terms/accept", { token: vera, json: { version: (await req("GET", "/api/knigi/terms")).data.version } })).status === 200, "Вера приняла условия");
  r = await write(vera, X, "Вера: отзыв после принятия условий.");
  ok(r.status === 200, "теперь пишет", r.text);
  const vX = r.data;

  section("6. Имя, фото и «прочитал(а)»");
  ok((await req("POST", "/api/collections/marks/records", { token: anna, json: { user: ANNA_ID, book: X, status: "finished", finished_at: "2026-01-10 12:00:00.000Z" } })).status === 200, "Анна отметила X «Прочитано»");
  await sleep(100);
  ok((await view(boris, aX.id)).data.finished === true, "у её отзыва к X пометка «прочитал(а)», Борис её видит");
  ok((await view(boris, bX3.id)).data.finished === false, "у Бориса пометки нет");
  const mk = (await req("GET", `/api/collections/marks/records?${flt(`book = '${X}'`)}`, { token: anna })).data.items[0];
  await req("DELETE", `/api/collections/marks/records/${mk.id}`, { token: anna });
  await sleep(100);
  ok((await view(anna, aX.id)).data.finished === false, "сняла отметку: пометка ушла");
  await req("POST", "/api/collections/marks/records", { token: anna, json: { user: ANNA_ID, book: X, status: "finished", finished_at: "2026-01-10 12:00:00.000Z" } });
  ok((await req("PATCH", `/api/collections/users/records/${ANNA_ID}`, { token: anna, json: { name: "Анна Петрова" } })).status === 200, "Анна сменила имя");
  await sleep(100);
  ok((await view(boris, aX.id)).data.user_name === "Анна Петрова", "в её отзывах новое имя");
  ok((await req("GET", `/api/knigi/users/${BORIS_ID}/avatar`, { token: dina })).status === 404, "фото Бориса до его отзыва Дине не отдаётся (404)…");
  const fd = new FormData();
  fd.append("avatar", new Blob([JPEG], { type: "image/jpeg" }), "face.jpg");
  r = await fetch(`${BASE}/api/collections/users/records/${BORIS_ID}`, { method: "PATCH", headers: { Authorization: boris }, body: fd });
  ok(r.status === 200, "Борис поставил фото");
  await sleep(100);
  const bAv = (await view(dina, bX3.id)).data.user_avatar;
  ok(!!bAv, "в отзыве Бориса имя файла фото есть");
  ok((await req("GET", `/api/knigi/users/${BORIS_ID}/avatar`, { token: dina })).status === 200, "…а теперь Дина видит его фото рядом с отзывом к X (200)");
  ok((await req("GET", `/api/knigi/users/${ANNA_ID}/avatar`, { token: dina })).status === 404, "фото Анны (его нет) по-прежнему 404");
  await setVis(admin, X, true);
  ok((await req("GET", `/api/knigi/users/${BORIS_ID}/avatar`, { token: dina })).status === 404, "X скрыли: фото Бориса Дине снова 404");
  await setVis(admin, X, false);
  const all = JSON.stringify(await list(dina));
  ok(!/@example\.com/.test(all), "в отзывах, которые видит читатель, нет ни одной почты");

  section("7. Точка администратору: новые и изменённые отзывы");
  let al = await list(admin);
  const unseen = al.filter((x) => !x.seen);
  ok(unseen.length > 0 && unseen.every((x) => x.user !== ADMIN_ID), "у администратора есть непросмотренные (точка), свой отзыв не среди них", unseen.length);
  ok((await list(anna)).every((x) => x.seen === undefined), "читателю поле «просмотрен» не отдаётся");
  ok((await req("POST", "/api/knigi/admin/reviews/seen", { token: anna })).status === 403, "читатель не отмечает просмотренными (403)");
  r = await req("POST", "/api/knigi/admin/reviews/seen", { token: admin });
  ok(r.status === 200 && r.data.count === unseen.length, "администратор открыл «Отзывы»: отмечено " + unseen.length, r.text);
  ok((await list(admin)).every((x) => x.seen), "непросмотренных нет: точка снята");
  await edit(vera, vX.id, "Вера: отзыв после принятия условий, дополнила.");
  r = await write(dina, X, "Дина о книге X.");
  const dX = r.data;
  al = await list(admin);
  ok(al.filter((x) => !x.seen).map((x) => x.id).sort().join() === [vX.id, dX.id].sort().join(), "новый отзыв Дины и изменённый отзыв Веры снова непросмотренные");
  await edit(vera, vX.id, "Вера: отзыв после принятия условий, дополнила.");
  await req("POST", "/api/knigi/admin/reviews/seen", { token: admin });
  ok((await list(admin)).every((x) => x.seen), "снова открыл: точки нет");

  section("8. Объединение книг переносит отзывы, у одного человека остаётся более новый");
  // Y: Анна пишет позже, чем к X (её отзыв к Y новее); Борис пишет к Y раньше, чем меняет отзыв к X (новее остаётся X)
  r = await write(boris, Y, "Борис о Y, старый.");
  const bY = r.data;
  await sleep(1100);
  await edit(boris, bX3.id, "Борис о X, новый.");
  await sleep(1100);
  r = await write(anna, Y, "Анна о Y, новый.");
  const aY = r.data;
  r = await write(vera, Y, "Вера только о Y.");
  const vY = r.data;
  const mi = await req("GET", `/api/knigi/books/${X}/merge/${Y}`, { token: admin });
  ok(mi.status === 200 && mi.data.reviews === 3, "перед объединением: у второй книги 3 отзыва", mi.text);
  r = await req("POST", `/api/knigi/books/${X}/merge/${Y}`, { token: admin });
  ok(r.status === 200, "X и Y объединены (останется X)", r.text);
  const xl = await list(admin, `book = '${X}'`);
  const byUser = (u) => xl.filter((x) => x.user === u);
  ok(byUser(ANNA_ID).length === 1 && byUser(ANNA_ID)[0].id === aY.id && byUser(ANNA_ID)[0].text === "Анна о Y, новый.", "у Анны один отзыв, более новый (о Y)", byUser(ANNA_ID));
  ok(byUser(BORIS_ID).length === 1 && byUser(BORIS_ID)[0].id === bX3.id && byUser(BORIS_ID)[0].text === "Борис о X, новый.", "у Бориса один, более новый (о X)", byUser(BORIS_ID));
  ok(byUser(uid(vera)).length === 1 && byUser(uid(vera))[0].id === vY.id, "у Веры один, более новый (о Y)", byUser(uid(vera)));
  ok(byUser(DINA_ID).length === 1 && byUser(ADMIN_ID).length === 1, "отзывы Дины и администратора на месте");
  ok(xl.length === 5, "всего у X 5 отзывов, каждый человек по одному", xl.length);
  ok(byUser(ANNA_ID)[0].finished === true, "у отзыва Анны, пришедшего от Y, пометка «прочитал(а)» по отметке к X");
  ok((await list(admin, `book = '${Y}'`)).length === 0, "у Y отзывов не осталось (книги нет)");
  ok((await view(admin, aX.id)).status === 404 && (await view(admin, vX.id)).status === 404 && (await view(admin, bY.id)).status === 404, "старые отзывы удалены");

  section("9. Удаление книги и пользователя удаляет отзывы");
  ok((await list(admin, `book = '${Z}'`)).length === 1, "у Z есть отзыв Анны");
  r = await req("DELETE", `/api/knigi/books/${Z}?notes=keep`, { token: admin });
  ok(r.status === 200, "книга Z удалена", r.text);
  ok((await view(admin, aZ.id)).status === 404 && (await list(admin, `book = '${Z}'`)).length === 0, "её отзыв удалён");
  ok((await list(admin, `user = '${DINA_ID}'`)).length === 1, "у Дины есть отзыв");
  r = await req("DELETE", `/api/collections/users/records/${DINA_ID}`, { token: su });
  ok(r.status === 204 || r.status === 200, "аккаунт Дины удалён (в панели)", r.text);
  ok((await view(admin, dX.id)).status === 404 && (await list(admin, `user = '${DINA_ID}'`)).length === 0, "её отзыв удалён");

  section("10. ИИ-помощник отзывов не получает");
  const at = await mcpToken();
  ok(!!at, "токен помощника получен");
  const tl = await mcp(at, "tools/list", {});
  const names = ((tl.data && tl.data.result && tl.data.result.tools) || []).map((t) => t.name);
  ok(names.length > 0 && !names.some((nm) => /review|отзыв/i.test(nm)), "среди инструментов нет отзывов: " + names.join(", "));
  // секретное слово в двух отзывах Анны
  await edit(anna, aH.id, "Анна о скрытой книге H. " + SECRET + " Перечитаю летом.");
  await edit(anna, aY.id, "Анна о Y, новый. " + SECRET + " Перечитаю летом.");
  const PHR = /Анна о скрытой|Анна о Y|Борис о X|Отзыв администратора о книге|Вера только о Y|Хорошо читает/;
  for (const [tool, args] of [["search", { query: SECRET }], ["search", { query: "Икс" }], ["search_books", { query: SECRET }], ["search_books", { query: "Икс" }], ["get_book", { book_id: X }], ["get_book", { book_id: AB }],
    ["list_notes", { query: SECRET }], ["list_notes", {}], ["search_in_books", { query: SECRET }], ["search_in_books", { query: "Перечитаю летом" }]]) {
    const cr = await mcp(at, "tools/call", { name: tool, arguments: args });
    const t = mcpText(cr);
    // слово запроса помощник может повторить в ответе («не нашлось»), поэтому ищем остальной текст отзывов
    ok(cr.status === 200 && !PHR.test(t), `${tool}(${JSON.stringify(args)}): текста отзывов нет`, t.slice(0, 300));
  }
  for (const id of [`review:${aH.id}`, `note:${aH.id}`, aH.id, `book:${X}`]) {
    const cr = await mcp(at, "tools/call", { name: "fetch", arguments: { id } });
    ok(!mcpText(cr).includes(SECRET) && !PHR.test(mcpText(cr)), `fetch(${id}): отзывов не отдаёт`, mcpText(cr).slice(0, 300));
  }
  const gn = await mcp(at, "tools/call", { name: "get_note", arguments: { id: aH.id } });
  ok(!mcpText(gn).includes(SECRET), "get_note с номером отзыва: ничего", mcpText(gn).slice(0, 200));

  console.log(`\nПроверок: ${oks + fails}, прошло ${oks}, ошибок ${fails}.`);
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.log("Сбой проверки:", e); process.exit(1); });
