// Проверка правок 4.7 в браузере (Playwright с Chromium): главная развёрнутая и свёрнутая (плашки с числами),
// ссылки в заголовках, крестик у «Продолжить слушание», возврат блока после нового включения аудио,
// закрытие во время игры (звук идёт, мини-плеер на месте, блок сам не возвращается), перезагрузка,
// второе окно того же пользователя, сохранение без сети, читатель без доступа.
// Запускается из tools/home-check.sh после home-check.mjs (тот же сервер, его пользователи и книга X).
// Настройки: KN_BASE, KN_SU, KN_SHOTS (папка для снимков; без неё снимки не делаются).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = (process.env.KN_BASE || "http://127.0.0.1:8093").replace(/\/+$/, "");
const [SU_EMAIL, SU_PASS] = (process.env.KN_SU || "su@example.com:proverka-su-12345").split(":");
const SHOTS = process.env.KN_SHOTS || "";
const ADMIN = { email: "admin@example.com", password: "proverka-admin-12345" };
const ANNA = { email: "anna@example.com", password: "proverka-anna-12345" };
const BORIS = { email: "boris@example.com", password: "proverka-boris-12345" };
const TOAST = "Блок скрыт. Вернётся, когда снова включите аудио";
let fails = 0, oks = 0;
const ok = (cond, what, extra) => {
  if (cond) { oks++; console.log("  ОК      " + what); }
  else { fails++; console.log("  ОШИБКА  " + what + (extra !== undefined ? "\n          " + String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 600) : "")); }
  return cond;
};
async function req(method, p, { json, token } = {}) {
  const h = {};
  if (json) h["Content-Type"] = "application/json";
  if (token) h.Authorization = token;
  const r = await fetch(BASE + p, { method, headers: h, body: json ? JSON.stringify(json) : undefined });
  let data = null; try { data = await r.json(); } catch (_) {}
  return { status: r.status, data };
}
const login = async (u) => (await req("POST", "/api/collections/users/auth-with-password", { json: { identity: u.email, password: u.password } })).data.token;
const uid = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url")).id;
const flt = (s) => "filter=" + encodeURIComponent(s);
const stamp = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// MP3 с тишиной: кадры MPEG-1 Layer III 64 кбит/с, моно
function makeMp3(seconds) {
  const len = Math.floor(144 * 64000 / 44100), n = Math.ceil(seconds * 44100 / 1152);
  const f = Buffer.alloc(len); f[0] = 0xff; f[1] = 0xfb; f[2] = 5 << 4; f[3] = 0xc0;
  return Buffer.concat(Array(n).fill(f));
}
async function addTrack(admin, book, title, seconds) {
  const buf = makeMp3(seconds);
  let r = await req("POST", "/api/knigi/upload/start", { token: admin, json: { name: title + ".mp3", size: buf.length, kind: "audio", book, title } });
  const fd = new FormData(); fd.append("chunk", new Blob([buf]), "chunk");
  await fetch(`${BASE}/api/knigi/upload/${r.data.upload}/0`, { method: "POST", headers: { Authorization: admin }, body: fd });
  r = await req("POST", `/api/knigi/upload/${r.data.upload}/finish`, { token: admin, json: {} });
  await req("POST", `/api/knigi/audio/${r.data.track}`, { token: admin, json: { published: true } });
  return r.data.track;
}
// full: главная целиком. Окно на время снимка вытягивается по высоте страницы (иначе нижнее меню телефона
// попадает в середину снимка).
async function shot(page, name, full) {
  if (!SHOTS) return;
  await page.waitForTimeout(350);
  const vp = page.viewportSize();
  if (full) {
    const h = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    if (h > vp.height) { await page.setViewportSize({ width: vp.width, height: Math.min(h, 4000) }); await page.waitForTimeout(250); }
  }
  await page.screenshot({ path: path.join(SHOTS, name + ".png") });
  if (full) { await page.setViewportSize(vp); await page.waitForTimeout(150); }
}
async function open(browser, { width, dark, user }) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: SHOTS ? 2 : 1, hasTouch: width < 600, isMobile: width < 600 });
  await ctx.addInitScript((t) => { try { localStorage.setItem("kn_theme", JSON.stringify(t)); } catch (_) {} }, dark ? "dark" : "light");
  const r = await req("POST", "/api/collections/users/auth-with-password", { json: { identity: user.email, password: user.password } });
  // вход подставляется только в пустое хранилище: после перезагрузки страница берёт то, что сохранило само приложение
  await ctx.addInitScript((a) => { try { if (!localStorage.getItem("pocketbase_auth")) localStorage.setItem("pocketbase_auth", JSON.stringify({ token: a.token, record: a.record })); } catch (_) {} }, r.data);
  // кнопки экрана блокировки: запоминаем обработчики, чтобы «нажать» их из проверки
  await ctx.addInitScript(() => {
    window.__ms = {};
    try { const o = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession); navigator.mediaSession.setActionHandler = (k, fn) => { window.__ms[k] = fn; return o(k, fn); }; } catch (_) {}
  });
  const page = await ctx.newPage();
  page.errs = [];
  page.on("pageerror", (e) => page.errs.push(e.message));
  return { ctx, page };
}
// Состояние блоков главной, как его видит человек
const blocks = (page) => page.evaluate(() => [...document.querySelectorAll("#main > section.block")].map((s) => {
  const btn = s.querySelector(".hfold-btn"), n = s.querySelector("h2 .n"), body = s.querySelector(".hfold-body"), ch = s.querySelector(".hfold-arrow .chev");
  const cs = n ? getComputedStyle(n) : null;
  return { key: s.dataset.fold || s.id || "", title: (s.querySelector("h2") ? s.querySelector("h2").childNodes[0].textContent || s.querySelector("h2").textContent : "").trim(),
    text: btn ? btn.childNodes[0].textContent.trim() : (s.querySelector("h2") || {}).textContent, fold: !!btn, folded: s.classList.contains("folded"),
    expanded: btn ? btn.getAttribute("aria-expanded") : null, controls: btn ? btn.getAttribute("aria-controls") : null,
    n: n ? n.textContent.trim() : "", nBg: cs ? cs.backgroundColor : "", nColor: cs ? cs.color : "", nRadius: cs ? cs.borderRadius : "", nW: n ? n.getBoundingClientRect().width : 0, nH: n ? n.getBoundingClientRect().height : 0,
    bodyShown: body ? body.getBoundingClientRect().height > 0 : null, bg: getComputedStyle(s).backgroundColor, w: Math.round(s.getBoundingClientRect().width), itemW: Math.round(((s.querySelector(".cont, .shelf-cards, .grid") || s).getBoundingClientRect()).width), h: Math.round(s.getBoundingClientRect().height), arrow: ch ? getComputedStyle(ch).transform : "",
    link: s.querySelector(".more-link") && s.querySelector(".more-link").getBoundingClientRect().width > 0 ? s.querySelector(".more-link").textContent.trim() : "" };
  }));
const byKey = (list, k) => list.find((x) => x.key === k) || {};
const audio = (page) => page.evaluate(() => { const a = document.querySelector("audio"); return a ? { t: a.currentTime, paused: a.paused, err: a.error && a.error.code, src: (a.getAttribute("src") || "").slice(0, 12) } : null; });
const srv = async (token) => (await req("GET", "/api/knigi/home-ui", { token })).data;
const waitSrv = async (token, test) => { for (let i = 0; i < 40; i++) { const s = await srv(token); if (test(s)) return s; await sleep(150); } return srv(token); };
const lum = (rgb) => { const m = (rgb.match(/[\d.]+/g) || []).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const FOLDS = ["reading", "reviews", "shelves", "mine"];

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const SU = (await req("POST", "/api/collections/_superusers/auth-with-password", { json: { identity: SU_EMAIL, password: SU_PASS } })).data.token;
  const admin = await login(ADMIN), anna = await login(ANNA), boris = await login(BORIS);
  const tv = (await req("GET", "/api/knigi/terms")).data.version;
  await req("POST", "/api/knigi/home-ui", { token: admin, json: { collapsed: [], listen_hidden: false } });
  // Книги: X из home-check.mjs (PDF), две книги с аудио. Общие полки, отзывы Анны, Бориса и администратора.
  const X = (await req("GET", `/api/collections/books/records?${flt("title ~ 'Икс'")}`, { token: admin })).data.items[0].id;
  const mk = async (title, authors) => { const r = await req("POST", "/api/knigi/audio-books", { token: admin, json: { title, authors } }); await req("POST", `/api/knigi/books/${r.data.id}/visibility`, { token: admin, json: { hidden: false } }); return r.data.id; };
  const A1 = await mk("Тихие вечера", "Мария Светлова"), A2 = await mk("Письма о терпении", "Иван Чтецов");
  const t1 = await addTrack(admin, A1, "Глава 1", 30), t2 = await addTrack(admin, A1, "Глава 2", 180);
  await addTrack(admin, A2, "Письмо первое", 60);
  let n = 0;
  for (const [name, books] of [["Богословие", [X, A1]], ["Для семейного чтения", [A2]], ["История церкви", [X]]]) {
    const s = await req("POST", "/api/collections/shelves/records", { token: admin, json: { name, owner: uid(admin), common: true, sort: ++n } });
    let i = 0; for (const b of books) await req("POST", "/api/collections/shelf_books/records", { token: admin, json: { shelf: s.data.id, book: b, sort: ++i } });
  }
  await req("POST", "/api/knigi/reviews", { token: anna, json: { book: X, text: "Читала медленно, по главе в день. Больше всего запомнилась глава о терпении." } });
  await req("POST", "/api/knigi/reviews", { token: boris, json: { book: X, text: "Полезная книга, советую читать вместе с кем-то." } });
  await req("POST", "/api/knigi/reviews", { token: admin, json: { book: A1, text: "Спокойная, тёплая книга. Хорошо слушать вечером." } });
  await req("POST", "/api/knigi/reviews", { token: anna, json: { book: A2, text: "Короткие письма, каждое на одну мысль." } });
  const COMMON = 3;

  const browser = await chromium.launch();
  const runs = [{ width: 390, dark: false, tag: "390-light" }, { width: 390, dark: true, tag: "390-dark" }, { width: 1280, dark: false, tag: "1280-light" }, { width: 1280, dark: true, tag: "1280-dark" }];
  n = 0;
  for (const run of runs) {
    n++;
    console.log(`\nБраузер ${run.tag}`);
    // новая читательница: две книги «Читаю», две свои полки, остановилась на 40-й секунде второй главы
    const R = { name: "Ольга", email: `olga-home${n}-${stamp}@example.com`, password: "proverka-ui-12345" };
    let r = await req("POST", "/api/collections/users/records", { token: SU, json: { ...R, passwordConfirm: R.password, role: "user", theme: "auto" } });
    R.id = r.data.id;
    const rt = await login(R);
    await req("POST", "/api/knigi/terms/accept", { token: rt, json: { version: tv } });
    for (const b of [X, A2]) await req("POST", "/api/collections/marks/records", { token: rt, json: { user: R.id, book: b, status: "reading" } });
    const myShelves = [];
    for (const [i, name] of ["Перечитать", "На лето"].entries()) {
      const s = await req("POST", "/api/collections/shelves/records", { token: rt, json: { name, owner: R.id, common: false, sort: i + 1 } });
      myShelves.push(s.data.id);
      await req("POST", "/api/collections/shelf_books/records", { token: rt, json: { shelf: s.data.id, book: i ? A1 : X, sort: 1 } });
    }
    await req("POST", `/api/knigi/audio/${t1}/progress`, { token: rt, json: { pos: 30, done: true } });
    await req("POST", `/api/knigi/audio/${t2}/progress`, { token: rt, json: { pos: 40 } });

    const { ctx, page } = await open(browser, { ...run, user: R });
    const two = await open(browser, { ...run, user: R }); // второе окно того же пользователя (как другое устройство)
    const page2 = two.page;
    await page.goto(BASE + "/"); await page2.goto(BASE + "/");
    await page.waitForSelector("#main .hfold"); await page2.waitForSelector("#main .hfold");
    await page.waitForSelector("#cont-listen");

    /* ---------- 1. Развёрнутая главная ---------- */
    let bl = await blocks(page);
    ok(bl.map((x) => x.key).join(",") === "reading,cont-listen,reviews,shelves,mine,", "блоки по порядку: чтение, слушание, отзывы, полки, мои полки, недавние", bl.map((x) => x.key + ":" + x.title));
    ok(FOLDS.every((k) => byKey(bl, k).fold && byKey(bl, k).expanded === "true" && !byKey(bl, k).folded && byKey(bl, k).bodyShown), "четыре блока развёрнуты, у заголовков aria-expanded=true");
    ok(FOLDS.every((k) => byKey(bl, k).controls === "fold-" + k), "aria-controls указывает на содержимое блока");
    ok(!byKey(bl, "cont-listen").fold && !bl[bl.length - 1].fold && /Недавно добавленные/.test(bl[bl.length - 1].title), "«Продолжить слушание» и «Недавно добавленные» не сворачиваются");
    ok(byKey(bl, "reading").n === "2" && byKey(bl, "reviews").n === "3" && byKey(bl, "shelves").n === String(COMMON) && byKey(bl, "mine").n === "2", "числа у заголовков: чтение 2, отзывы 3, полки 3, мои полки 2", FOLDS.map((k) => k + "=" + byKey(bl, k).n));
    ok(FOLDS.every((k) => byKey(bl, k).nBg === "rgba(0, 0, 0, 0)" && byKey(bl, k).nH < 20), "в развёрнутом виде число мелкое серое, без кружка", byKey(bl, "reading"));
    ok(FOLDS.every((k) => /matrix\(0, 1, -1, 0/.test(byKey(bl, k).arrow.replace(/6\.123\d*e-17/g, "0"))), "стрелка смотрит вниз", byKey(bl, "reading").arrow);
    ok(byKey(bl, "shelves").link === "Все полки" && byKey(bl, "mine").link === "" && byKey(bl, "reading").text === "Продолжить чтение", "ссылка «Все полки» на месте");
    ok(FOLDS.every((k) => byKey(bl, k).bg === "rgba(0, 0, 0, 0)" && byKey(bl, k).itemW === byKey(bl, k).w) && byKey(bl, "reading").itemW === byKey(bl, "cont-listen").itemW, "развёрнутые блоки выглядят как раньше: без подложки, во всю ширину колонки", bl.map((x) => [x.key, x.bg, x.w, x.itemW]));
    ok(await page.locator("#main .search #q").count() === 1, "поиск на месте");
    await shot(page, `${run.tag}-1-open`, true);

    /* ---------- 2. Ссылка в заголовке работает и блок не сворачивает ---------- */
    await page.click('#main [data-fold="shelves"] .more-link');
    await page.waitForFunction(() => location.hash === "#/shelves");
    await page.goBack();
    await page.waitForSelector('#main [data-fold="shelves"]');
    ok(!(await page.locator('#main [data-fold="shelves"].folded').count()) && (await srv(rt)).collapsed.length === 0, "«Все полки» открывает полки, блок остался развёрнутым");

    /* ---------- 3. Свернуть все четыре: плашки с числами ---------- */
    // нажатие не по надписи, а по пустому месту строки заголовка (правее названия)
    for (const k of FOLDS) {
      const row = page.locator(`#main [data-fold="${k}"] .hfold-h`), box = await row.boundingBox();
      await row.click({ position: { x: box.width - (k === "shelves" ? 110 : 40), y: box.height / 2 } });
      if (k === "reading") { // сразу, без ожидания сервера
        ok(await page.locator('#main [data-fold="reading"].folded').count() === 1, "блок свернулся сразу по нажатию на строку заголовка");
      }
    }
    await page.waitForTimeout(400); // стрелка поворачивается плавно
    bl = await blocks(page);
    ok(FOLDS.every((k) => byKey(bl, k).folded && byKey(bl, k).expanded === "false" && byKey(bl, k).bodyShown === false), "все четыре свёрнуты: aria-expanded=false, содержимое скрыто");
    ok(FOLDS.every((k) => byKey(bl, k).h >= 44 && byKey(bl, k).h <= 56), "каждый стал плашкой высотой со строку", FOLDS.map((k) => byKey(bl, k).h));
    ok(byKey(bl, "reading").n === "2" && byKey(bl, "reviews").n === "3" && byKey(bl, "shelves").n === "3" && byKey(bl, "mine").n === "2", "числа в плашках те же");
    const c = byKey(bl, "reading");
    ok(c.nBg !== "rgba(0, 0, 0, 0)" && Math.abs(c.nW - c.nH) < 1.5 && parseFloat(c.nRadius) >= c.nH / 2, "число в кружке", c);
    ok(contrast(c.nBg, c.nColor) >= 4.5, `кружок читается (контраст ${contrast(c.nBg, c.nColor).toFixed(1)})`, c);
    const linkColor = await page.evaluate(() => getComputedStyle(document.querySelector("#main .more-link")).color);
    ok(contrast(c.nBg, linkColor) < 1.35, "цвет кружка как у ссылок в заголовках", [c.nBg, linkColor]);
    ok(FOLDS.every((k) => /^none$|matrix\(1, 0, 0, 1/.test(byKey(bl, k).arrow)), "стрелка смотрит вправо", byKey(bl, "reading").arrow);
    ok(byKey(bl, "shelves").link === "", "в плашке ссылки нет: только название, число и стрелка");
    ok(byKey(bl, "cont-listen").key === "cont-listen" && /Недавно/.test(bl[bl.length - 1].title), "«Продолжить слушание» и «Недавно добавленные» как были");
    await shot(page, `${run.tag}-2-folded`, true);
    let s = await waitSrv(rt, (v) => v.collapsed.length === 4);
    ok(s.collapsed.length === 4 && s.listen_hidden === false, "на сервере записаны четыре свёрнутых блока", s);

    /* ---------- 4. Второе окно и перезагрузка ---------- */
    await page2.waitForFunction(() => document.querySelectorAll("#main .hfold.folded").length === 4, null, { timeout: 8000 }).catch(() => {});
    ok(await page2.locator("#main .hfold.folded").count() === 4, "во втором окне блоки свернулись сами (обновление данных)");
    await page.reload(); await page.waitForSelector("#main .hfold");
    ok(await page.locator("#main .hfold.folded").count() === 4, "после перезагрузки страницы всё свёрнуто");
    ok(await page.evaluate((id) => localStorage.getItem("kn_homeUi_" + id) === null, R.id), "несохранённого на устройстве не осталось");

    /* ---------- 5. Поиск при свёрнутых блоках ---------- */
    await page.fill("#q", "Икс");
    await page.waitForFunction(() => /Книги · 1/.test(document.querySelector("#main").textContent));
    ok(await page.locator("#main .hfold").count() === 0 && await page.locator("#main .brow").count() === 1, "поиск показывает результаты как раньше");
    await page.fill("#q", "");
    await page.waitForSelector("#main .hfold");
    ok(await page.locator("#main .hfold.folded").count() === 4, "после поиска блоки по-прежнему свёрнуты");

    /* ---------- 6. Развернуть нажатием на плашку (и с клавиатуры) ---------- */
    let box = await page.locator('#main [data-fold="mine"]').boundingBox();
    await page.locator('#main [data-fold="mine"]').click({ position: { x: box.width - 60, y: box.height / 2 } });
    ok(await page.locator('#main [data-fold="mine"].folded').count() === 0 && await page.locator('#main [data-fold="mine"] .shelf-card').count() === 2, "нажатие на плашку разворачивает блок как был");
    await page.focus('#main [data-fold="shelves"] .hfold-btn');
    await page.keyboard.press("Enter");
    ok(await page.locator('#main [data-fold="shelves"] .hfold-btn').getAttribute("aria-expanded") === "true", "с клавиатуры (Enter на заголовке) тоже разворачивается");
    for (const k of ["reading", "reviews"]) await page.click(`#main [data-fold="${k}"] .hfold-btn`);
    s = await waitSrv(rt, (v) => v.collapsed.length === 0);
    ok(s.collapsed.length === 0, "всё развёрнуто, на сервере пусто", s);
    await page2.waitForFunction(() => document.querySelectorAll("#main .hfold.folded").length === 0, null, { timeout: 8000 }).catch(() => {});
    ok(await page2.locator("#main .hfold.folded").count() === 0, "во втором окне тоже развернулось");

    /* ---------- 7. «Продолжить слушание»: крестик ---------- */
    const x = page.locator('#cont-listen [data-act="home-listen-hide"]');
    ok(await x.getAttribute("title") === "Скрыть блок" && await x.getAttribute("aria-label") === "Скрыть", "у блока крестик «Скрыть» с подсказкой «Скрыть блок»");
    ok(/Тихие вечера/.test(await page.locator("#cont-listen").textContent()) && /Глава 2/.test(await page.locator("#cont-listen").textContent()), "в блоке вторая глава «Тихих вечеров»");
    box = await x.boundingBox();
    ok(box.width >= 44 && box.height >= 44, "крестик не меньше 44 px");
    await page.locator("#cont-listen").scrollIntoViewIfNeeded();
    await shot(page, `${run.tag}-3-listen`);
    await x.click();
    await page.waitForFunction(() => !document.querySelector("#cont-listen"));
    ok(await page.locator("#cont-listen").count() === 0, "блок ушёл с главной сразу");
    ok((await page.locator("#toast").textContent()).trim() === TOAST, "подсказка внизу: «" + TOAST + "»", await page.locator("#toast").textContent());
    ok(!(await page.locator("#mini").count()) && (await audio(page)) === null, "звук не включался, мини-плеера нет");
    await shot(page, `${run.tag}-4-listen-hidden`);
    s = await waitSrv(rt, (v) => v.listen_hidden === true);
    ok(s.listen_hidden === true && s.collapsed.length === 0, "на сервере «слушание скрыто»", s);
    await page2.waitForFunction(() => !document.querySelector("#cont-listen"), null, { timeout: 8000 }).catch(() => {});
    ok(await page2.locator("#cont-listen").count() === 0, "во втором окне блока тоже нет");
    await page.reload(); await page.waitForSelector("#main .hfold");
    await page.waitForTimeout(600);
    ok(await page.locator("#cont-listen").count() === 0, "после перезагрузки блока нет");
    r = await req("GET", `/api/collections/audio_progress/records?${flt(`track = '${t2}'`)}`, { token: rt });
    ok(r.data.items[0].pos === 40, "место прослушивания не изменилось (40 с)", r.data.items[0]);

    /* ---------- 8. Блок возвращается, когда человек снова включает аудио ---------- */
    await page.goto(`${BASE}/#/b/${A1}`);
    await page.waitForSelector(".listen-btn");
    await page.click(".listen-btn");
    await page.waitForFunction(() => { const a = document.querySelector("audio"); return a && !a.paused && a.currentTime >= 40; }, null, { timeout: 15000 }).catch(() => {});
    let au = await audio(page);
    ok(au && !au.paused && au.t >= 40 && au.t < 52, "«Слушать» в карточке продолжает с того же места (40 с второй главы)", au);
    s = await waitSrv(rt, (v) => v.listen_hidden === false);
    ok(s.listen_hidden === false, "на сервере «слушание скрыто» снято", s);
    await page.goto(BASE + "/#/");
    await page.waitForSelector("#cont-listen");
    bl = await blocks(page);
    ok(byKey(bl, "cont-listen").key === "cont-listen" && bl.map((v) => v.key).join(",") === "reading,cont-listen,reviews,shelves,mine,", "блок вернулся на главную, на своё место, в обычном виде");
    ok(await page.locator("#mini").count() === 1, "мини-плеер на месте");
    await page2.waitForSelector("#cont-listen", { timeout: 8000 }).catch(() => {});
    ok(await page2.locator("#cont-listen").count() === 1, "во втором окне блок тоже вернулся");
    await shot(page, `${run.tag}-5-listen-back`);

    /* ---------- 9. Закрыть во время игры: звук идёт, мини-плеер на месте, блок сам не возвращается ---------- */
    const before = (await audio(page)).t;
    await page.click('#cont-listen [data-act="home-listen-hide"]');
    await page.waitForFunction(() => !document.querySelector("#cont-listen"));
    await page.waitForTimeout(12500); // за это время плеер сам сохраняет место (раз в 10 секунд)
    au = await audio(page);
    ok(au && !au.paused && au.t > before + 10, `звук не остановился (было ${before.toFixed(0)} с, стало ${au ? au.t.toFixed(0) : "?"} с)`, au);
    ok(await page.locator("#mini").count() === 1, "мини-плеер остался");
    ok(await page.locator("#cont-listen").count() === 0, "блок сам не вернулся, хотя место сохранялось");
    r = await req("GET", `/api/collections/audio_progress/records?${flt(`track = '${t2}'`)}`, { token: rt });
    ok(r.data.items[0].pos > 45, "место за это время сохранилось на сервере (" + r.data.items[0].pos + " с)");
    s = await srv(rt);
    ok(s.listen_hidden === true, "на сервере блок по-прежнему скрыт", s);
    await shot(page, `${run.tag}-6-hidden-playing`);
    await page.reload(); await page.waitForSelector("#main .hfold"); await page.waitForTimeout(500);
    ok(await page.locator("#cont-listen").count() === 0, "после перезагрузки блока по-прежнему нет");

    /* ---------- 10. Пауза и «Играть» в мини-плеере, экран блокировки, следующая глава сама ---------- */
    // после перезагрузки плеер пуст: включаем первую главу в карточке (это возвращает блок), потом снова закрываем
    await page.goto(`${BASE}/#/b/${A1}`);
    await page.waitForSelector('#main [data-act="au-track"]');
    await page.locator('#main [data-act="au-track"]').first().click();
    await page.waitForFunction(() => { const a = document.querySelector("audio"); return a && !a.paused && a.duration > 20 && a.duration < 40; }, null, { timeout: 15000 }).catch(() => {});
    s = await waitSrv(rt, (v) => v.listen_hidden === false);
    ok(s.listen_hidden === false, "глава, включённая в карточке, возвращает блок", s);
    await page.goto(BASE + "/#/");
    await page.waitForSelector("#cont-listen");
    await page.click('#cont-listen [data-act="home-listen-hide"]');
    await page.waitForFunction(() => !document.querySelector("#cont-listen"));
    await waitSrv(rt, (v) => v.listen_hidden === true);
    // первая глава (30 с) кончается: плеер сам включает вторую
    await page.evaluate(() => { const a = document.querySelector("audio"); a.currentTime = a.duration - 2; });
    await page.waitForFunction(() => /Глава 2/.test((document.querySelector("#mini .mini-t b") || {}).textContent || "") && !document.querySelector("audio").paused && document.querySelector("audio").duration > 100, null, { timeout: 15000 }).catch(() => {});
    ok(/Глава 2/.test(await page.locator("#mini .mini-t b").textContent()), "первая глава кончилась, плеер сам включил вторую");
    await page.waitForTimeout(900);
    ok(await page.locator("#cont-listen").count() === 0 && (await srv(rt)).listen_hidden === true, "от этого блок не вернулся");
    await page.click('#mini [data-mini="toggle"]');
    await page.waitForFunction(() => document.querySelector("audio").paused);
    await page.waitForTimeout(700);
    ok(await page.locator("#cont-listen").count() === 0, "пауза в мини-плеере блок не возвращает");
    await page.click('#mini [data-mini="toggle"]');
    await page.waitForSelector("#cont-listen", { timeout: 5000 }).catch(() => {});
    ok(await page.locator("#cont-listen").count() === 1 && !(await audio(page)).paused, "«Играть» в мини-плеере после паузы: блок вернулся");
    s = await waitSrv(rt, (v) => v.listen_hidden === false);
    ok(s.listen_hidden === false, "и на сервере тоже", s);
    await page.click('#cont-listen [data-act="home-listen-hide"]');
    await page.waitForFunction(() => !document.querySelector("#cont-listen"));
    await page.evaluate(() => window.__ms.pause());
    await page.waitForFunction(() => document.querySelector("audio").paused);
    await page.waitForTimeout(600);
    ok(await page.locator("#cont-listen").count() === 0, "пауза с экрана блокировки блок не возвращает");
    await page.evaluate(() => window.__ms.play());
    await page.waitForSelector("#cont-listen", { timeout: 5000 }).catch(() => {});
    ok(await page.locator("#cont-listen").count() === 1 && !(await audio(page)).paused, "«Играть» с экрана блокировки после паузы: блок вернулся");
    await page.click('#mini [data-mini="stop"]');
    await page.waitForFunction(() => !document.querySelector("#mini"));
    await waitSrv(rt, (v) => v.listen_hidden === false);

    /* ---------- 11. Нет сети: состояние остаётся на устройстве и уходит позже ---------- */
    await page.route("**/api/knigi/home-ui", (route) => route.abort());
    await page.click('#main [data-fold="reading"] .hfold-btn');
    ok(await page.locator('#main [data-fold="reading"].folded').count() === 1, "без связи с сервером блок сворачивается сразу");
    await page.waitForTimeout(1200);
    ok((await srv(rt)).collapsed.length === 0, "на сервер не ушло");
    ok(await page.locator("#toast:not([hidden])").evaluateAll((els) => els.every((e) => !/ошиб|не удалось|сет/i.test(e.textContent) || e.textContent.trim() === "")), "сообщения об ошибке нет");
    await page.reload(); await page.waitForSelector("#main .hfold"); await page.waitForTimeout(400);
    ok(await page.locator('#main [data-fold="reading"].folded').count() === 1, "после перезагрузки на этом устройстве блок свёрнут (запись сервера ещё прежняя)");
    await page.unroute("**/api/knigi/home-ui");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    s = await waitSrv(rt, (v) => v.collapsed.length === 1);
    ok(s.collapsed.join() === "reading", "связь вернулась: состояние ушло на сервер", s);
    await page.waitForFunction((id) => localStorage.getItem("kn_homeUi_" + id) === null, R.id, { timeout: 5000 }).catch(() => {});
    ok(await page.evaluate((id) => localStorage.getItem("kn_homeUi_" + id) === null, R.id), "запись на устройстве убрана");
    await page2.waitForFunction(() => document.querySelectorAll("#main .hfold.folded").length === 1, null, { timeout: 8000 }).catch(() => {});
    ok(await page2.locator('#main [data-fold="reading"].folded').count() === 1, "во втором окне блок свернулся");

    /* ---------- 12. Ноль: числа и кружка нет ---------- */
    for (const id of myShelves) {
      const sb = await req("GET", `/api/collections/shelf_books/records?${flt(`shelf = '${id}'`)}`, { token: rt });
      for (const it of sb.data.items) await req("DELETE", `/api/collections/shelf_books/records/${it.id}`, { token: rt });
      await req("DELETE", `/api/collections/shelves/records/${id}`, { token: rt });
    }
    await page.waitForFunction(() => !document.querySelector('#main [data-fold="mine"] .shelf-card'), null, { timeout: 8000 }).catch(() => {});
    bl = await blocks(page);
    ok(byKey(bl, "mine").n === "" && byKey(bl, "mine").link === "Создать", "своих полок нет: числа у заголовка нет, ссылка «Создать» на месте", byKey(bl, "mine"));
    await page.click('#main [data-fold="mine"] .hfold-btn');
    bl = await blocks(page);
    ok(byKey(bl, "mine").folded && byKey(bl, "mine").n === "" && await page.locator('#main [data-fold="mine"] .n').count() === 0, "в плашке «Мои полки» кружка нет");
    await shot(page, `${run.tag}-7-zero`, true);

    /* ---------- 13. Без доступа: главная видна, свернуть можно ---------- */
    await req("POST", "/api/knigi/admin/access", { token: admin, json: { user: R.id, action: "set", date: "2020-01-01" } });
    await page.waitForSelector("#access-bar.off:not([hidden])", { timeout: 8000 }).catch(() => {});
    ok(await page.locator("#access-bar.off").count() === 1, "срок закончился: красная полоска");
    await page.waitForSelector('#main [data-fold="shelves"] .hfold-btn');
    await page.click('#main [data-fold="shelves"] .hfold-btn');
    s = await waitSrv(rt, (v) => v.collapsed.includes("shelves"));
    ok(s.collapsed.includes("shelves") && await page.locator('#main [data-fold="shelves"].folded').count() === 1, "без доступа блок сворачивается и запоминается", s);
    ok(page.errs.length === 0 && page2.errs.length === 0, "ошибок на странице нет", page.errs.concat(page2.errs));
    await ctx.close(); await two.ctx.close();
  }

  /* ---------- Администратор: те же блоки ---------- */
  console.log("\nБраузер: администратор");
  {
    await req("POST", "/api/knigi/audio/" + t2 + "/progress", { token: admin, json: { pos: 20 } });
    const { ctx, page } = await open(browser, { width: 390, dark: false, user: ADMIN });
    await page.goto(BASE + "/");
    await page.waitForSelector("#main .hfold");
    let bl = await blocks(page);
    ok(["reading", "shelves", "mine"].every((k) => byKey(bl, k).fold) && byKey(bl, "cont-listen").key === "cont-listen", "у администратора блоки сворачиваются, у «Продолжить слушание» крестик", bl.map((x) => x.key));
    ok(byKey(bl, "reading").n === "" && /Отметьте книгу/.test(await page.locator('#main [data-fold="reading"]').textContent()), "«Продолжить чтение» без книг: подсказка, числа нет");
    await page.click('#main [data-fold="reading"] .hfold-btn');
    await page.click('#cont-listen [data-act="home-listen-hide"]');
    const s = await waitSrv(admin, (v) => v.listen_hidden && v.collapsed.length === 1);
    ok(s.listen_hidden === true && s.collapsed.join() === "reading", "его настройки сохранились", s);
    ok(page.errs.length === 0, "ошибок на странице нет", page.errs);
    await ctx.close();
    await req("POST", "/api/knigi/home-ui", { token: admin, json: { collapsed: [], listen_hidden: false } });
  }
  await browser.close();
  console.log(`\nБраузер: проверок ${oks + fails}, прошло ${oks}, ошибок ${fails}.`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("Сбой проверки в браузере:", e); process.exit(1); });
