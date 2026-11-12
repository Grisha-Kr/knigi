// Проверка правок 4.6 в браузере (Playwright с Chromium): вкладка «Отзывы» в карточке без отзывов и с несколькими
// (отзыв администратора первым, «прочитал(а)», «Читать полностью»), окно отзыва со счётчиком, «Изменить мой отзыв»,
// «Новые отзывы» на главной, точка на фото и «Профиль» → «Отзывы» у администратора, удаление с подтверждением.
// Запускается из tools/reviews-check.sh после reviews-check.mjs (тот же сервер, его книги и отзывы).
// Настройки: KN_BASE, KN_SU, KN_SHOTS (папка для снимков; без неё снимки не делаются).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = (process.env.KN_BASE || "http://127.0.0.1:8093").replace(/\/+$/, "");
const [SU_EMAIL, SU_PASS] = (process.env.KN_SU || "su@example.com:proverka-su-12345").split(":");
const SHOTS = process.env.KN_SHOTS || "";
const ADMIN = { email: "admin@example.com", password: "proverka-admin-12345" };
const ANNA = { email: "anna@example.com", password: "proverka-anna-12345" };
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
const flt = (s) => "filter=" + encodeURIComponent(s);
const stamp = Date.now().toString(36);
const LONG = ["Книга оказалась глубже, чем я ожидала. Первые главы читаются медленно, автор долго подводит к главной мысли, но потом всё складывается.",
  "Больше всего запомнилась глава о терпении: короткие примеры из жизни, без нравоучений. Перечитывала её дважды и выписала несколько мест.",
  "Местами язык тяжеловат, особенно в середине, где много повторов. Если читать по главе в день, это почти не мешает.",
  "Советую тем, кто готов читать не спеша и возвращаться к прочитанному. Для быстрого чтения в дороге она не подходит.",
  "В конце есть приложение с вопросами для обсуждения: удобно, если читать вместе с кем-то. Мы так и сделали с подругой.",
  "Поставила бы на полку рядом с книгами, которые хочется перечитать через год."].join("\n\n");
const MINE = "Прочитала за два вечера.\nСпокойная, тёплая книга, советую.";

async function shot(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(SHOTS, name + ".png") });
}
async function open(browser, { width, dark, user }) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: SHOTS ? 2 : 1, hasTouch: width < 600, isMobile: width < 600 });
  await ctx.addInitScript((t) => { try { localStorage.setItem("kn_theme", JSON.stringify(t)); } catch (_) {} }, dark ? "dark" : "light");
  const r = await req("POST", "/api/collections/users/auth-with-password", { json: { identity: user.email, password: user.password } });
  await ctx.addInitScript((a) => { try { localStorage.setItem("pocketbase_auth", JSON.stringify({ token: a.token, record: a.record })); } catch (_) {} }, r.data);
  const page = await ctx.newPage();
  return { ctx, page };
}
const dotOnPhoto = async (page, width) => width < 600 ? page.locator("header .me-link.dot").count() : page.locator("#side-me .face-wrap.dot").count();
const tabText = (page) => page.locator('#main .notes-card .tabs a[href*="tab=reviews"]').textContent();

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const SU = (await req("POST", "/api/collections/_superusers/auth-with-password", { json: { identity: SU_EMAIL, password: SU_PASS } })).data.token;
  const admin = await login(ADMIN), anna = await login(ANNA);
  const tv = (await req("GET", "/api/knigi/terms")).data.version;
  // книга X из reviews-check.mjs: у неё отзыв администратора и отзывы читателей, у Анны отметка «Прочитано»
  const X = (await req("GET", `/api/collections/books/records?${flt("title ~ 'Икс'")}`, { token: admin })).data.items[0].id;
  const annaX = (await req("GET", `/api/collections/reviews/records?${flt(`book = '${X}' && user = '${JSON.parse(Buffer.from(anna.split(".")[1], "base64url")).id}'`)}`, { token: anna })).data.items[0];
  await req("POST", `/api/knigi/reviews/${annaX.id}`, { token: anna, json: { text: LONG } });
  await req("POST", "/api/knigi/admin/reviews/seen", { token: admin });
  const browser = await chromium.launch();
  const runs = [{ width: 390, dark: false, tag: "390-light" }, { width: 390, dark: true, tag: "390-dark" }, { width: 1280, dark: false, tag: "1280-light" }, { width: 1280, dark: true, tag: "1280-dark" }];
  let n = 0;
  for (const run of runs) {
    n++;
    console.log(`\nБраузер ${run.tag}`);
    // новая книга без отзывов и новая читательница
    let r = await req("POST", "/api/knigi/audio-books", { token: admin, json: { title: `Тихие вечера ${n}`, authors: "Мария Светлова" } });
    const W = r.data.id;
    await req("POST", `/api/knigi/books/${W}/visibility`, { token: admin, json: { hidden: false } });
    const R = { name: "Ольга", email: `olga${n}-${stamp}@example.com`, password: "proverka-ui-12345" };
    r = await req("POST", "/api/collections/users/records", { token: SU, json: { ...R, passwordConfirm: R.password, role: "user", theme: "auto" } });
    R.id = r.data.id;
    const rt = await login(R);
    await req("POST", "/api/knigi/terms/accept", { token: rt, json: { version: tv } });

    /* ---------- Читатель: вкладка без отзывов ---------- */
    let { ctx, page } = await open(browser, { ...run, user: R });
    await page.goto(`${BASE}/#/b/${W}?tab=reviews`);
    await page.waitForSelector('#main [data-act="rv-write"]');
    ok((await tabText(page)).trim() === "Отзывы", "вкладка «Отзывы» есть, без числа", await tabText(page));
    ok(await page.locator('#main .tabs a[href*="tab=reviews"]').getAttribute("aria-selected") === "true", "открыта вкладка «Отзывы»");
    ok((await page.locator('#main [data-act="rv-write"]').textContent()).trim() === "Написать отзыв", "кнопка «Написать отзыв»");
    ok(/Отзывов пока нет/.test(await page.locator("#main .notes-card").textContent()), "пустая вкладка: «Отзывов пока нет…»");
    await shot(page, `${run.tag}-1-empty`);

    /* ---------- Профиль читателя: «Мои отзывы» под «Мои заметки», пока пусто ---------- */
    await page.goto(`${BASE}/#/profile`);
    await page.waitForSelector("#myrv-link");
    const order = await page.evaluate(() => {
      const main = document.querySelector("#main");
      const h2 = (t) => [...main.querySelectorAll("section.card h2")].find((h) => h.textContent.trim().startsWith(t));
      const marks = [["Читаю", h2("Читаю")], ["Прочитанные", h2("Прочитанные")], ["Мои заметки", main.querySelector('#notes-links a[href="#/notes"]')],
        ["Мои отзывы", main.querySelector('#notes-links a[href="#/myreviews"]')], ["Предложенные", h2("Мои предложенные книги")], ["Написать", main.querySelector(".msg-card")],
        ["Мои сообщения", main.querySelector(".msg-card #msgs-link")], ["Оформление", h2("Оформление")]];
      const all = [...main.querySelectorAll("*")];
      return marks.map(([k, el]) => [k, el ? all.indexOf(el) : -1]);
    });
    const idx = order.map((x) => x[1]);
    ok(idx.every((v) => v >= 0) && idx.every((v, i) => i === 0 || v > idx[i - 1]), "порядок в профиле читателя: " + order.map((x) => x[0]).join(" → "), order);
    ok((await page.locator("#myrv-link .n").textContent()) === "0", "«Мои отзывы» с числом 0");
    await page.click("#myrv-link");
    await page.waitForFunction(() => location.hash === "#/myreviews" && /Мои отзывы/.test((document.querySelector("#main h1") || {}).textContent || ""));
    ok(/Вы ещё не оставили ни одного отзыва/.test(await page.locator("#main").textContent()), "пустой экран: «Вы ещё не оставили ни одного отзыва»");

    /* ---------- Несколько отзывов ---------- */
    await page.goto(`${BASE}/#/b/${X}?tab=reviews`);
    await page.waitForSelector("#main .rv");
    const cnt = await page.locator("#main .rv-list .rv").count();
    ok(cnt >= 4, "у X несколько отзывов: " + cnt);
    ok((await tabText(page)).replace(/\s+/g, " ").trim() === `Отзывы ${cnt}`, "число у вкладки = числу отзывов", await tabText(page));
    const first = page.locator("#main .rv-list .rv").first();
    ok(await first.evaluate((el) => el.classList.contains("own")) && /Отзыв автора библиотеки/.test(await first.textContent()), "первым отзыв администратора с пометкой «Отзыв автора библиотеки»");
    const dates = await page.locator("#main .rv-list .rv:not(.own)").evaluateAll((els) => els.length);
    ok(dates === cnt - 1, "остальные отзывы ниже");
    const annaRow = page.locator("#main .rv", { hasText: "Анна Петрова" });
    ok(await annaRow.locator(".rv-fin").count() === 1 && (await annaRow.locator(".rv-fin").textContent()) === "прочитал(а)", "у Анны (отметка «Прочитано») серым «прочитал(а)»");
    ok(/изменён/.test(await annaRow.locator(".rv-date").textContent()), "у изменённого отзыва мелко «изменён»");
    ok(await annaRow.locator(".rv-more").isVisible(), "длинный отзыв свёрнут, есть «Читать полностью»");
    const hClamp = await annaRow.locator(".rv-text").evaluate((el) => el.clientHeight);
    ok(await page.locator("#main .rv", { hasText: "Борис о X" }).locator(".rv-more").isHidden(), "у короткого отзыва «Читать полностью» нет");
    ok(await page.locator("#main .rv", { hasText: "Борис о X" }).locator(".face img").count() === 1, "у Бориса его фото");
    ok(!/@/.test(await page.locator("#main .rv-list").textContent()), "почты авторов нигде нет");
    ok(await page.locator('#main .rv [data-act="rv-del"], #main .rv [data-act="rv-edit"]').count() === 0, "у чужих отзывов кнопок «Изменить» и «Удалить» нет");
    await page.locator("#main .notes-card").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 12));
    await shot(page, `${run.tag}-2-list`);
    await annaRow.locator(".rv-more").click();
    const hOpen = await annaRow.locator(".rv-text").evaluate((el) => el.clientHeight);
    ok(hOpen > hClamp + 40 && await annaRow.locator(".rv-more").isHidden(), "«Читать полностью» раскрывает весь текст", { hClamp, hOpen });

    /* ---------- Окно отзыва, правка ---------- */
    await page.goto(`${BASE}/#/b/${W}?tab=reviews`);
    await page.click('#main [data-act="rv-write"]');
    await page.waitForSelector("#rv-text");
    ok(await page.locator("#rv-cnt").textContent() === "0 из 2000", "в окне счётчик «0 из 2000»");
    await page.click("#dlg-ok");
    ok(/Напишите текст отзыва/.test(await page.locator("#dlg-err").textContent()), "пустой отзыв не отправляется");
    await page.fill("#rv-text", MINE);
    ok(await page.locator("#rv-cnt").textContent() === `${[...MINE].length} из 2000`, "счётчик меняется при вводе", await page.locator("#rv-cnt").textContent());
    await shot(page, `${run.tag}-3-dialog`);
    await page.click("#dlg-ok");
    await page.waitForSelector("#main .rv");
    ok((await page.locator('#main [data-act="rv-write"]').textContent()).trim() === "Изменить мой отзыв", "после отправки кнопка «Изменить мой отзыв»");
    ok((await tabText(page)).replace(/\s+/g, " ").trim() === "Отзывы 1", "у вкладки число 1");
    const own = page.locator("#main .rv").first();
    ok(await own.locator('[data-act="rv-edit"]').count() === 1 && await own.locator('[data-act="rv-del"]').count() === 1, "у своего отзыва «Изменить» и «Удалить»");
    ok(/Ольга/.test(await own.textContent()) && /Спокойная, тёплая книга/.test(await own.textContent()), "имя и текст на месте");
    await own.locator('[data-act="rv-edit"]').click();
    await page.waitForSelector("#rv-text");
    ok(await page.locator("#rv-text").inputValue() === MINE, "«Изменить» открывает окно с текстом отзыва");
    await page.fill("#rv-text", MINE + " Дополнила.");
    await page.click("#dlg-ok");
    await page.waitForFunction(() => /Дополнила/.test(document.querySelector("#main .rv").textContent));
    ok(/изменён/.test(await page.locator("#main .rv .rv-date").textContent()), "после правки «изменён»");
    await shot(page, `${run.tag}-4-mine`);

    /* ---------- «Мои отзывы»: строка, переход в карточку и «Назад», бледный отзыв к скрытой книге ---------- */
    await page.goto(`${BASE}/#/profile`);
    await page.waitForSelector("#myrv-link");
    ok((await page.locator("#myrv-link .n").textContent()) === "1", "в профиле «Мои отзывы» 1");
    await page.click("#myrv-link");
    await page.waitForSelector("#main .myrv");
    const item = page.locator("#main a.myrv");
    ok(await item.count() === 1, "на экране «Мои отзывы» один отзыв");
    const it = (await item.textContent()).replace(/\s+/g, " ");
    ok(it.includes(`Тихие вечера ${n}`) && it.includes("Мария Светлова") && /изменён/.test(it) && it.includes("Прочитала за два вечера"), "обложка, название, автор книги, дата с «изменён», начало текста", it);
    ok(await item.locator(".myrv-ex").evaluate((el) => getComputedStyle(el).webkitLineClamp) === "3", "текст обрезан до 3 строк");
    await shot(page, `${run.tag}-7-myreviews`);
    await item.click();
    await page.waitForSelector('#main .tabs a[href*="tab=reviews"][aria-selected="true"]');
    ok(page.url().includes(`#/b/${W}?tab=reviews`), "нажатие открывает карточку книги на вкладке «Отзывы»");
    ok((await page.locator("#main a.back").textContent()).trim() === "Мои отзывы", "у карточки «Назад» подписано «Мои отзывы»");
    await page.click("#main a.back");
    await page.waitForFunction(() => location.hash === "#/myreviews" && !!document.querySelector("#main .myrv"));
    ok(true, "«Назад» возвращает в «Мои отзывы»");
    await req("POST", `/api/knigi/books/${W}/visibility`, { token: admin, json: { hidden: true } });
    await page.waitForSelector("#main .myrv.na", { timeout: 8000 });
    const na = page.locator("#main .myrv.na");
    ok(await page.locator("#main a.myrv").count() === 0 && /Книга временно недоступна/.test(await na.textContent()), "книгу скрыли: отзыв бледный, «Книга временно недоступна», без перехода");
    ok(/Прочитала за два вечера/.test(await na.textContent()) && Number(await na.evaluate((el) => getComputedStyle(el).opacity)) < 1, "свой текст виден, строка бледная");
    await shot(page, `${run.tag}-8-hidden`);
    await page.goto(`${BASE}/#/b/${W}?tab=reviews`);
    await page.waitForSelector("#main .notes-card");
    ok(await page.locator("#main .rv").count() === 0 && (await tabText(page)).trim() === "Отзывы", "в карточке скрытой книги отзывов не видно, даже своего");
    // без доступа «Мои отзывы» видны
    await req("POST", "/api/knigi/admin/access", { token: admin, json: { user: R.id, action: "set", date: "2020-01-01" } });
    await req("POST", `/api/knigi/books/${W}/visibility`, { token: admin, json: { hidden: false } });
    await page.goto(`${BASE}/#/myreviews`);
    await page.reload();
    await page.waitForSelector("#main a.myrv");
    ok(await page.locator("#access-bar.off:not([hidden])").count() === 1 && await page.locator("#main a.myrv").count() === 1, "срок закончился: «Мои отзывы» видны, книга снова открыта");
    await req("POST", "/api/knigi/admin/access", { token: admin, json: { user: R.id, action: "unlimited" } });
    await page.reload();
    await page.waitForSelector("#main a.myrv");

    /* ---------- Главная: «Новые отзывы» ---------- */
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector("#main .rv-new");
    const items = page.locator("#main .rv-new .rv-item");
    ok(await items.count() === 3, "на главной «Новые отзывы»: 3 отзыва");
    ok(!/Ольга/.test(await page.locator("#main .rv-new").textContent()), "своего отзыва там нет");
    await page.locator("#main .rv-new").scrollIntoViewIfNeeded();
    await shot(page, `${run.tag}-5-home`);
    const href = await items.first().getAttribute("href");
    await items.first().click();
    await page.waitForSelector('#main .tabs a[href*="tab=reviews"][aria-selected="true"]');
    ok(/tab=reviews/.test(href), "нажатие открывает карточку книги на вкладке «Отзывы»");

    /* ---------- Администратор: точка, «Профиль» → «Отзывы» ---------- */
    const A = await open(browser, { ...run, user: ADMIN });
    const ap = A.page;
    await ap.goto(`${BASE}/#/`);
    await ap.waitForSelector("#main .rv-new, #main h1");
    await ap.waitForTimeout(500);
    ok(await dotOnPhoto(ap, run.width) === 1, "у администратора точка на фото");
    await ap.goto(`${BASE}/#/profile`);
    await ap.waitForSelector("#rv-link");
    ok(await ap.locator("#rv-link .n.hot").count() === 1 && (await ap.locator("#rv-link .n").textContent()) === "1", "в профиле «Отзывы» с числом новых 1");
    await ap.click("#rv-link");
    await ap.waitForSelector("#main .rv-list");
    ok(ap.url().endsWith("#/reviews"), "открылся раздел «Отзывы»");
    const fresh = ap.locator("#main .rv.unread");
    ok(await fresh.count() === 1 && /Ольга/.test(await fresh.textContent()) && await fresh.locator(".tag.new").count() === 1, "отзыв Ольги с пометкой «Новый»");
    ok(/Тихие вечера/.test(await fresh.locator(".rv-book").textContent()), "у отзыва видно книгу");
    ok(await ap.locator('#main .rv [data-act="rv-del"]').count() === await ap.locator("#main .rv").count(), "у каждого отзыва «Удалить»");
    ok(!/@/.test(await ap.locator("#main .rv-list").textContent()), "почты авторов нет и у администратора");
    await ap.waitForFunction((w) => w < 600 ? !document.querySelector("header .me-link.dot") : !document.querySelector("#side-me .face-wrap.dot"), run.width);
    ok(true, "точка на фото снята");
    await shot(ap, `${run.tag}-6-admin`);
    ok((await req("GET", `/api/collections/reviews/records?${flt("seen = false")}`, { token: admin })).data.items.length === 0, "на сервере все отзывы просмотрены");
    await ap.goto(`${BASE}/#/profile`);
    await ap.waitForSelector("#rv-link");
    ok(await ap.locator("#rv-link .n.hot").count() === 0, "после просмотра число в профиле не выделено");
    await ap.goBack();
    await ap.waitForSelector("#main .rv-list");
    ok(await ap.locator("#main .rv.unread").count() === 0, "при новом заходе пометки «Новый» нет");

    /* ---------- Удаление с подтверждением ---------- */
    const mineId = (await req("GET", `/api/collections/reviews/records?${flt(`user = '${R.id}'`)}`, { token: rt })).data.items[0].id;
    if (n % 2) {
      await page.goto(`${BASE}/#/b/${W}?tab=reviews`);
      await page.click('#main .rv [data-act="rv-del"]');
      await page.waitForSelector("#dlg[open] #dlg-ok");
      ok(/удалится навсегда/.test(await page.locator("#dlg").textContent()), "читатель: «Удалить» спрашивает подтверждение");
      await page.click("#dlg-ok");
      await page.waitForFunction(() => !document.querySelector("#main .rv"));
      ok((await page.locator('#main [data-act="rv-write"]').textContent()).trim() === "Написать отзыв", "свой отзыв удалён, снова «Написать отзыв»");
    } else {
      await ap.click(`#rv-${mineId} [data-act="rv-del"]`);
      await ap.waitForSelector("#dlg[open] #dlg-ok");
      ok(/удалится навсегда/.test(await ap.locator("#dlg").textContent()), "администратор: «Удалить» спрашивает подтверждение");
      await ap.click("#dlg-ok");
      await ap.waitForFunction((id) => !document.getElementById("rv-" + id), mineId);
      ok(true, "отзыв пропал из списка администратора");
      await page.goto(`${BASE}/#/b/${W}?tab=reviews`);
      await page.waitForSelector('#main [data-act="rv-write"]');
    }
    ok((await req("GET", `/api/collections/reviews/records/${mineId}`, { token: admin })).status === 404, "на сервере отзыва нет");
    await A.ctx.close();
    await ctx.close();
  }
  await browser.close();
  console.log(`\nВ браузере проверок: ${oks + fails}, прошло: ${oks}, ошибок: ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("СБОЙ ПРОВЕРКИ В БРАУЗЕРЕ: " + (e && e.stack || e)); process.exit(1); });
