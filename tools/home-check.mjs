#!/usr/bin/env node
// Проверка правок 4.7 (вид главной: свёрнутые блоки и закрытое «Продолжить слушание») на локальном PocketBase.
// Без внешних пакетов, Node 18+. Обычно запускается из tools/home-check.sh, который сам поднимает чистый PocketBase.
// Настройки: KN_BASE (адрес сервера), KN_SU (почта:пароль суперпользователя: им создаётся «старая» читательница
// без согласия с условиями).
//
// Пользователи: администратор, Анна, Борис (регистрация по приглашению), Вера («старая» читательница без согласия).
// Книга X (PDF, видна всем) нужна для общей группы Анны и Бориса: участник группы видит запись другого участника.
import { setTimeout as sleep } from "node:timers/promises";
import { createHash, randomBytes } from "node:crypto";

const BASE = (process.env.KN_BASE || "http://127.0.0.1:8093").replace(/\/+$/, "");
const [SU_EMAIL, SU_PASS] = (process.env.KN_SU || "su@example.com:proverka-su-12345").split(":");
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

/* ---------- Вид главной ---------- */
const BAD = /настройки главной не поддерживаются/;
const DEF = { collapsed: [], listen_hidden: false };
const same = (a, b) => JSON.stringify({ collapsed: a && a.collapsed, listen_hidden: a && a.listen_hidden }) === JSON.stringify({ collapsed: b.collapsed, listen_hidden: b.listen_hidden });
const hget = (t) => req("GET", "/api/knigi/home-ui", { token: t });
const hset = (t, json) => req("POST", "/api/knigi/home-ui", { token: t, json });
const access = (admin, user, body) => req("POST", "/api/knigi/admin/access", { token: admin, json: { user, ...body } });
const adminUser = async (admin, id) => ((await req("GET", "/api/knigi/admin/users", { token: admin })).data || []).find((x) => x.id === id);
// поля, которых новый маршрут не касается
const guardFields = (u) => JSON.stringify([u.role, u.access_until, u.suspended, u.no_mark, u.terms_version, u.terms_at, u.name, u.email]);

async function main() {
  section("Подготовка: администратор, Анна, Борис, Вера без согласия; книга X и общая группа Анны и Бориса");
  let r = await req("POST", "/api/collections/users/auth-with-password", { json: { identity: ADMIN.email, password: ADMIN.password } });
  let admin = r.status === 200 ? r.data.token : null;
  if (!admin) {
    r = await req("POST", "/api/collections/users/records", { json: { ...ADMIN, passwordConfirm: ADMIN.password } });
    if (r.status !== 200) throw new Error("администратор: " + r.text);
    admin = await login(ADMIN);
  }
  const anna = await register(admin, ANNA), boris = await register(admin, BORIS, "1m");
  const su = (await req("POST", "/api/collections/_superusers/auth-with-password", { json: { identity: SU_EMAIL, password: SU_PASS } })).data.token;
  r = await req("POST", "/api/collections/users/records", { token: su, json: { ...VERA, passwordConfirm: VERA.password, role: "user", terms_version: 0 } });
  ok(r.status === 200, "суперпользователь создал Веру без согласия (как после новой редакции условий)", r.text);
  const vera = await login(VERA);
  const ANNA_ID = uid(anna), BORIS_ID = uid(boris), VERA_ID = uid(vera), ADMIN_ID = uid(admin);
  const up = await upload(admin, "Иван Проверкин - Книга Икс.pdf", makePdf("Book X"));
  if (!up || !up.id) throw new Error("загрузка книги: " + JSON.stringify(up));
  await waitReady(admin, up.id);
  await req("POST", `/api/knigi/books/${up.id}/visibility`, { token: admin, json: { hidden: false } });
  const X = up.id;
  r = await req("POST", "/api/knigi/groups", { token: anna, json: { name: "Группа Анны", book: X } });
  ok(r.status === 200 && r.data.id, "Анна создала группу", r.text);
  const G = (await req("GET", `/api/collections/groups/records/${r.data.id}`, { token: anna })).data;
  r = await req("POST", `/api/knigi/join/${G.invite_code}`, { token: boris, json: {} });
  ok(r.status === 200, "Борис вступил в группу", r.text);

  section("1. Читатель сохраняет и получает свои свёрнутые блоки и «слушание скрыто»");
  r = await hget(anna);
  ok(r.status === 200 && same(r.data, DEF), "сначала пусто: всё развёрнуто, слушание показано", r.text);
  r = await hset(anna, { collapsed: ["reviews", "reading"], listen_hidden: true });
  ok(r.status === 200 && same(r.data, { collapsed: ["reading", "reviews"], listen_hidden: true }), "сохранила два блока и «слушание скрыто»: 200, блоки в порядке главной", r.text);
  r = await hget(anna);
  ok(same(r.data, { collapsed: ["reading", "reviews"], listen_hidden: true }), "получила то же", r.text);
  ok((r.headers.get("cache-control") || "").includes("no-store"), "ответ не кэшируется");
  r = await req("POST", "/api/collections/users/auth-refresh", { token: anna });
  ok(r.status === 200 && same(r.data.record.home_ui, { collapsed: ["reading", "reviews"], listen_hidden: true }), "после входа на другом устройстве настройки приходят вместе с записью пользователя", JSON.stringify(r.data && r.data.record));
  r = await hset(anna, { collapsed: ["reading", "shelves", "mine", "reviews"] });
  ok(r.status === 200 && r.data.collapsed.length === 4 && r.data.listen_hidden === true, "все четыре блока; «слушание скрыто» без ключа осталось прежним", r.text);
  r = await hset(anna, { listen_hidden: false });
  ok(r.status === 200 && r.data.collapsed.length === 4 && r.data.listen_hidden === false, "блок слушания вернулся; свёрнутые без ключа остались прежними", r.text);
  r = await hset(anna, { collapsed: [], listen_hidden: false });
  ok(r.status === 200 && same(r.data, DEF), "всё развернула", r.text);
  r = await hset(admin, { collapsed: ["shelves"], listen_hidden: true });
  ok(r.status === 200 && same(r.data, { collapsed: ["shelves"], listen_hidden: true }), "администратор сохраняет свои", r.text);
  ok(same((await hget(anna)).data, DEF), "у Анны от этого ничего не изменилось");
  ok((await hget()).status === 401 && (await hset(undefined, { collapsed: [] })).status === 401, "без входа: 401");

  section("2. Неизвестные ключи, неверные значения и слишком большой набор отклоняются");
  await hset(anna, { collapsed: ["mine"], listen_hidden: true });
  const KEEP = { collapsed: ["mine"], listen_hidden: true };
  const bad = [
    [{ collapsed: ["mine"], extra: 1 }, "лишний ключ рядом с верными"],
    [{ theme: "dark" }, "чужой ключ"],
    [{}, "пустой набор"],
    [[], "массив вместо набора"],
    [{ collapsed: ["recent"] }, "неизвестный блок («Недавно добавленные» не сворачивается)"],
    [{ collapsed: ["listen"] }, "блок слушания в свёрнутых (он только закрывается)"],
    [{ collapsed: ["mine", "mine"] }, "блок дважды"],
    [{ collapsed: "mine" }, "строка вместо списка"],
    [{ collapsed: [1, 2] }, "числа вместо названий"],
    [{ collapsed: [["mine"]] }, "список в списке"],
    [{ collapsed: ["reading", "shelves", "mine", "reviews", "reading"] }, "пять блоков"],
    [{ collapsed: null }, "null вместо списка"],
    [{ listen_hidden: "yes" }, "строка вместо да/нет"],
    [{ listen_hidden: 1 }, "число вместо да/нет"],
    [{ listen_hidden: null }, "null вместо да/нет"],
    [{ collapsed: ["mine"], listen_hidden: true, note: "ж".repeat(600) }, "большой набор с лишним ключом"],
  ];
  for (const [body, what] of bad) {
    r = await hset(anna, body);
    // массив вместо набора отклоняет ещё сам PocketBase, у него своё сообщение
    ok(r.status === 400 && (Array.isArray(body) || BAD.test((r.data && r.data.message) || "")), `${what}: 400`, r.status + " " + r.text);
  }
  r = await req("POST", "/api/knigi/home-ui", { token: anna, headers: { "Content-Type": "application/json" }, raw: '{"collapsed":["mine"],' + " ".repeat(600) + '"listen_hidden":false}' });
  ok(r.status === 400, "верные ключи, но тело больше 500 байт: 400", r.status + " " + r.text);
  r = await req("POST", "/api/knigi/home-ui", { token: anna, headers: { "Content-Type": "application/json" }, raw: '{"collapsed":[' + Array(200).fill('"mine"').join(",") + "]}" });
  ok(r.status === 400, "список из 200 блоков: 400", r.status + " " + r.text);
  r = await req("POST", "/api/knigi/home-ui", { token: anna, form: { collapsed: "mine" } });
  ok(r.status === 400, "форма вместо JSON: 400", r.status + " " + r.text);
  ok(same((await hget(anna)).data, KEEP), "после всех отказов настройки Анны прежние", (await hget(anna)).text);

  section("3. Чужой пользователь: поменять и увидеть нельзя");
  r = await hset(boris, { user: ANNA_ID, collapsed: [] });
  ok(r.status === 400, "Борис с ключом user = Анна: 400", r.text);
  r = await hset(boris, { id: ANNA_ID, listen_hidden: false });
  ok(r.status === 400, "Борис с ключом id = Анна: 400", r.text);
  r = await req("POST", `/api/knigi/home-ui?user=${ANNA_ID}`, { token: boris, json: { collapsed: ["shelves"] } });
  ok(r.status === 200 && same((await hget(boris)).data, { collapsed: ["shelves"], listen_hidden: false }), "с ?user=Анна в адресе меняются только настройки самого Бориса", r.text);
  ok(same((await hget(anna)).data, KEEP), "настройки Анны на месте");
  r = await req("PATCH", `/api/collections/users/records/${ANNA_ID}`, { token: boris, json: { home_ui: { collapsed: [] } } });
  ok(r.status === 404 || r.status === 403, "Борис обычным запросом запись Анны не меняет", r.status);
  r = await req("PATCH", `/api/collections/users/records/${ANNA_ID}`, { token: anna, json: { home_ui: { collapsed: ["reading"], junk: "x" } } });
  ok(r.status === 404 || r.status === 403 || r.status === 400, "и сама Анна обычным запросом поле не меняет (только маршрутом с проверкой)", r.status);
  r = await req("PATCH", `/api/collections/users/records/${ANNA_ID}`, { token: anna, json: { name: "Анна", home_ui: { listen_hidden: false } } });
  ok(r.status >= 400, "вместе с именем тоже нет", r.status);
  ok(same((await hget(anna)).data, KEEP), "настройки Анны прежние");
  r = await req("GET", `/api/collections/users/records/${ANNA_ID}`, { token: boris });
  ok(r.status === 200 && r.data.name === "Анна" && r.data.home_ui === undefined, "Борис (общая группа) видит имя Анны, настроек вида не видит", r.text);
  r = await req("GET", "/api/collections/users/records?perPage=50", { token: boris });
  ok(r.status === 200 && r.data.items.some((x) => x.id === ANNA_ID) && r.data.items.every((x) => x.id === BORIS_ID || x.home_ui === undefined), "списком тоже: настройки только свои", r.text.slice(0, 300));
  r = await req("GET", `/api/collections/users/records?${flt("home_ui ~ 'mine'")}`, { token: boris });
  ok(r.status === 400, "фильтр по настройкам вида отклонён", r.status);
  r = await req("GET", `/api/collections/users/records/${ANNA_ID}`, { token: anna });
  ok(r.status === 200 && same(r.data.home_ui, KEEP), "сама Анна в своей записи их видит");
  r = await req("GET", "/api/knigi/admin/users", { token: admin });
  ok(r.status === 200 && !r.text.includes("home_ui") && !r.text.includes("listen_hidden"), "в «Пользователях» у администратора чужих настроек вида нет");

  section("4. Поля доступа, условий и «без подписи» этим маршрутом не меняются");
  const before = guardFields(await adminUser(admin, ANNA_ID));
  for (const body of [{ access_until: "2099-01-01" }, { suspended: false }, { no_mark: true }, { terms_version: 99 }, { terms_at: "2020-01-01 00:00:00.000Z" }, { role: "admin" },
    { collapsed: [], access_until: "" }, { listen_hidden: false, no_mark: true }, { collapsed: ["mine"], role: "admin", terms_version: 99 }]) {
    r = await hset(anna, body);
    ok(r.status === 400, `${JSON.stringify(body)}: 400`, r.text);
  }
  ok(guardFields(await adminUser(admin, ANNA_ID)) === before, "у Анны срок, пауза, условия, «без подписи», роль прежние", before);
  ok(same((await hget(anna)).data, KEEP), "и настройки вида прежние");
  // у Бориса срок до даты и «без подписи»: удачное сохранение вида их не трогает
  await access(admin, BORIS_ID, { action: "mark_off" });
  const bBefore = await adminUser(admin, BORIS_ID);
  ok(!!bBefore.access_until && bBefore.no_mark === true, "у Бориса срок доступа до даты и «без подписи»", JSON.stringify(bBefore).slice(0, 300));
  r = await hset(boris, { collapsed: ["reading", "mine"], listen_hidden: true });
  ok(r.status === 200, "Борис сохранил вид главной", r.text);
  ok(guardFields(await adminUser(admin, BORIS_ID)) === guardFields(bBefore), "срок, пауза, условия, «без подписи» у него те же");
  r = await req("GET", "/api/knigi/access", { token: boris });
  ok(r.status === 200 && r.data.active === true && r.data.until === bBefore.access_until, "доступ как был", r.text);
  r = await hset(admin, { collapsed: ["shelves"], listen_hidden: true, role: "user" });
  ok(r.status === 400 && (await req("GET", "/api/knigi/access", { token: admin })).data.admin === true, "администратор лишний ключ тоже не пришлёт, роль на месте", r.text);

  section("5. Без доступа (срок, пауза, условия) настройки вида сохраняются");
  await access(admin, BORIS_ID, { action: "set", date: "2020-01-01" });
  r = await req("POST", "/api/collections/shelves/records", { token: boris, json: { name: "Нельзя", owner: BORIS_ID } });
  ok(r.status === 403 && /Срок доступа закончился/.test(r.data.message), "срок закончился: полку Борис создать не может (403)", r.text);
  r = await hset(boris, { collapsed: ["reviews"], listen_hidden: false });
  ok(r.status === 200 && same(r.data, { collapsed: ["reviews"], listen_hidden: false }), "а вид главной сохраняет: 200", r.text);
  ok(same((await hget(boris)).data, { collapsed: ["reviews"], listen_hidden: false }), "и получает");
  r = await hset(boris, { collapsed: ["nope"] });
  ok(r.status === 400, "проверка ключей для него та же (400)", r.text);
  ok((await adminUser(admin, BORIS_ID)).access_until === "2020-01-01", "срок от сохранения не изменился");
  await access(admin, BORIS_ID, { action: "unlimited" });
  await access(admin, BORIS_ID, { action: "suspend" });
  r = await req("GET", "/api/knigi/access", { token: boris });
  ok(r.data.active === false && r.data.reason === "suspended", "пауза стоит", r.text);
  r = await hset(boris, { collapsed: ["reading", "shelves", "mine", "reviews"], listen_hidden: true });
  ok(r.status === 200 && r.data.collapsed.length === 4 && r.data.listen_hidden === true, "на паузе вид главной сохраняется: 200", r.text);
  ok((await adminUser(admin, BORIS_ID)).suspended === true, "пауза от сохранения не снялась");
  await access(admin, BORIS_ID, { action: "resume" });
  r = await req("GET", "/api/knigi/access", { token: vera });
  ok(r.data.active === false && r.data.reason === "terms", "Вера условия не приняла", r.text);
  r = await req("POST", "/api/collections/shelves/records", { token: vera, json: { name: "Нельзя", owner: VERA_ID } });
  ok(r.status === 403, "полку она создать не может (403)", r.text);
  r = await hset(vera, { collapsed: ["shelves"], listen_hidden: true });
  ok(r.status === 200 && same(r.data, { collapsed: ["shelves"], listen_hidden: true }), "а вид главной сохраняет: 200", r.text);
  ok(same((await hget(vera)).data, { collapsed: ["shelves"], listen_hidden: true }), "и получает");
  r = await req("GET", "/api/knigi/access", { token: vera });
  ok(r.data.reason === "terms" && r.data.terms.accepted === 0, "условия от этого принятыми не стали", r.text);

  section("6. ИИ-помощник настроек вида не получает");
  await hset(admin, { collapsed: ["reading", "shelves", "mine", "reviews"], listen_hidden: true });
  const at = await mcpToken();
  ok(!!at, "ИИ-помощник подключён (как Claude)");
  const tl = await mcp(at, "tools/list", {});
  const tools = (tl.data && tl.data.result && tl.data.result.tools) || [];
  ok(tools.length === 12 && !/home|главн|listen_hidden|collapsed/i.test(JSON.stringify(tools)), "инструментов по-прежнему 12, про главную среди них ничего нет: " + tools.map((t) => t.name).join(", "));
  const LEAK = /home_ui|listen_hidden|collapsed/;
  const ini = await mcp(at, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "check", version: "1" } });
  ok(ini.status === 200 && !LEAK.test(ini.text), "initialize: настроек нет");
  for (const [tool, args] of [["search_books", {}], ["search_books", { query: "home_ui" }], ["list_shelves", {}], ["get_book", { book_id: X }], ["list_notes", {}], ["list_groups", {}],
    ["search", { query: "listen_hidden" }], ["search_in_books", { query: "collapsed" }], ["fetch", { id: "user:" + ADMIN_ID }], ["fetch", { id: ADMIN_ID }], ["get_note", { id: ADMIN_ID }]]) {
    const cr = await mcp(at, "tools/call", { name: tool, arguments: args });
    // слово запроса помощник может повторить в ответе («не нашлось»): ищем само содержимое настроек
    const t = mcpText(cr);
    ok(cr.status === 200 && !/"?(reading|shelves|mine|reviews)"?\s*,\s*"?(shelves|mine|reviews)/.test(t) && !/listen_hidden\W+true/.test(t) && !t.includes("home_ui\\\""), `${tool}(${JSON.stringify(args)}): настроек вида нет`, t.slice(0, 300));
  }
  ok(same((await hget(admin)).data, { collapsed: ["reading", "shelves", "mine", "reviews"], listen_hidden: true }), "а у самого администратора они на месте");
  r = await req("POST", "/api/knigi/home-ui", { json: { collapsed: [] }, token: "Bearer " + at });
  ok(r.status === 401, "токен ИИ-помощника маршрут настроек не открывает (401)", r.status);
  r = await req("GET", "/api/knigi/home-ui", { token: "Bearer " + at });
  ok(r.status === 401, "и прочитать их не даёт (401)", r.status);

  console.log(`\nПроверок: ${oks + fails}, прошло ${oks}, ошибок ${fails}.`);
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.log("Сбой проверки:", e); process.exit(1); });
