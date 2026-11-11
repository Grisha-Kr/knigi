#!/usr/bin/env node
// Проверка правок 4.3 в браузере (нужен Playwright с Chromium; если его нет, v43-check.sh этот шаг пропускает).
// Запускается из tools/v43-check.sh после tools/v43-check.mjs на том же сервере (пользователи уже созданы).
// Что проверяет: кнопка «Слушать» сразу включает звук с места, где читатель остановился, и открывает экран плеера;
// описание аудио видно читателю в карточке и на экране плеера.
const { chromium } = require("playwright");
const BASE = (process.env.KN_BASE || "http://127.0.0.1:8093").replace(/\/+$/, "");
let fails = 0, oks = 0;
const ok = (c, what, extra) => { if (c) { oks++; console.log("  ОК      " + what); } else { fails++; console.log("  ОШИБКА  " + what + (extra !== undefined ? "\n          " + JSON.stringify(extra) : "")); } };
async function req(method, path, token, json) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) }, body: json ? JSON.stringify(json) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const login = async (email, password) => (await req("POST", "/api/collections/users/auth-with-password", null, { identity: email, password })).data.token;
// MP3 с тишиной: кадры MPEG-1 Layer III 64 кбит/с, моно
function makeMp3(seconds) {
  const len = Math.floor(144 * 64000 / 44100), n = Math.ceil(seconds * 44100 / 1152);
  const f = Buffer.alloc(len); f[0] = 0xff; f[1] = 0xfb; f[2] = 5 << 4; f[3] = 0xc0;
  return Buffer.concat(Array(n).fill(f));
}
(async () => {
  console.log("\nБраузер. «Слушать» и описание аудио");
  const admin = await login("admin@example.com", "proverka-admin-12345");
  const anna = await login("anna@example.com", "proverka-anna-12345");
  const annaId = JSON.parse(Buffer.from(anna.split(".")[1], "base64url")).id;
  const book = (await req("POST", "/api/knigi/audio-books", admin, { title: "Проверка кнопки «Слушать»", authors: "Иван Чтецов" })).data.id;
  const add = async (title) => {
    const buf = makeMp3(120);
    let r = await req("POST", "/api/knigi/upload/start", admin, { name: title + ".mp3", size: buf.length, kind: "audio", book, title });
    const fd = new FormData(); fd.append("chunk", new Blob([buf]), "chunk");
    await fetch(`${BASE}/api/knigi/upload/${r.data.upload}/0`, { method: "POST", headers: { Authorization: admin }, body: fd });
    r = await req("POST", `/api/knigi/upload/${r.data.upload}/finish`, admin, {});
    await req("POST", `/api/knigi/audio/${r.data.track}`, admin, { published: true });
    return r.data.track;
  };
  const t1 = await add("Глава 1"), t2 = await add("Глава 2");
  await req("POST", `/api/knigi/books/${book}/readers`, admin, { users: [annaId] });
  await req("POST", `/api/knigi/books/${book}/audio-note`, admin, { text: "Подкаст по книге, сделан с помощью ИИ" });
  // Анна дослушала первую главу и остановилась на 40-й секунде второй
  await req("POST", `/api/knigi/audio/${t1}/progress`, anna, { pos: 120, done: true });
  await req("POST", `/api/knigi/audio/${t2}/progress`, anna, { pos: 40 });

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(BASE + "/");
  await page.waitForSelector("#auth input");
  const inputs = await page.$$("#auth input");
  await inputs[0].fill("anna@example.com"); await inputs[1].fill("proverka-anna-12345");
  await page.click("#auth button[type=submit]");
  await page.waitForSelector(".block", { timeout: 15000 });
  await page.goto(`${BASE}/#/b/${book}`);
  await page.waitForSelector(".listen-btn", { timeout: 10000 });
  ok((await page.$eval(".listen-btn", (e) => e.textContent.trim())) === "Слушать", "на кнопке просто «Слушать»");
  ok((await page.$eval(".audio-card .au-note", (e) => e.textContent).catch(() => "")) === "Подкаст по книге, сделан с помощью ИИ", "описание аудио видно читателю под заголовком «Аудио»");
  ok(!(await page.$('[data-act="au-head-menu"]')), "у читателя нет меню описания");
  await page.click(".listen-btn");
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => { const a = document.querySelector("audio"); return a && { t: a.currentTime, paused: a.paused, err: a.error && a.error.code }; });
  ok(/#\/listen\//.test(page.url()), "открылся экран плеера", page.url());
  ok(st && !st.paused && !st.err, "звук играет сразу после нажатия", st);
  ok(st && st.t >= 40 && st.t < 50, "с места, где читатель остановился (40 с второй главы)", st);
  ok((await page.$eval(".ap-head h1", (e) => e.textContent).catch(() => "")) === "Глава 2", "играет вторая глава (первая дослушана)");
  ok((await page.$eval(".ap-head .au-note", (e) => e.textContent).catch(() => "")) === "Подкаст по книге, сделан с помощью ИИ", "описание видно на экране плеера под названием книги");
  ok(!errs.length, "ошибок на странице нет", errs);
  await browser.close();
  await req("DELETE", `/api/knigi/books/${book}?notes=keep`, admin);
  console.log(`\nБраузер: проверок ${oks + fails}, прошло ${oks}, ошибок ${fails}.`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("Сбой проверки в браузере:", e); process.exit(1); });
