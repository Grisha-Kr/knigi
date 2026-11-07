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
  // подпись читателя: both (поле внизу и центр), edge (только поле), center (только центр)
  watermarkMode: () => { const v = String($os.getenv("WATERMARK_MODE") || "").trim().toLowerCase(); return v === "edge" || v === "center" ? v : "both"; },
  // бледность надписи по центру в процентах (1–30), по умолчанию 4
  watermarkOpacity: () => Math.min(30, Math.max(1, envNum("WATERMARK_OPACITY", 4))),
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
// Как рисовать подпись (приложение получает вместе со ссылкой на файл)
function watermarkCfg() { return { mode: S.watermarkMode(), opacity: S.watermarkOpacity() }; }
function watermarkFor(user) {
  if (!S.watermark() || user.getString("role") === "admin") return "";
  const name = user.getString("name").trim();
  return [name, user.getString("email")].filter(Boolean).join(" · ");
}

/* ---------- Отдача частей файла (Range) ---------- */
const MAX_SPAN = 4 * MB; // больше за один запрос не отдаём: читалка просит куски по 512 КБ
const EPUB_MAX = 100 * MB; // EPUB отдаётся целиком: читалке нужен весь архив
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
// Форматы книг (правки 3.1): PDF, EPUB, DjVu (переводится в PDF), FB2, MOBI, AZW3, TXT (переводятся в EPUB).
// FB2 и TXT до 200 МБ: перевод держит текст в памяти, а больше текста в одной книге не бывает.
const BOOK_EXTS = ["pdf", "epub", "djvu", "djv", "fb2", "fbz", "zip", "mobi", "azw3", "txt"];
const BOOK_ABOUT = "PDF, EPUB, DjVu, FB2, MOBI, AZW3 или TXT до 500 МБ";
const TEXT_MAX = 200 * MB;
const KINDS = {
  book: { exts: BOOK_EXTS, max: 500 * MB, about: BOOK_ABOUT },
  // книга от читателя (правки 2.2): те же форматы и размер, попадает на проверку администратору
  offer: { exts: BOOK_EXTS, max: 500 * MB, about: BOOK_ABOUT },
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
// Книги от читателя: сколько у человека на проверке вместе с теми, что загружаются прямо сейчас
const OFFER_MAX = 3;
function offerUploads(userId, skip) {
  let n = 0, list = [];
  try { list = $os.readDir(uploadsDir()); } catch (_) { return 0; }
  for (const d of list) {
    if (d.name() === skip) continue;
    let meta = null;
    try { meta = JSON.parse(toString($os.readFile($filepath.join(uploadsDir(), d.name(), "meta.json")))); } catch (_) {}
    if (meta && meta.kind === "offer" && meta.user === userId && Date.now() - meta.at < 864e5) n++;
  }
  return n;
}
function offersPending(userId) {
  return $app.countRecords("book_offers", $dbx.hashExp({ user: userId, status: "pending" }));
}
function offerLimit(userId, skip) {
  if (offersPending(userId) + offerUploads(userId, skip) >= OFFER_MAX) {
    throw new BadRequestError(`На проверке уже ${OFFER_MAX} ваши книги. Дождитесь решения по ним, потом предложите следующую.`);
  }
}
function startUpload(e, body) {
  const kind = KINDS[body.kind] ? body.kind : "book";
  const rule = KINDS[kind];
  const name = String(body.name || "").trim().slice(0, 300);
  const size = parseInt(body.size, 10) || 0;
  const C = require(`${__hooks}/convert_lib.js`);
  const ext = extOf(name);
  const bookKind = kind === "book" || kind === "offer";
  const bf = bookKind ? C.fmtOfName(name) : null;
  if (rule.exts.indexOf(ext) < 0 || (bookKind && !bf.fmt)) throw new BadRequestError(`Подходит ${rule.about}. Файл «${name}» не подходит.`);
  if (size <= 0) throw new BadRequestError("Файл пустой.");
  if (size > rule.max) throw new BadRequestError(`Файл «${name}» больше, чем можно: ${rule.about}.`);
  if (bookKind && (bf.fmt === "fb2" || bf.fmt === "txt") && size > TEXT_MAX) throw new BadRequestError(`Файл «${name}» слишком большой для ${C.FMT_NAME[bf.fmt]}: можно до 200 МБ.`);
  let note = "", book = "";
  if (kind === "offer") {
    // роль проверяет маршрут: предлагают читатели, администратор добавляет книги сам
    offerLimit(e.auth.id, "");
    note = String(body.note || "").replace(/\s+/g, " ").trim().slice(0, 1000);
  }
  if (kind === "book" && body.book) {
    // ещё один формат к книге, которая уже есть
    let b = null;
    try { b = $app.findRecordById("books", String(body.book)); } catch (_) {}
    if (!b) throw new NotFoundError("Книга не найдена: возможно, её удалили.");
    const fmt = bf.fmt;
    if ($app.countRecords("book_files", $dbx.hashExp({ book: b.id, format: fmt })) > 0) {
      throw new BadRequestError(`У этой книги уже есть файл ${C.FMT_NAME[fmt]}. Сначала уберите его, потом загрузите новый.`);
    }
    book = b.id;
  }
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
  const meta = { user: e.auth.id, kind, name, size, ext: bf ? bf.ext : ext, fmt: bf ? bf.fmt : "", note, book, chunks: Math.ceil(size / CHUNK), at: Date.now() };
  if (kind === "offer") meta.note = note;
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
// Отпечаток файла (sha256): по нему видны повторы
function sha256(path) {
  try { return run(["sha256sum", path], 600).split(/\s+/)[0] || ""; } catch (_) { return ""; }
}
function uploadKind(up, userId) { return uploadMeta(up, userId).kind; }
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
  // у первого файла новой книги тот же номер, что у книги (так было и на этапе 1)
  const C = require(`${__hooks}/convert_lib.js`);
  const id = newId();
  const fmt = meta.fmt || C.fmtOfName(meta.name).fmt || meta.ext;
  // файл лежит с расширением оригинала (ID.pdf, ID.djvu, ID.fbz …); обработка переведёт его для читалки
  const file = `${id}.${meta.ext}`;
  joinChunks(up, meta, $filepath.join(booksDir(), file));
  dropUpload(up);
  if ((fmt === "mobi" || fmt === "azw3") && C.kindleDrm($filepath.join(booksDir(), file))) {
    rmFile(booksDir(), file);
    throw new BadRequestError("Эта книга защищена Kindle, загрузите версию без защиты.");
  }
  if (meta.kind === "offer") return finishOffer(e, meta, id, fmt, file);
  const fileRec = (bookId) => {
    const f = new Record($app.findCollectionByNameOrId("book_files"));
    f.set("id", id);
    f.set("book", bookId);
    f.set("format", fmt);
    f.set("file", file);
    f.set("orig_name", meta.name);
    f.set("file_size", meta.size);
    f.set("status", "processing");
    return f;
  };
  if (meta.book) {
    let b = null;
    try { b = $app.findRecordById("books", meta.book); } catch (_) {}
    if (!b) { rmFile(booksDir(), file); throw new NotFoundError("Книга не найдена: возможно, её удалили."); }
    try { $app.save(fileRec(b.id)); } catch (err) { rmFile(booksDir(), file); throw new BadRequestError(`У этой книги уже есть файл ${C.FMT_NAME[fmt] || fmt}.`); }
    syncBook(b.id);
    return { id: b.id, file: id, kind: "book" };
  }
  const guess = fromFileName(meta.name);
  const b = new Record($app.findCollectionByNameOrId("books"));
  b.set("id", id);
  b.set("title", guess.title.slice(0, 500));
  b.set("formats", [fmt]);
  b.set("file_size", meta.size);
  b.set("status", "processing");
  if (guess.authors) b.set("authors", lib.splitAuthors(guess.authors).map((n) => lib.authorId($app, n)));
  try {
    $app.runInTransaction((tx) => { tx.save(b); tx.save(fileRec(id)); });
  } catch (err) { rmFile(booksDir(), file); throw err; }
  return { id, file: id, kind: "book" };
}

/* ---------- Книги от читателей (правки 2.2) ---------- */
// Файл уже склеен в BOOKS_DIR. Если такой файл есть в библиотеке или уже на проверке, он удаляется
// и человек получает ответ. Иначе появляются книга (pending, видит только администратор), её файл
// (обрабатывается как обычно) и строка book_offers.
function finishOffer(e, meta, id, fmt, file) {
  const lib = require(`${__hooks}/lib.js`);
  const path = $filepath.join(booksDir(), file);
  const hash = sha256(path);
  if (hash) {
    const twins = $app.findRecordsByFilter("book_files", "hash = {:h}", "created", 0, 0, { h: hash });
    for (const t of twins) {
      let tb = null;
      try { tb = $app.findRecordById("books", t.getString("book")); } catch (_) {}
      if (!tb) continue;
      rmFile(booksDir(), file);
      if (tb.getBool("pending")) return { kind: "offer", pending: true, message: "Эта книга уже на проверке." };
      return { kind: "offer", duplicate: { id: tb.id, title: tb.getString("title") }, message: "Эта книга уже есть в библиотеке." };
    }
  }
  try { offerLimit(e.auth.id, ""); } catch (err) { rmFile(booksDir(), file); throw err; }
  const guess = fromFileName(meta.name);
  const b = new Record($app.findCollectionByNameOrId("books"));
  b.set("id", id);
  b.set("title", guess.title.slice(0, 500));
  b.set("formats", [fmt]);
  b.set("file_size", meta.size);
  b.set("status", "processing");
  b.set("pending", true);
  b.set("offered_by", e.auth.id);
  const f = new Record($app.findCollectionByNameOrId("book_files"));
  f.set("id", id);
  f.set("book", id);
  f.set("format", fmt);
  f.set("file", file);
  f.set("orig_name", meta.name);
  f.set("file_size", meta.size);
  f.set("status", "processing");
  f.set("hash", hash);
  const o = new Record($app.findCollectionByNameOrId("book_offers"));
  o.set("user", e.auth.id);
  o.set("book", id);
  o.set("title", guess.title.slice(0, 500));
  o.set("file_name", meta.name);
  o.set("file_size", meta.size);
  o.set("note", meta.note || "");
  o.set("status", "pending");
  try {
    $app.runInTransaction((tx) => {
      if (guess.authors) b.set("authors", lib.splitAuthors(guess.authors).map((n) => lib.authorId(tx, n)));
      tx.save(b); tx.save(f); tx.save(o);
    });
  } catch (err) { rmFile(booksDir(), file); throw err; }
  try { lib.mailNewOffer(o, e.auth); } catch (err) { $app.logger().warn("Письмо о новой книге", "error", String(err)); }
  return { kind: "offer", id: o.id };
}
function offerOf(id) {
  let o = null;
  try { o = $app.findRecordById("book_offers", id); } catch (_) {}
  if (!o) throw new NotFoundError("Предложение не найдено: возможно, его уже разобрали.");
  if (o.getString("status") !== "pending") throw new BadRequestError("По этой книге решение уже принято.");
  let b = null;
  try { b = $app.findRecordById("books", o.getString("book")); } catch (_) {}
  if (!b) throw new NotFoundError("Книга не найдена: возможно, её удалили.");
  if (b.getString("status") === "processing") throw new BadRequestError("Книга ещё обрабатывается. Подождите минуту и попробуйте снова.");
  return { o, b };
}
// Одобрить: книга становится видна всем, встаёт на выбранные общие полки
function approveOffer(e, id, shelves) {
  const lib = require(`${__hooks}/lib.js`);
  const { o, b } = offerOf(id);
  if (b.getString("status") === "error") throw new BadRequestError("Файл книги не удалось обработать. Такую книгу лучше отклонить.");
  const list = [];
  for (const sid of (Array.isArray(shelves) ? shelves : []).slice(0, 50)) {
    let s = null;
    try { s = $app.findRecordById("shelves", String(sid)); } catch (_) {}
    if (!s || !s.getBool("common")) throw new BadRequestError("Полка не найдена или она не общая.");
    if (list.indexOf(s.id) < 0) list.push(s.id);
  }
  $app.runInTransaction((tx) => {
    const r = tx.findRecordById("books", b.id);
    r.set("pending", false);
    tx.save(r);
    // файлы книги сохраняем заново: так приложения читателей сразу получают их живым обновлением
    for (const f of filesOf(b.id, tx)) tx.save(f);
    const col = tx.findCollectionByNameOrId("shelf_books");
    for (const sid of list) {
      if (tx.countRecords("shelf_books", $dbx.hashExp({ shelf: sid, book: b.id })) > 0) continue;
      const sb = new Record(col);
      sb.set("shelf", sid);
      sb.set("book", b.id);
      sb.set("sort", tx.countRecords("shelf_books", $dbx.hashExp({ shelf: sid })));
      tx.save(sb);
    }
    const x = tx.findRecordById("book_offers", o.id);
    x.set("status", "approved");
    x.set("title", r.getString("title"));
    x.set("decided_at", new Date().toISOString().replace("T", " "));
    tx.save(x);
  });
  try { lib.mailOfferDecision($app.findRecordById("book_offers", o.id)); } catch (_) {}
}
// Отклонить: книга, её файл, текст, обложка и авторы без книг удаляются, у человека «Отклонена» с причиной
function rejectOffer(e, id, reason) {
  const lib = require(`${__hooks}/lib.js`);
  reason = String(reason || "").replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!reason) throw new BadRequestError("Напишите причину: её увидит человек, который предложил книгу.");
  const { o, b } = offerOf(id);
  const x = $app.findRecordById("book_offers", o.id);
  x.set("status", "rejected");
  x.set("reason", reason);
  x.set("title", b.getString("title"));
  x.set("book", "");
  x.set("decided_at", new Date().toISOString().replace("T", " "));
  $app.save(x);
  deleteBook(e, b, "delete");
  try { lib.mailOfferDecision(x); } catch (_) {}
}

/* ---------- Сводка книги по её файлам ---------- */
const FMT_ORDER = { pdf: 0, epub: 1, djvu: 2, fb2: 3, mobi: 4, azw3: 5, txt: 6 };
const FMT_NAME = { pdf: "PDF", epub: "EPUB", djvu: "DjVu", fb2: "FB2", mobi: "MOBI", azw3: "AZW3", txt: "TXT" };
const VIEW = { pdf: "pdf", djvu: "pdf", epub: "epub", fb2: "epub", mobi: "epub", azw3: "epub", txt: "epub" };
function filesOf(bookId, app) {
  return (app || $app).findRecordsByFilter("book_files", "book = {:b}", "", 0, 0, { b: bookId })
    .sort((x, y) => (FMT_ORDER[x.getString("format")] ?? 9) - (FMT_ORDER[y.getString("format")] ?? 9));
}
// Форматы, состояние, страницы, есть ли текст и откуда он берётся: PDF со своим текстом, иначе
// книга для читалки EPUB (EPUB, FB2, MOBI, AZW3, TXT), иначе DjVu со спрятанным текстом или распознанный скан.
function syncBook(bookId, app) {
  app = app || $app;
  let b = null;
  try { b = app.findRecordById("books", bookId); } catch (_) { return; }
  const list = filesOf(bookId, app);
  const st = list.map((f) => f.getString("status"));
  const ok = (f) => f.getBool("has_text") && f.getString("status") === "ready";
  const isPdf = (f) => VIEW[f.getString("format")] === "pdf";
  const text = list.find((f) => ok(f) && f.getString("format") === "pdf" && !f.getBool("ocr")) ||
    list.find((f) => ok(f) && VIEW[f.getString("format")] === "epub") || list.find((f) => ok(f) && isPdf(f)) || null;
  const pdf = list.find((f) => isPdf(f) && f.getInt("pages") > 0);
  b.set("formats", list.map((f) => f.getString("format")));
  b.set("status", !list.length ? "error" : st.indexOf("processing") >= 0 ? "processing" : st.every((x) => x === "error") ? "error" : "ready");
  b.set("pages", pdf ? pdf.getInt("pages") : 0);
  b.set("has_text", !!text);
  b.set("text_file", text ? text.id : "");
  b.set("file_size", list.reduce((n, f) => n + f.getInt("file_size"), 0));
  const notes = list.filter((f) => f.getString("status_note")).map((f) => (list.length > 1 ? FMT_NAME[f.getString("format")] + ": " : "") + f.getString("status_note"));
  b.set("status_note", notes.join(" ").slice(0, 500));
  app.save(b);
}

/* ---------- Фоновая обработка ---------- */
// По одной книге за раз: свойства файла, страницы, обложка, текст. Запускается каждую минуту
// (cron) и сразу после загрузки (маршрут process). Если обработка уже идёт, второй запуск ничего не делает.
function tryLock() {
  let got = false;
  $app.store().setFunc("kn_proc", (old) => {
    const now = Date.now();
    // перевод большого DjVu идёт долго; если сервер перезапустится, замок пропадёт сам (он в памяти)
    if (old && now - old < 6 * 3600e3) return old;
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
function epubMeta(path, id, needCover) {
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
  if (href && needCover) {
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

// Текст EPUB по разделам (файлам книги в порядке чтения): каждый раздел начинается строкой
// «=== Раздел N: название ===» (название из оглавления, иначе из первого заголовка). Так же, как у PDF,
// файл text/НОМЕР_ФАЙЛА.txt нужен для этапа 3. Возвращает, сколько знаков текста без пробелов.
function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return " "; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return " "; } })
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&hellip;/g, "…").replace(/&laquo;/g, "«").replace(/&raquo;/g, "»")
    .replace(/&amp;/g, "&");
}
function htmlText(html) {
  return decodeEntities(String(html || "")
    .replace(/<head[\s\S]*?<\/head>/i, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section|article|dd|dt|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function epubText(path, fid) {
  const unzip = (entry) => run(["unzip", "-p", path, entry], 60);
  const m = /full-path\s*=\s*"([^"]+)"/.exec(unzip("META-INF/container.xml"));
  if (!m) return 0;
  const opfPath = m[1];
  const base = opfPath.indexOf("/") >= 0 ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const opf = unzip(opfPath);
  const attr = (tag, a) => { const x = new RegExp("\\b" + a + '\\s*=\\s*"([^"]*)"', "i").exec(tag); return x ? x[1] : ""; };
  const entryOf = (dir, href) => {
    let p = dir + decodeURIComponent(String(href || "").split("#")[0]);
    for (let g = 0; g < 10 && /[^/]+\/\.\.\//.test(p); g++) p = p.replace(/[^/]+\/\.\.\//, "");
    return p.replace(/^\.\//, "");
  };
  const items = {};
  let navHref = "", ncxHref = "";
  for (const it of opf.match(/<item\b[^>]*>/gi) || []) {
    items[attr(it, "id")] = { href: attr(it, "href"), type: attr(it, "media-type") };
    if (/\bnav\b/.test(attr(it, "properties"))) navHref = attr(it, "href");
    if (/ncx/.test(attr(it, "media-type"))) ncxHref = attr(it, "href");
  }
  // названия разделов из оглавления: файл раздела → первое название
  const labels = {};
  const addLabel = (dir, href, label) => {
    const key = entryOf(dir, href);
    label = htmlText(label).replace(/\s+/g, " ").trim();
    if (label && !labels[key]) labels[key] = label.slice(0, 200);
  };
  try {
    if (navHref) {
      const navEntry = entryOf(base, navHref), navDir = navEntry.indexOf("/") >= 0 ? navEntry.slice(0, navEntry.lastIndexOf("/") + 1) : "";
      const nav = unzip(navEntry);
      const toc = /<nav\b[^>]*toc[^>]*>([\s\S]*?)<\/nav>/i.exec(nav);
      const re = /<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let a;
      while ((a = re.exec(toc ? toc[1] : nav))) addLabel(navDir, a[1], a[2]);
    } else if (ncxHref) {
      const ncxEntry = entryOf(base, ncxHref), ncxDir = ncxEntry.indexOf("/") >= 0 ? ncxEntry.slice(0, ncxEntry.lastIndexOf("/") + 1) : "";
      const ncx = unzip(ncxEntry);
      const re = /<navPoint\b[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\b[^>]*src\s*=\s*"([^"]*)"/gi;
      let a;
      while ((a = re.exec(ncx))) addLabel(ncxDir, a[2], a[1]);
    }
  } catch (_) {}
  let out = "", total = 0, n = 0;
  for (const ref of opf.match(/<itemref\b[^>]*>/gi) || []) {
    const it = items[attr(ref, "idref")];
    if (!it || !/html|xml/.test(it.type)) continue;
    const entry = entryOf(base, it.href);
    let html = "";
    try { html = unzip(entry); } catch (_) { continue; }
    const text = htmlText(html);
    if (!text) continue;
    n++;
    total += text.replace(/\s+/g, "").length;
    const h = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html) || /<title>([\s\S]*?)<\/title>/i.exec(html);
    const label = labels[entry] || (h ? htmlText(h[1]).replace(/\s+/g, " ").slice(0, 200) : "");
    out += `=== Раздел ${n}${label ? ": " + label : ""} ===\n${text}\n\n`;
    beat();
  }
  if (total >= 500) $os.writeFile($filepath.join(textDir(), fid + ".txt"), out, 0o640);
  else rmFile(textDir(), fid + ".txt");
  return total;
}

// DjVu: число страниц и обложка, если на сервере есть djvulibre-bin (ставит install.sh)
function djvuMeta(path, id, needCover) {
  const res = { pages: 0, cover: "" };
  if (!hasCmd("djvused")) return res;
  try { res.pages = parseInt(run(["djvused", "-e", "n", path], 60).trim(), 10) || 0; } catch (_) {}
  if (needCover && hasCmd("ddjvu")) {
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

// Обработка одного файла книги. Название и авторы из файла ставятся, только если файл у книги
// единственный, администратор не правил название и имя файла не вида «Автор - Название».
// Год и описание заполняются, если пусто. Обложка из файла ставится, только если у книги её нет.
// Правки 3.1: DjVu сначала переводится в PDF, FB2, MOBI, AZW3 и TXT в EPUB (tools/knigi_convert.py),
// дальше всё как у PDF и EPUB. Оригинал остаётся рядом (orig_file), отпечаток считается по оригиналу.
function processFile(f) {
  const lib = require(`${__hooks}/lib.js`);
  const C = require(`${__hooks}/convert_lib.js`);
  const id = f.id;
  const bookId = f.getString("book");
  const fmt = f.getString("format");
  const view = VIEW[fmt] || fmt;
  let path = $filepath.join(booksDir(), f.getString("file"));
  const fromName = fromFileName(f.getString("orig_name"));
  const book0 = $app.findRecordById("books", bookId);
  const needCover = !book0.getString("cover");
  let title = "", authors = [], year = "", pages = 0, cover = "", hasText = false, note = "", description = "";
  let fileName = f.getString("file"), origFile = f.getString("orig_file"), origSize = f.getInt("orig_size"), ocr = f.getBool("ocr");

  // отпечаток оригинала: по нему видны повторы
  let hash = "";
  if (view !== fmt) {
    // перевод: из оригинала (при повторной обработке он лежит в orig_file) в ID.pdf или ID.epub
    const srcName = origFile || fileName;
    const src = $filepath.join(booksDir(), srcName);
    if (!exists(src)) throw new Error("файл книги не найден на диске");
    try { hash = run(["sha256sum", src], 600).split(/\s+/)[0]; } catch (_) {}
    beat();
    const outName = `${id}.${view}`;
    const out = $filepath.join(booksDir(), outName);
    const tmp = out + ".part";
    try { $os.remove(tmp); } catch (_) {}
    let res;
    try {
      res = C.convert(fmt, src, tmp, id, { title: fromName.title, author: fromName.authors });
      if (fileSize(tmp) <= 0) throw new Error("пустой файл после перевода");
      $os.rename(tmp, out);
    } catch (err) {
      try { $os.remove(tmp); } catch (_) {}
      throw new Error(String(err && err.message || err).replace(/^Error:\s*/, ""));
    }
    beat();
    origFile = srcName;
    origSize = fileSize(src);
    fileName = outName;
    path = out;
    ocr = false; // файл собран заново: распознанного слоя в нём больше нет
  } else {
    if (!exists(path)) throw new Error("файл книги не найден на диске");
    try { hash = run(["sha256sum", path], 600).split(/\s+/)[0]; } catch (_) {}
    // у распознанного скана файл уже не тот, что загружали: отпечаток оставляем от оригинала
    if (ocr && f.getString("hash")) hash = f.getString("hash");
  }
  beat();
  if (view === "pdf") {
    const info = pdfInfo(path);
    pages = info.pages;
    note += optimizePdf(path, pages);
    beat();
    if (fmt === "pdf") {
      if (goodTitle(info.title)) title = info.title;
      authors = lib.splitAuthors(info.author); // год создания файла обычно не год книги: его не берём
    }
    beat();
    if (needCover) { try { cover = pdfCover(path, bookId); } catch (err) { note += "Обложка не получилась. "; } }
    beat();
    const tx = pdfText(path, id, pages);
    if (!pages) pages = tx.total;
    hasText = pages > 0 && tx.withText / pages >= 0.2;
    if (!hasText) note += tx.withText ? "Текста мало: похоже на скан. " : "Скан без текста. ";
  } else if (view === "epub") {
    const m = epubMeta(path, bookId, needCover);
    if (goodTitle(m.title) && fmt !== "txt") title = m.title;
    authors = fmt === "txt" ? [] : m.authors.slice(0, 10);
    year = m.year;
    cover = m.cover;
    description = m.description;
    beat();
    try { hasText = epubText(path, id) >= 500; } catch (err) { $app.logger().warn("Текст EPUB не извлечён", "file", id, "error", String(err)); }
    if (!hasText) note += "В файле почти нет текста. ";
  }
  beat();

  // свежие записи: пока шла обработка, администратор мог поправить данные
  const r = $app.findRecordById("books", bookId);
  const only = $app.countRecords("book_files", $dbx.hashExp({ book: bookId })) <= 1;
  // имя файла вида «Автор - Название» надёжнее свойств PDF; у EPUB, FB2, MOBI свойства надёжнее имени
  const metaFirst = view === "epub" && fmt !== "txt";
  const untouched = only && r.getString("title") === fromName.title.slice(0, 500) && (metaFirst || !fromName.authors);
  if (title && untouched) r.set("title", title.slice(0, 500));
  if (authors.length && untouched) r.set("authors", authors.map((n) => lib.authorId($app, n)));
  if (year && !r.getInt("year")) r.set("year", parseInt(year, 10));
  if (description && !r.getString("description")) r.set("description", description);
  if (cover) {
    if (r.getString("cover")) rmFile(coversDir(), cover); // обложку успели поставить вручную
    else r.set("cover", cover);
  }
  $app.save(r);
  const fr = $app.findRecordById("book_files", id);
  fr.set("file", fileName);
  fr.set("orig_file", origFile === fileName ? "" : origFile);
  fr.set("orig_size", origFile && origFile !== fileName ? origSize : 0);
  fr.set("ocr", ocr && hasText);
  fr.set("pages", pages);
  const size = fileSize(path);
  if (size > 0) fr.set("file_size", size); // после пересборки размер чуть меняется
  fr.set("has_text", hasText);
  fr.set("hash", hash);
  if (hash) {
    const twins = $app.findRecordsByFilter("book_files", "hash = {:h} && id != {:id} && book != {:b}", "created", 1, 0, { h: hash, id, b: bookId });
    if (twins.length) {
      let tb = null;
      try { tb = $app.findRecordById("books", twins[0].getString("book")); } catch (_) {}
      if (tb) note += `Похоже, это повтор книги «${tb.getString("title")}». `;
    }
  }
  fr.set("status_note", note.trim());
  fr.set("status", "ready");
  $app.save(fr);
  syncBook(bookId);
}

function processQueue() {
  if (!tryLock()) return { busy: true, done: 0 };
  let done = 0;
  try {
    ensureDirs();
    let paused = false;
    for (let guard = 0; guard < 1000; guard++) {
      const list = $app.findRecordsByFilter("book_files", "status = 'processing'", "created", 1, 0);
      if (!list.length) break;
      const f = list[0];
      beat();
      // распознавание стоит на паузе, пока переводится новая книга: тяжёлая работа идёт по одной
      if (!paused) { try { require(`${__hooks}/convert_lib.js`).ocrPause(true); } catch (_) {} paused = true; }
      try {
        processFile(f);
      } catch (err) {
        $app.logger().error("Не удалось обработать файл книги", "file", f.id, "book", f.getString("book"), "error", String(err));
        try {
          const r = $app.findRecordById("book_files", f.id);
          r.set("status", "error");
          r.set("status_note", "Не удалось обработать файл: " + String(err).slice(0, 300));
          $app.save(r);
          syncBook(r.getString("book"));
        } catch (_) {}
      }
      done++;
    }
    if (paused) { try { require(`${__hooks}/convert_lib.js`).ocrPause(false); } catch (_) {} }
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
  const files = filesOf(book.id).map((f) => ({ id: f.id, file: f.getString("file"), orig: f.getString("orig_file") }));
  for (const f of files) { try { require(`${__hooks}/convert_lib.js`).ocrCancelFile(f.id, "Книгу удалили."); } catch (_) {} }
  $app.runInTransaction((tx) => {
    for (const n of tx.findAllRecords("notes", $dbx.hashExp({ book: book.id }))) {
      if (n.getString("owner") === e.auth.id && notesMode === "delete") { tx.delete(n); continue; }
      n.set("book", "");
      n.set("book_title", title);
      tx.save(n);
    }
    tx.db().newQuery("UPDATE read_log SET book = '' WHERE book = {:b}").bind({ b: book.id }).execute();
    // книгу на проверке удалили из карточки: у человека она «Отклонена»
    tx.db().newQuery(`UPDATE book_offers SET status = 'rejected', reason = 'Администратор удалил книгу.', decided_at = {:t}, title = {:title}
      WHERE book = {:b} AND status = 'pending'`).bind({ b: book.id, t: new Date().toISOString().replace("T", " "), title }).execute();
    tx.db().newQuery("UPDATE book_offers SET book = '' WHERE book = {:b}").bind({ b: book.id }).execute();
    tx.delete(book); // файлы книги, места на полках и прогресс удаляются каскадом
  });
  for (const f of files) { rmFile(booksDir(), f.file); rmFile(booksDir(), f.orig); rmFile(textDir(), f.id + ".txt"); }
  rmFile(coversDir(), book.getString("cover"));
  lib.dropLonelyAuthors($app, authorIds);
}

// Убрать один формат книги (не последний): файл, текст, прогресс по этому формату
// и выделения в нём у всех. Заметки остаются (у них только пропадает ссылка на место в файле).
function formatInfo(f) {
  const q = { b: f.getString("book"), f: f.getString("format") };
  return {
    highlights: $app.countRecords("notes", $dbx.exp("book = {:b} AND format = {:f} AND kind = 'highlight'", q)),
    readers: $app.countRecords("reading", $dbx.exp("book = {:b} AND format = {:f}", q)),
    last: $app.countRecords("book_files", $dbx.hashExp({ book: q.b })) <= 1,
  };
}
function removeFormat(f) {
  const bookId = f.getString("book"), fmt = f.getString("format");
  if (formatInfo(f).last) throw new BadRequestError("Это последний формат книги. Чтобы убрать его, удалите книгу целиком.");
  try { require(`${__hooks}/convert_lib.js`).ocrCancelFile(f.id, "Формат убрали из книги."); } catch (_) {}
  $app.runInTransaction((tx) => {
    const q = { b: bookId, f: fmt };
    tx.db().newQuery("DELETE FROM notes WHERE book = {:b} AND format = {:f} AND kind = 'highlight'").bind(q).execute();
    tx.db().newQuery("UPDATE notes SET format = '' WHERE book = {:b} AND format = {:f}").bind(q).execute();
    tx.db().newQuery("DELETE FROM reading WHERE book = {:b} AND format = {:f}").bind(q).execute();
    tx.delete(tx.findRecordById("book_files", f.id));
  });
  rmFile(booksDir(), f.getString("file"));
  rmFile(booksDir(), f.getString("orig_file"));
  rmFile(textDir(), f.id + ".txt");
  syncBook(bookId);
}

// Объединить книгу other с книгой book: остаётся book (из её карточки начали объединение).
// Файлы, полки, заметки, выделения, уроки, прогресс и журнал второй книги переходят к первой.
// Пустые год, описание и обложка первой берутся у второй. Если у обеих есть файл одного формата, нельзя.
function mergeInfo(book, other) {
  const a = filesOf(book.id).map((f) => f.getString("format"));
  const b = filesOf(other.id).map((f) => f.getString("format"));
  const kinds = {};
  for (const k of ["note", "lesson", "highlight"]) kinds[k] = $app.countRecords("notes", $dbx.hashExp({ book: other.id, kind: k }));
  return {
    formats: b, conflict: b.filter((x) => a.indexOf(x) >= 0),
    shelves: $app.countRecords("shelf_books", $dbx.hashExp({ book: other.id })),
    notes: kinds.note, lessons: kinds.lesson, highlights: kinds.highlight,
    readers: $app.findRecordsByFilter("reading", "book = {:b}", "", 0, 0, { b: other.id }).map((r) => r.getString("user")).filter((u, i, arr) => arr.indexOf(u) === i).length,
  };
}
function mergeBooks(book, other) {
  const lib = require(`${__hooks}/lib.js`);
  if (book.id === other.id) throw new BadRequestError("Это одна и та же книга.");
  if (book.getBool("pending") || other.getBool("pending")) throw new BadRequestError("Книга на проверке. Сначала одобрите её, потом объединяйте.");
  const info = mergeInfo(book, other);
  if (info.conflict.length) {
    throw new BadRequestError(`У обеих книг есть файл ${info.conflict.map((x) => FMT_NAME[x]).join(" и ")}. Сначала уберите лишний формат в одной из них.`);
  }
  const otherAuthors = other.getStringSlice("authors");
  const otherCover = other.getString("cover");
  let keepCover = false;
  $app.runInTransaction((tx) => {
    const q = { a: book.id, b: other.id, t: book.getString("title") };
    const db = tx.db();
    db.newQuery("UPDATE book_files SET book = {:a} WHERE book = {:b}").bind(q).execute();
    // полки: если первая книга уже стоит на той же полке, место второй просто убирается
    db.newQuery("DELETE FROM shelf_books WHERE book = {:b} AND shelf IN (SELECT shelf FROM shelf_books WHERE book = {:a})").bind(q).execute();
    db.newQuery("UPDATE shelf_books SET book = {:a} WHERE book = {:b}").bind(q).execute();
    db.newQuery("UPDATE notes SET book = {:a}, book_title = {:t} WHERE book = {:b}").bind(q).execute();
    // группы чтения (этап 3): книга группы, её история и учёт чтения по дням переходят к первой книге
    db.newQuery('UPDATE "groups" SET book = {:a} WHERE book = {:b}').bind(q).execute();
    db.newQuery("UPDATE group_books SET book = {:a}, book_title = {:t} WHERE book = {:b}").bind(q).execute();
    db.newQuery("UPDATE group_members SET book_seen = {:a} WHERE book_seen = {:b}").bind(q).execute();
    db.newQuery(`DELETE FROM group_reads WHERE book = {:b} AND EXISTS (SELECT 1 FROM group_reads a WHERE a.book = {:a} AND a."user" = group_reads."user" AND a.day = group_reads.day)`).bind(q).execute();
    db.newQuery("UPDATE group_reads SET book = {:a} WHERE book = {:b}").bind(q).execute();
    db.newQuery("UPDATE book_offers SET book = {:a} WHERE book = {:b}").bind(q).execute();
    db.newQuery("UPDATE ocr_jobs SET book = {:a}, book_title = {:t} WHERE book = {:b}").bind(q).execute();
    // отметки «Читаю» и «Прочитано»: если у человека есть отметка у первой книги, вторая просто убирается
    db.newQuery(`DELETE FROM marks WHERE book = {:b} AND EXISTS (SELECT 1 FROM marks m WHERE m.book = {:a} AND m."user" = marks."user")`).bind(q).execute();
    db.newQuery("UPDATE marks SET book = {:a} WHERE book = {:b}").bind(q).execute();
    db.newQuery(`DELETE FROM reading WHERE book = {:b} AND EXISTS (SELECT 1 FROM reading r WHERE r.book = {:a} AND r."user" = reading."user" AND r.format = reading.format)`).bind(q).execute();
    db.newQuery("UPDATE reading SET book = {:a} WHERE book = {:b}").bind(q).execute();
    // журнал: строки за один час складываются
    db.newQuery(`UPDATE read_log SET bytes_sent = bytes_sent + COALESCE((SELECT o.bytes_sent FROM read_log o WHERE o.book = {:b} AND o."user" = read_log."user" AND o.hour = read_log.hour), 0),
        pages_seen = MAX(pages_seen, COALESCE((SELECT o.pages_seen FROM read_log o WHERE o.book = {:b} AND o."user" = read_log."user" AND o.hour = read_log.hour), 0)),
        over_limit = (over_limit OR COALESCE((SELECT o.over_limit FROM read_log o WHERE o.book = {:b} AND o."user" = read_log."user" AND o.hour = read_log.hour), FALSE))
      WHERE book = {:a} AND EXISTS (SELECT 1 FROM read_log o WHERE o.book = {:b} AND o."user" = read_log."user" AND o.hour = read_log.hour)`).bind(q).execute();
    db.newQuery(`DELETE FROM read_log WHERE book = {:b} AND EXISTS (SELECT 1 FROM read_log a WHERE a.book = {:a} AND a."user" = read_log."user" AND a.hour = read_log.hour)`).bind(q).execute();
    db.newQuery("UPDATE read_log SET book = {:a}, book_title = {:t} WHERE book = {:b}").bind(q).execute();
    const a = tx.findRecordById("books", book.id);
    if (!a.getInt("year") && other.getInt("year")) a.set("year", other.getInt("year"));
    if (!a.getString("description") && other.getString("description")) a.set("description", other.getString("description"));
    if (!a.getString("cover") && otherCover) { a.set("cover", otherCover); keepCover = true; }
    if (!a.getStringSlice("authors").length && otherAuthors.length) a.set("authors", otherAuthors);
    tx.save(a);
    tx.delete(tx.findRecordById("books", other.id));
  });
  if (otherCover && !keepCover) rmFile(coversDir(), otherCover);
  lib.dropLonelyAuthors($app, otherAuthors);
  syncBook(book.id);
}

module.exports = {
  MB, S, booksDir, filesDir, coversDir, textDir, ensureDirs, rmFile, exists, freeBytes, checkFree,
  fileKey, LINK_TTL, setCookie, clearCookie, cookieUser, makeLink, linkUser, watermarkFor, watermarkCfg,
  MAX_SPAN, EPUB_MAX, parseRange, noStore, takeBytes, logBytes, logPages, cleanLog,
  CHUNK, KINDS, startUpload, saveChunk, finishUpload, dropUpload, uploadDir, uploadKind, cleanUploads, fromFileName,
  OFFER_MAX, approveOffer, rejectOffer,
  processQueue, replaceCover, deleteBook, filesOf, syncBook, FMT_NAME, VIEW, formatInfo, removeFormat, mergeInfo, mergeBooks, htmlText,
  pdfInfo, optimizePdf, pdfText, fileSize, newId,
};
