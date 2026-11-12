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

/* ---------- Условия пользования (правки 4.4, часть А) ---------- */
// Действует редакция с наибольшим номером (коллекция terms). Нет ни одной редакции: условия не спрашиваются.
function termsCurrent() {
  try {
    const list = $app.findRecordsByFilter("terms", "version > 0", "-version", 1, 0);
    return list.length ? list[0] : null;
  } catch (_) { return null; }
}
function termsVersion() { const t = termsCurrent(); return t ? t.getInt("version") : 0; }
const TERMS_MSG = "Нужно принять условия пользования библиотекой.";

// reason: "terms" (условия не приняты), "suspended" (пауза), "expired" (срок прошёл), "" (доступ есть).
// Условия проверяются первыми: пока они не приняты, приложение показывает только окно с условиями.
// access_reason: причина без учёта условий (для раздела «Пользователи» и полосок срока).
function state(user) {
  const admin = user.getString("role") === "admin";
  const until = user.getString("access_until");
  const suspended = user.getBool("suspended");
  const t = today();
  let accessReason = "";
  if (!admin && suspended) accessReason = "suspended";
  else if (!admin && until && until < t) accessReason = "expired";
  const tv = termsVersion();
  const termsOk = admin || user.getInt("terms_version") >= tv;
  const reason = termsOk ? accessReason : "terms";
  return { admin, until, suspended, active: !reason, reason, access_reason: accessReason, terms_ok: termsOk, terms_current: tv, today: t };
}
function contact() { return ($os.getenv("CONTACT_EMAIL") || "").trim() || "администратору"; }
const head = (st) => st.reason === "suspended" ? "Доступ приостановлен" : "Срок доступа закончился";
// Запись без доступа
function message(st) {
  if (st.reason === "terms") return TERMS_MSG;
  return `${head(st)}: можно смотреть свои записи, а добавлять и менять нельзя. Чтобы продлить, напишите: ${contact()}.`;
}
// Книги и файлы уроков без доступа не открываются
function booksMessage(st) {
  if (st.reason === "terms") return TERMS_MSG;
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
    // active и reason здесь только про срок и паузу: непринятые условия показываются отдельной строкой
    return {
      id: u.id, name: u.getString("name"), email: u.getString("email"), role: u.getString("role") || "user",
      avatar: u.getString("avatar"), created: u.getString("created"),
      access_until: st.until, suspended: st.suspended, active: !st.access_reason, reason: st.access_reason, no_mark: u.getBool("no_mark"),
      terms_version: u.getInt("terms_version"), terms_at: u.getString("terms_at"), terms_ok: st.terms_ok,
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
// reason "terms": условия не приняты (приложение показывает окно с условиями, полоски срока не показывает);
// access_reason: срок или пауза без учёта условий. terms: какую редакцию принял человек и какая действует.
function myAccess(e) {
  const st = state(e.auth);
  return e.json(200, {
    active: st.active, reason: st.reason, access_reason: st.access_reason, until: st.until, suspended: st.suspended, admin: st.admin, today: st.today, contact: contact(),
    terms: { ok: st.terms_ok, current: st.terms_current, accepted: e.auth.getInt("terms_version"), accepted_at: e.auth.getString("terms_at") },
  });
}

/* ---------- Условия пользования: маршруты (правки 4.4, часть А) ---------- */
function termsJson(t) {
  return t ? { version: t.getInt("version"), text: t.getString("text"), created: t.getString("created"), updated: t.getString("updated"), by: t.getString("by_name") }
    : { version: 0, text: "", created: "", updated: "", by: "" };
}
function logAction(tx, user, by, action, note) {
  const log = new Record(tx.findCollectionByNameOrId("access_log"));
  log.set("user", user.id);
  log.set("by_name", by);
  log.set("action", action);
  log.set("until_before", user.getString("access_until"));
  log.set("until_after", user.getString("access_until"));
  log.set("note", note || "");
  tx.save(log);
}
const nameOf = (u) => u.getString("name") || u.getString("email");
// Сколько читателей приняли действующую редакцию (администраторы не считаются)
function termsStats(v) {
  const total = $app.countRecords("users", $dbx.exp("role != 'admin'"));
  const accepted = $app.countRecords("users", $dbx.exp("role != 'admin' AND terms_version >= {:v}", { v }));
  return { accepted, total };
}
// Текст действующей редакции. Открыт и без входа: он нужен на экране регистрации до создания аккаунта.
// С входом в ответе ещё своё согласие, у администратора число принявших.
function termsGet(e) {
  const t = termsCurrent();
  const out = termsJson(t);
  if (isUser(e.auth)) {
    const st = state(e.auth);
    out.accepted = e.auth.getInt("terms_version");
    out.accepted_at = e.auth.getString("terms_at");
    out.ok = st.terms_ok;
    if (st.admin) Object.assign(out, termsStats(out.version), { editions: $app.countRecords("terms") });
  }
  e.response.header().set("Cache-Control", "no-store");
  return e.json(200, out);
}
// Записать согласие: при регистрации (запись ещё в транзакции создания) и маршрутом «Принять»
function setAccepted(user, version) {
  user.set("terms_version", version);
  user.set("terms_at", new Date().toISOString().replace("T", " "));
}
// «Принять»: version = редакция, которую человек прочитал. Если пока окно было открыто, вышла новая, 409.
function termsAccept(e) {
  const b = e.requestInfo().body || {};
  const v = termsVersion();
  const u = $app.findRecordById("users", e.auth.id);
  if (u.getString("role") === "admin") return e.json(200, { ok: true });
  if (parseInt(b.version, 10) !== v) {
    return e.json(409, { status: 409, message: "Условия только что изменились. Прочитайте новую редакцию.", data: {}, version: v });
  }
  if (v && u.getInt("terms_version") < v) {
    $app.runInTransaction((tx) => {
      setAccepted(u, v);
      tx.save(u);
      logAction(tx, u, nameOf(u), "terms:" + v, "");
    });
  }
  return e.json(200, { ok: true, version: v });
}
// Регистрация по приглашению: без согласия с действующей редакцией аккаунт не создаётся.
// body.terms = номер редакции, которую человек принял в окне. Присланные terms_version и terms_at не принимаются.
function applyTerms(record, invite, body) {
  if (!invite) { record.set("terms_version", 0); record.set("terms_at", ""); return 0; }
  const v = termsVersion();
  if (v && parseInt((body || {}).terms, 10) !== v) throw new BadRequestError(TERMS_MSG);
  if (!v) { record.set("terms_version", 0); record.set("terms_at", ""); return 0; }
  setAccepted(record, v);
  return v;
}
// После создания аккаунта: строка «Принял(а) условия, редакция N» в истории
function logRegistered(record, version) {
  if (!version) return;
  try {
    $app.runInTransaction((tx) => logAction(tx, record, nameOf(record), "terms:" + version, "при регистрации"));
  } catch (err) { console.log("Не записалось согласие в историю: " + err); }
}
// «Сохранить» в разделе «Условия»: {text, new, version}. new = следующая редакция (все читатели принимают заново),
// иначе исправляется текст действующей (version должна совпадать с ней, чтобы не исправить чужую новую редакцию).
function termsSave(e) {
  requireAdmin(e);
  const b = e.requestInfo().body || {};
  const text = String(b.text || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").trim();
  if (!text) throw new BadRequestError("Текст условий пустой.");
  if (text.length > 20000) throw new BadRequestError("Текст условий длиннее 20 000 знаков.");
  const cur = termsCurrent();
  const by = nameOf(e.auth);
  if (b.new || !cur) {
    const r = new Record($app.findCollectionByNameOrId("terms"));
    r.set("version", (cur ? cur.getInt("version") : 0) + 1);
    r.set("text", text);
    r.set("by_name", by);
    $app.save(r);
  } else {
    if (b.version !== undefined && parseInt(b.version, 10) !== cur.getInt("version")) {
      throw new BadRequestError("Пока вы правили, вышла новая редакция. Откройте раздел заново.");
    }
    cur.set("text", text);
    cur.set("by_name", by);
    $app.save(cur);
  }
  return termsGet(e);
}

// Действует ли доступ у человека (запись или id)
function isActive(userOrId) { const u = userOf(userOrId); return !!u && state(u).active; }
// Состояние доступа человека (запись или id); null, если такого нет
function stateOf(userOrId) { const u = userOf(userOrId); return u ? state(u) : null; }

module.exports = { today, addMonths, state, stateOf, isActive, termsVersion, termsGet, termsAccept, termsSave, applyTerms, logRegistered, TERMS_MSG, guard, guardProfile, requireBooks, message, booksMessage, untilFor, PERIODS, checkInvite, applyInvite, adminUsers, adminAccess, myAccess };
