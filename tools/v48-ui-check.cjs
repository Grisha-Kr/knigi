#!/usr/bin/env node
// Проверка правок 4.8 в браузере (Playwright с Chromium; если его нет, access-check.sh этот шаг пропускает).
// Запускается из tools/access-check.sh после tools/access-check.mjs на том же сервере (пользователи и книга
// «Большая книга» уже есть). Настройки: KN_BASE, KN_DATA (папка pb_data: ключ подписи для устаревших ссылок),
// KN_SHOTS (папка для снимков; без неё снимки не делаются).
//
// Что проверяет на ширине 390 (телефон, касания) и 1280:
// - PDF на 30 страниц читается дольше 15 минут: ссылки, выданные раньше, сервер отклоняет как устаревшие (подменяем
//   ключ в адресе на просроченный, подписанный тем же ключом), часы приложения уходят на 16 минут вперёд, вкладка
//   уходит в фон и возвращается; листание, переход к странице 20 по оглавлению и обратно идут без ошибок;
// - EPUB так же: оглавление, листание, закрыть и открыть снова;
// - адрес файла PDF, EPUB и главы аудио, открытый в новой вкладке, даёт отказ, скачивания нет;
// - аудио играет в приложении (запросы Sec-Fetch-Dest: audio);
// - журнал: строки «скачано больше, чем прочитано» и фильтр «Только подозрительные» (администратор);
// - «Убрать формат»: окно с числами цитат, мыслей и людей, кнопка только после галочки; без цитат окно обычное.
const { chromium } = require("playwright");
const { readFileSync, mkdirSync } = require("fs");
const { createHmac } = require("crypto");
const { join } = require("path");
const BASE = (process.env.KN_BASE || "http://127.0.0.1:8093").replace(/\/+$/, "");
const DATA = process.env.KN_DATA || "";
const SHOTS = process.env.KN_SHOTS || "";
let fails = 0, oks = 0;
const ok = (c, what, extra) => { if (c) { oks++; console.log("  ОК      " + what); } else { fails++; console.log("  ОШИБКА  " + what + (extra !== undefined ? "\n          " + JSON.stringify(extra).slice(0, 500) : "")); } };
const section = (t) => console.log("\n" + t);
async function req(method, path, token, json) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) }, body: json ? JSON.stringify(json) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const login = async (email, password) => (await req("POST", "/api/collections/users/auth-with-password", null, { identity: email, password })).data.token;
const uid = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url")).id;
const flt = (s) => "filter=" + encodeURIComponent(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// PDF на 30 страниц: на каждой своя картинка из шума (около 400 КБ) и номер; оглавление из трёх глав
function makePdf30() {
  const N = 30, W = 700, H = 600;
  const parts = [], offs = []; let size = 0;
  const push = (b) => { parts.push(b); size += b.length; };
  const obj = (n, head, stream) => { offs[n] = size; push(Buffer.from(`${n} 0 obj\n${head}\n`, "latin1")); if (stream) { push(Buffer.from("stream\n", "latin1")); push(stream); push(Buffer.from("\nendstream\n", "latin1")); } push(Buffer.from("endobj\n", "latin1")); };
  push(Buffer.from("%PDF-1.4\n", "latin1"));
  const page = (i) => 10 + i * 3; // страница, её содержимое, её картинка
  obj(1, "<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R /PageMode /UseOutlines >>");
  obj(2, `<< /Type /Pages /Kids [${Array.from({ length: N }, (_, i) => page(i) + " 0 R").join(" ")}] /Count ${N} >>`);
  obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  obj(4, "<< /Type /Outlines /First 5 0 R /Last 7 0 R /Count 3 >>");
  obj(5, `<< /Title (Chapter 1) /Parent 4 0 R /Next 6 0 R /Dest [${page(0)} 0 R /Fit] >>`);
  obj(6, `<< /Title (Chapter 2) /Parent 4 0 R /Prev 5 0 R /Next 7 0 R /Dest [${page(19)} 0 R /Fit] >>`);
  obj(7, `<< /Title (Chapter 3) /Parent 4 0 R /Prev 6 0 R /Dest [${page(27)} 0 R /Fit] >>`);
  let seed = 12345;
  for (let i = 0; i < N; i++) {
    const img = Buffer.alloc(W * H); for (let k = 0; k < img.length; k++) { seed = (seed * 1103515245 + 12345) >>> 0; img[k] = seed >>> 24; }
    const c = Buffer.from(`BT /F1 28 Tf 72 720 Td (Page ${i + 1}) Tj ET q 450 0 0 380 80 200 cm /Im 0 Do Q`.replace("/Im 0", "/Im" + i), "latin1");
    obj(page(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Im${i} ${page(i) + 2} 0 R >> >> /Contents ${page(i) + 1} 0 R >>`);
    obj(page(i) + 1, `<< /Length ${c.length} >>`, c);
    obj(page(i) + 2, `<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${img.length} >>`, img);
  }
  const max = page(N - 1) + 2, xref = size;
  let t = `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= max; n++) t += (offs[n] !== undefined ? String(offs[n]).padStart(10, "0") + " 00000 n \n" : "0000000000 65535 f \n");
  t += `trailer\n<< /Size ${max + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  push(Buffer.from(t, "latin1"));
  return Buffer.concat(parts);
}
// EPUB с пятью главами
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function makeZip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, data] of files) {
    const nb = Buffer.from(name), d = Buffer.from(data), crc = crc32(d);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt32LE(crc, 14); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(nb.length, 26);
    parts.push(h, nb, d);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt32LE(crc, 16); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, nb); off += 30 + nb.length + d.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
function makeEpub5() {
  const chs = [1, 2, 3, 4, 5];
  const ch = (i) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Глава ${i}</title></head><body><h1>Глава ${i}</h1>${`<p>Глава ${i}. Терпение и молитва идут рядом, и каждый день приносит своё.</p>`.repeat(60)}</body></html>`;
  return makeZip([
    ["mimetype", "application/epub+zip"],
    ["META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ["OEBPS/content.opf", `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">kn48-${Date.now()}</dc:identifier><dc:title>Долгое чтение</dc:title><dc:creator>Иван Проверкин</dc:creator><dc:language>ru</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chs.map((i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${chs.map((i) => `<itemref idref="c${i}"/>`).join("")}</spine></package>`],
    ["OEBPS/nav.xhtml", `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${chs.map((i) => `<li><a href="c${i}.xhtml">Глава ${i}</a></li>`).join("")}</ol></nav></body></html>`],
    ...chs.map((i) => [`OEBPS/c${i}.xhtml`, ch(i)]),
  ]);
}
async function upload(token, json, buf) {
  let r = await req("POST", "/api/knigi/upload/start", token, { size: buf.length, ...json });
  if (r.status !== 200) throw new Error("upload/start: " + JSON.stringify(r.data));
  const up = r.data.upload;
  for (let i = 0; i < r.data.chunks; i++) {
    const fd = new FormData(); fd.append("chunk", new Blob([buf.subarray(i * r.data.chunk, (i + 1) * r.data.chunk)]), "chunk");
    const c = await fetch(`${BASE}/api/knigi/upload/${up}/${i}`, { method: "POST", headers: { Authorization: token }, body: fd });
    if (c.status !== 200) throw new Error("upload chunk " + c.status);
  }
  r = await req("POST", `/api/knigi/upload/${up}/finish`, token, {});
  await req("POST", "/api/knigi/process", token, {});
  return r.data;
}
async function waitReady(admin, id) {
  for (let i = 0; i < 120; i++) {
    const b = await req("GET", `/api/collections/books/records/${id}`, admin);
    if (b.data && b.data.status && b.data.status !== "processing") return b.data;
    await sleep(500);
  }
  throw new Error("книга не обработалась");
}
// Просроченный ключ ссылки, подписанный ключом сервера
function expiredT(t) {
  const key = readFileSync(join(DATA, "files.key"), "utf8");
  const p = JSON.parse(Buffer.from(t.split(".")[1], "base64url"));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" }), body = b64({ k: p.k, i: p.i, u: p.u, exp: Math.floor(Date.now() / 1000) - 60 });
  return `${head}.${body}.${createHmac("sha256", key).update(head + "." + body).digest("base64url")}`;
}

async function ctxFor(browser, width, email, password) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, hasTouch: width < 600, isMobile: width < 600, deviceScaleFactor: SHOTS ? 2 : 1, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("          ошибка на странице: " + e.message));
  await page.goto(BASE + "/");
  await page.waitForSelector("#auth input");
  const inputs = await page.$$("#auth input");
  await inputs[0].fill(email); await inputs[1].fill(password);
  await page.click("#auth button[type=submit]");
  await page.waitForSelector(".block, .head", { timeout: 15000 });
  return { ctx, page };
}
const shot = async (page, name, full) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, name + ".png"), fullPage: !!full }); } };
// Сдвинуть часы приложения вперёд (ссылка «состарилась» и для самого приложения) и сделать вид, что вкладка
// ушла в фон и вернулась, как на iPhone
async function timeTravel(page, minutes) {
  await page.evaluate((ms) => {
    const real = window.__realNow || (window.__realNow = Date.now.bind(Date));
    window.__shift = (window.__shift || 0) + ms;
    Date.now = () => real() + window.__shift;
    const set = (v) => Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
    set("hidden"); document.dispatchEvent(new Event("visibilitychange"));
    set("visible"); document.dispatchEvent(new Event("visibilitychange"));
  }, minutes * 60e3);
}

async function readerRun(browser, width, T, ids) {
  const { page, ctx } = await ctxFor(browser, width, "boris@example.com", "proverka-boris-12345");
  const seen = new Set(), net = [], links = [];
  let dead = new Set();
  // «прошло 15 минут»: ключи из dead сервер получает просроченными (подписаны его ключом, срок прошёл)
  await ctx.route("**/api/knigi/f/book/**", (route) => {
    const u = new URL(route.request().url()), t = u.searchParams.get("t");
    if (dead.has(t)) { u.searchParams.set("t", expiredT(t)); return route.continue({ url: u.toString() }); }
    seen.add(t); return route.continue();
  });
  const expireAll = () => { dead = new Set(seen); };
  page.on("response", async (r) => {
    const u = r.url();
    if (u.includes("/api/knigi/f/book/")) { const it = { st: r.status(), dest: "?", range: "" }; net.push(it); const h = await r.request().allHeaders().catch(() => ({})); it.dest = h["sec-fetch-dest"] || ""; it.range = h.range || ""; }
    if (/\/api\/knigi\/books\/[^/]+\/link/.test(u)) links.push(r.status());
  });
  const num = () => page.$eval("#rd-num", (e) => e.textContent.trim()).catch(() => "");
  const msg = () => page.$eval("#rd-msg", (e) => (e.hidden ? "" : e.textContent.trim())).catch(() => "");
  const tag = width < 600 ? "390" : "1280";
  // каждый проход начинает книги с начала
  await req("POST", `/api/knigi/books/${ids.pdfBook}/progress`, T.boris, { format: "pdf", page: 1, pages: 30 });
  await req("POST", `/api/knigi/books/${ids.epBook}/progress`, T.boris, { format: "epub", pct: 0, pos: "" });

  section(`Браузер ${tag}. PDF читается дольше 15 минут`);
  await page.goto(`${BASE}/#/read/${ids.pdfBook}?f=pdf`);
  await page.waitForFunction(() => /^1 из 30$/.test((document.querySelector("#rd-num") || {}).textContent || ""), null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  ok(net.length > 0 && net.every((x) => x.st === 206 && /^bytes=\d+-\d+$/.test(x.range)), "читалка получает куски (206): сервер не принял её запросы за открытие страницы", net.slice(0, 4));
  for (let i = 0; i < 2; i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(700); }
  ok((await num()) === "3 из 30", "листание до 3-й страницы", await num());
  // прошло 16 минут: старые ключи устарели, часы приложения ушли вперёд, вкладка побывала в фоне
  expireAll(); const before401 = net.length, linksBefore = links.length;
  await timeTravel(page, 16);
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(1500);
  ok((await num()) === "5 из 30" && !(await msg()), "через 16 минут листание продолжается без сообщений", [await num(), await msg()]);
  ok(links.length > linksBefore, "читалка сама заранее взяла новую ссылку (по своим часам)", links.length - linksBefore);
  // переход по оглавлению к главе 2 (страница 20) и к главе 3 (28)
  await page.click("#rd-toc");
  await page.waitForSelector(".toc-row");
  await page.click('.toc-row:has-text("Chapter 2")');
  await page.waitForFunction(() => /^20 из 30$/.test((document.querySelector("#rd-num") || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  ok((await num()) === "20 из 30" && !(await msg()), "переход по оглавлению к главе 2 (с. 20)", [await num(), await msg()]);
  // сервер считает устаревшей и ту ссылку, что сейчас у читалки, а по её часам ссылка ещё свежая: ответ 401
  const n401Before = net.filter((x) => x.st === 401).length;
  expireAll();
  await page.click("#rd-toc"); await page.waitForSelector(".toc-row");
  await page.click('.toc-row:has-text("Chapter 3")');
  await page.waitForFunction(() => /^28 из 30$/.test((document.querySelector("#rd-num") || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const n401 = net.filter((x) => x.st === 401).length - n401Before;
  ok((await num()) === "28 из 30" && !(await msg()), "сервер ответил 401 на устаревшую ссылку, читалка повторила с новой: глава 3 (с. 28)", [await num(), await msg(), "401:", n401]);
  ok(n401 >= 1, "ответ 401 действительно был", n401);
  const bad = net.slice(before401).filter((x) => x.st !== 206 && x.st !== 401);
  ok(!bad.length, "других ошибок при чтении нет", bad);
  await shot(page, `pdf-${tag}-after-16min`);

  // адрес куска PDF в новой вкладке: отказ, не файл
  const pdfUrl = (await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.includes("/f/book/")))).pop();
  dead = new Set();
  {
    const p2 = await ctx.newPage(); let dl = null; p2.on("download", (d) => { dl = d; });
    const r = await p2.goto(pdfUrl).catch((e) => ({ status: () => 0, err: e }));
    await p2.waitForTimeout(800);
    ok(r.status() === 403 && !dl && /только в читалке/.test(await p2.content()), "PDF: адрес куска в новой вкладке → 403 «Книга открывается только в читалке приложения»", r.status());
    if (width < 600) await shot(p2, `pdf-${tag}-new-tab`);
    await p2.close();
  }

  section(`Браузер ${tag}. EPUB читается дольше 15 минут`);
  const epNet = net.length;
  await page.goto(`${BASE}/#/b/${ids.pdfBook}`); await page.waitForTimeout(500);
  await page.goto(`${BASE}/#/read/${ids.epBook}?f=epub`);
  await page.waitForFunction(() => /Глава/.test((document.querySelector("#rd-num") || {}).textContent || ""), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  ok(net.slice(epNet).some((x) => x.st === 200), "EPUB получен читалкой (200)", net.slice(epNet));
  expireAll();
  await timeTravel(page, 16);
  await page.click("#rd-toc");
  await page.waitForSelector(".toc-row", { timeout: 5000 });
  await page.click('.toc-row:has-text("Глава 4")');
  await page.waitForTimeout(1500);
  const epPos = await num();
  ok(/Глава 4/.test(epPos) && !(await msg()), "через 16 минут переход по оглавлению к главе 4", [epPos, await msg()]);
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(1200);
  ok(!(await msg()), "листание без сообщений", await num());
  await shot(page, `epub-${tag}-after-16min`);
  const epUrl = (await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.includes("/f/book/")))).pop();
  // закрыть и открыть снова: новая ссылка
  const lb = links.length;
  await page.click('[data-rd="close"]').catch(() => {});
  await page.waitForTimeout(800);
  await page.goto(`${BASE}/#/read/${ids.epBook}?f=epub`);
  await page.waitForFunction(() => /Глава/.test((document.querySelector("#rd-num") || {}).textContent || ""), null, { timeout: 20000 }).catch(() => {});
  ok(/Глава/.test(await num()) && !(await msg()), "EPUB закрыли и открыли снова: читается", [await num(), await msg(), links.length - lb]);
  dead = new Set();
  {
    const p2 = await ctx.newPage(); let dl = null; p2.on("download", (d) => { dl = d; });
    const r = await p2.goto(epUrl).catch(() => null);
    await p2.waitForTimeout(800);
    ok(r && r.status() === 403 && !dl, "EPUB: адрес в новой вкладке → 403, скачивания нет (раньше браузер скачивал книгу)", r && r.status());
    await p2.close();
  }

  section(`Браузер ${tag}. Аудио`);
  const au = [];
  page.on("response", async (r) => { if (r.url().includes("/api/knigi/f/audio/")) { const it = { st: r.status(), dest: "?" }; au.push(it); const h = await r.request().allHeaders().catch(() => ({})); it.dest = h["sec-fetch-dest"] || ""; } });
  await page.goto(`${BASE}/#/b/${ids.pdfBook}`);
  await page.waitForSelector(".listen-btn", { timeout: 10000 });
  await page.click(".listen-btn");
  await page.waitForTimeout(3000);
  const st = await page.evaluate(() => { const a = document.querySelector("audio"); return a && { t: a.currentTime, paused: a.paused, err: a.error && a.error.code, src: a.currentSrc }; });
  ok(st && st.t > 0.5 && !st.paused && !st.err, "глава играет в приложении", st);
  ok(au.length && au.every((x) => x.st === 200 || x.st === 206), "запросы главы проходят", au);
  const alog = (await req("GET", `/api/knigi/admin/audio-log`, T.admin)).data.rows || [];
  ok(alog.some((x) => x.user === "Борис" && /^(audio|video)$/.test(x.dest) && !x.note), "сервер видел их как Sec-Fetch-Dest: audio или video", alog.slice(0, 3).map((x) => [x.dest, x.mode, x.note]));
  await shot(page, `audio-${tag}`);
  {
    const p2 = await ctx.newPage(); let dl = null; p2.on("download", (d) => { dl = d; });
    const r = await p2.goto(st.src).catch(() => null);
    await p2.waitForTimeout(800);
    ok(r && r.status() === 403 && !dl && /плеере приложения/.test(await p2.content()), "аудио: адрес главы в новой вкладке → 403", r && r.status());
    await p2.close();
  }
  await page.evaluate(() => { const a = document.querySelector("audio"); if (a) a.pause(); });
  await ctx.close();
}

async function adminRun(browser, width, T, ids) {
  const { page, ctx } = await ctxFor(browser, width, "admin@example.com", "proverka-admin-12345");
  const tag = width < 600 ? "390" : "1280";
  section(`Браузер ${tag}. Журнал: «скачано больше, чем прочитано»`);
  await page.goto(`${BASE}/#/log`);
  await page.waitForSelector(".log-row", { timeout: 15000 });
  const nAll = await page.$$eval(".log-row", (x) => x.length), nSus = await page.$$eval(".log-row.sus", (x) => x.length);
  ok(nSus >= 1 && nAll > nSus, "выделены подозрительные часы", [nSus, nAll]);
  const txts = await page.$$eval(".log-row.sus", (x) => x.map((e) => e.textContent.replace(/\s+/g, " ")));
  ok(txts.every((t) => /скачано больше, чем прочитано/.test(t)) && txts.some((t) => /PDF: файл .+ получен целиком \(отдано .+\), просмотрено 0 из 5 стр\./.test(t)) && txts.some((t) => /EPUB: файл .+ отдан целиком 3 раза за час/.test(t)),
    "в строках пометка и пояснение (PDF: доля и страницы; EPUB: сколько раз целиком)", txts.map((t) => t.slice(0, 160)));
  ok(/Только подозрительные \(\d+\)/.test(await page.$eval(".log-sus-chip", (e) => e.textContent)), "фильтр с числом");
  await shot(page, `log-${tag}`);
  await page.check("#log-sus"); await page.waitForTimeout(300);
  const after = await page.$$eval(".log-row", (x) => x.map((e) => e.classList.contains("sus")));
  ok(after.length === nSus && after.every(Boolean), "«Только подозрительные»: остались только они", [after.length, nSus]);
  await shot(page, `log-${tag}-filter`, true);
  await page.uncheck("#log-sus"); await page.waitForTimeout(300);
  ok((await page.$$eval(".log-row", (x) => x.length)) === nAll, "галочку сняли: снова все строки");

  section(`Браузер ${tag}. «Убрать формат»`);
  // EPUB к «Долгому чтению» (PDF) с цитатами: у Анны 2 (одна с мыслью), у Бориса 1 с мыслью
  const hasEp = async () => (await req("GET", `/api/collections/book_files/records?${flt(`book = '${ids.pdfBook}' && format = 'epub'`)}`, T.admin)).data.items.length;
  if (!(await hasEp())) { await upload(T.admin, { name: "Проверкин - Долгое чтение.epub", kind: "book", book: ids.pdfBook }, makeEpub5()); await waitReady(T.admin, ids.pdfBook); }
  const hl = (t, body, n) => req("POST", "/api/collections/notes/records", t, { owner: uid(t), kind: "highlight", book: ids.pdfBook, format: "epub", quote: "цитата " + n, color: "green", body: body ? `<p>${body}</p>` : "", anchor: { v: 1, cfi: "epubcfi(/6/2!/4/2/1:0)", pct: 0, chapter: "Глава 1" } });
  const annaHl = (await req("GET", `/api/collections/notes/records?${flt(`book = '${ids.pdfBook}' && kind = 'highlight' && format = 'epub'`)}`, T.anna)).data.items.length;
  if (!annaHl) { await hl(T.anna, "мысль", 1); await hl(T.anna, "", 2); await hl(T.boris, "мысль Бориса", 3); }
  await page.goto(`${BASE}/#/b/${ids.pdfBook}`);
  await page.waitForSelector('[data-act="book-menu"]', { timeout: 10000 });
  const openRemove = async () => {
    await page.click('[data-act="book-menu"]');
    await page.click('.menu button:has-text("Убрать формат")');
    await page.waitForSelector('[data-dlg="fmt"]');
    await page.click('[data-dlg="fmt"]:has-text("EPUB")');
    await page.waitForFunction(() => { const h = document.querySelector("#dlg h2"); return h && /EPUB/.test(h.textContent) && !/Какой/.test(document.querySelector("#dlg").textContent.slice(0, 80)); }, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
  };
  await openRemove();
  const title = await page.$eval("#dlg h2", (e) => e.textContent);
  const sum = await page.$eval(".rmf-sum", (e) => e.textContent.replace(/\s+/g, " ")).catch(() => "");
  const who = await page.$eval(".rmf-who", (e) => e.textContent.replace(/\s+/g, " ")).catch(() => "");
  ok(title === "Удалятся цитаты в EPUB", "отдельное окно «Удалятся цитаты в EPUB»", title);
  ok(/3 цитаты/.test(sum) && /с мыслями 2/.test(sum) && /у 2 человек/.test(sum), "числа: 3 цитаты, с мыслями 2, у 2 человек", sum);
  ok(/Анна: 2 цитаты, с мыслями 1/.test(who) && /Борис: 1 цитата, с мыслями 1/.test(who), "по людям: Анна 2 (мысль 1), Борис 1 (мысль 1)", who);
  ok(await page.$eval("#dlg-ok", (e) => e.disabled && /Удалить вместе с цитатами/.test(e.textContent)), "кнопка «Удалить вместе с цитатами» выключена без галочки");
  await shot(page, `remove-format-${tag}`);
  await page.check("#rmf-ok");
  ok(await page.$eval("#dlg-ok", (e) => !e.disabled), "после галочки кнопка включилась");
  await shot(page, `remove-format-${tag}-checked`);
  if (width < 600) {
    await page.click('#dlg [data-close]'); // на телефоне только смотрим и закрываем
    await page.waitForTimeout(300);
    ok((await req("GET", `/api/collections/book_files/records?${flt(`book = '${ids.pdfBook}' && format = 'epub'`)}`, T.admin)).data.items.length === 1, "«Отмена»: формат на месте");
  } else {
    await page.click("#dlg-ok");
    await page.waitForFunction(() => !document.querySelector("#dlg").open, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(800);
    const left = (await req("GET", `/api/collections/book_files/records?${flt(`book = '${ids.pdfBook}' && format = 'epub'`)}`, T.admin)).data.items.length;
    const annaLeft = (await req("GET", `/api/collections/notes/records?${flt(`book = '${ids.pdfBook}' && kind = 'highlight'`)}`, T.anna)).data.items.length;
    ok(left === 0 && annaLeft === 0, "после подтверждения формат и цитаты удалены", [left, annaLeft]);
    // без цитат: обычное окно
    await upload(T.admin, { name: "Проверкин - Долгое чтение.epub", kind: "book", book: ids.pdfBook }, makeEpub5());
    await waitReady(T.admin, ids.pdfBook);
    await page.waitForTimeout(1500);
    await openRemove();
    const t2 = await page.$eval("#dlg h2", (e) => e.textContent);
    ok(t2 === "Убрать EPUB?" && !(await page.$("#rmf-ok")) && (await page.$eval("#dlg-ok", (e) => !e.disabled)), "цитат нет: обычное окно «Убрать EPUB?» без галочки", t2);
    ok(/Цитат в этом формате нет/.test(await page.$eval("#dlg .dlg-text", (e) => e.textContent)), "в тексте: цитат нет");
    await shot(page, `remove-format-${tag}-empty`);
    await page.click("#dlg-ok"); await page.waitForTimeout(800);
  }
  await ctx.close();
}

(async () => {
  if (!DATA) { console.log("Нужна настройка KN_DATA (папка pb_data)."); process.exit(2); }
  const T = { admin: await login("admin@example.com", "proverka-admin-12345"), anna: await login("anna@example.com", "proverka-anna-12345"), boris: await login("boris@example.com", "proverka-boris-12345") };
  section("Браузер. Подготовка: PDF на 30 страниц с оглавлением, EPUB на 5 глав, глава аудио");
  const p = await upload(T.admin, { name: "Проверкин - Долгое чтение.pdf", kind: "book" }, makePdf30());
  const pb = await waitReady(T.admin, p.id);
  await req("POST", `/api/knigi/books/${p.id}/visibility`, T.admin, { hidden: false });
  const e = await upload(T.admin, { name: "Проверкин - Долгое чтение EPUB.epub", kind: "book" }, makeEpub5());
  await waitReady(T.admin, e.id);
  await req("POST", `/api/knigi/books/${e.id}/visibility`, T.admin, { hidden: false });
  // глава аудио: тишина MP3 2 минуты
  const len = Math.floor(144 * 64000 / 44100), n = Math.ceil(120 * 44100 / 1152), f = Buffer.alloc(len); f[0] = 0xff; f[1] = 0xfb; f[2] = 5 << 4; f[3] = 0xc0;
  const a = await upload(T.admin, { name: "глава.mp3", kind: "audio", book: p.id, title: "Глава 1" }, Buffer.concat(Array(n).fill(f)));
  await req("POST", `/api/knigi/audio/${a.track}`, T.admin, { published: true });
  ok(pb.pages === 30 && pb.formats.includes("pdf"), "PDF на 30 страниц готов", [pb.pages, pb.file_size]);
  const ids = { pdfBook: p.id, epBook: e.id };
  const browser = await chromium.launch();
  try {
    for (const w of [390, 1280]) { await readerRun(browser, w, T, ids); await adminRun(browser, w, T, ids); }
  } finally { await browser.close(); }
  console.log(`\nПроверок в браузере: ${oks + fails}, прошло ${oks}, ошибок ${fails}.`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("Сбой проверки в браузере:", e); process.exit(1); });
