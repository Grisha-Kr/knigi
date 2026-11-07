/// <reference path="../pb_data/types.d.ts" />

// Сервер «Библиотеки»: правила, которые не выразить правилами коллекций, и свои маршруты.
// Общие функции в lib.js (полки, заметки, письма) и files_lib.js (файлы, обработка, ссылки, журнал).
// В обработчиках код верхнего уровня этого файла недоступен, поэтому каждый подключает их через require.

/* ---------- Регистрация ---------- */
// Первый пользователь становится администратором, все следующие регистрируются только по приглашению.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) { e.next(); return; }
  const invite = require(`${__hooks}/lib.js`).checkRegistration(e);
  e.next();
  if (invite) {
    invite.set("uses", invite.getInt("uses") + 1);
    invite.set("used_by", invite.getStringSlice("used_by").concat([e.record.id]));
    $app.save(invite);
  }
}, "users");

// Кто создал приглашение, записывает сервер.
onRecordCreateRequest((e) => {
  if (e.auth) e.record.set("created_by", e.auth.id);
  e.record.set("uses", 0);
  e.record.set("used_by", []);
  e.next();
}, "invites");

/* ---------- Авторы и книги ---------- */
// Имя для сортировки и строка поиска ставятся сами при любом сохранении.
onRecordCreate((e) => {
  const lib = require(`${__hooks}/lib.js`);
  const name = e.record.getString("name").replace(/\s+/g, " ").trim();
  e.record.set("name", name);
  if (!e.record.getString("sort_name").trim()) e.record.set("sort_name", lib.sortName(name));
  e.record.set("search", lib.norm(name));
  e.next();
}, "authors");
onRecordUpdate((e) => {
  const lib = require(`${__hooks}/lib.js`);
  const o = e.record.original();
  const name = e.record.getString("name").replace(/\s+/g, " ").trim();
  e.record.set("name", name);
  // имя поменяли, а фамилию для сортировки нет: пересчитываем
  if (!e.record.getString("sort_name").trim() || (name !== o.getString("name") && e.record.getString("sort_name") === o.getString("sort_name"))) {
    e.record.set("sort_name", lib.sortName(name));
  }
  e.record.set("search", lib.norm(name));
  e.next();
}, "authors");
// Автора переименовали: у его книг обновляется строка поиска.
onRecordAfterUpdateSuccess((e) => {
  e.next();
  for (const b of $app.findRecordsByFilter("books", "authors ?= {:a}", "", 0, 0, { a: e.record.id })) {
    try { $app.save(b); } catch (_) {}
  }
}, "authors");
// Двух авторов с одинаковым именем не бывает.
onRecordCreateRequest((e) => {
  const lib = require(`${__hooks}/lib.js`);
  const key = lib.norm(e.record.getString("name"));
  if (!key) throw new BadRequestError("Введите имя автора.");
  if ($app.countRecords("authors", $dbx.hashExp({ search: key })) > 0) throw new BadRequestError("Такой автор уже есть.");
  e.next();
}, "authors");
onRecordUpdateRequest((e) => {
  const lib = require(`${__hooks}/lib.js`);
  const key = lib.norm(e.record.getString("name"));
  if (!key) throw new BadRequestError("Введите имя автора.");
  if ($app.countRecords("authors", $dbx.and($dbx.hashExp({ search: key }), $dbx.not($dbx.hashExp({ id: e.record.id })))) > 0) {
    throw new BadRequestError("Автор с таким именем уже есть.");
  }
  e.next();
}, "authors");

onRecordCreate((e) => { e.record.set("search", require(`${__hooks}/lib.js`).bookSearch(e.app, e.record)); e.next(); }, "books");
onRecordUpdate((e) => { e.record.set("search", require(`${__hooks}/lib.js`).bookSearch(e.app, e.record)); e.next(); }, "books");

// Администратор через API меняет только название, авторов, год и описание.
// Форматы, страницы, обложку, состояние и прочее ставит только сервер (сводка по book_files, syncBook).
onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const o = e.record.original();
    for (const f of ["formats", "text_file", "file_size", "pages", "has_text", "status", "status_note", "cover", "pending", "offered_by"]) {
      e.record.set(f, o.get(f));
    }
    const title = e.record.getString("title").replace(/\s+/g, " ").trim();
    if (!title) throw new BadRequestError("Введите название книги.");
    e.record.set("title", title);
    const y = e.record.getInt("year");
    if (y && (y < 100 || y > new Date().getFullYear() + 1)) throw new BadRequestError("Проверьте год издания.");
  }
  e.next();
}, "books");
// Авторов убрали из книги: те, у кого книг не осталось, удаляются. Название в заметках обновляется.
onRecordAfterUpdateSuccess((e) => {
  e.next();
  const lib = require(`${__hooks}/lib.js`);
  const o = e.record.original();
  const now = e.record.getStringSlice("authors");
  lib.dropLonelyAuthors($app, o.getStringSlice("authors").filter((a) => now.indexOf(a) < 0));
  if (o.getString("title") !== e.record.getString("title")) {
    $app.db().newQuery("UPDATE notes SET book_title = {:t} WHERE book = {:b}").bind({ t: e.record.getString("title"), b: e.record.id }).execute();
    $app.db().newQuery("UPDATE group_books SET book_title = {:t} WHERE book = {:b}").bind({ t: e.record.getString("title"), b: e.record.id }).execute();
    // название в «Моих предложенных книгах» меняется вместе с книгой (через запись, чтобы пришло живое обновление)
    for (const x of $app.findRecordsByFilter("book_offers", "book = {:b}", "", 0, 0, { b: e.record.id })) {
      x.set("title", e.record.getString("title"));
      try { $app.save(x); } catch (_) {}
    }
  }
}, "books");
// Кто предложил книгу, видит только администратор.
onRecordEnrich((e) => {
  const auth = e.requestInfo.auth;
  if (!(auth && (auth.isSuperuser() || auth.getString("role") === "admin"))) e.record.hide("offered_by", "pending");
  e.next();
}, "books");

// Служебные поля файла книги (имя на диске, исходное имя, отпечаток) видит только администратор.
onRecordEnrich((e) => {
  const auth = e.requestInfo.auth;
  if (!(auth && (auth.isSuperuser() || auth.getString("role") === "admin"))) e.record.hide("orig_name", "hash", "file", "orig_file");
  e.next();
}, "book_files");

/* ---------- Полки ---------- */
onRecordCreateRequest((e) => { if (!e.hasSuperuserAuth()) require(`${__hooks}/lib.js`).checkShelfCreate(e); e.next(); }, "shelves");
onRecordUpdateRequest((e) => { if (!e.hasSuperuserAuth()) require(`${__hooks}/lib.js`).checkShelfUpdate(e); e.next(); }, "shelves");
onRecordDeleteRequest((e) => { if (!e.hasSuperuserAuth()) require(`${__hooks}/lib.js`).checkShelfDelete(e); e.next(); }, "shelves");

// Книга на полке: одна и та же книга на полке один раз; полку и книгу у записи не меняют.
onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    let b = null;
    try { b = $app.findRecordById("books", e.record.getString("book")); } catch (_) {}
    if (!b) throw new BadRequestError("Книга не найдена.");
    if (b.getBool("pending")) throw new BadRequestError("Книга на проверке. На полку она встанет после одобрения.");
    if ($app.countRecords("shelf_books", $dbx.hashExp({ shelf: e.record.getString("shelf"), book: b.id })) > 0) {
      throw new BadRequestError("Эта книга уже стоит на этой полке.");
    }
  }
  e.next();
}, "shelf_books");
onRecordUpdateRequest((e) => {
  const o = e.record.original();
  e.record.set("shelf", o.getString("shelf"));
  e.record.set("book", o.getString("book"));
  e.next();
}, "shelf_books");

/* ---------- Заметки и уроки ---------- */
// Оформление чистится по списку разрешённых тегов, текст для поиска ставит сервер.
// Делиться (shared) и писать уроки может только администратор.
onRecordCreateRequest((e) => { if (!e.hasSuperuserAuth()) require(`${__hooks}/lib.js`).checkNote(e); e.next(); }, "notes");
onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const o = e.record.original();
    e.record.set("owner", o.getString("owner"));
    // урок не превращается в заметку и наоборот, если у урока есть файлы
    if (o.getString("kind") === "lesson" && e.record.getString("kind") !== "lesson" &&
        $app.countRecords("note_files", $dbx.hashExp({ note: e.record.id })) > 0) {
      throw new BadRequestError("У урока есть файлы. Сначала удалите их, потом делайте из урока заметку.");
    }
    require(`${__hooks}/lib.js`).checkNote(e);
  }
  e.next();
}, "notes");

// Чужую заметку видно только общую (shared) или групповую (участникам группы, этап 3). Место цитаты
// (anchor) у них видно: по нему читатель переходит к месту в книге. Если запись почему-то пришла
// не общей и не групповой, служебные поля скрыты.
onRecordEnrich((e) => {
  const auth = e.requestInfo.auth;
  if (!(auth && (auth.isSuperuser() || auth.id === e.record.getString("owner") || e.record.getBool("shared") || e.record.getString("group")))) e.record.hide("anchor", "color");
  e.next();
}, "notes");

onRecordEnrich((e) => { e.record.hide("file"); e.next(); }, "note_files");

/* ---------- Отметки «Читаю» и «Прочитано» (правки 2.2) ---------- */
onRecordCreateRequest((e) => { if (!e.hasSuperuserAuth()) require(`${__hooks}/lib.js`).checkMark(e); e.next(); }, "marks");
onRecordUpdateRequest((e) => { if (!e.hasSuperuserAuth()) require(`${__hooks}/lib.js`).checkMark(e); e.next(); }, "marks");

// Файл урока удалили (сам или вместе с уроком): убираем его с диска.
onRecordAfterDeleteSuccess((e) => {
  e.next();
  try { const F = require(`${__hooks}/files_lib.js`); F.rmFile(F.filesDir(), e.record.getString("file")); }
  catch (err) { $app.logger().error("Не удалось удалить файл урока", "file", e.record.id, "error", String(err)); }
}, "note_files");

/* ---------- Сеанс и защищённые ссылки ---------- */
// Кука для обложек и файлов: ставится при входе в приложение и при каждой новой ссылке.
routerAdd("GET", "/api/knigi/session", (e) => {
  const F = require(`${__hooks}/files_lib.js`);
  F.setCookie(e, e.auth.id);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/knigi/logout", (e) => {
  require(`${__hooks}/files_lib.js`).clearCookie(e);
  return e.json(200, { ok: true });
});

// Обложка: только вошедшему (по куке). Можно хранить в памяти браузера, адрес меняется вместе с обложкой.
routerAdd("GET", "/api/knigi/f/cover/{id}", (e) => {
  const F = require(`${__hooks}/files_lib.js`);
  const u = F.cookieUser(e);
  let b = null;
  try { b = $app.findRecordById("books", e.request.pathValue("id")); } catch (_) {}
  if (b && b.getBool("pending") && u.getString("role") !== "admin") b = null; // книгу на проверке видит только администратор
  const name = b ? b.getString("cover") : "";
  if (!name) throw new NotFoundError("Обложки нет.");
  const h = e.response.header();
  h.set("Cache-Control", "private, max-age=2592000, immutable");
  h.set("X-Content-Type-Options", "nosniff");
  return e.fileFS($os.dirFS(F.coversDir()), name);
});

// Ссылка на файл книги нужного формата (?f=pdf|epub|djvu|fb2|mobi|azw3|txt, без f: PDF): на 2 часа и только
// вместе с кукой, которую ставит этот же ответ. В ключе ссылки номер файла (book_files). DjVu отдаётся
// переведённым в PDF, FB2, MOBI, AZW3 и TXT переведёнными в EPUB (правки 3.1): view говорит, какой читалкой открывать.
routerAdd("GET", "/api/knigi/books/{id}/link", (e) => {
  const F = require(`${__hooks}/files_lib.js`);
  let b = null;
  try { b = $app.findRecordById("books", e.request.pathValue("id")); } catch (_) {}
  if (b && b.getBool("pending") && !require(`${__hooks}/lib.js`).isAdmin(e.auth)) b = null;
  if (!b) throw new NotFoundError("Книга не найдена: возможно, её удалили.");
  const fmt = String((e.requestInfo().query || {}).f || "pdf");
  const view = F.VIEW[fmt];
  if (!view) throw new BadRequestError("Такой формат читалка не открывает.");
  let f = null;
  try { f = $app.findFirstRecordByFilter("book_files", "book = {:b} && format = {:f}", { b: b.id, f: fmt }); } catch (_) {}
  if (!f) throw new NotFoundError(`У этой книги нет файла ${F.FMT_NAME[fmt]}.`);
  if (f.getString("status") === "processing") throw new BadRequestError("Книга ещё обрабатывается. Попробуйте через минуту.");
  const size = F.exists($filepath.join(F.booksDir(), f.getString("file"))) ? f.getInt("file_size") : 0;
  if (!size) throw new NotFoundError("Файл книги не найден на сервере.");
  if (view === "epub" && size > F.EPUB_MAX) throw new BadRequestError("Эта книга слишком большая для читалки.");
  return e.json(200, { url: F.makeLink(e, "book", f.id, e.auth.id), size, ttl: F.LINK_TTL, mark: F.watermarkFor(e.auth), mark_cfg: F.watermarkCfg(), chunk: 512 * 1024,
    file: f.id, format: fmt, view, whole: view === "epub" });
}, $apis.requireAuth("users"));

// Отдача файла книги (номер файла из book_files; у книг этапа 1 он совпадает с номером книги).
// PDF только частями (Range) и не больше 4 МБ за раз. EPUB целиком: читалке нужен весь архив, файлы небольшие.
// Вход проверяется дважды: ключ в адресе и кука. У читателей сервер считает отданные байты (лимит в час)
// и пишет журнал. На администратора это не действует.
routerAdd("GET", "/api/knigi/f/book/{id}", (e) => {
  const F = require(`${__hooks}/files_lib.js`);
  const id = e.request.pathValue("id");
  const user = F.linkUser(e, "book", id);
  let f = null, b = null;
  try { f = $app.findRecordById("book_files", id); b = $app.findRecordById("books", f.getString("book")); } catch (_) {}
  if (b && b.getBool("pending") && user.getString("role") !== "admin") b = null;
  if (!f || !b) throw new NotFoundError("Книга не найдена: возможно, её удалили.");
  const name = f.getString("file");
  const size = f.getInt("file_size");
  const whole = F.VIEW[f.getString("format")] === "epub" && !e.request.header.get("Range");
  if (whole && size > F.EPUB_MAX) throw new BadRequestError("Этот EPUB слишком большой для читалки.");
  const range = whole ? { start: 0, end: size - 1, len: size } : F.parseRange(e.request.header.get("Range"), size);
  if (!range) throw new BadRequestError("Книга открывается только в читалке приложения.");
  if (!whole && range.len > F.MAX_SPAN) throw new BadRequestError("Слишком большой кусок файла за один раз.");
  const admin = user.getString("role") === "admin";
  if (!admin) {
    const wait = F.takeBytes(user.id, range.len);
    if (wait) {
      F.logBytes(user.id, b, 0, true);
      return e.json(429, { message: `Вы читаете очень быстро. Сделайте паузу и продолжите через ${wait} мин.`, wait });
    }
    F.logBytes(user.id, b, range.len, false);
  }
  F.noStore(e);
  e.response.header().set("Content-Type", "application/octet-stream");
  e.response.header().set("Content-Disposition", "inline");
  return e.fileFS($os.dirFS(F.booksDir()), name);
});

// Файл урока. PDF открывается в читалке (как книга, частями); остальное только скачивает владелец (администратор).
// Читатель получает только PDF общего урока.
routerAdd("GET", "/api/knigi/files/{id}/link", (e) => {
  const F = require(`${__hooks}/files_lib.js`);
  let f = null;
  try { f = $app.findRecordById("note_files", e.request.pathValue("id")); } catch (_) {}
  if (!f) throw new NotFoundError("Файл не найден: возможно, его удалили.");
  const own = f.getString("owner") === e.auth.id;
  if (!own) {
    let n = null;
    try { n = $app.findRecordById("notes", f.getString("note")); } catch (_) {}
    if (!n || !n.getBool("shared") || f.getString("ext") !== "pdf") throw new NotFoundError("Файл не найден.");
  }
  return e.json(200, { url: F.makeLink(e, "file", f.id, e.auth.id), size: f.getInt("size"), name: f.getString("name"), ext: f.getString("ext"),
    ttl: F.LINK_TTL, mark: own ? "" : F.watermarkFor(e.auth), mark_cfg: F.watermarkCfg(), chunk: 512 * 1024 });
}, $apis.requireAuth("users"));
routerAdd("GET", "/api/knigi/f/file/{id}", (e) => {
  const F = require(`${__hooks}/files_lib.js`);
  const id = e.request.pathValue("id");
  const user = F.linkUser(e, "file", id);
  let f = null;
  try { f = $app.findRecordById("note_files", id); } catch (_) {}
  if (!f) throw new NotFoundError("Файл не найден: возможно, его удалили.");
  const own = f.getString("owner") === user.id;
  if (!own) {
    let n = null;
    try { n = $app.findRecordById("notes", f.getString("note")); } catch (_) {}
    if (!n || !n.getBool("shared") || f.getString("ext") !== "pdf") throw new NotFoundError("Файл не найден.");
  }
  F.noStore(e);
  const dl = String((e.requestInfo().query || {}).dl || "") === "1";
  if (dl) {
    // скачать целиком может только владелец (администратор): это его собственные материалы
    if (!own) throw new ForbiddenError("Скачать файл нельзя.");
    const name = f.getString("name").replace(/["\\\r\n]/g, "_");
    e.response.header().set("Content-Disposition", `attachment; filename="file.${f.getString("ext")}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    return e.fileFS($os.dirFS(F.filesDir()), f.getString("file"));
  }
  if (f.getString("ext") !== "pdf") throw new BadRequestError("Этот файл не открывается в читалке.");
  const range = F.parseRange(e.request.header.get("Range"), f.getInt("size"));
  if (!range) throw new BadRequestError("Файл открывается только в читалке приложения.");
  if (range.len > F.MAX_SPAN) throw new BadRequestError("Слишком большой кусок файла за один раз.");
  if (user.getString("role") !== "admin") {
    const wait = F.takeBytes(user.id, range.len);
    if (wait) return e.json(429, { message: `Вы читаете очень быстро. Сделайте паузу и продолжите через ${wait} мин.`, wait });
  }
  e.response.header().set("Content-Type", "application/octet-stream");
  e.response.header().set("Content-Disposition", "inline");
  return e.fileFS($os.dirFS(F.filesDir()), f.getString("file"));
});

// Прогресс чтения и какие страницы открыты (для журнала). Пишет только сервер.
routerAdd("POST", "/api/knigi/books/{id}/progress", (e) => {
  const F = require(`${__hooks}/files_lib.js`);
  let b = null;
  try { b = $app.findRecordById("books", e.request.pathValue("id")); } catch (_) {}
  if (b && b.getBool("pending") && e.auth.getString("role") !== "admin") b = null;
  if (!b) throw new NotFoundError("Книга не найдена.");
  const body = e.requestInfo().body || {};
  // формат файла; читалка PDF (страница: PDF, DjVu) или EPUB (процент и место: EPUB, FB2, MOBI, AZW3, TXT).
  // Старое приложение формат не присылает, это PDF.
  const fmt = F.VIEW[body.format] ? String(body.format) : "pdf";
  const isEp = F.VIEW[fmt] === "epub";
  let f = null;
  try { f = $app.findFirstRecordByFilter("book_files", "book = {:b} && format = {:f}", { b: b.id, f: fmt }); } catch (_) {}
  if (!f) throw new NotFoundError(`У этой книги нет файла ${F.FMT_NAME[fmt]}.`);
  const pages = (!isEp && f.getInt("pages")) || Math.min(parseInt(body.pages, 10) || 0, 1000000);
  let page = parseInt(body.page, 10) || 1;
  if (page < 1) page = 1;
  if (pages && page > pages) page = pages;
  const pct = isEp ? Math.min(100, Math.max(0, Math.round((parseFloat(body.pct) || 0) * 10) / 10)) : (pages ? Math.round(page / pages * 1000) / 10 : 0);
  const pos = isEp ? String(body.pos || "").slice(0, 2000) : "";
  const key = { u: e.auth.id, b: b.id, f: fmt };
  const fill = (r) => { r.set("page", page); r.set("pages", pages); r.set("pct", pct); r.set("pos", pos); };
  let r = null;
  try { r = $app.findFirstRecordByFilter("reading", "user = {:u} && book = {:b} && format = {:f}", key); } catch (_) {}
  const oldPct = r ? r.getFloat("pct") : null; // для групп: где человек был до этого сохранения
  if (!r) {
    r = new Record($app.findCollectionByNameOrId("reading"));
    r.set("user", e.auth.id);
    r.set("book", b.id);
    r.set("format", fmt);
  }
  fill(r);
  try { $app.save(r); } catch (err) {
    // два запроса одновременно создали запись: обновляем ту, что уже есть
    r = $app.findFirstRecordByFilter("reading", "user = {:u} && book = {:b} && format = {:f}", key);
    fill(r); $app.save(r);
  }
  if (e.auth.getString("role") !== "admin" && Array.isArray(body.seen)) {
    const seen = body.seen.map((x) => parseInt(x, 10)).filter((x) => x > 0 && (!pages || x <= pages)).slice(0, 500);
    F.logPages(e.auth.id, b, seen);
  }
  // группы чтения: сколько страниц (у EPUB процентов) человек прочитал сегодня, если книга читается в его группе
  require(`${__hooks}/groups_lib.js`).recordRead(e.auth.id, b, fmt, body, oldPct, pct, pages);
  return e.json(200, { id: r.id, format: fmt, page, pages, pct, pos, updated: r.getString("updated") });
}, $apis.requireAuth("users"));

/* ---------- Загрузка книг и файлов уроков ---------- */
// Книги и файлы уроков загружает администратор. Читатель может только предложить книгу (kind: offer):
// она попадает на проверку, не больше 3 книг на проверке от одного человека (правки 2.2).
// Продолжить, закончить и отменить загрузку может только тот, кто её начал (uploadMeta проверяет владельца).
routerAdd("POST", "/api/knigi/upload/start", (e) => {
  const lib = require(`${__hooks}/lib.js`);
  const body = e.requestInfo().body || {};
  if (body.kind === "offer") {
    if (lib.isAdmin(e.auth)) throw new BadRequestError("Администратор добавляет книги сам: кнопка «Добавить книги» на главной.");
  } else lib.requireAdmin(e);
  return e.json(200, require(`${__hooks}/files_lib.js`).startUpload(e, body));
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/knigi/upload/{up}/finish", (e) => {
  const F = require(`${__hooks}/files_lib.js`);
  if (F.uploadKind(e.request.pathValue("up"), e.auth.id) !== "offer") require(`${__hooks}/lib.js`).requireAdmin(e);
  return e.json(200, F.finishUpload(e, e.request.pathValue("up")));
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/knigi/upload/{up}/{n}", (e) => {
  const F = require(`${__hooks}/files_lib.js`);
  if (F.uploadKind(e.request.pathValue("up"), e.auth.id) !== "offer") require(`${__hooks}/lib.js`).requireAdmin(e);
  return e.json(200, F.saveChunk(e, e.request.pathValue("up"), e.request.pathValue("n")));
}, $apis.requireAuth("users"), $apis.bodyLimit(12 * 1024 * 1024));
routerAdd("DELETE", "/api/knigi/upload/{up}", (e) => {
  const F = require(`${__hooks}/files_lib.js`);
  if (F.uploadKind(e.request.pathValue("up"), e.auth.id) !== "offer") require(`${__hooks}/lib.js`).requireAdmin(e);
  F.dropUpload(e.request.pathValue("up"));
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Обработать загруженные книги сейчас (иначе это сделает задание раз в минуту).
// Может позвать любой вошедший: так книга читателя тоже обрабатывается сразу после загрузки.
// Маршрут только запускает очередь, которая и так идёт раз в минуту.
routerAdd("POST", "/api/knigi/process", (e) => {
  return e.json(200, require(`${__hooks}/files_lib.js`).processQueue());
}, $apis.requireAuth("users"));

/* ---------- Книги на проверке (правки 2.2, только администратор) ---------- */
// Одобрить: {shelves: [id общих полок]}. Название, авторов, год, описание и обложку администратор
// правит до этого обычными способами (книга видна ему, как любая другая).
routerAdd("POST", "/api/knigi/offers/{id}/approve", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const body = e.requestInfo().body || {};
  require(`${__hooks}/files_lib.js`).approveOffer(e, e.request.pathValue("id"), body.shelves);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
// Отклонить: {reason}. Файл, текст и обложка удаляются с диска.
routerAdd("POST", "/api/knigi/offers/{id}/reject", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const body = e.requestInfo().body || {};
  require(`${__hooks}/files_lib.js`).rejectOffer(e, e.request.pathValue("id"), body.reason);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
// Настроена ли почта: на экране проверки администратор видит, придёт ли человеку письмо.
routerAdd("GET", "/api/knigi/admin/mail", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  return e.json(200, { ready: require(`${__hooks}/lib.js`).mailReady() });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/knigi/books/{id}/reprocess", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const F = require(`${__hooks}/files_lib.js`);
  const b = $app.findRecordById("books", e.request.pathValue("id"));
  for (const f of F.filesOf(b.id)) {
    require(`${__hooks}/convert_lib.js`).ocrCancelFile(f.id, "Книгу обработали заново.");
    f.set("status", "processing");
    f.set("status_note", "");
    $app.save(f);
  }
  F.syncBook(b.id);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Заменить обложку своей картинкой.
routerAdd("POST", "/api/knigi/books/{id}/cover", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  let b = null;
  try { b = $app.findRecordById("books", e.request.pathValue("id")); } catch (_) {}
  if (!b) throw new NotFoundError("Книга не найдена.");
  return e.json(200, { cover: require(`${__hooks}/files_lib.js`).replaceCover(e, b) });
}, $apis.requireAuth("users"), $apis.bodyLimit(11 * 1024 * 1024));

// Удалить книгу. ?notes=delete удаляет свои заметки и уроки к ней, ?notes=keep оставляет их без книги.
routerAdd("DELETE", "/api/knigi/books/{id}", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  let b = null;
  try { b = $app.findRecordById("books", e.request.pathValue("id")); } catch (_) {}
  if (!b) throw new NotFoundError("Книга не найдена: возможно, её уже удалили.");
  const mode = String((e.requestInfo().query || {}).notes || "keep") === "delete" ? "delete" : "keep";
  require(`${__hooks}/files_lib.js`).deleteBook(e, b, mode);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Объединить с другой книгой: GET показывает, что перейдёт (и есть ли одинаковые форматы), POST объединяет.
// Остаётся книга {id}, вторая ({other}) пропадает, её файлы, полки, заметки и прогресс переходят к первой.
routerAdd("GET", "/api/knigi/books/{id}/merge/{other}", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const F = require(`${__hooks}/files_lib.js`);
  const a = $app.findRecordById("books", e.request.pathValue("id"));
  const b = $app.findRecordById("books", e.request.pathValue("other"));
  return e.json(200, F.mergeInfo(a, b));
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/knigi/books/{id}/merge/{other}", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const F = require(`${__hooks}/files_lib.js`);
  let a = null, b = null;
  try { a = $app.findRecordById("books", e.request.pathValue("id")); b = $app.findRecordById("books", e.request.pathValue("other")); } catch (_) {}
  if (!a || !b) throw new NotFoundError("Книга не найдена: возможно, её удалили.");
  F.mergeBooks(a, b);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Убрать формат: GET показывает, сколько выделений и читателей у этого формата, DELETE убирает.
routerAdd("GET", "/api/knigi/book-files/{id}", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const F = require(`${__hooks}/files_lib.js`);
  return e.json(200, F.formatInfo($app.findRecordById("book_files", e.request.pathValue("id"))));
}, $apis.requireAuth("users"));
routerAdd("DELETE", "/api/knigi/book-files/{id}", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const F = require(`${__hooks}/files_lib.js`);
  let f = null;
  try { f = $app.findRecordById("book_files", e.request.pathValue("id")); } catch (_) {}
  if (!f) throw new NotFoundError("Файл не найден: возможно, его уже убрали.");
  F.removeFormat(f);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Сколько места свободно (для окна «Добавить книги»).
routerAdd("GET", "/api/knigi/disk", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const F = require(`${__hooks}/files_lib.js`);
  const sum = new DynamicModel({ total: 0, count: 0 });
  $app.db().select("COALESCE(SUM(file_size), 0) as total", "COUNT(DISTINCT book) as count").from("book_files").one(sum);
  return e.json(200, { free: F.freeBytes(), min: F.S.minFree(), books: sum.total, count: sum.count });
}, $apis.requireAuth("users"));

/* ---------- Журнал чтения (только администратор) ---------- */
routerAdd("GET", "/api/knigi/admin/log", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const F = require(`${__hooks}/files_lib.js`);
  const q = e.requestInfo().query || {};
  const days = Math.min(Math.max(parseInt(q.days, 10) || 7, 1), 400);
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 13);
  const params = { from, u: String(q.user || ""), b: String(q.book || "") };
  let filter = "hour >= {:from}";
  if (params.u) filter += " && user = {:u}";
  if (params.b) filter += " && book = {:b}";
  const rows = $app.findRecordsByFilter("read_log", filter, "-hour", 3000, 0, params);
  const people = {};
  for (const u of $app.findAllRecords("users")) people[u.id] = { id: u.id, name: u.getString("name"), email: u.getString("email"), admin: u.getString("role") === "admin" };
  return e.json(200, {
    rows: rows.map((r) => ({ id: r.id, hour: r.getString("hour"), user: r.getString("user"), book: r.getString("book"), book_title: r.getString("book_title"),
      pages_seen: r.getInt("pages_seen"), bytes_sent: r.getInt("bytes_sent"), over_limit: r.getBool("over_limit") })),
    users: Object.keys(people).map((k) => people[k]),
    settings: { log: F.S.readLog(), days: F.S.logDays(), limit: F.S.maxBytesHour(), watermark: F.S.watermark() },
  });
}, $apis.requireAuth("users"));

/* ---------- Фото профиля (правки 1.1) ---------- */
// Файл защищённый, а чужие записи users через API не читает никто, поэтому фото отдаёт этот маршрут:
// своё фото каждому, любое фото администратору, фото администратора всем вошедшим
// (оно стоит рядом с «Заметками автора библиотеки»), фото участника общей группы (этап 3).
// Чужое фото читателя, с которым нет общей группы, другой читатель не получит.
routerAdd("GET", "/api/knigi/users/{id}/avatar", (e) => {
  const lib = require(`${__hooks}/lib.js`);
  let u = null;
  try { u = $app.findRecordById("users", e.request.pathValue("id")); } catch (_) {}
  const ok = u && (u.id === e.auth.id || lib.isAdmin(e.auth) || lib.isAdmin(u) || require(`${__hooks}/groups_lib.js`).shareGroup($app, e.auth.id, u.id));
  const name = ok ? u.getString("avatar") : "";
  if (!name || $app.settings().s3.enabled) throw new NotFoundError("Фото нет.");
  e.response.header().set("Cache-Control", "private, no-store");
  e.response.header().set("X-Content-Type-Options", "nosniff");
  return e.fileFS($os.dirFS($filepath.join($app.dataDir(), "storage", u.baseFilesPath())), name);
}, $apis.requireAuth("users"));

// Кто администратор библиотеки: имя и есть ли фото (для «Заметок автора библиотеки»).
routerAdd("GET", "/api/knigi/owner", (e) => {
  const list = $app.findRecordsByFilter("users", "role = 'admin'", "created", 1, 0);
  if (!list.length) return e.json(200, {});
  const u = list[0];
  return e.json(200, { id: u.id, name: u.getString("name"), avatar: u.getString("avatar") });
}, $apis.requireAuth("users"));

// Все пользователи с фото (только администратору): раздел «Пользователи» и имена у приглашений.
routerAdd("GET", "/api/knigi/admin/users", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const users = $app.findRecordsByFilter("users", "id != ''", "created", 0, 0);
  return e.json(200, users.map((u) => ({ id: u.id, name: u.getString("name"), email: u.getString("email"), role: u.getString("role"),
    avatar: u.getString("avatar"), created: u.getString("created") })));
}, $apis.requireAuth("users"));

/* ---------- Прочее ---------- */
// Сведения для экрана входа и политики конфиденциальности.
routerAdd("GET", "/api/knigi/setup", (e) => {
  return e.json(200, {
    firstRun: $app.countRecords("users") === 0,
    owner: $os.getenv("OWNER_NAME") || "",
    contact: $os.getenv("CONTACT_EMAIL") || "",
  });
});

/* ---------- Распознавание текста в сканах (правки 3.1, только администратор) ---------- */
// Очередь, ход работы текущей книги, готовые и ошибки, сколько сканов ещё не распознано и сколько это займёт.
routerAdd("GET", "/api/knigi/ocr", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  return e.json(200, require(`${__hooks}/convert_lib.js`).ocrState());
}, $apis.requireAuth("users"));
// Распознать сканы одной книги (кнопка «Распознать текст» в карточке)
routerAdd("POST", "/api/knigi/books/{id}/ocr", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const C = require(`${__hooks}/convert_lib.js`);
  let b = null;
  try { b = $app.findRecordById("books", e.request.pathValue("id")); } catch (_) {}
  if (!b) throw new NotFoundError("Книга не найдена.");
  const n = C.ocrBook(b);
  C.ocrTick();
  return e.json(200, { added: n, state: C.ocrState() });
}, $apis.requireAuth("users"));
// «Распознать все сканы»
routerAdd("POST", "/api/knigi/ocr/all", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const C = require(`${__hooks}/convert_lib.js`);
  const n = C.ocrAll();
  C.ocrTick();
  return e.json(200, { added: n, state: C.ocrState() });
}, $apis.requireAuth("users"));
// «Отменить»: книга остаётся как была
routerAdd("POST", "/api/knigi/ocr/{id}/cancel", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const C = require(`${__hooks}/convert_lib.js`);
  C.ocrCancel(e.request.pathValue("id"), "");
  C.ocrTick();
  return e.json(200, { state: C.ocrState() });
}, $apis.requireAuth("users"));

// Обработка книг раз в минуту (если после загрузки её не запустили сразу) и уборка раз в сутки.
cronAdd("knigi_process", "* * * * *", () => {
  require(`${__hooks}/files_lib.js`).processQueue();
});
// Очередь распознавания: раз в минуту смотрит ход работы, запускает следующую книгу,
// после перезапуска сервера продолжает прерванную.
cronAdd("knigi_ocr", "* * * * *", () => {
  try { require(`${__hooks}/convert_lib.js`).ocrTick(); } catch (err) { $app.logger().error("Очередь распознавания", "error", String(err)); }
});
cronAdd("knigi_clean", "17 4 * * *", () => {
  try { require(`${__hooks}/convert_lib.js`).ocrCleanDirs(); } catch (err) { $app.logger().error("Уборка папок распознавания", "error", String(err)); }
  const F = require(`${__hooks}/files_lib.js`);
  try { F.cleanLog(); } catch (err) { $app.logger().error("Уборка журнала", "error", String(err)); }
  try { F.cleanUploads(); } catch (err) { $app.logger().error("Уборка загрузок", "error", String(err)); }
});

// Настройки из окружения при каждом запуске:
// APP_URL — адрес для ссылок в письмах; BEHIND_PROXY=1 — настоящий IP посетителя берётся из X-Forwarded-For.
// Папки книг и файлов создаются, ключ для подписи ссылок появляется сам.
onBootstrap((e) => {
  e.next();
  const s = $app.settings();
  let changed = false;
  const url = $os.getenv("APP_URL");
  if (url && s.meta.appURL !== url) { s.meta.appURL = url; changed = true; }
  if ($os.getenv("BEHIND_PROXY") === "1") {
    const h = s.trustedProxy.headers || [];
    if (h.length !== 1 || h[0] !== "X-Forwarded-For") { s.trustedProxy.headers = ["X-Forwarded-For"]; changed = true; }
  }
  if (changed) $app.save(s);
  try {
    const F = require(`${__hooks}/files_lib.js`);
    F.ensureDirs();
    F.fileKey();
  } catch (err) {
    $app.logger().error("Не удалось подготовить папки книг", "error", String(err));
  }
});

/* ---------- Письма ---------- */
// Шаблоны записаны миграцией 1780000001_mail.js. Перед отправкой хук подставляет имя и срок ссылки.
onMailerRecordPasswordResetSend((e) => { require(`${__hooks}/lib.js`).mailPolish(e, "reset"); e.next(); }, "users");
onMailerRecordVerificationSend((e) => { require(`${__hooks}/lib.js`).mailPolish(e, "verify"); e.next(); }, "users");
onMailerRecordEmailChangeSend((e) => { require(`${__hooks}/lib.js`).mailPolish(e, "change"); e.next(); }, "users");
onMailerRecordOTPSend((e) => { require(`${__hooks}/lib.js`).mailPolish(e, "otp"); e.next(); }, "users");
onMailerRecordAuthAlertSend((e) => { require(`${__hooks}/lib.js`).mailPolish(e, "alert"); e.next(); }, "users");

// Не больше 5 писем в сутки на одну почту. Сверх лимита ответ тот же (204): по нему не узнать, есть ли такая почта.
onRecordRequestPasswordResetRequest((e) => {
  if (!e.hasSuperuserAuth() && !require(`${__hooks}/lib.js`).mailAllowed(e.record, "reset")) return e.noContent(204);
  e.next();
}, "users");
onRecordRequestVerificationRequest((e) => {
  if (!e.hasSuperuserAuth() && !e.record.verified() && !require(`${__hooks}/lib.js`).mailAllowed(e.record, "verify")) return e.noContent(204);
  e.next();
}, "users");
// Смены почты в приложении нет: чтобы через API никто не отправил письмо с ящика приложения на чужой адрес.
onRecordRequestEmailChangeRequest((e) => {
  if (!e.hasSuperuserAuth()) throw new BadRequestError("Смена почты в приложении не поддерживается. Напишите администратору.");
  e.next();
}, "users");
