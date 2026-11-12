// Проверка правок 4.5 в браузере (Playwright с Chromium): «Написать администратору» со снимком, «Мои сообщения»
// с ответом и точкой, «или напишите здесь» и «Скопировать почту» в красной полоске, «Сообщения читателей»
// у администратора (список, переписка, снимок крупно, «Ответить по почте», ответ, архив, удаление),
// «Сообщения: N» в «Пользователях».
// Запускается из tools/messages-check.sh после messages-check.mjs (тот же сервер). Настройки: KN_BASE, KN_SU,
// KN_SHOTS (папка для снимков; без неё снимки не делаются).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = (process.env.KN_BASE || "http://127.0.0.1:8093").replace(/\/+$/, "");
const [SU_EMAIL, SU_PASS] = (process.env.KN_SU || "su@example.com:proverka-su-12345").split(":");
const SHOTS = process.env.KN_SHOTS || "";
const ADMIN = { email: "admin@example.com", password: "proverka-admin-12345" };
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
const stamp = Date.now().toString(36);
const kh = (days) => new Date(Date.now() + 10 * 3600e3 + days * 864e5).toISOString().slice(0, 10);
const TEXT = "Не открывается оглавление в книге.\nПробовала два раза.";

async function shot(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, name + ".png") });
}
async function open(browser, { width, dark, user }) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: SHOTS ? 2 : 1, hasTouch: width < 600, isMobile: width < 600 });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await ctx.addInitScript((t) => { try { localStorage.setItem("kn_theme", JSON.stringify(t)); } catch (_) {} }, dark ? "dark" : "light");
  const r = await req("POST", "/api/collections/users/auth-with-password", { json: { identity: user.email, password: user.password } });
  await ctx.addInitScript((a) => { try { localStorage.setItem("pocketbase_auth", JSON.stringify({ token: a.token, record: a.record })); } catch (_) {} }, r.data);
  const page = await ctx.newPage();
  return { ctx, page };
}
// Большая картинка 2400×1500 (как снимок экрана компьютера), сделанная в браузере
async function bigPng(page) {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 2400; c.height = 1500;
    const g = c.getContext("2d");
    for (let i = 0; i < 30; i++) { g.fillStyle = `hsl(${i * 12},60%,${40 + (i % 3) * 15}%)`; g.fillRect(i * 80, 0, 80, 1500); }
    g.fillStyle = "#fff"; g.font = "bold 120px sans-serif"; g.fillText("Снимок экрана", 300, 750);
    const blob = await new Promise((res) => c.toBlob(res, "image/png"));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  return Buffer.from(b64, "base64");
}
const dotOnPhoto = async (page, width) => width < 600 ? page.locator("header .me-link.dot").count() : page.locator("#side-me .face-wrap.dot").count();

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const SU = (await req("POST", "/api/collections/_superusers/auth-with-password", { json: { identity: SU_EMAIL, password: SU_PASS } })).data.token;
  const admin = await login(ADMIN);
  const tv = (await req("GET", "/api/knigi/terms")).data.version;
  const browser = await chromium.launch();
  const runs = [{ width: 390, dark: false, tag: "390-light" }, { width: 390, dark: true, tag: "390-dark" }, { width: 1280, dark: false, tag: "1280-light" }, { width: 1280, dark: true, tag: "1280-dark" }];
  let n = 0;
  for (const run of runs) {
    n++;
    console.log(`\nБраузер ${run.tag}`);
    // читатель с закончившимся сроком (красная полоска), условия принял
    const R = { name: "Ольга", email: `olga${n}-${stamp}@example.com`, password: "proverka-ui-12345" };
    let r = await req("POST", "/api/collections/users/records", { token: SU, json: { ...R, passwordConfirm: R.password, role: "user", theme: "auto" } });
    R.id = r.data.id;
    const rt = await login(R);
    await req("POST", "/api/knigi/terms/accept", { token: rt, json: { version: tv } });
    await req("POST", "/api/knigi/admin/access", { token: admin, json: { user: R.id, action: "set", date: kh(-1) } });

    /* ---------- Читатель: окно «Написать администратору» со снимком ---------- */
    let { ctx, page } = await open(browser, { ...run, user: R });
    await page.goto(`${BASE}/#/profile`);
    await page.waitForSelector('#main [data-act="msg-write"]');
    ok(await page.locator('#main [data-act="msg-write"]').isVisible(), "в профиле кнопка «Написать администратору»");
    await page.click('#main [data-act="msg-write"]');
    await page.waitForSelector("#mw-text");
    ok(await page.locator("#mw-cnt").textContent() === "0 из 1000", "счётчик «0 из 1000»");
    await page.selectOption("#mw-topic", "problem");
    await page.fill("#mw-text", TEXT);
    ok(await page.locator("#mw-cnt").textContent() === `${[...TEXT].length} из 1000`, "счётчик меняется при вводе", await page.locator("#mw-cnt").textContent());
    const png = await bigPng(page);
    let fc = page.waitForEvent("filechooser");
    await page.click('[data-dlg="mw-shot"]');
    await (await fc).setFiles({ name: "Снимок экрана.png", mimeType: "image/png", buffer: png });
    await page.waitForSelector(".mw-prev img");
    ok(true, "маленький просмотр снимка появился");
    await page.click('[data-dlg="mw-unshot"]');
    ok(await page.locator(".mw-prev").count() === 0 && await page.locator('[data-dlg="mw-shot"]').count() === 1, "крестик «Убрать» убирает снимок");
    fc = page.waitForEvent("filechooser");
    await page.click('[data-dlg="mw-shot"]');
    await (await fc).setFiles({ name: "Снимок экрана.png", mimeType: "image/png", buffer: png });
    await page.waitForSelector(".mw-prev img");
    const size = await page.locator(".mw-shot small").textContent();
    ok(/КБ/.test(size), "снимок уменьшен: " + size);
    await shot(page, `${run.tag}-1-write`);
    await page.click("#dlg-ok");
    await page.waitForFunction(() => /Ответ появится в разделе «Мои сообщения»/.test(document.querySelector("#dlg") && document.querySelector("#dlg").textContent || ""));
    ok(true, "после отправки: «Сообщение отправлено. Ответ появится в разделе «Мои сообщения»»");
    await shot(page, `${run.tag}-2-sent`);
    await page.click("#dlg-ok");
    const mine = (await req("GET", "/api/collections/messages/records?sort=-created", { token: rt })).data.items;
    ok(mine.length === 1 && mine[0].topic === "problem" && mine[0].text === TEXT && mine[0].shot, "сообщение на сервере: тема, текст с переносом, снимок", mine[0]);
    const msgId = mine[0].id;

    /* ---------- Красная полоска: «Скопировать почту» и «или напишите здесь» ---------- */
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector("#access-bar.off:not([hidden])");
    const bar = page.locator("#access-bar");
    ok(await bar.locator(".mail-copy").count() === 1 && await bar.locator('[data-msgw="renew"]').count() === 1, "в красной полоске «Скопировать почту» и «или напишите здесь»");
    ok(/напишите на owner@example\.com\s*Скопировать почту\s*или напишите здесь и укажите/.test((await bar.textContent()).replace(/\s+/g, " ")), "порядок слов в полоске", await bar.textContent());
    await shot(page, `${run.tag}-3-bar`);
    await bar.locator(".mail-copy").click();
    await page.waitForFunction(() => /Почта скопирована/.test(document.querySelector("#toast") && document.querySelector("#toast").textContent || ""));
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    ok(clip === "owner@example.com", "«Почта скопирована», в буфере почта", clip);
    await bar.locator('[data-msgw="renew"]').click();
    await page.waitForSelector("#mw-topic");
    ok(await page.locator("#mw-topic").inputValue() === "renew", "«или напишите здесь» открывает окно с темой «Продление доступа или пожертвование»");
    await shot(page, `${run.tag}-4-renew`);
    await page.click("#dlg [data-close]");
    await page.goto(`${BASE}/#/profile`);
    await page.waitForSelector(".acc-line .mail-copy");
    ok(await page.locator(".acc-line .mail-copy").count() === 1 && await page.locator('.acc-line [data-msgw="renew"]').count() === 1, "«Скопировать почту» и «или напишите здесь» и в строке о сроке в профиле");
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector("#q");
    ok(await dotOnPhoto(page, run.width) === 0, "пока ответа нет, точки на фото нет");
    await page.goto(`${BASE}/#/profile`);
    await page.waitForSelector("#msgs-link");
    ok(await page.locator("#msgs-link .ldot").count() === 0, "и у «Мои сообщения» нет");

    /* ---------- Администратор: список, переписка, снимок, письмо, ответ, архив ---------- */
    const A = await open(browser, { ...run, user: ADMIN });
    const ap = A.page;
    await ap.goto(`${BASE}/#/profile`);
    await ap.waitForSelector("#msgs-link");
    ok(/Сообщения читателей/.test(await ap.locator("#msgs-link").textContent()) && await ap.locator("#msgs-link .n.hot").count() === 1, "у администратора «Сообщения читателей» с числом новых");
    ok(await ap.locator('#main [data-act="msg-write"]').count() === 0, "у администратора кнопки «Написать администратору» нет");
    await ap.goto(`${BASE}/#/`);
    await ap.waitForSelector("#q");
    ok(await dotOnPhoto(ap, run.width) === 1, "точка на фото администратора");
    await ap.goto(`${BASE}/#/profile`);
    await ap.click("#msgs-link");
    await ap.waitForSelector(`.msg-row[href="#/msg/${msgId}"]`);
    const row = ap.locator(`.msg-row[href="#/msg/${msgId}"]`);
    const rowText = await row.textContent();
    ok(/Ольга/.test(rowText) && rowText.includes(R.email) && /Что-то неудобно или не работает/.test(rowText) && /Новое/.test(rowText) && await row.locator(".msg-row-t svg").count() === 1, "строка: имя, почта, тема, начало текста, значок снимка, «Новое»", rowText);
    ok(await ap.locator('.msg-tabs a[aria-selected="true"]').textContent().then((t) => /Входящие/.test(t)), "вкладка «Входящие»");
    await shot(ap, `${run.tag}-5-admin-list`);
    await row.click();
    await ap.waitForSelector(".msg-shot img");
    const dims = await ap.locator(".msg-shot img").evaluate((im) => new Promise((res) => { const f = () => res([im.naturalWidth, im.naturalHeight]); im.complete ? f() : im.onload = f; }));
    ok(Math.max(...dims) === 1600 && dims[1] === 1000, "снимок на сервере 1600 по длинной стороне: " + dims.join("×"));
    ok((await ap.locator(".msg-thread .msg-text").first().innerHTML()).includes("<br>"), "в переписке весь текст с переносом строки");
    const href = await ap.locator("#msg-mail").getAttribute("href");
    const mu = new URL(href.replace(/^mailto:/, "mailto://"));
    const subj = decodeURIComponent(/subject=([^&]*)/.exec(href)[1]), body = decodeURIComponent(/body=([^&]*)/.exec(href)[1]);
    ok(href.startsWith("mailto:" + R.email + "?") && subj === "Ваше сообщение в Библиотеке: Что-то неудобно или не работает", "«Ответить по почте»: адрес читателя и тема", subj);
    ok(body.includes("Здравствуйте, Ольга.\r\n") && body.includes("> Не открывается оглавление в книге.\r\n> Пробовала два раза.") && /%0D%0A/.test(href) && /%D0%97/.test(href), "в письме цитата его текста, русские буквы и переносы закодированы (UTF-8, %0D%0A)", body);
    void mu;
    await ap.click(".msg-shot");
    await ap.waitForSelector("#shot[open]");
    ok(true, "нажатие на снимок открывает его крупно");
    await shot(ap, `${run.tag}-6-admin-shot`);
    await ap.click("#shot");
    await ap.waitForFunction(() => !document.querySelector("#shot").open);
    await ap.fill("#msg-reply", "Здравствуйте! Посмотрю сегодня.");
    ok(/из 1000/.test(await ap.locator("#msg-cnt").textContent()), "у ответа тоже счётчик");
    await ap.click('[data-act="msg-send"]');
    await ap.waitForFunction(() => document.querySelectorAll(".msg-b.adm").length === 1);
    await ap.waitForSelector(".msg-from .tag.ok");
    ok(/Отвечено/.test(await ap.locator(".msg-from").textContent()), "после «Ответить» ответ в переписке, состояние «Отвечено»");
    await shot(ap, `${run.tag}-7-admin-thread`);

    /* ---------- Читатель видит ответ и точку, открывает, точка снимается ---------- */
    await page.waitForSelector("#msgs-link .ldot", { timeout: 8000 });
    ok(true, "у читателя точка у «Мои сообщения» (живое обновление)");
    await shot(page, `${run.tag}-8-reader-dot`);
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector("#q");
    ok(await dotOnPhoto(page, run.width) === 1, "и на фото");
    await shot(page, `${run.tag}-8b-reader-photo-dot`);
    await page.goto(`${BASE}/#/profile`);
    await page.click("#msgs-link");
    await page.waitForSelector(".msg-row.unread");
    ok(/Новый ответ/.test(await page.locator(".msg-row").first().textContent()), "в «Мои сообщения» отметка «Новый ответ»");
    await shot(page, `${run.tag}-9-my-list`);
    await page.click(".msg-row");
    await page.waitForSelector(".msg-b.adm");
    ok(/Посмотрю сегодня/.test(await page.locator(".msg-b.adm").textContent()) && /Администратор/.test(await page.locator(".msg-b.adm").textContent()), "в переписке ответ администратора");
    ok(await page.locator(".msg-shot img").count() === 1, "и свой снимок");
    await page.waitForFunction(() => !document.querySelector(".me-link.dot") && !document.querySelector("#side-me .face-wrap.dot"));
    ok(true, "точка на фото снята после открытия");
    ok((await req("GET", `/api/collections/messages/records/${msgId}`, { token: rt })).data.user_unread === false, "и на сервере");
    await page.fill("#msg-reply", "Спасибо, жду.");
    await page.click('[data-act="msg-send"]');
    await page.waitForFunction(() => document.querySelectorAll(".msg-b:not(.adm)").length === 2);
    ok(true, "читатель (со сроком закончившимся) ответил");
    await shot(page, `${run.tag}-10-reader-thread`);
    await page.click("#main a.back");
    await page.waitForSelector(".msg-row");
    ok(/Есть ответ/.test(await page.locator(".msg-row").first().textContent()) && await page.locator(".msg-row.unread").count() === 0, "в списке «Есть ответ» без точки");

    // у администратора ответ читателя снова «Новое»; архив
    await ap.waitForSelector(".msg-from .tag.new", { timeout: 8000 });
    ok(true, "у администратора ответ читателя: снова «Новое»");
    await ap.click('[data-act="msg-arch"]');
    await ap.waitForSelector('[data-act="msg-arch"][data-v="0"]');
    ok(/в архиве/.test(await ap.locator(".msg-from").textContent()), "«В архив»: пометка «в архиве», кнопка «Вернуть из архива»");
    await ap.goto(`${BASE}/#/msgs`);
    await ap.waitForSelector(".msg-tabs");
    ok(await ap.locator(`.msg-row[href="#/msg/${msgId}"]`).count() === 0, "во «Входящих» её нет");
    await ap.click('.msg-tabs a[href="#/msgs?box=archive"]');
    await ap.waitForSelector(`.msg-row[href="#/msg/${msgId}"]`);
    ok(true, "в «Архиве» есть");
    await shot(ap, `${run.tag}-11-admin-archive`);
    // ответ читателя возвращает во «Входящие»
    await page.click(".msg-row");
    await page.waitForSelector("#msg-reply");
    await page.fill("#msg-reply", "И ещё вопрос.");
    await page.click('[data-act="msg-send"]');
    await ap.waitForFunction((id) => !document.querySelector(`.msg-row[href="#/msg/${id}"]`), msgId, { timeout: 8000 });
    await ap.click('.msg-tabs a[href="#/msgs"]');
    await ap.waitForSelector(`.msg-row[href="#/msg/${msgId}"]`);
    ok(/Новое/.test(await ap.locator(`.msg-row[href="#/msg/${msgId}"]`).textContent()), "ответ читателя вернул переписку во «Входящие» как «Новое»");
    // «Прочитано»
    await ap.click(`.msg-row[href="#/msg/${msgId}"]`);
    await ap.waitForSelector('[data-act="msg-st"]');
    await ap.click('[data-act="msg-st"]');
    await ap.waitForSelector(".msg-from .tag.wait");
    ok(/Прочитано/.test(await ap.locator(".msg-from").textContent()) && await ap.locator('[data-act="msg-st"]').count() === 0, "«Прочитано»");
    // «Пользователи»: «Сообщения: N»
    await ap.goto(`${BASE}/#/profile`);
    await ap.click("#users-fold summary");
    const um = ap.locator(`.usr-msgs[href="#/msgs?user=${R.id}"]`);
    await um.waitFor();
    ok(/Сообщения: 1/.test(await um.textContent()), "в «Пользователях» у читателя «Сообщения: 1»");
    await um.click();
    await ap.waitForSelector(`.msg-row[href="#/msg/${msgId}"]`);
    ok(/Сообщения: Ольга/.test(await ap.locator("#main h1").textContent()), "ссылка ведёт к его перепискам");
    if (n === runs.length) {
      // удаление с подтверждением
      await ap.click(`.msg-row[href="#/msg/${msgId}"]`);
      await ap.waitForSelector('[data-act="msg-del"]');
      await ap.click('[data-act="msg-del"]');
      await ap.waitForSelector("#dlg[open] #dlg-ok");
      ok(/удалятся навсегда/.test(await ap.locator("#dlg").textContent()), "«Удалить» спрашивает подтверждение");
      await ap.click("#dlg-ok");
      await ap.waitForFunction(() => location.hash.startsWith("#/msgs"));
      ok((await req("GET", `/api/collections/messages/records/${msgId}`, { token: admin })).status === 404, "после подтверждения сообщение удалено");
      await page.waitForFunction(() => /Не найдено/.test(document.querySelector("#main").textContent), null, { timeout: 8000 });
      ok(true, "у читателя переписка исчезла");
    }
    await A.ctx.close();
    await ctx.close();
  }
  await browser.close();
  console.log(`\nВ браузере проверок: ${oks + fails}, прошло: ${oks}, ошибок: ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("СБОЙ ПРОВЕРКИ В БРАУЗЕРЕ: " + (e && e.stack || e)); process.exit(1); });
