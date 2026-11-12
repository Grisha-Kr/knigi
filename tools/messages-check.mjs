#!/usr/bin/env node
// Проверка правок 4.5 (сообщения администратору) на локальном PocketBase. Без внешних пакетов, Node 18+.
// Обычно запускается из tools/messages-check.sh, который сам поднимает чистый PocketBase.
// Настройки: KN_BASE (адрес сервера), KN_DATA (папка pb_data сервера: проверить, что снимки удаляются с диска),
// KN_SU (почта:пароль суперпользователя: им создаётся «старый» читатель без согласия и удаляется аккаунт).
//
// Пользователи: администратор, Анна и Борис (регистрация по приглашению), Вера («старая» читательница без
// согласия с условиями), Дина (ограничение в день и удаление аккаунта).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

const BASE = (process.env.KN_BASE || "http://127.0.0.1:8093").replace(/\/+$/, "");
const DATA = process.env.KN_DATA || "";
const [SU_EMAIL, SU_PASS] = (process.env.KN_SU || "su@example.com:proverka-su-12345").split(":");
const ADMIN = { email: "admin@example.com", password: "proverka-admin-12345", name: "Григорий" };
const ANNA = { email: "anna@example.com", password: "proverka-anna-12345", name: "Анна" };
const BORIS = { email: "boris@example.com", password: "proverka-boris-12345", name: "Борис" };
const VERA = { email: "vera@example.com", password: "proverka-vera-12345", name: "Вера" };
const DINA = { email: "dina@example.com", password: "proverka-dina-12345", name: "Дина" };
const TERMS = "Нужно принять условия пользования библиотекой.";
const DAY_MSG = "Сегодня отправлено слишком много сообщений. Попробуйте завтра.";
// маленький настоящий JPEG 8×6
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAGAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCzRRRXwR9sf//Z", "base64");
const SECRET = "секретнаяфраза" + randomBytes(3).toString("hex"); // слово из сообщения: ИИ-помощник не должен его найти

let fails = 0, oks = 0;
const ok = (cond, what, extra) => {
  if (cond) { oks++; console.log("  ОК      " + what); }
  else { fails++; console.log("  ОШИБКА  " + what + (extra !== undefined ? "\n          " + String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 600) : "")); }
  return cond;
};
const section = (t) => console.log("\n" + t);
const cookieOf = (r) => (r.headers.get("set-cookie") || "").split(";")[0];
async function req(method, path, { json, form, fd, headers = {}, token } = {}) {
  const h = { ...headers };
  let body;
  if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (form) { h["Content-Type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(form).toString(); }
  if (fd) body = fd;
  if (token) h.Authorization = token;
  const r = await fetch(BASE + path, { method, headers: h, body, redirect: "manual" });
  const buf = Buffer.from(await r.arrayBuffer());
  const text = buf.toString("utf8");
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  return { status: r.status, headers: r.headers, text, data, buf };
}
const uid = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url")).id;
const flt = (s) => "filter=" + encodeURIComponent(s);
async function login(u) {
  const r = await req("POST", "/api/collections/users/auth-with-password", { json: { identity: u.email, password: u.password } });
  if (r.status !== 200) throw new Error("Не получилось войти как " + u.email + ": " + r.text);
  return r.data.token;
}
async function register(admin, u) {
  const code = "KN" + Math.random().toString(36).slice(2, 10).toUpperCase();
  await req("POST", "/api/collections/invites/records", { token: admin, json: { code, note: "проверка", max_uses: 1, access_period: "" } });
  const v = (await req("GET", "/api/knigi/terms")).data.version;
  const r = await req("POST", "/api/collections/users/records", { json: { ...u, passwordConfirm: u.password, invite: code, terms: v } });
  if (r.status !== 200) throw new Error("регистрация " + u.email + ": " + r.text);
  return login(u);
}
// Сообщение: со снимком (multipart) или без (JSON)
function send(token, { topic = "problem", text = "Не открывается книга", shot, name = "snimok.jpg", type = "image/jpeg" } = {}) {
  if (!shot) return req("POST", "/api/knigi/messages", { token, json: { topic, text } });
  const fd = new FormData();
  fd.append("topic", topic); fd.append("text", text);
  fd.append("shot", new Blob([shot], { type }), name);
  return req("POST", "/api/knigi/messages", { token, fd });
}
const reply = (token, id, text) => req("POST", `/api/knigi/messages/${id}/reply`, { token, json: { text } });
const seen = (token, id) => req("POST", `/api/knigi/messages/${id}/seen`, { token });
const setState = (token, id, body) => req("POST", `/api/knigi/messages/${id}/state`, { token, json: body });
const msgView = (token, id) => req("GET", `/api/collections/messages/records/${id}`, { token });
const myList = async (token) => ((await req("GET", "/api/collections/messages/records?perPage=200", { token })).data || {}).items || [];
const replyList = async (token) => ((await req("GET", "/api/collections/message_replies/records?perPage=200", { token })).data || {}).items || [];
// Снимок как приложение: ссылка с кукой, потом файл с этой кукой
async function shot(token, id, { noCookie, cookie } = {}) {
  const l = await req("GET", `/api/knigi/messages/${id}/shot`, { token });
  if (l.status !== 200) return { link: l };
  const h = {};
  if (cookie) h.Cookie = cookie; else if (!noCookie) h.Cookie = cookieOf(l);
  const f = await req("GET", l.data.url, { headers: h });
  return { link: l, status: f.status, type: f.headers.get("content-type"), buf: f.buf, cookie: cookieOf(l), url: l.data.url };
}
const shotPath = (m) => DATA ? join(DATA, "storage", m.collectionId, m.id, m.shot) : "";
const ADMIN_NEW = async (admin) => (await myList(admin)).filter((m) => m.status === "new").length;

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

async function main() {
  section("Подготовка: администратор, Анна, Борис, Дина; Вера без согласия (как после миграции)");
  let r = await req("POST", "/api/collections/users/records", { json: { ...ADMIN, passwordConfirm: ADMIN.password } });
  const admin = r.status === 200 ? await login(ADMIN) : await login(ADMIN);
  const anna = await register(admin, ANNA), boris = await register(admin, BORIS), dina = await register(admin, DINA);
  const su = (await req("POST", "/api/collections/_superusers/auth-with-password", { json: { identity: SU_EMAIL, password: SU_PASS } })).data.token;
  r = await req("POST", "/api/collections/users/records", { token: su, json: { ...VERA, passwordConfirm: VERA.password, role: "user", terms_version: 0 } });
  ok(r.status === 200, "суперпользователь создал Веру без согласия", r.text);
  const vera = await login(VERA);
  const ANNA_ID = uid(anna), BORIS_ID = uid(boris), DINA_ID = uid(dina);

  section("1. Читатель отправляет сообщение со снимком и без");
  r = await send(anna, { topic: "offer", text: "Добавьте, пожалуйста, книги Льюиса.\nВторая строка. " + SECRET });
  ok(r.status === 200 && r.data.id && r.data.topic === "offer" && r.data.author === ANNA_ID && !r.data.shot, "без снимка: 200", r.text);
  const m1 = r.data;
  ok(m1.text.includes("\nВторая строка"), "перенос строки сохранился");
  ok(m1.status === undefined && m1.archived === undefined, "читателю состояние и архив не отдаются");
  r = await send(anna, { topic: "problem", text: "Вот снимок экрана с ошибкой", shot: JPEG });
  ok(r.status === 200 && r.data.shot, "со снимком JPEG: 200, имя файла есть", r.text);
  const m2 = r.data;
  ok(!DATA || existsSync(shotPath(m2)), "снимок лежит на диске в pb_data/storage", shotPath(m2));
  r = await send(anna, { topic: "review", text: "ё".repeat(1000) });
  ok(r.status === 200, "ровно 1000 знаков (русских): 200", r.text);
  const m3 = r.data;

  section("2. Что отклоняется");
  r = await send(anna, { text: "ж".repeat(1001) });
  ok(r.status === 400 && /1000 знаков/.test(r.data.message), "1001 знак: 400 «Текст длиннее 1000 знаков»", r.text);
  r = await send(anna, { text: "" });
  ok(r.status === 400 && /Напишите текст/.test(r.data.message), "пустое: 400", r.text);
  r = await send(anna, { text: "   \n  " });
  ok(r.status === 400, "только пробелы и переносы: 400", r.text);
  r = await send(anna, { topic: "spam", text: "привет" });
  ok(r.status === 400 && /тему/.test(r.data.message), "неизвестная тема: 400", r.text);
  r = await send(anna, { text: "не картинка", shot: Buffer.from("это просто текст, а не картинка\n".repeat(20)), name: "fake.jpg" });
  ok(r.status === 400 && /картинкой/.test(r.data.message), "текстовый файл под видом .jpg: 400 «Снимок должен быть картинкой»", r.text);
  r = await send(anna, { text: "pdf", shot: Buffer.from("%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n"), name: "doc.pdf", type: "application/pdf" });
  ok(r.status === 400, "PDF вместо снимка: 400", r.text);
  const big = Buffer.concat([JPEG.subarray(0, JPEG.length - 2), Buffer.alloc(2 * 1024 * 1024 + 10, 0x20), Buffer.from([0xff, 0xd9])]);
  r = await send(anna, { text: "большой", shot: big });
  ok(r.status === 400 && /2 МБ/.test(r.data.message), "снимок больше 2 МБ: 400", r.text);
  const fd = new FormData();
  fd.append("topic", "other"); fd.append("text", "два снимка");
  fd.append("shot", new Blob([JPEG], { type: "image/jpeg" }), "a.jpg"); fd.append("shot", new Blob([JPEG], { type: "image/jpeg" }), "b.jpg");
  r = await req("POST", "/api/knigi/messages", { token: anna, fd });
  ok(r.status === 400 && /один снимок/.test(r.data.message), "два снимка: 400", r.text);
  r = await send(admin, { text: "сам себе" });
  ok(r.status === 400, "администратор новое сообщение не пишет", r.text);
  r = await req("POST", "/api/knigi/messages", { json: { topic: "other", text: "без входа" } });
  ok(r.status === 401, "без входа: 401", r.text);
  r = await req("POST", "/api/collections/messages/records", { token: anna, json: { author: ANNA_ID, topic: "other", text: "мимо маршрута", status: "new" } });
  ok(r.status === 403 || r.status === 400, "создать через обычный API нельзя", r.status);
  r = await req("PATCH", `/api/collections/messages/records/${m1.id}`, { token: anna, json: { text: "поменяла" } });
  ok(r.status === 403 || r.status === 404, "изменить через обычный API нельзя", r.status);
  r = await req("PATCH", `/api/collections/messages/records/${m1.id}`, { token: admin, json: { status: "answered" } });
  ok(r.status === 403 || r.status === 404, "и администратору через обычный API нельзя", r.status);
  r = await req("DELETE", `/api/collections/messages/records/${m1.id}`, { token: anna });
  ok(r.status === 403 || r.status === 404, "удалить через обычный API нельзя", r.status);
  r = await req("POST", "/api/collections/message_replies/records", { token: anna, json: { message: m1.id, user: ANNA_ID, text: "мимо" } });
  ok(r.status === 403 || r.status === 400, "ответ через обычный API не создать", r.status);

  section("3. Кто что видит");
  r = await send(boris, { topic: "renew", text: "Борис: продлите, пожалуйста" });
  const mb = r.data;
  const bl = await myList(boris);
  ok(bl.length === 1 && bl[0].id === mb.id, "Борис видит списком только своё сообщение", bl.map((x) => x.id));
  ok((await msgView(boris, m1.id)).status === 404, "сообщение Анны по адресу Борису: 404");
  r = await req("GET", "/api/collections/messages/records?" + flt(`author = "${ANNA_ID}"`), { token: boris });
  ok(r.status === 200 && r.data.items.length === 0, "фильтр по автору Анны: пусто");
  const al = await myList(anna);
  ok(al.length === 3 && al.every((x) => x.author === ANNA_ID && x.status === undefined), "Анна видит свои 3, без состояния", al.length);
  const adl = await myList(admin);
  ok(adl.length === 4 && adl.every((x) => x.status === "new"), "администратор видит все 4, состояние «Новое»", adl.map((x) => x.status));
  ok((await req("GET", "/api/collections/messages/records")).status !== 200 || (await req("GET", "/api/collections/messages/records")).data.items.length === 0, "без входа списка нет");
  ok((await seen(boris, m1.id)).status === 404, "Борис не отмечает чужое прочитанным (404)");
  ok((await reply(boris, m1.id, "влезу")).status === 404, "Борис не отвечает в чужой переписке (404)");
  ok((await setState(boris, mb.id, { archived: true })).status === 403, "читатель не меняет состояние и архив (403)");
  ok((await req("DELETE", `/api/knigi/messages/${mb.id}`, { token: boris })).status === 403, "читатель не удаляет сообщение (403)");

  section("4. Снимок открывает только автор и администратор");
  let s = await shot(anna, m2.id);
  ok(s.status === 200 && /image\/jpeg/.test(s.type) && Buffer.compare(s.buf, JPEG) === 0, "Анна: ссылка и кука, файл тот же JPEG", { st: s.status, type: s.type, len: s.buf && s.buf.length });
  ok(/no-store/.test((await fetch(BASE + s.url, { headers: { Cookie: s.cookie } })).headers.get("cache-control") || ""), "снимок не кэшируется (no-store)");
  const annaLink = s;
  s = await shot(admin, m2.id);
  ok(s.status === 200 && Buffer.compare(s.buf, JPEG) === 0, "администратор открывает снимок");
  s = await shot(boris, m2.id);
  ok(s.link.status === 404, "Борису ссылка на чужой снимок: 404", s.link.text);
  s = await shot(anna, m2.id, { noCookie: true });
  ok(s.status === 401, "ссылка без куки: 401");
  const bc = await req("GET", "/api/knigi/session", { token: boris });
  r = await req("GET", annaLink.url, { headers: { Cookie: cookieOf(bc) } });
  ok(r.status === 401, "ссылка Анны с кукой Бориса: 401");
  r = await req("GET", annaLink.url);
  ok(r.status === 401, "снимок без входа и куки: 401");
  ok((await req("GET", `/api/knigi/messages/${m2.id}/shot`)).status === 401, "ссылку без входа не выдать: 401");
  r = await req("GET", `/api/files/messages/${m2.id}/${m2.shot}`);
  ok(r.status !== 200, "прямой адрес /api/files без токена не открывается", r.status);
  const ft = await req("POST", "/api/files/token", { token: boris });
  r = await req("GET", `/api/files/messages/${m2.id}/${m2.shot}?token=${ft.data && ft.data.token}`);
  ok(r.status !== 200, "прямой адрес с файловым токеном Бориса не открывается", r.status);
  ok((await shot(anna, m1.id)).link.status === 404, "у сообщения без снимка ссылки нет (404)");

  section("5. Ответы и точки");
  ok(await ADMIN_NEW(admin) === 4, "у администратора 4 новых (точка на фото)");
  r = await reply(admin, m1.id, "Добрый день! Добавлю на этой неделе.");
  ok(r.status === 200 && r.data.reply.admin === true && r.data.message.status === "answered" && r.data.message.user_unread === true && r.data.message.answers === 1,
    "ответ администратора: «Отвечено», у читателя точка", r.text);
  let a1 = (await msgView(anna, m1.id)).data;
  ok(a1.user_unread === true && a1.answers === 1, "Анна видит у сообщения непрочитанный ответ (точка)");
  let rl = await replyList(anna);
  ok(rl.length === 1 && rl[0].text.startsWith("Добрый день") && rl[0].admin === true, "Анна видит ответ администратора", rl);
  ok((await replyList(boris)).length === 0, "Борис чужих ответов не видит");
  ok(await ADMIN_NEW(admin) === 3, "у администратора осталось 3 новых");
  r = await seen(anna, m1.id);
  ok(r.status === 200 && r.data.user_unread === false, "Анна открыла переписку: точка снята", r.text);
  ok((await msgView(anna, m1.id)).data.user_unread === false, "и в базе снята");
  r = await reply(anna, m1.id, "Спасибо!");
  ok(r.status === 200 && r.data.reply.admin === false, "Анна ответила", r.text);
  a1 = (await msgView(admin, m1.id)).data;
  ok(a1.status === "new" && a1.user_unread === false, "ответ читателя: снова «Новое», точка у администратора");
  ok(await ADMIN_NEW(admin) === 4, "у администратора снова 4 новых");
  r = await setState(admin, m1.id, { status: "read" });
  ok(r.status === 200 && r.data.status === "read", "«Прочитано»", r.text);
  r = await reply(anna, m1.id, "ж".repeat(1001));
  ok(r.status === 400, "ответ длиннее 1000 знаков: 400");
  r = await reply(admin, m1.id, "   ");
  ok(r.status === 400, "пустой ответ: 400");

  section("6. Архив");
  r = await setState(admin, m3.id, { archived: true });
  ok(r.status === 200 && r.data.archived === true && r.data.status === "read", "«В архив»: в архиве, отмечено прочитанным", r.text);
  ok(await ADMIN_NEW(admin) === 2, "архивное не считается новым");
  r = await reply(anna, m3.id, "А ещё вот что хотела сказать");
  a1 = (await msgView(admin, m3.id)).data;
  ok(r.status === 200 && a1.archived === false && a1.status === "new", "ответ читателя в архивной переписке вернул её во «Входящие» как новую", a1);
  r = await setState(admin, m3.id, { archived: true });
  r = await setState(admin, m3.id, { archived: false });
  ok(r.status === 200 && r.data.archived === false, "«Вернуть из архива»");
  r = await setState(admin, m3.id, { status: "deleted" });
  ok(r.status === 400, "неизвестное состояние: 400");

  section("7. Без доступа и без условий");
  r = await req("POST", "/api/knigi/admin/access", { token: admin, json: { user: BORIS_ID, action: "set", date: "2020-01-01" } });
  ok(r.status === 200, "у Бориса срок закончился (1 января 2020)");
  ok((await req("GET", "/api/knigi/access", { token: boris })).data.reason === "expired", "сервер: expired");
  r = await send(boris, { topic: "renew", text: "Срок закончился, хочу продлить", shot: JPEG });
  ok(r.status === 200, "с закончившимся сроком пишет сообщение со снимком", r.text);
  const mb2 = r.data;
  ok((await shot(boris, mb2.id)).status === 200, "и открывает свой снимок");
  r = await reply(admin, mb.id, "Продлила на месяц.");
  r = await reply(boris, mb.id, "Спасибо, получил!");
  ok(r.status === 200, "с закончившимся сроком отвечает", r.text);
  ok((await replyList(boris)).length === 2, "и видит ответы");
  ok((await seen(boris, mb.id)).status === 200, "и снимает точку");
  r = await req("POST", "/api/knigi/admin/access", { token: admin, json: { user: BORIS_ID, action: "suspend" } });
  ok((await req("GET", "/api/knigi/access", { token: boris })).data.reason === "suspended", "Борис на паузе");
  r = await send(boris, { topic: "other", text: "На паузе тоже можно?" });
  ok(r.status === 200, "на паузе пишет", r.text);
  ok((await reply(boris, mb.id, "И ответить на паузе")).status === 200, "на паузе отвечает");
  ok((await req("POST", "/api/collections/shelves/records", { token: boris, json: { owner: BORIS_ID, name: "Полка", common: false } })).status === 403, "а полку на паузе по-прежнему не создать (403)");
  await req("POST", "/api/knigi/admin/access", { token: admin, json: { user: BORIS_ID, action: "unlimited" } });
  r = await send(vera, { topic: "other", text: "Вера без согласия" });
  ok(r.status === 403 && r.data.message === TERMS, "без принятых условий: 403 «Нужно принять условия…»", r.text);
  const tv = (await req("GET", "/api/knigi/terms")).data.version;
  await req("POST", "/api/knigi/terms/accept", { token: vera, json: { version: tv } });
  r = await send(vera, { topic: "other", text: "Вера приняла условия" });
  ok(r.status === 200, "после «Принять» пишет", r.text);
  const mv = r.data;
  await req("POST", "/api/knigi/admin/terms", { token: admin, json: { text: "Новая редакция условий для проверки.", new: true } });
  r = await reply(vera, mv.id, "после новой редакции");
  ok(r.status === 403 && r.data.message === TERMS, "новая редакция: ответ без согласия 403", r.text);
  const tv2 = (await req("GET", "/api/knigi/terms")).data.version;
  for (const t of [anna, boris, vera, dina]) await req("POST", "/api/knigi/terms/accept", { token: t, json: { version: tv2 } });
  ok((await reply(vera, mv.id, "приняла новую")).status === 200, "приняла новую редакцию: отвечает");

  section("8. Не больше 10 записей в день");
  let last = null, n = 0;
  r = await send(dina, { topic: "problem", text: "Дина 1", shot: JPEG }); n++;
  const md = r.data;
  for (let i = 0; i < 4; i++) { r = await send(dina, { topic: "other", text: "Дина " + (n + 1) }); n++; last = r; }
  for (let i = 0; i < 5; i++) { r = await reply(dina, md.id, "ответ " + i); n++; last = r; }
  ok(last.status === 200 && n === 10, "10 записей (5 сообщений и 5 ответов) прошли");
  r = await send(dina, { topic: "other", text: "Одиннадцатое" });
  ok(r.status === 429 && r.data.message === DAY_MSG, "одиннадцатое сообщение: 429 «Сегодня отправлено слишком много сообщений…»", r.text);
  r = await reply(dina, md.id, "одиннадцатый ответ");
  ok(r.status === 429 && r.data.message === DAY_MSG, "одиннадцатый ответ: 429", r.text);
  ok((await reply(admin, md.id, "Администратора ограничение не касается")).status === 200, "администратор отвечает сверх 10");
  r = await send(anna, { topic: "other", text: "У Анны свой счёт" });
  ok(r.status === 200, "у другого читателя счёт свой", r.text);

  section("9. ИИ-помощник сообщений не получает");
  const at = await mcpToken();
  ok(!!at, "токен помощника получен");
  const tl = await mcp(at, "tools/list", {});
  const names = ((tl.data && tl.data.result && tl.data.result.tools) || []).map((t) => t.name);
  ok(names.length > 0 && !names.some((nm) => /mess|msg|mail|сообщ/i.test(nm)), "среди инструментов нет сообщений: " + names.join(", "));
  for (const [tool, args] of [["search", { query: SECRET }], ["search_books", { query: SECRET }], ["list_notes", { query: SECRET }], ["search_in_books", { query: SECRET }]]) {
    const cr = await mcp(at, "tools/call", { name: tool, arguments: args });
    // слово запроса помощник повторяет в ответе («не нашлось»), поэтому ищем остальной текст сообщения
    ok(!/Добавьте, пожалуйста|Вторая строка|Льюиса/.test(mcpText(cr)), `${tool}: текста сообщения нет`, mcpText(cr).slice(0, 300));
  }
  for (const id of [`message:${m1.id}`, `note:${m1.id}`, m1.id]) {
    const cr = await mcp(at, "tools/call", { name: "fetch", arguments: { id } });
    ok(!mcpText(cr).includes(SECRET) && !/Льюиса/.test(mcpText(cr)), `fetch(${id}): сообщения не отдаёт`, mcpText(cr).slice(0, 300));
  }
  const gn = await mcp(at, "tools/call", { name: "get_note", arguments: { id: m1.id } });
  ok(!mcpText(gn).includes(SECRET), "get_note с номером сообщения: ничего", mcpText(gn).slice(0, 200));

  section("10. Удаление сообщения и пользователя убирает снимки с диска");
  const p2 = shotPath(m2);
  r = await req("DELETE", `/api/knigi/messages/${m2.id}`, { token: admin });
  ok(r.status === 200, "администратор удалил сообщение со снимком", r.text);
  ok((await msgView(anna, m2.id)).status === 404, "у Анны его больше нет");
  ok(!DATA || !existsSync(p2), "снимок удалён с диска", p2);
  r = await reply(admin, m1.id, "ещё один ответ");
  const rid = r.data.reply.id;
  r = await req("DELETE", `/api/knigi/messages/${m1.id}`, { token: admin });
  ok((await req("GET", `/api/collections/message_replies/records/${rid}`, { token: admin })).status === 404, "ответы удалены вместе с сообщением");
  const pd = shotPath(md);
  ok(!DATA || existsSync(pd), "снимок Дины на диске до удаления аккаунта", pd);
  r = await req("DELETE", `/api/collections/users/records/${DINA_ID}`, { token: su });
  ok(r.status === 204, "суперпользователь удалил аккаунт Дины (в панели)", r.text);
  const left = (await myList(admin)).filter((x) => x.author === DINA_ID);
  ok(left.length === 0, "сообщений Дины не осталось");
  ok((await replyList(admin)).every((x) => x.user !== DINA_ID && x.message !== md.id), "её ответов и ответов ей не осталось");
  ok(!DATA || !existsSync(pd), "снимок Дины удалён с диска", pd);
  if (DATA) {
    const dir = join(DATA, "storage", md.collectionId);
    const rest = existsSync(dir) ? readdirSync(dir) : [];
    ok(!rest.includes(md.id), "и папка её сообщения тоже", rest);
  }

  console.log(`\nПроверок: ${oks + fails}, прошло: ${oks}, ошибок: ${fails}`);
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.log("СБОЙ ПРОВЕРКИ: " + (e && e.stack || e)); process.exit(1); });
