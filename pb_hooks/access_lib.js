// Срок доступа и пауза (правки 4.1, часть Б, по образцу «Молитвенного дневника»). Подключается через
// require() внутри обработчиков (access.pb.js, main.pb.js, groups.pb.js).
// Правило: администратор всегда с доступом. Остальные с доступом, если нет паузы и дата access_until
// пустая (бессрочно) или ещё не прошла (последний день включительно).
// Без доступа человек видит карточки книг, полки, поиск, свои цитаты, заметки и группы, но книги
// не открываются, а добавлять и менять ничего нельзя (кроме пароля и темы, выхода из группы,
// передачи роли создателя и удаления аккаунта).
// «Сегодня» считается по времени Хабаровска: APP_TZ_OFFSET в часах, по умолчанию 10.

function today() {
  const off = parseFloat($os.getenv("APP_TZ_OFFSET"));
  return new Date(Date.now() + (isNaN(off) ? 10 : off) * 3600 * 1000).toISOString().slice(0, 10);
}
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !isNaN(new Date(v + "T00:00:00Z").getTime())
  && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
// Прибавить месяцы: 31 января + 1 месяц = 28 (29) февраля
function addMonths(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}
// Срок из приглашения: "" бессрочно, "1m", "3m", "6m"
const PERIODS = { "": "бессрочно", "1m": "1 месяц", "3m": "3 месяца", "6m": "6 месяцев" };
function untilFor(period) {
  const m = /^(\d+)m$/.exec(String(period || ""));
  return m ? addMonths(today(), +m[1]) : "";
}

function state(user) {
  const admin = user.getString("role") === "admin";
  const until = user.getString("access_until");
  const suspended = user.getBool("suspended");
  const t = today();
  let reason = "";
  if (!admin && suspended) reason = "suspended";
  else if (!admin && until && until < t) reason = "expired";
  return { admin, until, suspended, active: !reason, reason, today: t };
}
function contact() { return ($os.getenv("CONTACT_EMAIL") || "").trim() || "администратору"; }
const head = (st) => st.reason === "suspended" ? "Доступ приостановлен" : "Срок доступа закончился";
// Запись без доступа
function message(st) {
  return `${head(st)}: можно смотреть свои записи, а добавлять и менять нельзя. Чтобы продлить, напишите: ${contact()}.`;
}
// Книги и файлы уроков без доступа не открываются
function booksMessage(st) {
  return `${head(st)}: книги сейчас не открываются. Чтобы продлить, напишите: ${contact()}.`;
}
const isUser = (rec) => !!(rec && rec.collection && rec.collection().name === "users");
function userOf(userOrId) {
  if (isUser(userOrId)) return userOrId;
  try { return $app.findRecordById("users", String(userOrId || "")); } catch (_) { return null; }
}
// Для обработчиков создания, изменения и удаления записей и для своих маршрутов, которые что-то меняют
function guard(e) {
  if (e.hasSuperuserAuth() || !isUser(e.auth)) return;
  const st = state(e.auth);
  if (!st.active) throw new ForbiddenError(message(st));
}
// Для ссылок на файлы книг и уроков и для отдачи самих файлов (user: запись или id)
function requireBooks(userOrId) {
  const u = userOf(userOrId);
  if (!u) throw new ForbiddenError("Войдите в приложение.");
  const st = state(u);
  if (!st.active) throw new ForbiddenError(booksMessage(st));
}
// Свой профиль без доступа: можно сменить пароль и тему оформления, имя и фото нельзя
const PROFILE_LOCKED = ["name", "avatar", "emailVisibility"];
function guardProfile(e) {
  if (e.hasSuperuserAuth() || !isUser(e.auth)) return;
  const st = state(e.auth);
  if (st.active) return;
  const o = e.record.original();
  const changed = e.record.getUnsavedFiles("avatar").length > 0
    || PROFILE_LOCKED.some((f) => e.record.getString(f) !== o.getString(f));
  if (changed) throw new ForbiddenError(message(st));
}

// Срок доступа в приглашении: только из списка PERIODS
function checkInvite(e) {
  if (!Object.prototype.hasOwnProperty.call(PERIODS, e.record.getString("access_period"))) {
    throw new BadRequestError("Выберите срок доступа из списка.");
  }
}
// Регистрация по приглашению: срок доступа от сегодня, присланные значения не принимаются.
// Первый пользователь (администратор) бессрочный.
function applyInvite(record, invite) {
  record.set("access_until", invite ? untilFor(invite.getString("access_period")) : "");
  record.set("suspended", false);
}

/* ---------- Раздел «Пользователи» для администратора ---------- */
function requireAdmin(e) {
  if (!isUser(e.auth) || e.auth.getString("role") !== "admin") throw new ForbiddenError("Это может сделать только администратор библиотеки.");
}
function adminUsers(e) {
  requireAdmin(e);
  const logs = {};
  for (const l of $app.findRecordsByFilter("access_log", "id != ''", "-created", 5000, 0)) {
    const u = l.getString("user");
    (logs[u] = logs[u] || []).push({
      created: l.getString("created"), by: l.getString("by_name"), action: l.getString("action"),
      until_before: l.getString("until_before"), until_after: l.getString("until_after"), note: l.getString("note"),
    });
  }
  const users = $app.findRecordsByFilter("users", "id != ''", "created", 0, 0).map((u) => {
    const st = state(u);
    return {
      id: u.id, name: u.getString("name"), email: u.getString("email"), role: u.getString("role") || "user",
      avatar: u.getString("avatar"), created: u.getString("created"),
      access_until: st.until, suspended: st.suspended, active: st.active, reason: st.reason, no_mark: u.getBool("no_mark"),
      log: (logs[u.id] || []).slice(0, 20),
    };
  });
  return e.json(200, users);
}
function adminAccess(e) {
  requireAdmin(e);
  const b = e.requestInfo().body || {};
  let u = null;
  try { u = $app.findRecordById("users", String(b.user || "")); } catch (_) {}
  if (!u) throw new NotFoundError("Пользователь не найден.");
  const note = String(b.note || "").trim().slice(0, 1000);
  const before = u.getString("access_until");
  const t = today();
  const action = String(b.action || "");
  if (u.getString("role") === "admin" && action !== "note") throw new BadRequestError("У администратора доступ всегда бессрочный.");
  let months = 0;
  switch (action) {
    case "extend": {
      months = parseInt(b.months, 10);
      if (!(months >= 1 && months <= 24)) throw new BadRequestError("Продлить можно на 1–24 месяца.");
      // продление считается от даты окончания, если она ещё не прошла, иначе от сегодня
      const from = before && before >= t ? before : t;
      u.set("access_until", addMonths(from, months));
      u.set("suspended", false);
      break;
    }
    case "set": {
      if (!isDate(b.date)) throw new BadRequestError("Укажите дату.");
      u.set("access_until", String(b.date));
      u.set("suspended", false);
      break;
    }
    case "unlimited": u.set("access_until", ""); u.set("suspended", false); break;
    case "suspend": u.set("suspended", true); break;
    case "resume": u.set("suspended", false); break;
    case "note": if (!note) throw new BadRequestError("Заметка пустая."); break;
    // подпись на страницах только у этого читателя (правки 4.2); журнал и ограничение скорости не меняются
    case "mark_off": u.set("no_mark", true); break;
    case "mark_on": u.set("no_mark", false); break;
    default: throw new BadRequestError("Неизвестное действие.");
  }
  $app.runInTransaction((tx) => {
    if (action !== "note") tx.save(u);
    const log = new Record(tx.findCollectionByNameOrId("access_log"));
    log.set("user", u.id);
    log.set("by_name", e.auth.getString("name") || e.auth.getString("email"));
    log.set("action", action + (action === "extend" ? ":" + months : ""));
    log.set("until_before", before);
    log.set("until_after", u.getString("access_until"));
    log.set("note", note);
    tx.save(log);
  });
  return e.json(200, { ok: true });
}

// Своё состояние доступа для приложения
function myAccess(e) {
  const st = state(e.auth);
  return e.json(200, { active: st.active, reason: st.reason, until: st.until, suspended: st.suspended, admin: st.admin, today: st.today, contact: contact() });
}

module.exports = { today, addMonths, state, guard, guardProfile, requireBooks, message, booksMessage, untilFor, PERIODS, checkInvite, applyInvite, adminUsers, adminAccess, myAccess };
