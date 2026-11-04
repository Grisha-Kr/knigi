// Файлы книг и уроков, обложки, тексты, загрузка частями, фоновая обработка,
// защищённые ссылки, журнал чтения и ограничение скорости.
// Подключается в обработчиках через require(`${__hooks}/files_lib.js`).

const MB = 1024 * 1024;
const GB = 1024 * MB;
const ID_ABC = "abcdefghijklmnopqrstuvwxyz0123456789";

/* ---------- Настройки из knigi.env ---------- */
function envNum(name, def) {
  const v = String($os.getenv(name) || "").trim();
  if (v === "") return def;
  const n = parseFloat(v.replace(",", "."));
  return isFinite(n) ? n : def;
}
function envFlag(name, def) {
  const v = String($os.getenv(name) || "").trim().toLowerCase();
  if (v === "") return def;
  return v === "1" || v === "true" || v === "yes" || v === "да";
}
const S = {
  watermark: () => envFlag("WATERMARK", true),
  readLog: () => envFlag("READ_LOG", true),
  logDays: () => Math.max(1, envNum("READ_LOG_DAYS", 180)),
  maxBytesHour: () => Math.max(0, envNum("MAX_MB_PER_HOUR", 200)) * MB, // 0 = без ограничения
  minFree: () => { const g = envNum("MIN_FREE_GB", 5); return (g >= 0 ? g : 5) * GB; },
};

/* ---------- Папки ---------- */
// Книги: BOOKS_DIR (по умолчанию /opt/knigi/books рядом с pb_data), внутри covers/ (обложки),
// text/ (текст PDF постранично) и .uploads/ (части загружаемых файлов).
// Файлы уроков: FILES_DIR (по умолчанию /opt/knigi/files).
function booksDir() { return $os.getenv("BOOKS_DIR") || $filepath.join($app.dataDir(), "..", "books"); }
function filesDir() { return $os.getenv("FILES_DIR") || $filepath.join($app.dataDir(), "..", "files"); }
function coversDir() { return $filepath.join(booksDir(), "covers"); }
function textDir() { return $filepath.join(booksDir(), "text"); }
function uploadsDir() { return $filepath.join(booksDir(), ".uploads"); }
function ensureDirs() {
  for (const d of [booksDir(), coversDir(), textDir(), uploadsDir(), filesDir()]) $os.mkdirAll(d, 0o750);
}
// Удалить файл вместе со служебным .attrs (его создаёт $filesystem.local)
function rmFile(dir, name) {
  if (!name || name.indexOf("/") >= 0 || name.indexOf("..") >= 0) return;
  for (const n of [name, name + ".attrs"]) { try { $os.remove($filepath.join(dir, n)); } catch (_) {} }
}
function fileSize(path) {
  try { return $os.stat(path).size(); } catch (_) { return -1; }
}
function exists(path) { return fileSize(path) >= 0; }
function newId() { return $security.randomStringWithAlphabet(15, ID_ABC); }
function randTail() { return $security.randomStringWithAlphabet(6, "abcdefghijkmnpqrstuvwxyz23456789"); }

// Свободное место на диске с книгами
function freeBytes() {
  const out = toString($os.cmd("df", "-Pk", booksDir()).output());
  const lines = out.trim().split("\n");
  const cols = lines[lines.length - 1].trim().split(/\s+/);
  return (parseInt(cols[3], 10) || 0) * 1024;
}
const gbText = (x) => (x / GB).toFixed(1).replace(".", ",");
function checkFree(need) {
  const free = freeBytes(), min = S.minFree();
  if (free - need < min) {
    throw new BadRequestError(`На диске сервера мало места: свободно ${gbText(free)} ГБ, а нужно оставить не меньше ${gbText(min)} ГБ (настройка MIN_FREE_GB). Удалите ненужные книги или попросите хостинг увеличить диск.`);
  }
}

/* ---------- Ключ, ссылки и кука ---------- */
// Ключ для подписи ссылок и кук. Лежит рядом с базой, создаётся сам при первом запуске.
function fileKey() {
  const path = $filepath.join($app.dataDir(), "files.key");
  try {
    const key = toString($os.readFile(path));
    if (key.length >= 32) return key;
  } catch (_) {}
  const key = $security.randomString(50);
  $os.writeFile(path, key, 0o600);
  return key;
}
const LINK_TTL = 2 * 3600;      // сколько живёт ссылка на файл книги или урока
const COOKIE_TTL = 12 * 3600;   // кука вошедшего человека, обновляется при каждой новой ссылке
const COOKIE = "kn_s";
const COOKIE_PATH = "/api/knigi/f";

function cookieValue(e, name) {
  const raw = String(e.request.header.get("Cookie") || "");
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}
function isHttps(e) {
  const proto = String(e.request.header.get("X-Forwarded-Proto") || "").toLowerCase();
  return e.isTLS() || proto === "https"; // на сервере https завершает Caddy, он же ставит заголовок
}
// Кука только для путей /api/knigi/f/..., недоступна странице (HttpOnly) и не уходит на другие сайты
// (SameSite=Strict). Поэтому пересланная ссылка в чужом браузере не открывается.
function setCookie(e, userId) {
  const token = $security.createJWT({ u: userId, c: 1 }, fileKey(), COOKIE_TTL);
  e.response.header().add("Set-Cookie",
    `${COOKIE}=${token}; Path=${COOKIE_PATH}; Max-Age=${COOKIE_TTL}; HttpOnly; SameSite=Strict` + (isHttps(e) ? "; Secure" : ""));
}
function clearCookie(e) {
  e.response.header().add("Set-Cookie", `${COOKIE}=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Strict` + (isHttps(e) ? "; Secure" : ""));
}
// Пользователь из куки (обложки) или ошибка
function cookieUser(e) {
  let c = null;
  try { c = $security.parseJWT(cookieValue(e, COOKIE), fileKey()); } catch (_) {}
  if (!c || !c.u) throw new UnauthorizedError("Войдите в библиотеку заново.");
  let u = null;
  try { u = $app.findRecordById("users", String(c.u)); } catch (_) {}
  if (!u) throw new UnauthorizedError("Войдите в библиотеку заново.");
  return u;
}
// Ссылка: kind = "book" или "file", id записи. Ключ в адресе и кука должны принадлежать одному человеку.
function makeLink(e, kind, id, userId) {
  setCookie(e, userId);
  const t = $security.createJWT({ k: kind, i: id, u: userId }, fileKey(), LINK_TTL);
  return `${COOKIE_PATH}/${kind}/${id}?t=${t}`;
}
function linkUser(e, kind, id) {
  const key = fileKey();
  let link = null, cookie = null;
  try { link = $security.parseJWT(String((e.requestInfo().query || {}).t || ""), key); } catch (_) {}
  if (!link || link.k !== kind || link.i !== id || !link.u) throw new UnauthorizedError("Ссылка устарела. Откройте книгу в приложении заново.");
  try { cookie = $security.parseJWT(cookieValue(e, COOKIE), key); } catch (_) {}
  if (!cookie || cookie.u !== link.u) {
    throw new UnauthorizedError("Этот файл открывается только в приложении, в том браузере, где выполнен вход.");
  }
  let u = null;
  try { u = $app.findRecordById("users", String(link.u)); } catch (_) {}
  if (!u) throw new UnauthorizedError("Войдите в библиотеку заново.");
  return u;
}
// Подпись на страницах: имя и почта читателя. Администратору не ставится.
function watermarkFor(user) {
  if (!S.watermark() || user.getString("role") === "admin") return "";
  const name = user.getString("name").trim();
  return [name, user.getString("email")].filter(Boolean).join(" · ");
}

/* ---------- Отдача частей файла (Range) ---------- */
const MAX_SPAN = 4 * MB; // больше за один запрос не отдаём: читалка просит куски по 512 КБ
function parseRange(h, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(h || "").trim());
  if (!m || size <= 0) return null;
  let start, end;
  if (m[1] === "") {
    const n = parseInt(m[2], 10);
    if (!n) return null;
    start = Math.max(0, size - n); end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === "" ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  }
  if (!(start >= 0) || start > end || start >= size) return null;
  return { start, end, len: end - start + 1 };
}
function noStore(e) {
  const h = e.response.header();
  h.set("Cache-Control", "private, no-store, max-age=0");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Robots-Tag", "noindex");
}

/* ---------- Ограничение скорости ---------- */
// Сколько байт книг отдано человеку за последний час: два счётчика по часам в памяти сервера
// (текущий и прошлый час), прошлый учитывается долей, которая ещё входит в последние 60 минут.
// После перезапуска приложения счёт начинается заново.
function hourIdx(t) { return Math.floor(t / 3600e3); }
function usedBytes(st, now) {
  if (!st) return 0;
  const h = hourIdx(now), frac = (now % 3600e3) / 3600e3;
  if (st.h === h) return st.cur + st.prev * (1 - frac);
  if (st.h === h - 1) return st.cur * (1 - frac);
  return 0;
}
// Через сколько минут можно будет снова получить n байт
function waitMinutes(st, now, limit, n) {
  for (let m = 1; m <= 120; m++) {
    if (usedBytes(st, now + m * 60e3) + n <= limit) return m;
  }
  return 60;
}
// Проверить лимит и учесть отдачу. Возвращает 0, если можно, иначе сколько минут ждать.
function takeBytes(userId, n) {
  const limit = S.maxBytesHour();
  if (!limit) return 0;
  const now = Date.now(), h = hourIdx(now);
  let wait = 0;
  $app.store().setFunc("kn_rate:" + userId, (old) => {
    let st = old || { h, cur: 0, prev: 0 };
    if (st.h !== h) st = { h, cur: 0, prev: st.h === h - 1 ? st.cur : 0 };
    if (usedBytes(st, now) + n > limit) {
      wait = waitMinutes(st, now, limit, Math.min(n, limit));
      return st;
    }
    return { h: st.h, cur: st.cur + n, prev: st.prev };
  });
  return wait;
}

/* ---------- Журнал чтения ---------- */
// Одна строка на (читатель, книга, час). Пишется прямым запросом к базе, чтобы одновременные
// запросы читалки не затирали счётчики друг друга.
const stamp = () => new Date().toISOString().replace("T", " ");
const hourKey = () => new Date().toISOString().slice(0, 13); // «2026-11-04T13», час по UTC
function logRow(userId, book) {
  const hour = hourKey(), t = stamp();
  $app.db().newQuery(`INSERT INTO read_log (id, "user", book, book_title, hour, pages, pages_seen, bytes_sent, over_limit, created, updated)
    VALUES ({:id}, {:u}, {:b}, {:title}, {:hour}, '[]', 0, 0, FALSE, {:t}, {:t})
    ON CONFLICT ("user", book, hour) DO NOTHING`)
    .bind({ id: newId(), u: userId, b: book.id, title: book.getString("title"), hour, t }).execute();
  return hour;
}
function logBytes(userId, book, n, over) {
  if (!S.readLog()) return;
  try {
    const hour = logRow(userId, book);
    $app.db().newQuery(`UPDATE read_log SET bytes_sent = bytes_sent + {:n}, over_limit = (over_limit OR {:o}), updated = {:t}
      WHERE "user" = {:u} AND book = {:b} AND hour = {:hour}`)
      .bind({ n, o: !!over, t: stamp(), u: userId, b: book.id, hour }).execute();
  } catch (err) {
    $app.logger().warn("Не удалось записать журнал чтения", "error", String(err));
  }
}
function logPages(userId, book, pages) {
  if (!S.readLog() || !pages.length) return;
  try {
    const hour = logRow(userId, book);
    const row = $app.findFirstRecordByFilter("read_log", "user = {:u} && book = {:b} && hour = {:h}", { u: userId, b: book.id, h: hour });
    let seen = [];
    try { seen = JSON.parse(toString(row.get("pages")) || "[]"); } catch (_) { seen = []; }
    if (!Array.isArray(seen)) seen = [];
    const set = {};
    for (const p of seen.concat(pages)) set[p] = 1;
    const all = Object.keys(set).map(Number).filter((x) => x > 0).sort((a, b) => a - b).slice(0, 5000);
    $app.db().newQuery("UPDATE read_log SET pages = {:p}, pages_seen = {:n}, updated = {:t} WHERE id = {:id}")
      .bind({ p: JSON.stringify(all), n: all.length, t: stamp(), id: row.id }).execute();
  } catch (err) {
    $app.logger().warn("Не удалось записать страницы в журнал", "error", String(err));
  }
}
function cleanLog() {
  const before = new Date(Date.now() - S.logDays() * 864e5).toISOString().slice(0, 13);
  $app.db().newQuery("DELETE FROM read_log WHERE hour < {:h}").bind({ h: before }).execute();
}

/* ---------- Загрузка частями ---------- */
// Файл идёт кусками по 8 МБ: каждый кусок отдельным запросом, сервер складывает их в .uploads/НОМЕР/,
// в конце склеивает. Так большой файл не упирается в ограничение времени одного запроса,
// оборвавшийся кусок отправляется заново, а память сервера не расходуется.
const CHUNK = 8 * MB;
const KINDS = {
  book: { exts: ["pdf", "epub", "djvu", "djv"], max: 500 * MB, about: "PDF, EPUB или DjVu до 500 МБ" },
  file: { exts: ["pdf", "doc", "docx", "ppt", "pptx", "jpg", "jpeg", "png", "webp", "gif", "heic"], max: 50 * MB,
    about: "PDF, DOC, DOCX, PPT, PPTX или изображение до 50 МБ" },
};
const extOf = (name) => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || "")); return m ? m[1].toLowerCase() : ""; };

function uploadDir(up) {
  if (!/^[a-z0-9]{20}$/.test(String(up || ""))) throw new BadRequestError("Неверный номер загрузки.");
  return $filepath.join(uploadsDir(), up);
}
function uploadMeta(up, userId) {
  let meta = null;
  try { meta = JSON.parse(toString($os.readFile($filepath.join(uploadDir(up), "meta.json")))); } catch (_) {}
  if (!meta || meta.user !== userId) throw new NotFoundError("Загрузка не найдена: начните её заново.");
  return meta;
}
function startUpload(e, body) {
  const kind = KINDS[body.kind] ? body.kind : "book";
  const rule = KINDS[kind];
  const name = String(body.name || "").trim().slice(0, 300);
  const size = parseInt(body.size, 10) || 0;
  const ext = extOf(name);
  if (rule.exts.indexOf(ext) < 0) throw new BadRequestError(`Подходит ${rule.about}. Файл «${name}» не подходит.`);
  if (size <= 0) throw new BadRequestError("Файл пустой.");
  if (size > rule.max) throw new BadRequestError(`Файл «${name}» больше, чем можно: ${rule.about}.`);
  let note = "";
  if (kind === "file") {
    let n = null;
    try { n = $app.findRecordById("notes", String(body.note || "")); } catch (_) {}
    if (!n || n.getString("owner") !== e.auth.id) throw new NotFoundError("Урок не найден.");
    if (n.getString("kind") !== "lesson") throw new BadRequestError("Файлы прикрепляются только к урокам.");
    note = n.id;
  }
  checkFree(size * 2); // куски и склеенный файл какое-то время лежат вместе
  const up = $security.randomStringWithAlphabet(20, ID_ABC);
  const dir = $filepath.join(uploadsDir(), up);
  $os.mkdirAll(dir, 0o750);
  const meta = { user: e.auth.id, kind, name, size, ext: ext === "djv" ? "djvu" : ext, note, chunks: Math.ceil(size / CHUNK), at: Date.now() };
  $os.writeFile($filepath.join(dir, "meta.json"), JSON.stringify(meta), 0o640);
  return { upload: up, chunk: CHUNK, chunks: meta.chunks };
}
function saveChunk(e, up, n) {
  const meta = uploadMeta(up, e.auth.id);
  n = parseInt(n, 10);
  if (!(n >= 0 && n < meta.chunks)) throw new BadRequestError("Неверный номер куска.");
  const files = e.findUploadedFiles("chunk");
  if (!files.length) throw new BadRequestError("Кусок файла не получен.");
  const f = files[0];
  const expect = n === meta.chunks - 1 ? meta.size - CHUNK * (meta.chunks - 1) : CHUNK;
  if (f.size !== expect) throw new BadRequestError("Кусок файла пришёл не целиком, отправьте его ещё раз.");
  const key = "c" + String(n).padStart(6, "0");
  const fs = $filesystem.local(uploadDir(up));
  try { fs.uploadFile(f, key); } finally { fs.close(); }
  return { ok: true };
}
// Склеить куски в файл dest. Возвращает true, если размер совпал.
function joinChunks(up, meta, dest) {
  const dir = uploadDir(up);
  for (let i = 0; i < meta.chunks; i++) {
    if (fileSize($filepath.join(dir, "c" + String(i).padStart(6, "0"))) < 0) throw new BadRequestError("Дошли не все куски файла. Загрузите его заново.");
  }
  $os.cmd("sh", "-c", 'cat "$1"/c?????? > "$2"', "sh", dir, dest).run();
  if (fileSize(dest) !== meta.size) {
    try { $os.remove(dest); } catch (_) {}
    throw new BadRequestError("Файл склеился неправильно. Загрузите его заново.");
  }
}
function dropUpload(up) { try { $os.removeAll(uploadDir(up)); } catch (_) {} }
// Брошенные загрузки старше суток
function cleanUploads() {
  let list = [];
  try { list = $os.readDir(uploadsDir()); } catch (_) { return; }
  for (const d of list) {
    const dir = $filepath.join(uploadsDir(), d.name());
    let meta = null;
    try { meta = JSON.parse(toString($os.readFile($filepath.join(dir, "meta.json")))); } catch (_) {}
    if (!meta || Date.now() - meta.at > 864e5) { try { $os.removeAll(dir); } catch (_) {} }
  }
}

// Название из имени файла: «Баундс Э. - Сила молитвы.pdf» → автор «Баундс Э.», название «Сила молитвы»
function fromFileName(name) {
  let s = String(name || "").replace(/\.[A-Za-z0-9]{1,8}$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  const m = /^(.{2,120}?)\s+[-–—]\s+(.{2,})$/.exec(s);
  if (m) return { title: m[2].trim(), authors: m[1].trim() };
  return { title: s || "Без названия", authors: "" };
}

function finishUpload(e, up) {
  const meta = uploadMeta(up, e.auth.id);
  const lib = require(`${__hooks}/lib.js`);
  ensureDirs();
  if (meta.kind === "file") {
    const id = newId();
    const file = `${id}.${meta.ext}`;
    joinChunks(up, meta, $filepath.join(filesDir(), file));
    dropUpload(up);
    const r = new Record($app.findCollectionByNameOrId("note_files"));
    r.set("id", id);
    r.set("note", meta.note);
    r.set("owner", e.auth.id);
    r.set("name", meta.name);
    r.set("ext", meta.ext);
    r.set("size", meta.size);
    r.set("file", file);
    r.set("sort", $app.countRecords("note_files", $dbx.hashExp({ note: meta.note })));
    try { $app.save(r); } catch (err) { rmFile(filesDir(), file); throw err; }
    return { id, kind: "file" };
  }
  const id = newId();
  const fmt = meta.ext === "djvu" ? "djvu" : meta.ext;
  const file = `${id}.${fmt}`;
  joinChunks(up, meta, $filepath.join(booksDir(), file));
  dropUpload(up);
  const guess = fromFileName(meta.name);
  const b = new Record($app.findCollectionByNameOrId("books"));
  b.set("id", id);
  b.set("title", guess.title.slice(0, 500));
  b.set("format", fmt);
  b.set("file", file);
  b.set("orig_name", meta.name);
  b.set("file_size", meta.size);
  b.set("status", "processing");
  if (guess.authors) b.set("authors", lib.splitAuthors(guess.authors).map((n) => lib.authorId($app, n)));
  try { $app.save(b); } catch (err) { rmFile(booksDir(), file); throw err; }
  return { id, kind: "book" };
}

/* ---------- Фоновая обработка ---------- */
// По одной книге за раз: свойства файла, страницы, обложка, текст. Запускается каждую минуту
// (cron) и сразу после загрузки (маршрут process). Если обработка уже идёт, второй запуск ничего не делает.
function tryLock() {
  let got = false;
  $app.store().setFunc("kn_proc", (old) => {
    const now = Date.now();
    if (old && now - old < 20 * 60e3) return old;
    got = true;
    return now;
  });
  return got;
}
function unlock() { $app.store().remove("kn_proc"); }
function beat() { $app.store().set("kn_proc", Date.now()); }

function run(args, timeoutSec) {
  // timeout не даёт зависшей программе держать очередь
  return toString($os.cmd("timeout", String(timeoutSec || 600), ...args).output());
}
function hasCmd(name) {
  try { $os.cmd("sh", "-c", 'command -v "$1" >/dev/null', "sh", name).run(); return true; } catch (_) { return false; }
}

// Похоже ли название из свойств файла на настоящее
function goodTitle(t) {
  t = String(t || "").trim();
  if (t.length < 2 || t.length > 400) return false;
  if (/^(untitled|unknown|title|document|документ|microsoft word|без названия|new document|\d+)$/i.test(t)) return false;
  if (/^microsoft (word|powerpoint)|\.(docx?|pdf|indd|qxd|rtf|txt|p65|pmd|cdr|ps)$|^[a-z]:\\|^\/|^\d{4,}[-_]/i.test(t)) return false;
  return true;
}

function pdfInfo(path) {
  const out = run(["pdfinfo", "-enc", "UTF-8", path], 120);
  const get = (k) => { const m = new RegExp("^" + k + ":[ \\t]*(.*)$", "m").exec(out); return m ? m[1].trim() : ""; };
  return { pages: parseInt(get("Pages"), 10) || 0, title: get("Title"), author: get("Author"), year: (/(1[5-9]\d\d|20\d\d)/.exec(get("CreationDate")) || [])[1] || "" };
}

// Обложка из первой страницы PDF: около 400 точек по ширине, JPEG
function pdfCover(path, id) {
  const name = `${id}-${randTail()}`;
  const prefix = $filepath.join(coversDir(), name);
  run(["pdftoppm", "-f", "1", "-l", "1", "-scale-to-x", "400", "-scale-to-y", "-1", "-jpeg", "-jpegopt", "quality=82", "-singlefile", path, prefix], 180);
  return exists(prefix + ".jpg") ? name + ".jpg" : "";
}

// Картинку любого размера уменьшить до 400 по ширине (через средства PocketBase)
function thumbCover(rawName, id) {
  const fs = $filesystem.local(coversDir());
  try {
    let head = "";
    try { head = toString($os.cmd("sh", "-c", 'head -c 4 "$1" | od -An -tx1', "sh", $filepath.join(coversDir(), rawName)).output()); } catch (_) {}
    const png = /89\s*50\s*4e\s*47/i.test(head);
    const name = `${id}-${randTail()}.${png ? "png" : "jpg"}`;
    fs.createThumb(rawName, name, "400x0");
    return name;
  } finally {
    fs.close();
    rmFile(coversDir(), rawName);
  }
}

// Текст PDF постранично: каждая страница начинается строкой «=== Страница N ===».
// Возвращает, сколько страниц с текстом (не меньше 30 знаков без пробелов).
function pdfText(path, id, pages) {
  const tmp = $filepath.join(textDir(), id + ".tmp");
  run(["pdftotext", "-enc", "UTF-8", path, tmp], 1800);
  let raw = "";
  try { raw = toString($os.readFile(tmp)); } catch (_) {}
  try { $os.remove(tmp); } catch (_) {}
  const parts = raw.split("\f");
  if (parts.length > 1 && !parts[parts.length - 1].trim()) parts.pop();
  let withText = 0, out = "";
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i].replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (t.replace(/\s+/g, "").length >= 30) withText++;
    out += `=== Страница ${i + 1} ===\n${t}\n\n`;
  }
  if (withText > 0) $os.writeFile($filepath.join(textDir(), id + ".txt"), out, 0o640);
  else rmFile(textDir(), id + ".txt");
  return { withText, total: Math.max(pages, parts.length) };
}

// EPUB: название, авторы, год и обложка из описания книги (content.opf внутри архива)
function epubMeta(path, id) {
  const res = { title: "", authors: [], year: "", description: "", cover: "" };
  const unzip = (entry) => run(["unzip", "-p", path, entry], 60);
  const container = unzip("META-INF/container.xml");
  const m = /full-path\s*=\s*"([^"]+)"/.exec(container);
  if (!m) return res;
  const opfPath = m[1];
  const opf = unzip(opfPath);
  const dec = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const t = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf);
  if (t) res.title = dec(t[1]);
  const re = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/gi;
  let c;
  while ((c = re.exec(opf))) res.authors.push(dec(c[1]));
  const d = /<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i.exec(opf);
  if (d) res.year = (/(1[5-9]\d\d|20\d\d)/.exec(d[1]) || [])[1] || "";
  const ds = /<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i.exec(opf);
  if (ds) res.description = dec(ds[1].replace(/&lt;[^&]*&gt;/g, " ")).slice(0, 5000);
  // обложка: элемент с properties="cover-image" (EPUB 3) или <meta name="cover" content="ID"> (EPUB 2)
  const items = opf.match(/<item\b[^>]*>/gi) || [];
  const attr = (tag, a) => { const x = new RegExp("\\b" + a + '\\s*=\\s*"([^"]*)"', "i").exec(tag); return x ? x[1] : ""; };
  let href = "";
  for (const it of items) if (/cover-image/.test(attr(it, "properties"))) href = attr(it, "href");
  if (!href) {
    const mc = /<meta\b[^>]*name\s*=\s*"cover"[^>]*>/i.exec(opf);
    const cid = mc ? attr(mc[0], "content") : "";
    for (const it of items) if (cid && attr(it, "id") === cid) href = attr(it, "href");
  }
  if (!href) for (const it of items) if (/cover/i.test(attr(it, "id") + attr(it, "href")) && /image\//.test(attr(it, "media-type"))) { href = attr(it, "href"); break; }
  if (href) {
    const base = opfPath.indexOf("/") >= 0 ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
    const entry = (base + decodeURIComponent(href)).replace(/[^/]+\/\.\.\//g, "");
    const raw = `${id}-raw-${randTail()}`;
    try {
      $os.cmd("sh", "-c", 'timeout 60 unzip -p "$1" "$2" > "$3"', "sh", path, entry, $filepath.join(coversDir(), raw)).run();
      if (fileSize($filepath.join(coversDir(), raw)) > 100) res.cover = thumbCover(raw, id);
      else rmFile(coversDir(), raw);
    } catch (err) {
      rmFile(coversDir(), raw);
    }
  }
  return res;
}

// DjVu: число страниц и обложка, если на сервере есть djvulibre-bin (ставит install.sh)
function djvuMeta(path, id) {
  const res = { pages: 0, cover: "" };
  if (!hasCmd("djvused")) return res;
  try { res.pages = parseInt(run(["djvused", "-e", "n", path], 60).trim(), 10) || 0; } catch (_) {}
  if (hasCmd("ddjvu")) {
    const tmp = $filepath.join(coversDir(), `${id}-p1.pdf`);
    try {
      run(["ddjvu", "-format=pdf", "-page=1", "-size=800x1200", path, tmp], 120);
      res.cover = pdfCover(tmp, id);
    } catch (_) {}
    try { $os.remove(tmp); } catch (_) {}
  }
  return res;
}

// Пересобрать PDF так, чтобы описания страниц лежали вместе (qpdf, «потоки объектов»).
// Содержимое страниц не меняется. Без этого в части файлов (сканы, PDF из простых программ) описание
// каждой страницы лежит рядом с её картинкой, и читалка, чтобы найти страницу 150, перебирает
// описания всех предыдущих: это почти весь файл. После пересборки книга открывается за 1-2 МБ.
// Если qpdf не справился (повреждённый или зашифрованный файл), остаётся исходный файл.
function optimizePdf(path, pages) {
  if (!hasCmd("qpdf")) return "";
  const tmp = path + ".qpdf";
  try {
    try { $os.cmd("timeout", "1800", "qpdf", "--object-streams=generate", "--stream-data=preserve", "--deterministic-id", path, tmp).run(); }
    catch (err) { if (!/exit status 3/.test(String(err))) throw err; } // 3 = предупреждения, файл готов
    const size = fileSize(tmp);
    if (size <= 0) throw new Error("пустой файл");
    if (pages && pdfInfo(tmp).pages !== pages) throw new Error("не совпало число страниц");
    $os.rename(tmp, path);
    return "";
  } catch (err) {
    try { $os.remove(tmp); } catch (_) {}
    $app.logger().warn("qpdf не пересобрал книгу, оставлен исходный файл", "file", path, "error", String(err));
    return "Файл не удалось пересобрать для быстрого открытия: толстая книга может открываться медленнее. ";
  }
}

function processBook(b) {
  const lib = require(`${__hooks}/lib.js`);
  const id = b.id;
  const path = $filepath.join(booksDir(), b.getString("file"));
  if (!exists(path)) throw new Error("файл книги не найден на диске");
  const fmt = b.getString("format");
  const fromName = fromFileName(b.getString("orig_name"));
  let title = "", authors = [], year = "", pages = 0, cover = "", hasText = false, note = "", description = "";

  // отпечаток исходного файла: по нему видны повторы
  let hash = "";
  try { hash = run(["sha256sum", path], 600).split(/\s+/)[0]; } catch (_) {}
  beat();
  if (fmt === "pdf") {
    const info = pdfInfo(path);
    pages = info.pages;
    note += optimizePdf(path, pages);
    beat();
    if (goodTitle(info.title)) title = info.title;
    authors = lib.splitAuthors(info.author); // год создания файла обычно не год книги: его не берём
    beat();
    try { cover = pdfCover(path, id); } catch (err) { note += "Обложка не получилась. "; }
    beat();
    const tx = pdfText(path, id, pages);
    if (!pages) pages = tx.total;
    hasText = pages > 0 && tx.withText / pages >= 0.2;
    if (!hasText) note += tx.withText ? "Текста мало: похоже на скан. " : "Скан без текста. ";
  } else if (fmt === "epub") {
    const m = epubMeta(path, id);
    if (goodTitle(m.title)) title = m.title;
    authors = m.authors.slice(0, 10);
    year = m.year;
    cover = m.cover;
    description = m.description;
  } else if (fmt === "djvu") {
    const m = djvuMeta(path, id);
    pages = m.pages;
    cover = m.cover;
  }
  beat();

  // свежая запись: пока шла обработка, администратор мог поправить данные
  const r = $app.findRecordById("books", id);
  // имя файла вида «Автор - Название» надёжнее свойств файла: тогда оставляем его
  const untouched = r.getString("title") === fromName.title.slice(0, 500) && (fmt === "epub" || !fromName.authors);
  if (title && untouched) r.set("title", title.slice(0, 500));
  if (authors.length && untouched) r.set("authors", authors.map((n) => lib.authorId($app, n)));
  if (year && !r.getInt("year")) r.set("year", parseInt(year, 10));
  if (description && !r.getString("description")) r.set("description", description);
  r.set("pages", pages);
  const size = fileSize(path);
  if (size > 0) r.set("file_size", size); // после пересборки размер чуть меняется
  r.set("has_text", hasText);
  if (cover) {
    rmFile(coversDir(), r.getString("cover"));
    r.set("cover", cover);
  }
  r.set("hash", hash);
  if (hash) {
    const twins = $app.findRecordsByFilter("books", "hash = {:h} && id != {:id}", "created", 1, 0, { h: hash, id });
    if (twins.length) note += `Похоже, это повтор книги «${twins[0].getString("title")}». `;
  }
  r.set("status_note", note.trim());
  r.set("status", "ready");
  $app.save(r);
}

function processQueue() {
  if (!tryLock()) return { busy: true, done: 0 };
  let done = 0;
  try {
    ensureDirs();
    for (let guard = 0; guard < 1000; guard++) {
      const list = $app.findRecordsByFilter("books", "status = 'processing'", "created", 1, 0);
      if (!list.length) break;
      const b = list[0];
      beat();
      try {
        processBook(b);
      } catch (err) {
        $app.logger().error("Не удалось обработать книгу", "book", b.id, "error", String(err));
        try {
          const r = $app.findRecordById("books", b.id);
          r.set("status", "error");
          r.set("status_note", "Не удалось обработать файл: " + String(err).slice(0, 300));
          $app.save(r);
        } catch (_) {}
      }
      done++;
    }
  } finally {
    unlock();
  }
  return { busy: false, done };
}

// Новая обложка от администратора: любая картинка до 10 МБ, сервер уменьшает её до 400 по ширине
function replaceCover(e, book) {
  const files = e.findUploadedFiles("cover");
  if (!files.length) throw new BadRequestError("Картинка не выбрана.");
  const f = files[0];
  if (f.size > 10 * MB) throw new BadRequestError("Картинка больше 10 МБ.");
  if (["jpg", "jpeg", "png", "webp", "gif"].indexOf(extOf(f.originalName)) < 0) throw new BadRequestError("Подходят JPG, PNG, WEBP и GIF.");
  ensureDirs();
  const raw = `${book.id}-raw-${randTail()}`;
  const fs = $filesystem.local(coversDir());
  try { fs.uploadFile(f, raw); } finally { fs.close(); }
  let name = "";
  try { name = thumbCover(raw, book.id); } catch (err) { throw new BadRequestError("Картинку не удалось прочитать. Попробуйте JPG или PNG."); }
  const old = book.getString("cover");
  book.set("cover", name);
  $app.save(book);
  rmFile(coversDir(), old);
  return name;
}

// Удаление книги: файл, текст, обложка, места на полках и прогресс чтения.
// Свои заметки и уроки администратор удаляет или оставляет без книги; заметки читателей остаются у них без книги.
function deleteBook(e, book, notesMode) {
  const lib = require(`${__hooks}/lib.js`);
  const title = book.getString("title");
  const authorIds = book.getStringSlice("authors");
  $app.runInTransaction((tx) => {
    for (const n of tx.findAllRecords("notes", $dbx.hashExp({ book: book.id }))) {
      if (n.getString("owner") === e.auth.id && notesMode === "delete") { tx.delete(n); continue; }
      n.set("book", "");
      n.set("book_title", title);
      tx.save(n);
    }
    tx.db().newQuery("UPDATE read_log SET book = '' WHERE book = {:b}").bind({ b: book.id }).execute();
    tx.delete(book);
  });
  rmFile(booksDir(), book.getString("file"));
  rmFile(textDir(), book.id + ".txt");
  rmFile(coversDir(), book.getString("cover"));
  lib.dropLonelyAuthors($app, authorIds);
}

module.exports = {
  MB, S, booksDir, filesDir, coversDir, textDir, ensureDirs, rmFile, exists, freeBytes, checkFree,
  fileKey, LINK_TTL, setCookie, clearCookie, cookieUser, makeLink, linkUser, watermarkFor,
  MAX_SPAN, parseRange, noStore, takeBytes, logBytes, logPages, cleanLog,
  CHUNK, KINDS, startUpload, saveChunk, finishUpload, dropUpload, uploadDir, cleanUploads, fromFileName,
  processQueue, replaceCover, deleteBook,
};
