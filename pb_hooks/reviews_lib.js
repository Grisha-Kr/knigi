// Отзывы о книгах (правки 4.6). Подключается через require() внутри обработчиков reviews.pb.js и files_lib.js.
//
// Читатель пишет к книге один отзыв (текст до 2000 знаков), его сразу видят все, кому видна книга (bookOpen):
// книга не на проверке и видна всем или открыта этому читателю лично. Писать, менять и удалять свой отзыв может
// только тот, у кого есть доступ (срок не закончился, нет паузы, условия приняты), как с заметками. Исключение
// «своя книга» (правки 4.3) здесь не действует. Администратор пишет свой отзыв и удаляет любой.
// Имя и фото автора хранятся в отзыве копией (почта никуда не попадает), «прочитал(а)» берётся из marks.
// В подключение к ИИ (MCP) отзывы не попадают.

const TEXT_MAX = 2000;
const DUP_MSG = "Вы уже написали отзыв к этой книге. Его можно изменить.";
const PENDING_MSG = "У книги на проверке отзывов нет.";
const NOT_FOUND = "Отзыв не найден: возможно, его удалили.";

const L = () => require(`${__hooks}/lib.js`);
const A = () => require(`${__hooks}/access_lib.js`);
const isAdminUser = (u) => !!u && u.getString("role") === "admin";
const nowStr = () => new Date().toISOString().replace("T", " ");
// Имя автора в отзыве: только имя, почта не показывается никому
const nameOf = (u) => (u.getString("name") || "").trim() || "Читатель";

// Текст: переносы строк одного вида, пробелы по краям убираются. Длина по буквам (как у PocketBase).
function cleanText(v) {
  const t = String(v == null ? "" : v).replace(/\r\n?/g, "\n").replace(/\u0000/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) throw new BadRequestError("Напишите текст отзыва.");
  if (Array.from(t).length > TEXT_MAX) throw new BadRequestError(`Отзыв длиннее ${TEXT_MAX} знаков.`);
  return t;
}
// Писать, менять и удалять свой отзыв: нужен доступ (у администратора он всегда)
function canWrite(user) {
  const st = A().state(user);
  if (!st.active) throw new ForbiddenError(A().message(st));
}
function finishedOf(userId, bookId) {
  return $app.countRecords("marks", $dbx.hashExp({ user: userId, book: bookId, status: "finished" })) > 0;
}
function findReview(id) {
  try { return $app.findRecordById("reviews", String(id || "")); } catch (_) { return null; }
}
function findBook(id) {
  try { return $app.findRecordById("books", String(id || "")); } catch (_) { return null; }
}
// Отзыв, который этот человек видит: администратор любой, остальные только к книге, которая им видна
function reviewFor(user, id) {
  const r = findReview(id);
  if (!r) throw new NotFoundError(NOT_FOUND);
  if (isAdminUser(user)) return r;
  if (!L().bookOpen(findBook(r.getString("book")), user)) throw new NotFoundError(NOT_FOUND);
  return r;
}
function reviewJson(r, admin) {
  const out = {
    id: r.id, collectionId: r.collection().id, collectionName: "reviews",
    book: r.getString("book"), user: r.getString("user"), user_name: r.getString("user_name"), user_avatar: r.getString("user_avatar"),
    finished: r.getBool("finished"), text: r.getString("text"), edited: r.getString("edited"),
    created: r.getString("created"), updated: r.getString("updated"),
  };
  if (admin) out.seen = r.getBool("seen");
  return out;
}

// Новый отзыв: {book, text}
function create(e) {
  const u = e.auth;
  canWrite(u);
  const b = e.requestInfo().body || {};
  const book = L().openBook(b.book, u); // не видна → 404, видна только карточкой → 403
  if (book.getBool("pending")) throw new BadRequestError(PENDING_MSG);
  const text = cleanText(b.text);
  if ($app.countRecords("reviews", $dbx.hashExp({ book: book.id, user: u.id })) > 0) throw new BadRequestError(DUP_MSG);
  const r = new Record($app.findCollectionByNameOrId("reviews"));
  r.set("book", book.id);
  r.set("user", u.id);
  r.set("user_name", nameOf(u));
  r.set("user_avatar", u.getString("avatar"));
  r.set("finished", finishedOf(u.id, book.id));
  r.set("text", text);
  r.set("edited", "");
  r.set("seen", isAdminUser(u)); // свой отзыв администратору не новый
  try { $app.save(r); }
  catch (err) { if (/unique|book|user/i.test(String(err))) throw new BadRequestError(DUP_MSG); throw err; }
  return e.json(200, reviewJson(r, isAdminUser(u)));
}

// Изменить свой отзыв: {text}. Чужой отзыв не меняет никто (администратор может только удалить).
function update(e, id) {
  const u = e.auth;
  const r = reviewFor(u, id);
  if (r.getString("user") !== u.id) throw new ForbiddenError("Изменить можно только свой отзыв.");
  canWrite(u);
  if (!L().bookOpen(findBook(r.getString("book")), u)) throw new NotFoundError(NOT_FOUND);
  const text = cleanText((e.requestInfo().body || {}).text);
  if (text !== r.getString("text")) {
    r.set("text", text);
    r.set("edited", nowStr());
    r.set("user_name", nameOf(u));
    r.set("user_avatar", u.getString("avatar"));
    if (!isAdminUser(u)) r.set("seen", false); // изменённый отзыв администратор увидит как новый
    $app.save(r);
  }
  return e.json(200, reviewJson(r, isAdminUser(u)));
}

// Удалить: свой (с доступом) или любой (администратор)
function remove(e, id) {
  const u = e.auth;
  const r = reviewFor(u, id);
  if (!isAdminUser(u)) {
    if (r.getString("user") !== u.id) throw new ForbiddenError("Удалить можно только свой отзыв.");
    canWrite(u);
  }
  $app.delete(r);
  return e.json(200, { ok: true });
}

// Администратор открыл раздел «Отзывы»: все отзывы просмотрены (через записи, чтобы точка ушла и на других его устройствах)
function seenAll(e) {
  if (!isAdminUser(e.auth)) throw new ForbiddenError("Это может сделать только администратор библиотеки.");
  const list = $app.findRecordsByFilter("reviews", "seen = false", "", 0, 0);
  for (const r of list) {
    r.set("seen", true);
    try { $app.save(r); } catch (_) {}
  }
  return e.json(200, { ok: true, count: list.length });
}

// Имя или фото пользователя изменились: обновить копию в его отзывах
function syncUser(user) {
  const name = nameOf(user), av = user.getString("avatar");
  for (const r of $app.findRecordsByFilter("reviews", "user = {:u}", "", 0, 0, { u: user.id })) {
    if (r.getString("user_name") === name && r.getString("user_avatar") === av) continue;
    r.set("user_name", name);
    r.set("user_avatar", av);
    try { $app.save(r); } catch (_) {}
  }
}
// Отметка «Прочитано» появилась или пропала: пометка «прочитал(а)» в отзыве этого человека к этой книге
function syncFinished(userId, bookId) {
  if (!userId || !bookId) return;
  for (const r of $app.findRecordsByFilter("reviews", "user = {:u} && book = {:b}", "", 1, 0, { u: userId, b: bookId })) {
    const f = finishedOf(userId, bookId);
    if (r.getBool("finished") === f) continue;
    r.set("finished", f);
    try { $app.save(r); } catch (_) {}
  }
}
// Хук marks: запись создана, изменена или удалена
function markChanged(rec) {
  try {
    syncFinished(rec.getString("user"), rec.getString("book"));
    const o = rec.original();
    if (o && (o.getString("book") !== rec.getString("book") || o.getString("user") !== rec.getString("user"))) syncFinished(o.getString("user"), o.getString("book"));
  } catch (err) { console.log("Отзывы: пометка «прочитал(а)» не обновилась: " + err); }
}
// После объединения книг: пометки «прочитал(а)» по всем отзывам оставшейся книги
function syncFinishedBook(bookId) {
  for (const r of $app.findRecordsByFilter("reviews", "book = {:b}", "", 0, 0, { b: bookId })) syncFinished(r.getString("user"), bookId);
}
// Объединение книг (внутри транзакции mergeBooks): отзывы второй книги переходят к первой.
// Если у человека отзыв к обеим, остаётся более новый (по дате правки, иначе по дате создания).
function mergeReviews(tx, keepId, otherId) {
  const when = (r) => r.getString("edited") || r.getString("created");
  for (const r of tx.findRecordsByFilter("reviews", "book = {:b}", "", 0, 0, { b: otherId })) {
    const mine = tx.findRecordsByFilter("reviews", "book = {:b} && user = {:u}", "", 1, 0, { b: keepId, u: r.getString("user") });
    if (mine.length) {
      if (when(mine[0]) >= when(r)) { tx.delete(r); continue; }
      tx.delete(mine[0]);
    }
    r.set("book", keepId);
    tx.save(r);
  }
}
function mergeCount(otherId) { return $app.countRecords("reviews", $dbx.hashExp({ book: otherId })); }
// Фото автора отзыва видит тот, кому видна книга хотя бы одного его отзыва
function authorVisible(viewer, userId) {
  if (!viewer || !userId) return false;
  for (const r of $app.findRecordsByFilter("reviews", "user = {:u}", "-created", 200, 0, { u: userId })) {
    if (L().bookOpen(findBook(r.getString("book")), viewer)) return true;
  }
  return false;
}

module.exports = { TEXT_MAX, DUP_MSG, create, update, remove, seenAll, syncUser, syncFinished, syncFinishedBook, markChanged, mergeReviews, mergeCount, authorVisible, reviewJson };
