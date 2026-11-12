// Сообщения администратору (правки 4.5, часть А). Подключается через require() внутри обработчиков messages.pb.js.
//
// Читатель пишет администратору (тема, текст до 1000 знаков, снимок экрана по желанию), администратор отвечает
// в приложении, читатель видит ответ у себя. Писать может каждый читатель, принявший условия пользования,
// в том числе с закончившимся сроком доступа и на паузе (это исключение из guard). Кто не принял условия,
// не пишет (сначала окно условий). От одного читателя не больше 10 записей в день (сообщения и ответы вместе),
// день считается по APP_TZ_OFFSET, как срок доступа. Администратор не ограничен и сам новых сообщений не пишет.
// Писем нет: о новом приложение говорит точками на фото.

const TOPICS = ["offer", "problem", "review", "renew", "other"];
const STATUSES = ["new", "read", "answered"];
const TEXT_MAX = 1000;
const SHOT_MAX = 2 * 1024 * 1024;
const DAY_MAX = 10;
const DAY_MSG = "Сегодня отправлено слишком много сообщений. Попробуйте завтра.";

const A = () => require(`${__hooks}/access_lib.js`);
const isAdminUser = (u) => !!u && u.getString("role") === "admin";
const nowStr = () => new Date().toISOString().replace("T", " ");

// Текст: переносы строк одного вида, пробелы по краям убираются. Длина считается по буквам (как у PocketBase).
function cleanText(v) {
  const t = String(v == null ? "" : v).replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
  if (!t) throw new BadRequestError("Напишите текст сообщения.");
  if (Array.from(t).length > TEXT_MAX) throw new BadRequestError(`Текст длиннее ${TEXT_MAX} знаков.`);
  return t;
}
// Писать может читатель, принявший условия (срок и пауза не мешают)
function canWrite(user) {
  const st = A().state(user);
  if (!st.terms_ok) throw new ForbiddenError(A().TERMS_MSG);
}
// Начало сегодняшнего дня (по APP_TZ_OFFSET) в формате дат PocketBase
function dayStart() {
  const off = parseFloat($os.getenv("APP_TZ_OFFSET"));
  const h = isNaN(off) ? 10 : off;
  const t = new Date(new Date(A().today() + "T00:00:00Z").getTime() - h * 3600 * 1000);
  return t.toISOString().replace("T", " ");
}
// Не больше 10 записей в день от читателя
function checkDay(user) {
  if (isAdminUser(user)) return;
  const since = dayStart();
  const n = $app.countRecords("messages", $dbx.exp("author = {:u} AND created >= {:t}", { u: user.id, t: since }))
    + $app.countRecords("message_replies", $dbx.exp("user = {:u} AND admin = FALSE AND created >= {:t}", { u: user.id, t: since }));
  if (n >= DAY_MAX) throw new ApiError(429, DAY_MSG);
}
function findMessage(id) {
  try { return $app.findRecordById("messages", String(id || "")); } catch (_) { return null; }
}
// Сообщение, которое этот человек может видеть: своё или (администратору) любое
function msgFor(e, id) {
  const m = findMessage(id);
  if (!m || !(m.getString("author") === e.auth.id || isAdminUser(e.auth))) throw new NotFoundError("Сообщение не найдено: возможно, его удалили.");
  return m;
}
function msgJson(m, admin) {
  const out = {
    id: m.id, collectionId: m.collection().id, collectionName: "messages",
    author: m.getString("author"), author_name: m.getString("author_name"), author_email: m.getString("author_email"),
    topic: m.getString("topic"), text: m.getString("text"), shot: m.getString("shot"),
    user_unread: m.getBool("user_unread"), answers: m.getInt("answers"), last_at: m.getString("last_at"),
    created: m.getString("created"), updated: m.getString("updated"),
  };
  if (admin) { out.status = m.getString("status"); out.archived = m.getBool("archived"); }
  return out;
}
function replyJson(r) {
  return { id: r.id, collectionId: r.collection().id, collectionName: "message_replies", message: r.getString("message"), user: r.getString("user"),
    admin: r.getBool("admin"), text: r.getString("text"), created: r.getString("created") };
}
// Ошибка сохранения снимка (не картинка, слишком большой) по-русски
function shotError(err) {
  const s = String(err && err.message || err);
  if (/size/i.test(s)) return new BadRequestError("Снимок больше 2 МБ. Выберите снимок поменьше.");
  return new BadRequestError("Снимок должен быть картинкой JPEG, PNG или WEBP.");
}

// Новое сообщение: multipart (topic, text, shot) или JSON (topic, text)
function create(e) {
  const u = e.auth;
  if (isAdminUser(u)) throw new BadRequestError("Администратор отвечает в переписке читателя, новые сообщения пишут читатели.");
  canWrite(u);
  const info = e.requestInfo();
  const b = info.body || {};
  const topic = String(b.topic || "");
  if (TOPICS.indexOf(topic) < 0) throw new BadRequestError("Выберите тему сообщения.");
  const text = cleanText(b.text);
  let files = [];
  try { files = e.findUploadedFiles("shot") || []; } catch (_) { files = []; }
  if (files.length > 1) throw new BadRequestError("Можно приложить только один снимок.");
  if (files.length && files[0].size > SHOT_MAX) throw new BadRequestError("Снимок больше 2 МБ. Выберите снимок поменьше.");
  checkDay(u);
  const m = new Record($app.findCollectionByNameOrId("messages"));
  m.set("author", u.id);
  m.set("author_name", u.getString("name"));
  m.set("author_email", u.getString("email"));
  m.set("topic", topic);
  m.set("text", text);
  m.set("status", "new");
  m.set("archived", false);
  m.set("user_unread", false);
  m.set("answers", 0);
  m.set("last_at", nowStr());
  if (files.length) m.set("shot", files[0]);
  try { $app.save(m); }
  catch (err) { if (files.length && /shot/.test(String(err))) throw shotError(err); throw err; }
  return e.json(200, msgJson(m, false));
}

// Ответ в переписке. Ответ администратора: «Отвечено», у читателя точка. Ответ читателя: снова «Новое»,
// переписка из архива возвращается во «Входящие».
function reply(e, id) {
  const u = e.auth;
  const m = msgFor(e, id);
  const admin = isAdminUser(u);
  if (!admin) canWrite(u);
  const text = cleanText((e.requestInfo().body || {}).text);
  checkDay(u);
  let r = null;
  $app.runInTransaction((tx) => {
    r = new Record(tx.findCollectionByNameOrId("message_replies"));
    r.set("message", m.id);
    r.set("user", u.id);
    r.set("admin", admin);
    r.set("text", text);
    tx.save(r);
    const mm = tx.findRecordById("messages", m.id);
    if (admin) {
      mm.set("status", "answered");
      mm.set("user_unread", true);
      mm.set("answers", mm.getInt("answers") + 1);
    } else {
      mm.set("status", "new");
      mm.set("archived", false);
    }
    mm.set("last_at", nowStr());
    tx.save(mm);
  });
  return e.json(200, { reply: replyJson(r), message: msgJson(findMessage(m.id), admin) });
}

// Читатель открыл переписку: точка «есть ответ» снимается
function seen(e, id) {
  const m = msgFor(e, id);
  if (m.getString("author") === e.auth.id && m.getBool("user_unread")) {
    m.set("user_unread", false);
    $app.save(m);
  }
  return e.json(200, msgJson(m, isAdminUser(e.auth)));
}

// Администратор: «Прочитано» (status read), «Сделать новым» (new), «В архив» и «Вернуть из архива» (archived)
function setState(e, id) {
  if (!isAdminUser(e.auth)) throw new ForbiddenError("Это может сделать только администратор библиотеки.");
  const m = msgFor(e, id);
  const b = e.requestInfo().body || {};
  if (b.status !== undefined) {
    const s = String(b.status);
    if (s !== "read" && s !== "new") throw new BadRequestError("Неизвестное состояние.");
    // «Прочитано» у отвеченного сообщения состояние не меняет
    if (!(s === "read" && m.getString("status") === "answered")) m.set("status", s);
  }
  if (b.archived !== undefined) {
    m.set("archived", !!b.archived);
    // в архив уходит прочитанным: иначе точка «новое» осталась бы навсегда
    if (b.archived && m.getString("status") === "new") m.set("status", "read");
  }
  $app.save(m);
  return e.json(200, msgJson(m, true));
}

// Администратор: удалить сообщение вместе с ответами и снимком (снимок PocketBase удаляет с записью)
function remove(e, id) {
  if (!isAdminUser(e.auth)) throw new ForbiddenError("Это может сделать только администратор библиотеки.");
  const m = msgFor(e, id);
  $app.delete(m);
  return e.json(200, { ok: true });
}

// Ссылка на снимок: автору и администратору, на 2 часа, вместе с кукой (как файлы уроков)
function shotLink(e, id) {
  const F = require(`${__hooks}/files_lib.js`);
  const m = msgFor(e, id);
  if (!m.getString("shot")) throw new NotFoundError("Снимка нет.");
  return e.json(200, { url: F.makeLink(e, "shot", m.id, e.auth.id), ttl: F.LINK_TTL });
}
function shotServe(e, id) {
  const F = require(`${__hooks}/files_lib.js`);
  const user = F.linkUser(e, "shot", id);
  const m = findMessage(id);
  if (!m || !(m.getString("author") === user.id || isAdminUser(user)) || !m.getString("shot")) throw new NotFoundError("Снимок не найден.");
  if ($app.settings().s3.enabled) throw new NotFoundError("Снимок не найден.");
  F.noStore(e);
  return e.fileFS($os.dirFS($filepath.join($app.dataDir(), "storage", m.baseFilesPath())), m.getString("shot"));
}

module.exports = { TOPICS, STATUSES, TEXT_MAX, DAY_MAX, DAY_MSG, create, reply, seen, setState, remove, shotLink, shotServe, msgJson };
