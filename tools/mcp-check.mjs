#!/usr/bin/env node
// Проверка этапа 4 (сервер MCP и вход OAuth) на локальном PocketBase. Без внешних пакетов, Node 18+.
// Обычно запускается из tools/mcp-check.sh, который сам поднимает чистый PocketBase.
//
//   node tools/mcp-check.mjs                 весь путь три раза (Claude, ChatGPT, Perplexity) и проверки отказов
//   node tools/mcp-check.mjs --expect-ip-block   только: /mcp отвечает 403 (запущен с MCP_IP_ALLOW)
//   node tools/mcp-check.mjs --expect-disabled   только: /mcp и /oauth/token отвечают 503 (MCP_ENABLED=0)
//
// Настройки: KN_BASE (http://127.0.0.1:8093), KN_LOG (файл журнала сервера, для проверки строки
// «Отклонён адрес возврата»). Пользователи и книги создаются сами, если база пустая.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

const BASE = (process.env.KN_BASE || "http://127.0.0.1:8093").replace(/\/+$/, "");
const LOG = process.env.KN_LOG || "";
const ADMIN = { email: "admin@example.com", password: "proverka-admin-12345", name: "Григорий" };
const READER = { email: "reader@example.com", password: "proverka-reader-12345", name: "Анна" };
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
  const t0 = Date.now();
  const r = await fetch(BASE + path, { method, headers: h, body, redirect: "manual" });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  return { status: r.status, headers: r.headers, text, data, ms: Date.now() - t0 };
}

/* ---------- Тестовые книги (делаются здесь же) ---------- */
function makePdf() {
  // 6 страниц, латиница (стандартный шрифт), закладки и разметка номеров: две страницы i, ii, дальше 1, 2, ...
  const pages = [];
  for (let i = 1; i <= 6; i++) {
    const lines = [`Glava ${i}`, `This is page ${i} of the test book about prayer and patience.`, "The quick brown fox jumps over the lazy dog again and again.",
      i === 4 ? "Here is the secret phrase: golden morning light." : "Nothing special on this page, just ordinary words."];
    pages.push("BT /F1 14 Tf 72 720 Td " + lines.map((l) => `(${l}) Tj 0 -24 Td`).join(" ") + " ET");
  }
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add(null), pagesObj = add(null), font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = [];
  for (const c of pages) {
    const content = add(`<< /Length ${Buffer.byteLength(c)} >>\nstream\n${c}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  const outlines = add(null);
  const items = pageIds.map((p, i) => add(null));
  items.forEach((id, i) => {
    objs[id - 1] = `<< /Title (Chapter ${i + 1}) /Parent ${outlines} 0 R /Dest [${pageIds[i]} 0 R /Fit]` +
      (i ? ` /Prev ${items[i - 1]} 0 R` : "") + (i < items.length - 1 ? ` /Next ${items[i + 1]} 0 R` : "") + " >>";
  });
  objs[outlines - 1] = `<< /Type /Outlines /First ${items[0]} 0 R /Last ${items[items.length - 1]} 0 R /Count ${items.length} >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((p) => p + " 0 R").join(" ")}] /Count ${pageIds.length} >>`;
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R /Outlines ${outlines} 0 R /PageMode /UseOutlines /PageLabels << /Nums [0 << /S /r >> 2 << /S /D >>] >> >>`;
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
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
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
  const para = (t) => `<p>${t}</p>`;
  const long = "Терпение и молитва идут рядом. ".repeat(40);
  const ch = (title, body) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;
  return makeZip([
    ["mimetype", "application/epub+zip"],
    ["META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ["OEBPS/content.opf", '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">kn-test</dc:identifier><dc:title>' + (title || "Ёлка и молитва") + '</dc:title><dc:creator>Иван Проверкин</dc:creator><dc:language>ru</dc:language><dc:date>1999</dc:date></metadata>' +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>'],
    ["OEBPS/nav.xhtml", '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Глава первая. Утро</a></li><li><a href="c2.xhtml">Глава вторая. Вечер</a></li></ol></nav></body></html>'],
    ["OEBPS/c1.xhtml", ch("Глава первая. Утро", para("Утром зажгли ёлку и долго молились.") + para(long))],
    ["OEBPS/c2.xhtml", ch("Глава вторая. Вечер", para("Вечером снова читали Псалтирь, и тихий свет лежал на столе.") + para(long))],
  ]);
}

/* ---------- Подготовка данных ---------- */
async function login(u) {
  const r = await req("POST", "/api/collections/users/auth-with-password", { json: { identity: u.email, password: u.password } });
  if (r.status !== 200) throw new Error("Не получилось войти как " + u.email + ": " + r.text);
  return r.data.token;
}
async function upload(token, name, buf, kind) {
  let r = await req("POST", "/api/knigi/upload/start", { token, json: { name, size: buf.length, kind: kind || "book" } });
  if (r.status !== 200) throw new Error("upload/start: " + r.text);
  const up = r.data.upload;
  const fd = new FormData();
  fd.append("chunk", new Blob([buf]), "chunk");
  const c = await fetch(`${BASE}/api/knigi/upload/${up}/0`, { method: "POST", headers: { Authorization: token }, body: fd });
  if (c.status !== 200) throw new Error("upload chunk: " + (await c.text()));
  r = await req("POST", `/api/knigi/upload/${up}/finish`, { token, json: {} });
  if (r.status !== 200) throw new Error("upload/finish: " + r.text);
  await req("POST", "/api/knigi/process", { token, json: {} });
  if (kind === "offer") return r.data;
  for (let i = 0; i < 60; i++) {
    const b = await req("GET", `/api/collections/books/records/${r.data.id}`, { token });
    if (b.data && b.data.status !== "processing") {
      // правки 4.1: новая книга скрыта, для этой проверки открываем её всем
      const v = await req("POST", `/api/knigi/books/${b.data.id}/visibility`, { token, json: { hidden: false } });
      if (v.status !== 200) throw new Error("visibility: " + v.text);
      return { ...b.data, hidden: false };
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error("Книга не обработалась за 30 секунд");
}
async function setup() {
  section("Подготовка: пользователи, книги, полка, заметки, группа");
  const s = await req("GET", "/api/knigi/setup");
  if (s.data.firstRun) {
    await req("POST", "/api/collections/users/records", { json: { ...ADMIN, passwordConfirm: ADMIN.password } });
  }
  const admin = await login(ADMIN);
  let reader;
  try { reader = await login(READER); } catch (_) {
    const code = "PROVERKA" + randomBytes(3).toString("hex").toUpperCase();
    await req("POST", "/api/collections/invites/records", { token: admin, json: { code, max_uses: 1, uses: 0 } });
    const r = await req("POST", "/api/collections/users/records", { json: { ...READER, passwordConfirm: READER.password, invite: code, terms: (await req("GET", "/api/knigi/terms")).data.version } });
    if (r.status !== 200) throw new Error("Читатель не зарегистрировался: " + r.text);
    reader = await login(READER);
  }
  let books = (await req("GET", "/api/collections/books/records?perPage=50&filter=" + encodeURIComponent("pending = false"), { token: admin })).data.items;
  let pdf = books.find((b) => b.title === "Proverka PDF"), epub = books.find((b) => /Ёлка/.test(b.title));
  if (!pdf) pdf = await upload(admin, "Тестов Автор - Proverka PDF.pdf", makePdf());
  if (!epub) epub = await upload(admin, "elka.epub", makeEpub());
  ok(pdf.status === "ready" && pdf.has_text, "PDF загружен и обработан, текст есть", pdf);
  ok(epub.status === "ready" && epub.has_text, "EPUB загружен и обработан, текст есть", epub);
  const meId = JSON.parse(Buffer.from(admin.split(".")[1], "base64url")).id;
  let shelf = (await req("GET", "/api/collections/shelves/records?filter=" + encodeURIComponent("name = 'Проверка'"), { token: admin })).data.items[0];
  if (!shelf) {
    const sr = await req("POST", "/api/collections/shelves/records", { token: admin, json: { name: "Проверка", common: true, owner: meId, sort: 1 } });
    ok(sr.status === 200, "общая полка создана", sr.text);
    shelf = sr.data;
    const sb = await req("POST", "/api/collections/shelf_books/records", { token: admin, json: { shelf: shelf.id, book: pdf.id, sort: 1 } });
    ok(sb.status === 200, "книга поставлена на полку", sb.text);
  }
  const notes = (await req("GET", "/api/collections/notes/records?perPage=100&filter=" + encodeURIComponent(`owner = '${meId}'`), { token: admin })).data.items;
  if (!notes.some((n) => n.title === "Заметка для проверки")) {
    await req("POST", "/api/collections/notes/records", { token: admin, json: { owner: meId, kind: "note", title: "Заметка для проверки", book: pdf.id, page: 4,
      body: "<h2>Главное</h2><p>Текст с <strong>жирным</strong> и <em>курсивом</em>.</p><ul><li>первый</li><li>второй</li></ul><blockquote>цитата</blockquote>" } });
    await req("POST", "/api/collections/notes/records", { token: admin, json: { owner: meId, kind: "highlight", book: pdf.id, page: 4, format: "pdf",
      quote: "golden morning light", color: "green", body: "<p>Моя мысль о свете</p>", anchor: { v: 1, rects: [[0.1, 0.1, 0.2, 0.02]], s: 0, e: 10 } } });
  }
  // группа: администратор создаёт, читатель вступает и пишет цитату, администратор комментирует
  let groups = (await req("GET", "/api/collections/groups/records", { token: admin })).data.items;
  let g = groups.find((x) => x.name === "Группа проверки");
  if (!g) {
    const r = await req("POST", "/api/knigi/groups", { token: admin, json: { name: "Группа проверки", description: "Читаем вместе", book: epub.id } });
    g = (await req("GET", `/api/collections/groups/records/${r.data.id}`, { token: admin })).data;
    await req("POST", `/api/knigi/join/${g.invite_code}`, { token: reader, json: {} });
    const readerId = JSON.parse(Buffer.from(reader.split(".")[1], "base64url")).id;
    const n = await req("POST", "/api/collections/notes/records", { token: reader, json: { owner: readerId, kind: "highlight", book: epub.id, format: "epub", group: g.id,
      quote: "Утром зажгли ёлку", color: "yellow", body: "<p>Красиво</p>", place: "Глава первая · 5%", anchor: { v: 1, cfi: "epubcfi(/6/2!/4/2)", pct: 5 } } });
    ok(n.status === 200, "читатель отправил цитату в группу", n.text);
    const cm = await req("POST", "/api/collections/note_comments/records", { token: admin, json: { note: n.data.id, user: meId, group: g.id, text: "Согласен, очень красиво" } });
    ok(cm.status === 200, "администратор прокомментировал цитату", cm.text);
  }
  // книга на проверке: читатель предлагает, администратор пишет к ней заметку
  let pend = (await req("GET", "/api/collections/books/records?filter=" + encodeURIComponent("pending = true"), { token: admin })).data.items[0];
  if (!pend) {
    await upload(reader, "Секретная - Книга на проверке.epub", makeEpub("Книга на проверке секретная"), "offer");
    for (let i = 0; i < 60 && !(pend && pend.status === "ready"); i++) {
      await new Promise((res) => setTimeout(res, 500));
      pend = (await req("GET", "/api/collections/books/records?filter=" + encodeURIComponent("pending = true"), { token: admin })).data.items[0];
    }
    const pn = await req("POST", "/api/collections/notes/records", { token: admin, json: { owner: meId, kind: "note", title: "Заметка к книге на проверке", book: pend.id, body: "<p>секретная</p>" } });
    ok(pn.status === 200, "заметка администратора к книге на проверке", pn.text);
  }
  ok(pend && pend.status === "ready", "книга читателя на проверке обработана", pend);
  return { admin, reader, pdf, epub, shelf, group: g, pend };
}

/* ---------- PKCE ---------- */
const b64u = (b) => Buffer.from(b).toString("base64url");
function pkce() { const v = b64u(randomBytes(40)); return { verifier: v, challenge: b64u(createHash("sha256").update(v).digest()) }; }

async function mcp(token, body, extraHeaders = {}) {
  return req("POST", "/mcp", { json: body, headers: { Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25", ...extraHeaders }, token: token ? "Bearer " + token : undefined });
}
let rpcId = 0;
async function call(token, name, args) {
  const r = await mcp(token, { jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } });
  const res = r.data && r.data.result;
  return { r, res, text: res && res.content && res.content[0] ? res.content[0].text : "" };
}

/* ---------- Весь путь для одного сервиса ---------- */
async function flow(svc, D) {
  section(`Путь как ${svc.name}: регистрация ${svc.method}, адрес возврата ${svc.redirect}`);
  // 1. без токена
  const r0 = await mcp(null, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: svc.name, version: "1" } } });
  const wa = r0.headers.get("www-authenticate") || "";
  ok(r0.status === 401 && /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource"/.test(wa), "без токена 401 и WWW-Authenticate с resource_metadata", wa);
  const prmUrl = /resource_metadata="([^"]+)"/.exec(wa)[1];
  // 2. метаданные
  const prm = await req("GET", new URL(prmUrl).pathname);
  ok(prm.status === 200 && prm.data.resource === BASE + "/mcp" && prm.data.authorization_servers.length === 1 && prm.data.authorization_servers[0] === BASE,
    "oauth-protected-resource: resource и authorization_servers", prm.data);
  const prm2 = await req("GET", "/.well-known/oauth-protected-resource/mcp");
  ok(prm2.status === 200 && prm2.data.resource === BASE + "/mcp", "вариант с /mcp в конце");
  const as = await req("GET", "/.well-known/oauth-authorization-server");
  const oidc = await req("GET", "/.well-known/openid-configuration");
  ok(as.status === 200 && as.data.issuer === BASE && as.data.code_challenge_methods_supported.join() === "S256" &&
    ["none", "client_secret_post", "client_secret_basic"].every((m) => as.data.token_endpoint_auth_methods_supported.includes(m)) &&
    as.data.scopes_supported.includes("offline_access") && as.data.registration_endpoint, "oauth-authorization-server: адреса, S256, способы, offline_access", as.data);
  ok(oidc.status === 200 && oidc.data.token_endpoint === as.data.token_endpoint, "openid-configuration с теми же данными");
  // 3. регистрация
  const reg = await req("POST", "/oauth/register", { json: { client_name: svc.name, redirect_uris: [svc.redirect], token_endpoint_auth_method: svc.method, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] } });
  ok(reg.status === 201 && reg.data.client_id && reg.data.client_secret, `регистрация (DCR): client_id и client_secret выданы (${svc.method})`, reg.text);
  const client = reg.data;
  const clientAuth = (form) => {
    if (svc.method === "client_secret_post") return { form: { ...form, client_id: client.client_id, client_secret: client.client_secret } };
    if (svc.method === "client_secret_basic") return { form, headers: { Authorization: "Basic " + Buffer.from(encodeURIComponent(client.client_id) + ":" + encodeURIComponent(client.client_secret)).toString("base64") } };
    return { form: { ...form, client_id: client.client_id } };
  };
  // 4. вход и согласие
  const pk = pkce();
  const state = "st-" + randomBytes(6).toString("hex");
  const q = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: svc.redirect, state, code_challenge: pk.challenge, code_challenge_method: "S256",
    scope: "library offline_access", resource: BASE + "/mcp" });
  const page = await req("GET", "/oauth/authorize?" + q);
  ok(page.status === 200 && page.text.includes("oauth.js") && page.text.includes(svc.label), `страница входа отдаётся и называет «${svc.label}»`, page.text.slice(0, 300));
  ok(/frame-ancestors 'none'/.test(page.headers.get("content-security-policy") || ""), "страницу нельзя встроить в чужой сайт (CSP)");
  const lg = await req("POST", "/oauth/login", { json: { email: ADMIN.email, password: ADMIN.password } });
  ok(lg.status === 200 && lg.data.token, "вход почтой и паролем на странице согласия", lg.text);
  const me = await req("GET", "/oauth/me", { token: lg.data.token });
  ok(me.data && me.data.admin === true, "страница видит, что вошёл администратор");
  const dec = await req("POST", "/oauth/authorize", { token: lg.data.token, json: { ...Object.fromEntries(q), allow: true } });
  const red = dec.data && dec.data.redirect ? new URL(dec.data.redirect) : null;
  ok(red && red.origin + red.pathname === svc.redirect && red.searchParams.get("code") && red.searchParams.get("state") === state && red.searchParams.get("iss") === BASE,
    "«Разрешить»: возврат на адрес помощника с code, state и iss", dec.text);
  const code = red.searchParams.get("code");
  // 5. обмен кода
  const bad = await req("POST", "/oauth/token", clientAuth({ grant_type: "authorization_code", code, redirect_uri: svc.redirect, code_verifier: pkce().verifier }));
  ok(bad.status === 400 && bad.data.error === "invalid_grant", "неверный code_verifier: invalid_grant", bad.text);
  // код одноразовый: после неудачной попытки он уже сгорел, берём новый
  const dec2 = await req("POST", "/oauth/authorize", { token: lg.data.token, json: { ...Object.fromEntries(q), allow: true } });
  const code2 = new URL(dec2.data.redirect).searchParams.get("code");
  const tok = await req("POST", "/oauth/token", clientAuth({ grant_type: "authorization_code", code: code2, redirect_uri: svc.redirect, code_verifier: pk.verifier, resource: BASE + "/mcp" }));
  ok(tok.status === 200 && tok.data.access_token && tok.data.refresh_token && tok.data.token_type === "Bearer" && tok.data.expires_in > 3000,
    `обмен кода на токены (${tok.ms} мс)`, tok.text);
  ok(tok.ms < 1000, "ответ /oauth/token быстрее секунды");
  ok(/no-store/.test(tok.headers.get("cache-control") || ""), "токены не кэшируются (no-store)");
  const again = await req("POST", "/oauth/token", clientAuth({ grant_type: "authorization_code", code: code2, redirect_uri: svc.redirect, code_verifier: pk.verifier }));
  ok(again.status === 400 && again.data.error === "invalid_grant", "повтор того же кода: invalid_grant");
  if (svc.method !== "none") {
    const wrong = await req("POST", "/oauth/token", svc.method === "client_secret_post"
      ? { form: { grant_type: "refresh_token", refresh_token: tok.data.refresh_token, client_id: client.client_id, client_secret: "kns_wrong" } }
      : { form: { grant_type: "refresh_token", refresh_token: tok.data.refresh_token }, headers: { Authorization: "Basic " + Buffer.from(client.client_id + ":kns_wrong").toString("base64") } });
    ok(wrong.status === 401 && wrong.data.error === "invalid_client", "неверный секрет клиента: invalid_client", wrong.text);
    const none = await req("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: tok.data.refresh_token, client_id: client.client_id } });
    ok(none.status === 401 && none.data.error === "invalid_client", "без секрета у клиента " + svc.method + ": invalid_client", none.text);
  }
  const jsonTok = await req("POST", "/oauth/token", { json: { grant_type: "refresh_token", refresh_token: tok.data.refresh_token, client_id: client.client_id } });
  ok(jsonTok.status === 400, "/oauth/token в JSON не принимается (нужна форма)");
  let access = tok.data.access_token;
  // 6. MCP
  const init = await mcp(access, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: svc.name, version: "1" } } });
  ok(init.status === 200 && init.data.result.protocolVersion === "2025-11-25" && init.data.result.capabilities.tools, "initialize: версия 2025-11-25", init.text);
  const old = await mcp(access, { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {} } });
  ok(old.data.result.protocolVersion === "2025-03-26", "initialize: старая версия 2025-03-26 тоже согласуется");
  const unk = await mcp(access, { jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2099-01-01", capabilities: {} } });
  ok(unk.data.result.protocolVersion === "2025-11-25", "initialize: незнакомая версия → сервер предлагает свою");
  const ntf = await mcp(access, { jsonrpc: "2.0", method: "notifications/initialized" });
  ok(ntf.status === 202, "notifications/initialized: 202 без тела");
  const ping = await mcp(access, { jsonrpc: "2.0", id: 4, method: "ping" });
  ok(ping.status === 200 && ping.data.result && Object.keys(ping.data.result).length === 0, "ping");
  const badPv = await mcp(access, { jsonrpc: "2.0", id: 5, method: "ping" }, { "MCP-Protocol-Version": "1999-01-01" });
  ok(badPv.status === 400, "неизвестный заголовок MCP-Protocol-Version: 400");
  const get = await req("GET", "/mcp", { token: "Bearer " + access });
  ok(get.status === 405, "GET /mcp: 405");
  const list = await mcp(access, { jsonrpc: "2.0", id: 6, method: "tools/list" });
  const tools = list.data.result.tools;
  const names = tools.map((t) => t.name);
  const want = ["search_books", "list_shelves", "get_book", "read_book", "search_in_books", "list_notes", "get_note", "list_groups", "get_group_notes", "create_note", "search", "fetch"];
  ok(want.every((n) => names.includes(n)), "tools/list: все 12 инструментов", names);
  ok(tools.every((t) => t.name === "create_note" ? t.annotations.readOnlyHint === false && t.annotations.destructiveHint === false : t.annotations.readOnlyHint === true),
    "readOnlyHint у всех, кроме create_note; у create_note destructiveHint false");
  ok(tools.every((t) => /[а-я]/i.test(t.description) && t.inputSchema && t.inputSchema.type === "object"), "описания по-русски, схемы параметров есть");
  // вызовы
  let c = await call(access, "search_books", { query: "proverka" });
  ok(!c.res.isError && c.text.includes(D.pdf.id) && /полки: Проверка/.test(c.text), "search_books по названию (id, полка)", c.text);
  c = await call(access, "search_books", { query: "секретная" });
  ok(!c.res.isError && !c.text.includes(D.pend.id), "книга на проверке не ищется", c.text);
  c = await call(access, "read_book", { book_id: D.pend.id });
  ok(c.res.isError && /не найдена/.test(c.text), "текст книги на проверке не отдаётся", c.text);
  c = await call(access, "list_notes", { query: "секретная" });
  ok(!c.text.includes("Заметка к книге на проверке"), "заметка к книге на проверке не видна", c.text);
  c = await call(access, "search_in_books", { query: "Утром зажгли" });
  ok(!c.text.includes(D.pend.id), "поиск в тексте не заходит в книгу на проверке", c.text);
  c = await call(access, "search_books", {});
  ok(!c.res.isError && c.text.includes("Недавно добавленные") && c.text.includes(D.epub.id), "search_books без запроса: недавние", c.text);
  c = await call(access, "search_books", { shelf_id: D.shelf.id });
  ok(!c.res.isError && c.text.includes(D.pdf.id) && !c.text.includes(D.epub.id), "search_books по полке", c.text);
  c = await call(access, "list_shelves", {});
  ok(!c.res.isError && c.text.includes("Проверка") && c.text.includes(D.shelf.id) && /1 книга/.test(c.text), "list_shelves: дерево с числом книг", c.text);
  c = await call(access, "get_book", { book_id: D.pdf.id });
  ok(!c.res.isError && /Chapter 1 · с\. 1/.test(c.text) && /заметок [1-9]/.test(c.text) && /цитат 1/.test(c.text) && /напечатанный/i.test(c.text), "get_book PDF: оглавление, счётчики, номера страниц", c.text);
  c = await call(access, "get_book", { book_id: D.epub.id });
  ok(!c.res.isError && /Разделы/.test(c.text) && /Глава первая/.test(c.text), "get_book EPUB: разделы", c.text);
  // правки 4.1: помощник работает с правами владельца и видит скрытые книги с пометкой
  await req("POST", `/api/knigi/books/${D.epub.id}/visibility`, { token: D.admin, json: { hidden: true } });
  c = await call(access, "search_books", { query: "ёлка" });
  ok(!c.res.isError && c.text.includes(D.epub.id) && c.text.includes("скрыта от читателей"), "search_books: скрытая книга с пометкой «скрыта от читателей»", c.text);
  c = await call(access, "get_book", { book_id: D.epub.id });
  ok(!c.res.isError && /Видимость: скрыта от читателей/.test(c.text), "get_book: «скрыта от читателей»", c.text);
  await req("POST", `/api/knigi/books/${D.epub.id}/visibility`, { token: D.admin, json: { hidden: false } });
  c = await call(access, "get_book", { book_id: D.epub.id });
  ok(!c.res.isError && /Видимость: видна всем читателям/.test(c.text), "get_book: после открытия «видна всем читателям»", c.text);
  c = await call(access, "read_book", { book_id: D.pdf.id, from: 3, to: 4 });
  ok(!c.res.isError && c.text.includes("=== Страница 3 (в книге: 1) ===") && c.text.includes("golden morning light"), "read_book PDF с. 3-4, напечатанный номер в скобках", c.text);
  c = await call(access, "read_book", { book_id: D.epub.id, from: 1 });
  ok(!c.res.isError && c.text.includes("=== Раздел 1: Глава первая. Утро ===") && c.text.includes("ёлку"), "read_book EPUB раздел 1", c.text.slice(0, 400));
  c = await call(access, "read_book", { book_id: "zzzzzzzzzzzzzzz" });
  ok(c.res.isError && /не найдена/.test(c.text), "read_book неизвестной книги: понятная ошибка");
  c = await call(access, "search_in_books", { query: "Golden Morning" });
  ok(!c.res.isError && /с\. 4/.test(c.text) && c.text.includes(D.pdf.id), "search_in_books во всех книгах (регистр не важен)", c.text);
  c = await call(access, "search_in_books", { query: "елку", book_id: D.epub.id });
  ok(!c.res.isError && /раздел 1/.test(c.text), "search_in_books: ё = е, в одной книге", c.text);
  c = await call(access, "search_in_books", { query: "proverka", shelf_id: D.shelf.id });
  ok(!c.res.isError, "search_in_books на полке");
  c = await call(access, "list_notes", {});
  ok(!c.res.isError && c.text.includes("Заметка для проверки") && c.text.includes("golden morning light") && /зелёная/.test(c.text) && /Мысль: Моя мысль/.test(c.text), "list_notes: заметка и цитата с цветом и мыслью", c.text);
  c = await call(access, "list_notes", { kind: "highlight", book_id: D.pdf.id });
  ok(!c.res.isError && !c.text.includes("Заметка для проверки"), "list_notes по виду и книге");
  c = await call(access, "list_notes", { query: "мысль о свете" });
  ok(!c.res.isError && c.text.includes("golden"), "list_notes поиск по мысли");
  const noteId = /Заметка · «Заметка для проверки» \(id: ([a-z0-9]{15})\)/.exec((await call(access, "list_notes", { kind: "note" })).text);
  c = await call(access, "get_note", { note_id: noteId && noteId[1] });
  ok(!c.res.isError && c.text.includes("## Главное") && c.text.includes("**жирным**") && c.text.includes("*курсивом*") && c.text.includes("- первый") && c.text.includes("> цитата"), "get_note: Markdown", c.text);
  c = await call(access, "list_groups", {});
  ok(!c.res.isError && c.text.includes("Группа проверки") && c.text.includes("Анна") && !c.text.includes("@"), "list_groups: участники по именам, без почты", c.text);
  c = await call(access, "get_group_notes", { group_id: D.group.id });
  ok(!c.res.isError && c.text.includes("Утром зажгли ёлку") && c.text.includes("Анна") && c.text.includes("Согласен, очень красиво") && !c.text.includes("@"), "get_group_notes: цитата участника и комментарий, без почты", c.text);
  c = await call(access, "get_group_notes", { group_id: "zzzzzzzzzzzzzzz" });
  ok(c.res.isError, "get_group_notes чужой группы: отказ");
  c = await call(access, "create_note", { title: `Конспект от ${svc.name}`, text: "# Итог\n\nГлавная мысль **важна**, а *эта* тоже.\n\n- пункт один\n- пункт два\n  - вложенный\n\n1. первое\n2. второе\n\n> цитата из книги\n\n[ссылка](https://example.com)", book_id: D.pdf.id, page: 4 });
  const nid = (/\(id: ([a-z0-9]{15})\)/.exec(c.text) || [])[1];
  ok(!c.res.isError && nid && c.text.includes("#/note/" + nid), "create_note: id и ссылка", c.text);
  const nrec = await req("GET", `/api/collections/notes/records/${nid}`, { token: D.admin });
  ok(nrec.data && nrec.data.ai === svc.brand && nrec.data.shared === false && !nrec.data.group && nrec.data.page === 4 && /<h2>Итог<\/h2>/.test(nrec.data.body) &&
    /<strong>важна<\/strong>/.test(nrec.data.body) && /<ul><li>пункт один/.test(nrec.data.body) && /<ol>/.test(nrec.data.body) && /<blockquote>/.test(nrec.data.body) && /<a href="https:\/\/example.com"/.test(nrec.data.body),
    `заметка в базе: «Создано ${svc.brand}», личная, страница, оформление`, nrec.data);
  const rd = await req("GET", `/api/collections/notes/records/${nid}`, { token: D.reader });
  ok(rd.status === 404, "читатель новую заметку не видит");
  const upd = await req("PATCH", `/api/collections/notes/records/${nid}`, { token: D.admin, json: { ai: "", title: `Конспект от ${svc.name} (правка)` } });
  ok(upd.status === 200 && upd.data.ai === svc.brand, "пометку «Создано …» через приложение не снять");
  c = await call(access, "search", { query: "golden morning" });
  let sr = null; try { sr = JSON.parse(c.text); } catch (_) {}
  ok(sr && Array.isArray(sr.results) && sr.results.some((x) => /^text:/.test(x.id)), "search (ChatGPT): JSON results с отрывком", c.text);
  const fid = sr && sr.results.find((x) => /^text:/.test(x.id));
  c = await call(access, "fetch", { id: fid && fid.id });
  let fr = null; try { fr = JSON.parse(c.text); } catch (_) {}
  ok(fr && fr.id && fr.text && fr.text.includes("golden morning light") && fr.url, "fetch по id из search", c.text.slice(0, 300));
  c = await call(access, "fetch", { id: "book:" + D.epub.id });
  ok(!c.res.isError && JSON.parse(c.text).title.includes("Ёлка"), "fetch книги");
  const unknown = await mcp(access, { jsonrpc: "2.0", id: 99, method: "tools/call", params: { name: "delete_everything", arguments: {} } });
  ok(unknown.data.error && unknown.data.error.code === -32602, "неизвестный инструмент: ошибка -32602");
  const qtoken = await req("POST", "/mcp?token=" + access + "&access_token=" + access, { json: { jsonrpc: "2.0", id: 1, method: "ping" } });
  ok(qtoken.status === 401, "токен в адресе (?token=) не принимается");
  // 7. обновление токена
  const ref = await req("POST", "/oauth/token", clientAuth({ grant_type: "refresh_token", refresh_token: tok.data.refresh_token }));
  ok(ref.status === 200 && ref.data.access_token && ref.data.refresh_token && ref.data.refresh_token !== tok.data.refresh_token, "обновление токена: новая пара", ref.text);
  const reuse = await req("POST", "/oauth/token", clientAuth({ grant_type: "refresh_token", refresh_token: tok.data.refresh_token }));
  ok(reuse.status === 400 && reuse.data.error === "invalid_grant", "старый токен обновления: invalid_grant", reuse.text);
  access = ref.data.access_token;
  const p2 = await mcp(access, { jsonrpc: "2.0", id: 7, method: "ping" });
  ok(p2.status === 200, "новый токен доступа работает");
  // 8. «Отключить» в профиле
  const conns = await req("GET", "/api/knigi/admin/mcp", { token: D.admin });
  const mine = conns.data.connections.find((x) => x.service === svc.brand);
  ok(conns.status === 200 && mine && mine.last_used && conns.data.log.some((l) => l.tool === "read_book" && l.book), `профиль: подключение «${svc.brand}» и журнал с книгой`, conns.data.connections);
  const rr = await req("GET", "/api/knigi/admin/mcp", { token: D.reader });
  ok(rr.status === 403, "читатель раздел «Подключение к ИИ» не получает");
  const del = await req("DELETE", `/api/knigi/admin/mcp/${mine.id}`, { token: D.admin });
  ok(del.status === 200, "«Отключить»");
  const after = await mcp(access, { jsonrpc: "2.0", id: 8, method: "ping" });
  ok(after.status === 401 && /invalid_token/.test(after.headers.get("www-authenticate") || ""), "после «Отключить» токен доступа не работает (401 invalid_token)");
  const ref2 = await req("POST", "/oauth/token", clientAuth({ grant_type: "refresh_token", refresh_token: ref.data.refresh_token }));
  ok(ref2.status === 400 && ref2.data.error === "invalid_grant", "после «Отключить» токен обновления: invalid_grant");
  return client;
}

/* ---------- Отказы ---------- */
async function negatives(D) {
  section("Отказы");
  const cb = "https://claude.ai/api/mcp/auth_callback";
  for (const [uri, what] of [["https://evil.example.com/cb", "чужой сайт"], ["http://claude.ai/api/mcp/auth_callback", "http://"], ["https://claude.ai.evil.com/cb", "поддельный поддомен"], ["https://user@claude.ai/cb", "логин в адресе"]]) {
    const r = await req("POST", "/oauth/register", { json: { redirect_uris: [uri], token_endpoint_auth_method: "none" } });
    ok(r.status === 400 && r.data.error === "invalid_redirect_uri", `регистрация с адресом возврата (${what}) отклонена`, r.text);
  }
  if (LOG && existsSync(LOG)) {
    await new Promise((res) => setTimeout(res, 300));
    const log = readFileSync(LOG, "utf8");
    ok(log.includes("Отклонён адрес возврата: https://evil.example.com/cb") && log.includes("Отклонён адрес возврата: http://claude.ai/"), "отклонённые адреса записаны в журнал службы");
  }
  const reg = await req("POST", "/oauth/register", { json: { redirect_uris: [cb], token_endpoint_auth_method: "none" } });
  const cid = reg.data.client_id;
  const pk = pkce();
  const base = { response_type: "code", client_id: cid, redirect_uri: cb, state: "x", code_challenge: pk.challenge, code_challenge_method: "S256" };
  let r = await req("GET", "/oauth/authorize?" + new URLSearchParams({ ...base, code_challenge: "", code_challenge_method: "" }));
  ok(r.status === 302 && /error=invalid_request/.test(r.headers.get("location") || ""), "без PKCE: отказ (возврат с invalid_request)", r.headers.get("location"));
  r = await req("GET", "/oauth/authorize?" + new URLSearchParams({ ...base, code_challenge_method: "plain" }));
  ok(r.status === 302 && /error=invalid_request/.test(r.headers.get("location") || ""), "PKCE plain: отказ");
  r = await req("GET", "/oauth/authorize?" + new URLSearchParams({ ...base, redirect_uri: "https://claude.ai/other" }));
  ok(r.status === 400 && !r.headers.get("location"), "адрес возврата не из регистрации: ошибка на странице, без перенаправления");
  r = await req("GET", "/oauth/authorize?" + new URLSearchParams({ ...base, client_id: "kn_unknown" }));
  ok(r.status === 400, "неизвестный клиент: ошибка на странице");
  // читатель
  const lr = await req("POST", "/oauth/login", { json: { email: READER.email, password: READER.password } });
  const me = await req("GET", "/oauth/me", { token: lr.data.token });
  ok(me.data.admin === false, "страница видит, что вошёл читатель");
  const dr = await req("POST", "/oauth/authorize", { token: lr.data.token, json: { ...base, allow: true } });
  ok(dr.status === 403 && !(dr.data && dr.data.redirect) && /только администратору/.test(dr.data.message), "читатель не получает код авторизации", dr.text);
  const deny = await req("POST", "/oauth/authorize", { token: lr.data.token, json: { ...base, allow: false } });
  ok(deny.data && /error=access_denied/.test(deny.data.redirect), "«Отказать»: возврат с access_denied");
  const anon = await req("POST", "/oauth/authorize", { json: { ...base, allow: true } });
  ok(anon.status === 401, "без входа код не выдаётся");
  // вход: неверный пароль и ограничение частоты
  let last = null;
  for (let i = 0; i < 11; i++) last = await req("POST", "/oauth/login", { json: { email: "nobody-" + i + "@example.com", password: "wrong" } });
  ok(last.status === 429, "11-я попытка входа подряд с одного адреса: 429", last.text);
  // неверный секрет у клиента client_secret_post и токен обновления чужого клиента
  const regP = await req("POST", "/oauth/register", { json: { redirect_uris: ["https://www.perplexity.ai/rest/connections/oauth_callback"], token_endpoint_auth_method: "client_secret_post" } });
  const wr = await req("POST", "/oauth/token", { form: { grant_type: "authorization_code", code: "knc_x", client_id: regP.data.client_id, client_secret: "nope", code_verifier: pk.verifier } });
  ok(wr.status === 401 && wr.data.error === "invalid_client", "неверный секрет клиента на обмене кода: invalid_client");
  const nt = await req("POST", "/mcp", { json: { jsonrpc: "2.0", id: 1, method: "ping" }, token: "Bearer kna_fake" });
  ok(nt.status === 401 && /invalid_token/.test(nt.headers.get("www-authenticate") || ""), "выдуманный токен: 401 invalid_token");
  const pbTok = await req("POST", "/mcp", { json: { jsonrpc: "2.0", id: 1, method: "ping" }, token: "Bearer " + D.admin });
  ok(pbTok.status === 401, "ключ входа приложения вместо токена MCP не принимается");
  const evil = await req("POST", "/mcp", { json: { jsonrpc: "2.0", id: 1, method: "ping" }, headers: { Origin: "https://evil.example.com" } });
  ok(evil.status === 403, "запрос с чужого сайта (Origin): 403");
}

/* ---------- Запуск ---------- */
const mode = process.argv[2] || "";
(async () => {
  if (mode === "--expect-ip-block") {
    section("MCP_IP_ALLOW");
    const r = await req("POST", "/mcp", { json: { jsonrpc: "2.0", id: 1, method: "ping" } });
    ok(r.status === 403, "адрес не из MCP_IP_ALLOW: 403", r.text);
  } else if (mode === "--expect-disabled") {
    section("MCP_ENABLED=0");
    const r = await req("POST", "/mcp", { json: { jsonrpc: "2.0", id: 1, method: "ping" } });
    ok(r.status === 503, "/mcp выключен: 503", r.text);
    const t = await req("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: "x" } });
    ok(t.status === 503 && t.data.error === "temporarily_unavailable", "токены не выдаются: 503");
    const a = await req("GET", "/oauth/authorize?client_id=x");
    ok(a.status === 400 && /выключено/.test(a.text), "страница входа говорит, что подключение выключено");
  } else {
    const D = await setup();
    const SVC = [
      { name: "Claude", brand: "Claude", label: "Claude (claude.ai)", method: "none", redirect: "https://claude.ai/api/mcp/auth_callback" },
      { name: "ChatGPT", brand: "ChatGPT", label: "ChatGPT (chatgpt.com)", method: "client_secret_basic", redirect: "https://chatgpt.com/connector_platform_oauth_redirect" },
      { name: "Perplexity", brand: "Perplexity", label: "Perplexity (perplexity.ai)", method: "client_secret_post", redirect: "https://www.perplexity.ai/rest/connections/oauth_callback" },
    ];
    for (const s of SVC) await flow(s, D);
    await negatives(D);
  }
  console.log(`\nИтого: ${oks} проверок прошли, ${fails} с ошибкой.`);
  process.exit(fails ? 1 : 0);
})().catch((err) => { console.log("\nПроверка остановилась: " + (err && err.stack || err)); process.exit(2); });
