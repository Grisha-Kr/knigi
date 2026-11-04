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
// Файл, формат, страницы, обложку, состояние и прочее ставит только сервер.
onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const o = e.record.original();
    for (const f of ["format", "file", "orig_name", "file_size", "pages", "has_text", "status", "status_note", "cover", "hash"]) {
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
  }
}, "books");

// Служебные поля книги видит только администратор.
onRecordEnrich((e) => {
  const auth = e.requestInfo.auth;
  if (!(auth && (auth.isSuperuser() || auth.getString("role") === "admin"))) e.record.hide("orig_name", "hash", "file");
  e.next();
}, "books");

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

// Чужую общую заметку читатель видит без служебных полей.
onRecordEnrich((e) => {
  const auth = e.requestInfo.auth;
  if (!(auth && (auth.isSuperuser() || auth.id === e.record.getString("owner")))) e.record.hide("anchor", "color");
  e.next();
}, "notes");

onRecordEnrich((e) => { e.record.hide("file"); e.next(); }, "note_files");

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
  F.cookieUser(e);
  let b = null;
  try { b = $app.findRecordById("books", e.request.pathValue("id")); } catch (_) {}
  const name = b ? b.getString("cover") : "";
  if (!name) throw new NotFoundError("Обложки нет.");
  const h = e.response.header();
  h.set("Cache-Control", "private, max-age=2592000, immutable");
  h.set("X-Content-Type-Options", "nosniff");
  return e.fileFS($os.dirFS(F.coversDir()), name);
});

// Ссылка на файл книги: на 2 часа и только вместе с кукой, которую ставит этот же ответ.
routerAdd("GET", "/api/knigi/books/{id}/link", (e) => {
  const F = require(`${__hooks}/files_lib.js`);
  let b = null;
  try { b = $app.findRecordById("books", e.request.pathValue("id")); } catch (_) {}
  if (!b) throw new NotFoundError("Книга не найдена: возможно, её удалили.");
  if (b.getString("format") !== "pdf") throw new BadRequestError("Читалка для этого формата появится позже.");
  if (b.getString("status") === "processing") throw new BadRequestError("Книга ещё обрабатывается. Попробуйте через минуту.");
  const size = F.exists($filepath.join(F.booksDir(), b.getString("file"))) ? b.getInt("file_size") : 0;
  if (!size) throw new NotFoundError("Файл книги не найден на сервере.");
  return e.json(200, { url: F.makeLink(e, "book", b.id, e.auth.id), size, ttl: F.LINK_TTL, mark: F.watermarkFor(e.auth), chunk: 512 * 1024 });
}, $apis.requireAuth("users"));

// Отдача файла книги: только частями (Range) и не больше 4 МБ за раз. Вход проверяется дважды: ключ в адресе и кука.
// У читателей сервер считает отданные байты (лимит в час) и пишет журнал. На администратора это не действует.
routerAdd("GET", "/api/knigi/f/book/{id}", (e) => {
  const F = require(`${__hooks}/files_lib.js`);
  const id = e.request.pathValue("id");
  const user = F.linkUser(e, "book", id);
  let b = null;
  try { b = $app.findRecordById("books", id); } catch (_) {}
  if (!b) throw new NotFoundError("Книга не найдена: возможно, её удалили.");
  const name = b.getString("file");
  const range = F.parseRange(e.request.header.get("Range"), b.getInt("file_size"));
  if (!range) throw new BadRequestError("Книга открывается только в читалке приложения.");
  if (range.len > F.MAX_SPAN) throw new BadRequestError("Слишком большой кусок файла за один раз.");
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
    ttl: F.LINK_TTL, mark: own ? "" : F.watermarkFor(e.auth), chunk: 512 * 1024 });
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
  if (!b) throw new NotFoundError("Книга не найдена.");
  const body = e.requestInfo().body || {};
  const pages = b.getInt("pages") || parseInt(body.pages, 10) || 0;
  let page = parseInt(body.page, 10) || 1;
  if (page < 1) page = 1;
  if (pages && page > pages) page = pages;
  let r = null;
  try { r = $app.findFirstRecordByFilter("reading", "user = {:u} && book = {:b}", { u: e.auth.id, b: b.id }); } catch (_) {}
  if (!r) {
    r = new Record($app.findCollectionByNameOrId("reading"));
    r.set("user", e.auth.id);
    r.set("book", b.id);
  }
  r.set("page", page);
  r.set("pages", pages);
  try { $app.save(r); } catch (err) {
    // два запроса одновременно создали запись: обновляем ту, что уже есть
    r = $app.findFirstRecordByFilter("reading", "user = {:u} && book = {:b}", { u: e.auth.id, b: b.id });
    r.set("page", page); r.set("pages", pages); $app.save(r);
  }
  if (e.auth.getString("role") !== "admin" && Array.isArray(body.seen)) {
    const seen = body.seen.map((x) => parseInt(x, 10)).filter((x) => x > 0 && (!pages || x <= pages)).slice(0, 500);
    F.logPages(e.auth.id, b, seen);
  }
  return e.json(200, { id: r.id, page, pages, updated: r.getString("updated") });
}, $apis.requireAuth("users"));

/* ---------- Загрузка книг и файлов уроков (только администратор) ---------- */
routerAdd("POST", "/api/knigi/upload/start", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  return e.json(200, require(`${__hooks}/files_lib.js`).startUpload(e, e.requestInfo().body || {}));
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/knigi/upload/{up}/finish", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  return e.json(200, require(`${__hooks}/files_lib.js`).finishUpload(e, e.request.pathValue("up")));
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/knigi/upload/{up}/{n}", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  return e.json(200, require(`${__hooks}/files_lib.js`).saveChunk(e, e.request.pathValue("up"), e.request.pathValue("n")));
}, $apis.requireAuth("users"), $apis.bodyLimit(12 * 1024 * 1024));
routerAdd("DELETE", "/api/knigi/upload/{up}", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const F = require(`${__hooks}/files_lib.js`);
  F.uploadDir(e.request.pathValue("up"));
  F.dropUpload(e.request.pathValue("up"));
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Обработать загруженные книги сейчас (иначе это сделает задание раз в минуту).
routerAdd("POST", "/api/knigi/process", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  return e.json(200, require(`${__hooks}/files_lib.js`).processQueue());
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/knigi/books/{id}/reprocess", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const b = $app.findRecordById("books", e.request.pathValue("id"));
  b.set("status", "processing");
  b.set("status_note", "");
  $app.save(b);
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

// Сколько места свободно (для окна «Добавить книги»).
routerAdd("GET", "/api/knigi/disk", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const F = require(`${__hooks}/files_lib.js`);
  const sum = new DynamicModel({ total: 0, count: 0 });
  $app.db().select("COALESCE(SUM(file_size), 0) as total", "COUNT(*) as count").from("books").one(sum);
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
// (оно стоит рядом с «Заметками автора библиотеки»). Чужое фото читателя другой читатель не получит.
routerAdd("GET", "/api/knigi/users/{id}/avatar", (e) => {
  const lib = require(`${__hooks}/lib.js`);
  let u = null;
  try { u = $app.findRecordById("users", e.request.pathValue("id")); } catch (_) {}
  const ok = u && (u.id === e.auth.id || lib.isAdmin(e.auth) || lib.isAdmin(u));
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

// Обработка книг раз в минуту (если после загрузки её не запустили сразу) и уборка раз в сутки.
cronAdd("knigi_process", "* * * * *", () => {
  require(`${__hooks}/files_lib.js`).processQueue();
});
cronAdd("knigi_clean", "17 4 * * *", () => {
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
