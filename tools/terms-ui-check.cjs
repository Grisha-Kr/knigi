// Проверка правок 4.4 в браузере (Playwright с Chromium): окно условий при регистрации и у «старого» читателя,
// раздел «Условия» у администратора, строки в «Пользователях», условия внизу профиля читателя,
// жёлтая и красная полоски с новым текстом и письмо по ссылке на почту.
// Запускается из tools/terms-check.sh после terms-check.mjs (тот же сервер). Настройки: KN_BASE, KN_SU,
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
const mk = (name) => ({ name, email: `${name.toLowerCase().replace(/[^a-z0-9]/g, "") || "u"}-${stamp}@example.com`, password: "proverka-ui-12345" });
const kh = (days) => new Date(Date.now() + 10 * 3600e3 + days * 864e5).toISOString().slice(0, 10);

async function shot(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, name + ".png") });
}
async function open(browser, { width, dark, user }) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: SHOTS ? 2 : 1, hasTouch: width < 600, isMobile: width < 600 });
  await ctx.addInitScript((t) => { try { localStorage.setItem("kn_theme", JSON.stringify(t)); localStorage.setItem("kn_barsHint", "3"); } catch (_) {} }, dark ? "dark" : "light");
  const page = await ctx.newPage();
  if (user) {
    const r = await req("POST", "/api/collections/users/auth-with-password", { json: { identity: user.email, password: user.password } });
    // вход кладётся один раз: после «Выйти» страница перезагружается и должна остаться без входа
    await ctx.addInitScript((a) => { try { if (!sessionStorage.getItem("kn_t_in")) { sessionStorage.setItem("kn_t_in", "1"); localStorage.setItem("pocketbase_auth", JSON.stringify({ token: a.token, record: a.record })); } } catch (_) {} }, r.data);
  }
  return { ctx, page };
}

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const SU = (await req("POST", "/api/collections/_superusers/auth-with-password", { json: { identity: SU_EMAIL, password: SU_PASS } })).data.token;
  const admin = await login(ADMIN);
  const newcomer = (n) => ({ ...mk("new" + n), name: "Ольга" });
  const old = { ...mk("old"), name: "Пётр" };
  const soon = { ...mk("soon"), name: "Марина" };
  const gone = { ...mk("gone"), name: "Семён" };
  const t = await req("GET", "/api/knigi/terms");
  for (const u of [old, soon, gone]) {
    const r = await req("POST", "/api/collections/users/records", { token: SU, json: { ...u, passwordConfirm: u.password, role: "user", theme: "auto" } });
    if (r.status !== 200) throw new Error("пользователь " + u.email + ": " + JSON.stringify(r.data));
    u.id = r.data.id;
  }
  for (const u of [soon, gone]) await req("POST", "/api/knigi/terms/accept", { token: await login(u), json: { version: t.data.version } });
  await req("POST", "/api/knigi/admin/access", { token: admin, json: { user: soon.id, action: "set", date: kh(3) } });
  await req("POST", "/api/knigi/admin/access", { token: admin, json: { user: gone.id, action: "set", date: kh(-1) } });

  const browser = await chromium.launch();
  const runs = [{ width: 390, dark: false, tag: "390-light" }, { width: 390, dark: true, tag: "390-dark" }, { width: 1280, dark: false, tag: "1280-light" }, { width: 1280, dark: true, tag: "1280-dark" }];
  let n = 0;
  for (const run of runs) {
    console.log(`\nБраузер ${run.tag}`);
    n++;
    // 1. Регистрация по приглашению
    const code = "UI" + stamp.toUpperCase() + n;
    await req("POST", "/api/collections/invites/records", { token: admin, json: { code, note: "ui", max_uses: 1, access_period: "" } });
    const nu = newcomer(n);
    let { ctx, page } = await open(browser, run);
    await page.goto(`${BASE}/?invite=${code}`);
    await page.waitForSelector("#a-email");
    ok(!(await page.$("#a-consent")), "на форме регистрации галочки согласия больше нет");
    await page.fill("#a-name", nu.name); await page.fill("#a-email", nu.email);
    await page.fill("#a-pass", nu.password); await page.fill("#a-pass2", nu.password);
    await page.click("#auth-form [type=submit]");
    await page.waitForSelector("#terms[open]");
    ok(await page.isDisabled("#terms-ok"), "окно условий открылось, «Принять и создать аккаунт» не нажимается");
    ok((await page.textContent("#terms-ok")).trim() === "Принять и создать аккаунт" && (await page.textContent("#terms-no")).trim() === "Отмена", "кнопки «Принять и создать аккаунт» и «Отмена»");
    ok(await page.$$eval("#terms .terms-text li", (l) => l.length) === 3 && await page.$$eval("#terms .terms-text p", (l) => l.length) >= 6, "абзацы и три пункта списка");
    const link = await page.$eval('#terms .terms-text a', (a) => [a.getAttribute("href"), a.target, a.textContent]);
    ok(link[0] === "/privacy.html" && link[1] === "_blank" && link[2] === "Политике конфиденциальности", "«Политике конфиденциальности» ссылка на /privacy.html в новой вкладке", link);
    ok(await page.$eval('#terms .terms-checks a', (a) => a.textContent === "хранение моего имени и почты" && a.getAttribute("href") === "/privacy.html"), "во второй галочке ссылка «хранение моего имени и почты»");
    await shot(page, `reg-${run.tag}`);
    await page.click("#t-read");
    ok(await page.isDisabled("#terms-ok"), "одна галочка: кнопка всё ещё не нажимается");
    // политика окном поверх приложения: ссылка в тексте условий
    await page.click('#terms .terms-text a[href="/privacy.html"]');
    await page.waitForSelector("#privacy[open] #priv-body h2");
    ok(!page.url().includes("privacy"), "ссылка «Политике конфиденциальности» не уходит со страницы", page.url());
    const pv = await page.$eval("#priv-body", (b) => { const before = b.scrollTop; b.scrollTop = 400; return [b.scrollHeight > b.clientHeight, b.scrollTop > before, b.querySelectorAll("h2").length, !!b.querySelector('a[href="/"]'), b.textContent.includes("журнал чтения и прослушивания")]; });
    ok(pv[0] && pv[1] && pv[2] >= 5 && !pv[3] && pv[4], "политика в окне: разделы на месте, текст прокручивается, без «В приложение»", pv);
    ok(await page.isVisible("#privacy .dlg-foot [data-priv-close]"), "кнопка «Закрыть» видна");
    if (run.width < 600) {
      const pb = await page.$eval("#privacy", (d) => { const r = d.getBoundingClientRect(); return [r.width, r.height, innerWidth, innerHeight]; });
      ok(pb[0] <= pb[2] && pb[1] <= pb[3] + 1, "на телефоне окно политики по размеру экрана", pb);
    }
    await shot(page, `privacy-${run.tag}`);
    await page.click("#privacy .dlg-foot [data-priv-close]");
    await page.waitForFunction(() => !document.querySelector("#privacy[open]"));
    ok(!!(await page.$("#terms[open]")) && await page.isChecked("#t-read") && !(await page.isChecked("#t-data")), "после «Закрыть» окно условий на месте, отмеченная галочка тоже");
    // ссылка внутри второй галочки: открывает политику и галочку не меняет; Esc закрывает только политику
    await page.click("#terms .terms-checks a");
    await page.waitForSelector("#privacy[open]");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#privacy[open]"));
    ok(!!(await page.$("#terms[open]")) && !(await page.isChecked("#t-data")) && await page.isChecked("#t-read"), "ссылка в галочке открывает политику, галочку не меняет, Esc закрывает только политику");
    await page.click("#terms-no");
    ok(!(await page.$("#terms[open]")) && (await page.inputValue("#a-email")) === nu.email && (await page.inputValue("#a-name")) === nu.name, "«Отмена» вернула к форме, введённое на месте");
    await page.click('#auth-form a[href="/privacy.html"]');
    await page.waitForSelector("#privacy[open] #priv-body h2");
    await page.click("#privacy [data-priv-close]");
    await page.waitForFunction(() => !document.querySelector("#privacy[open]"));
    ok(!page.url().includes("privacy") && (await page.inputValue("#a-pass")) === nu.password && (await page.inputValue("#a-email")) === nu.email, "ссылка на форме регистрации: политика окном, форма с паролем на месте");
    await page.click("#auth-form [type=submit]");
    await page.waitForSelector("#terms[open]");
    ok(!(await page.isChecked("#t-read")), "окно открывается снова с пустыми галочками");
    await page.click("#t-read"); await page.click("#t-data");
    ok(!(await page.isDisabled("#terms-ok")), "две галочки: кнопка нажимается");
    if (run.width < 600) {
      const box = await page.$eval("#terms", (d) => { const r = d.getBoundingClientRect(); return [r.width, r.height, innerWidth, innerHeight]; });
      ok(box[0] <= box[2] && box[1] <= box[3] + 1, "на телефоне окно по размеру экрана", box);
    }
    await page.click("#terms-ok");
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForFunction(() => !document.querySelector("#terms[open]"));
    const tok = await login(nu);
    const acc = await req("GET", "/api/knigi/access", { token: tok });
    ok(acc.data.active && acc.data.terms.accepted === t.data.version, "аккаунт создан, условия приняты", acc.data);
    await ctx.close();

    // 1б. Страница всё же перезагрузилась во время регистрации: форма регистрации с кодом, именем и почтой
    {
      const code2 = "UR" + stamp.toUpperCase() + n;
      await req("POST", "/api/collections/invites/records", { token: admin, json: { code: code2, note: "ui", max_uses: 1, access_period: "" } });
      const c2 = await open(browser, run), p2 = c2.page;
      await p2.goto(`${BASE}/?invite=${code2}`);
      await p2.waitForSelector("#a-email");
      await p2.fill("#a-name", "Ирина"); await p2.fill("#a-email", `irina${n}-${stamp}@example.com`);
      await p2.fill("#a-pass", "proverka-ui-12345"); await p2.fill("#a-pass2", "proverka-ui-12345");
      await p2.goto(BASE + "/privacy.html");
      await p2.goBack();
      await p2.reload();
      await p2.waitForSelector("#auth-form[data-mode=register] #a-email");
      const vals = await p2.evaluate(() => ["a-invite", "a-name", "a-email", "a-pass", "a-pass2"].map((id) => document.getElementById(id).value));
      ok(vals[0] === code2 && vals[1] === "Ирина" && vals[2] === `irina${n}-${stamp}@example.com` && !vals[3] && !vals[4], "после ухода и «Назад» снова форма регистрации: код, имя и почта на месте, пароля нет", vals);
      ok(!(await p2.evaluate(() => (localStorage.getItem("kn_regDraft") || "").includes("proverka"))), "пароль нигде не сохранён");
      await p2.click('#auth-form [data-auth="login"]');
      await p2.reload();
      await p2.waitForSelector("#auth-form[data-mode=login]");
      ok(true, "«У меня уже есть аккаунт» убирает черновик: после перезагрузки экран входа");
      await c2.ctx.close();
    }

    // 2. «Старый» читатель: окно поверх всего, «Выйти»
    ({ ctx, page } = await open(browser, { ...run, user: old }));
    await page.goto(BASE + "/#/");
    await page.waitForSelector("#terms[open]");
    ok((await page.textContent("#terms-ok")).trim() === "Принять" && (await page.textContent("#terms-no")).trim() === "Выйти", "у старого читателя окно с кнопками «Принять» и «Выйти»");
    ok(await page.$eval("#access-bar", (b) => b.hidden), "полоски срока доступа нет");
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    ok(!!(await page.$("#terms[open]")), "Esc окно не закрывает");
    await page.click('#terms .terms-text a[href="/privacy.html"]');
    await page.waitForSelector("#privacy[open] #priv-body h2");
    await page.click("#privacy .dlg-foot [data-priv-close]");
    await page.waitForFunction(() => !document.querySelector("#privacy[open]"));
    ok(!!(await page.$("#terms[open]")) && !page.url().includes("privacy"), "у старого читателя политика окном, после «Закрыть» окно условий на месте");
    await shot(page, `gate-${run.tag}`);
    await page.click("#terms-no");
    await page.waitForSelector("#auth:not([hidden]) #a-email");
    ok(true, "«Выйти» вышел из аккаунта");
    await page.fill("#a-email", old.email); await page.fill("#a-pass", old.password);
    await page.click("#auth-form [type=submit]");
    await page.waitForSelector("#terms[open]");
    ok(true, "после входа окно снова");
    if (n === runs.length) {
      await page.click("#t-read"); await page.click("#t-data"); await page.click("#terms-ok");
      await page.waitForFunction(() => !document.querySelector("#terms[open]"));
      const a2 = await req("GET", "/api/knigi/access", { token: await login(old) });
      ok(a2.data.active, "«Принять»: окно закрылось, доступ есть");
    }
    await ctx.close();

    // 3. Администратор: «Условия» и «Пользователи»
    ({ ctx, page } = await open(browser, { ...run, user: ADMIN }));
    await page.goto(BASE + "/#/profile");
    await page.waitForSelector("#terms-fold");
    ok(!(await page.$("#terms[open]")), "у администратора окна нет");
    await page.click("#terms-fold > summary");
    await page.waitForSelector("#tm-text");
    const stat = await page.textContent(".terms-stat");
    ok(/Приняли действующую редакцию: \d+ из \d+ читател/.test(stat), "строка «Приняли действующую редакцию: N из M читателей»", stat);
    ok(/Каждая строка абзац\. Строка с «- » в начале пункт списка\. Ссылка: \[слова\]\(адрес\)\./.test(await page.textContent("#terms-fold")), "подсказка под полем");
    await page.$eval("#terms-fold", (el) => el.scrollIntoView());
    await shot(page, `admin-terms-${run.tag}`);
    await page.click('[data-act="terms-preview"]');
    await page.waitForSelector("#dlg[open] .terms-text li");
    ok(true, "«Посмотреть» показывает текст как у читателя");
    await shot(page, `admin-preview-${run.tag}`);
    await page.click("#dlg-ok");
    await page.click("#users-fold > summary");
    await page.waitForSelector(".usr-terms");
    const lines = await page.$$eval(".usr-terms", (l) => l.map((x) => x.textContent));
    ok(lines.some((x) => /^Условия: приняты \d+ [а-я]+ \d{4}, редакция \d+$/.test(x)), "строка «Условия: приняты 12 ноября 2026, редакция N»", lines);
    ok(lines.some((x) => /^Условия: не приняты/.test(x)), "строка «Условия: не приняты»", lines);
    const oldRow = await page.$$eval(".usr", (rows, email) => { const r = rows.find((x) => x.textContent.includes(email)); return r ? r.textContent : ""; }, old.email);
    if (n < runs.length) ok(/Условия: не приняты/.test(oldRow) && !/приостановлен|закончился/.test(oldRow), "у читателя без согласия нет «приостановлен» и «срок закончился»", oldRow);
    await page.$eval("#users-fold", (el) => el.scrollIntoView());
    await shot(page, `admin-users-${run.tag}`);
    await ctx.close();

    // 4. Читатель с близким сроком: жёлтая полоска, условия внизу профиля
    ({ ctx, page } = await open(browser, { ...run, user: soon }));
    await page.goto(BASE + "/#/profile");
    await page.waitForSelector("#access-bar:not([hidden])");
    const yel = await page.textContent("#access-text");
    ok(/Доступ действует до .* Чтобы продлить доступ или сделать пожертвование, напишите на owner@example\.com и укажите имя и почту, с которыми вы зарегистрированы в библиотеке\.$/.test(yel), "жёлтая полоска: новый текст", yel);
    const href = await page.$eval("#access-text a", (a) => a.getAttribute("href"));
    const u = new URL(href);
    ok(u.protocol === "mailto:" && u.pathname === "owner@example.com", "ссылка mailto на почту из CONTACT_EMAIL", href);
    ok(u.searchParams.get("subject") === "Продление доступа к Библиотеке", "тема письма", u.searchParams.get("subject"));
    ok(u.searchParams.get("body") === `Здравствуйте.\r\nХочу продлить доступ к библиотеке.\r\n\r\nИмя: Марина\r\nПочта в библиотеке: ${soon.email}\r\n`, "текст письма с именем и почтой", u.searchParams.get("body"));
    ok(/%D0%9F%D1%80%D0%BE%D0%B4%D0%BB/.test(href) && /%0D%0A/.test(href) && !/[а-яё\s]/i.test(href), "русские буквы и переносы закодированы (UTF-8, %0D%0A), пробелов в ссылке нет", href);
    const foot = await page.textContent(".terms-foot");
    ok(/^Вы приняли условия пользования \d+ [а-я]+ \d{4}\./.test(foot.trim()), "внизу профиля «Вы приняли условия пользования …»", foot);
    ok(!(await page.$(".terms-foot input, .terms-foot button")), "галочек и кнопок там нет");
    await page.evaluate(() => scrollTo(0, 0));
    await shot(page, `reader-yellow-${run.tag}`);
    await page.click(".terms-more summary");
    await page.click('.terms-foot a[href="/privacy.html"]');
    await page.waitForSelector("#privacy[open] #priv-body h2");
    await page.click("#privacy .dlg-foot [data-priv-close]");
    await page.waitForFunction(() => !document.querySelector("#privacy[open]"));
    ok(!page.url().includes("privacy") && /#\/profile/.test(page.url()), "в профиле ссылка из условий открывает политику окном");
    await page.$eval(".terms-foot", (el) => el.scrollIntoView({ block: "end" }));
    await shot(page, `reader-foot-${run.tag}`);
    await ctx.close();

    // 5. Срок закончился: красная полоска и сообщение в читалке
    ({ ctx, page } = await open(browser, { ...run, user: gone }));
    await page.goto(BASE + "/#/profile");
    await page.waitForSelector("#access-bar.off:not([hidden])");
    const red = await page.textContent("#access-text");
    ok(/^Срок доступа закончился \d+ [а-я]+( \d{4})?\. Книги сейчас не открываются, свои цитаты и заметки можно смотреть\. Чтобы продлить доступ или сделать пожертвование, напишите на owner@example\.com и укажите имя и почту, с которыми вы зарегистрированы в библиотеке\.$/.test(red), "красная полоска: новый текст", red);
    ok(/Чтобы продлить доступ или сделать пожертвование, напишите на owner@example\.com/.test(await page.textContent(".acc-line")), "строка в профиле: новый текст");
    await page.goto(BASE + "/#/");
    await shot(page, `reader-red-${run.tag}`);
    const books = (await req("GET", "/api/collections/books/records?perPage=50&filter=" + encodeURIComponent("hidden = false"), { token: await login(gone) })).data.items.filter((b) => (b.formats || []).length);
    if (books.length) {
      await page.goto(`${BASE}/#/read/${books[0].id}`);
      await page.waitForSelector(".rd-msg");
      const msg = await page.textContent(".rd-msg p");
      ok(/книги сейчас не открываются\. Чтобы продлить доступ или сделать пожертвование, напишите на owner@example\.com/.test(msg) && !!(await page.$(".rd-msg a[href^='mailto:']")), "в читалке новый текст и почта ссылкой", msg);
      await shot(page, `reader-rdfail-${run.tag}`);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`\nБраузер: проверок ${oks + fails}, прошло ${oks}, ошибок ${fails}.`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("Сбой проверки в браузере:", e); process.exit(1); });
