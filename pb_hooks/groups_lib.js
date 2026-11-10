// Группы чтения (этап 3): участники, книги группы, план, учёт чтения по дням, групповые заметки, комментарии.
// Подключается в обработчиках через require(`${__hooks}/groups_lib.js`).
// Устройство повторяет группы «Молитвенного дневника»: ссылка-приглашение, роль создателя, неделя кружками.

/* ---------- Настройки из knigi.env ---------- */
function envNum(name, def) {
  const v = String($os.getenv(name) || "").trim();
  if (v === "") return def;
  const n = parseInt(v, 10);
  return isFinite(n) && n > 0 ? n : def;
}
const CFG = {
  maxPerUser: () => envNum("GROUP_MAX_PER_USER", 5),   // в скольких группах может состоять человек (вместе с созданными)
  maxMembers: () => envNum("GROUP_MAX_MEMBERS", 25),   // сколько участников в группе
  // план чтения: 1 включён, 0 спрятан (этапы в базе остаются)
  plan: () => { const v = String($os.getenv("GROUP_PLAN") || "").trim(); return v === "" ? true : v === "1" || v === "true" || v === "да"; },
};
function config() { return { maxPerUser: CFG.maxPerUser(), maxMembers: CFG.maxMembers(), plan: CFG.plan() }; }

const nowStr = () => new Date().toISOString().replace("T", " ");
const utcDay = (k) => new Date(Date.now() + (k || 0) * 864e5).toISOString().slice(0, 10);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
// День по часам устройства: сервер принимает сегодня ± 1 день (запас на часовые пояса), иначе берёт свой
function clientDay(s) {
  s = String(s || "");
  return isDay(s) && s >= utcDay(-1) && s <= utcDay(1) ? s : utcDay(0);
}

/* ---------- Группа и участники ---------- */
// Код ссылки-приглашения: 24 случайных символа без похожих (0/o, 1/l)
function newCode() { return $security.randomStringWithAlphabet(24, "abcdefghijkmnpqrstuvwxyz23456789"); }

function isMember(app, groupId, userId) {
  return app.countRecords("group_members", $dbx.hashExp({ group: groupId, user: userId })) > 0;
}
// Группа, в которой человек участник; иначе «не найдена» (о чужих группах сервер ничего не говорит)
function memberGroup(app, groupId, userId) {
  let g = null;
  try { g = app.findRecordById("groups", groupId); } catch (_) {}
  if (!g || !isMember(app, g.id, userId)) throw new NotFoundError("Группа не найдена: возможно, её удалили или вас из неё исключили.");
  return g;
}
function ownGroup(app, groupId, userId) {
  const g = memberGroup(app, groupId, userId);
  if (g.getString("owner") !== userId) throw new ForbiddenError("Это может сделать только создатель группы.");
  return g;
}
function groupByCode(app, code) {
  code = String(code || "").trim().toLowerCase();
  let g = null;
  if (code.length >= 16) {
    try { g = app.findFirstRecordByData("groups", "invite_code", code); } catch (_) {}
  }
  if (!g) throw new NotFoundError("Ссылка не работает: возможно, создатель группы сделал новую. Попросите прислать свежую ссылку.");
  return g;
}
function checkLimit(app, userId) {
  const max = CFG.maxPerUser();
  if (app.countRecords("group_members", $dbx.hashExp({ user: userId })) >= max) {
    throw new BadRequestError(`Можно состоять не больше чем в ${max} группах (вместе с теми, что вы создали). Чтобы вступить в новую, выйдите из одной из старых.`);
  }
}
function checkRoom(app, groupId) {
  const max = CFG.maxMembers();
  if (app.countRecords("group_members", $dbx.hashExp({ group: groupId })) >= max) {
    throw new BadRequestError(`В группе уже ${max} участников: это наибольшее число.`);
  }
}
function addMember(app, g, userId) {
  const m = new Record(app.findCollectionByNameOrId("group_members"));
  m.set("group", g.id);
  m.set("user", userId);
  m.set("last_seen", nowStr());
  m.set("book_seen", g.getString("book"));
  app.save(m);
}
// Книга для группы: есть в библиотеке, не на проверке и её видят все участники группы (members: id участников).
// Скрытую ото всех книгу группе не выбрать (правки 4.1); скрытую, но открытую отдельным читателям (правки 4.3),
// можно, только если она открыта каждому участнику-читателю.
function groupBook(app, bookId, members) {
  const L = require(`${__hooks}/lib.js`);
  let b = null;
  try { b = app.findRecordById("books", String(bookId || "")); } catch (_) {}
  if (!b || b.getBool("pending")) throw new BadRequestError("Выберите книгу из библиотеки.");
  if (b.getBool("hidden")) {
    const readers = app.findRecordsByFilter("book_access", "book = {:b}", "", 0, 0, { b: b.id }).map((r) => r.getString("user"));
    if (!readers.length) throw new BadRequestError("Эта книга скрыта от читателей. Выберите другую или сначала откройте её всем.");
    for (const uid of members || []) {
      let u = null;
      try { u = app.findRecordById("users", uid); } catch (_) {}
      if (u && !L.isAdmin(u) && readers.indexOf(uid) < 0) throw new BadRequestError("Книга открыта не всем участникам группы. Выберите другую или откройте её всем.");
    }
  }
  return b;
}
// Скрытые книги, которые эта группа выбрать не может (для окна выбора книги, правки 4.3)
function blockedBooks(app, groupId) {
  const L = require(`${__hooks}/lib.js`);
  const members = app.findRecordsByFilter("group_members", "group = {:g}", "", 0, 0, { g: groupId })
    .map((m) => m.getString("user"))
    .filter((uid) => { try { return !L.isAdmin(app.findRecordById("users", uid)); } catch (_) { return false; } });
  const out = [];
  for (const b of app.findRecordsByFilter("books", "hidden = true && pending = false", "", 0, 0)) {
    const readers = app.findRecordsByFilter("book_access", "book = {:b}", "", 0, 0, { b: b.id }).map((r) => r.getString("user"));
    if (!readers.length || members.some((uid) => readers.indexOf(uid) < 0)) out.push(b.id);
  }
  return out;
}
function startBook(app, g, b) {
  const gb = new Record(app.findCollectionByNameOrId("group_books"));
  gb.set("group", g.id);
  gb.set("book", b.id);
  gb.set("book_title", b.getString("title"));
  gb.set("started_at", nowStr());
  app.save(gb);
  return gb;
}
function currentGroupBook(app, groupId) {
  const list = app.findRecordsByFilter("group_books", "group = {:g} && finished_at = ''", "-started_at", 1, 0, { g: groupId });
  return list.length ? list[0] : null;
}

// Человек выходит или его исключают: его групповые заметки и цитаты становятся личными
// (пропадают из ленты группы), комментарии остаются (в группе подписаны «Бывший участник»).
function removeMember(app, groupId, userId) {
  app.db().newQuery('UPDATE notes SET "group" = \'\' WHERE owner = {:u} AND "group" = {:g}').bind({ u: userId, g: groupId }).execute();
  for (const r of app.findAllRecords("group_members", $dbx.hashExp({ group: groupId, user: userId }))) app.delete(r);
}

// Аккаунт создателя удаляется: группа переходит к участнику, который вступил раньше всех, без участников удаляется
function handOverGroups(app, userId) {
  for (const g of app.findAllRecords("groups", $dbx.hashExp({ owner: userId }))) {
    const rest = app.findRecordsByFilter("group_members", "group = {:g} && user != {:u}", "created", 1, 0, { g: g.id, u: userId });
    if (rest.length) { g.set("owner", rest[0].getString("user")); app.save(g); }
    else app.delete(g);
  }
}

// Два человека состоят в общей группе (для фото профиля)
function shareGroup(app, a, b) {
  const m = new DynamicModel({ n: 0 });
  try {
    app.db().newQuery('SELECT COUNT(*) AS n FROM group_members x JOIN group_members y ON x."group" = y."group" WHERE x.user = {:a} AND y.user = {:b}')
      .bind({ a, b }).one(m);
  } catch (_) { return false; }
  return m.n > 0;
}

/* ---------- Заметки и цитаты в группе ---------- */
// notes.group: заметка видна участникам группы. Отправить в группу можно только свою заметку или цитату
// (правило коллекции) к книге, которую группа читает сейчас, и только в группу, где вы участник.
// Уже отправленная заметка по прошлой книге группы остаётся в группе, её можно править.
function checkNoteGroup(r, auth) {
  const gid = r.getString("group");
  if (!gid) return;
  const o = r.isNew() ? null : r.original();
  if (o && o.getString("group") === gid && o.getString("book") === r.getString("book")) return;
  const kind = r.getString("kind");
  if (kind !== "note" && kind !== "highlight") throw new BadRequestError("В группу можно отправить заметку или цитату. Уроки остаются у вас.");
  const g = memberGroup($app, gid, auth.id);
  if (!r.getString("book") || g.getString("book") !== r.getString("book")) {
    throw new BadRequestError(`В группу «${g.getString("name")}» можно отправить только заметку или цитату к книге, которую группа читает сейчас.`);
  }
}

/* ---------- Комментарии ---------- */
const COMMENT_MAX = 2000;
function cleanComment(t) {
  t = String(t || "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) throw new BadRequestError("Напишите комментарий.");
  if (t.length > COMMENT_MAX) throw new BadRequestError(`Комментарий длиннее ${COMMENT_MAX} знаков. Сократите его.`);
  return t;
}
function checkCommentCreate(e) {
  const r = e.record;
  let n = null;
  try { n = $app.findRecordById("notes", r.getString("note")); } catch (_) {}
  const gid = n ? n.getString("group") : "";
  if (!n || !gid) throw new NotFoundError("Заметка не найдена: возможно, её убрали из группы.");
  memberGroup($app, gid, e.auth.id);
  r.set("group", gid);
  r.set("user", e.auth.id);
  r.set("edited", false);
  r.set("text", cleanComment(r.getString("text")));
}
function checkCommentUpdate(e) {
  const r = e.record, o = r.original();
  for (const f of ["note", "group", "user"]) r.set(f, o.getString(f));
  memberGroup($app, o.getString("group"), e.auth.id);
  const t = cleanComment(r.getString("text"));
  if (t !== o.getString("text")) r.set("edited", true);
  else r.set("edited", o.getBool("edited"));
  r.set("text", t);
}

/* ---------- План чтения ---------- */
// Этап: до какой страницы (PDF) или до какого процента (EPUB, подпись главы по желанию) и к какой дате.
// Этап всегда к текущей книге группы. При GROUP_PLAN=0 план спрятан и не меняется, этапы в базе остаются.
function checkPlan(e) {
  if (!CFG.plan()) throw new BadRequestError("План чтения сейчас выключен.");
  const r = e.record;
  const o = r.isNew() ? null : r.original();
  const g = ownGroup($app, o ? o.getString("group") : r.getString("group"), e.auth.id);
  r.set("group", g.id);
  if (o) r.set("gbook", o.getString("gbook"));
  else {
    const gb = currentGroupBook($app, g.id);
    if (!gb || !gb.getString("book")) throw new BadRequestError("У группы сейчас нет книги. Сначала выберите книгу.");
    r.set("gbook", gb.id);
  }
  const gb = $app.findRecordById("group_books", r.getString("gbook"));
  const fmt = r.getString("format");
  let f = null;
  try { f = $app.findFirstRecordByFilter("book_files", "book = {:b} && format = {:f}", { b: gb.getString("book"), f: fmt }); } catch (_) {}
  const V = require(`${__hooks}/convert_lib.js`);
  if (!f) throw new BadRequestError(`У книги нет файла ${V.FMT_NAME[fmt] || fmt}.`);
  if (V.VIEW[fmt] === "pdf") {
    const p = r.getInt("page"), max = f.getInt("pages");
    if (p < 1 || (max && p > max)) throw new BadRequestError(max ? `Страница от 1 до ${max}.` : "Укажите страницу.");
    r.set("pct", 0);
    r.set("chapter", "");
  } else {
    const pct = Math.round(r.getFloat("pct") * 10) / 10;
    if (!(pct > 0 && pct <= 100)) throw new BadRequestError("Укажите процент от 1 до 100.");
    r.set("pct", pct);
    r.set("page", 0);
    r.set("chapter", r.getString("chapter").replace(/\s+/g, " ").trim().slice(0, 200));
  }
  const due = r.getString("due");
  if (!isDay(due) || due < "2000-01-01" || due > "2100-01-01") throw new BadRequestError("Проверьте дату.");
}

/* ---------- Учёт чтения по дням ---------- */
// Вызывается из маршрута прогресса. Пишется, только если книга сейчас читается хотя бы в одной группе
// человека. Страницы считаются по открытым (быстро пролистанная тоже засчитается), у EPUB прирост процента.
// Ограничение скорости и журнал администратора на это не влияют.
function inGroupBook(app, userId, bookId) {
  const m = new DynamicModel({ n: 0 });
  app.db().newQuery('SELECT COUNT(*) AS n FROM group_members m JOIN "groups" g ON g.id = m."group" WHERE m.user = {:u} AND g.book = {:b}')
    .bind({ u: userId, b: bookId }).one(m);
  return m.n > 0;
}
function recordRead(userId, book, fmt, body, oldPct, newPct, pages) {
  try {
    if (!inGroupBook($app, userId, book.id)) return;
    const day = clientDay(body.day);
    const t = nowStr();
    const db = $app.db();
    db.newQuery(`INSERT INTO group_reads (id, "user", book, day, pages, pdf_n, epub_from, epub_to, epub_n, created, updated)
      VALUES ({:id}, {:u}, {:b}, {:d}, '[]', 0, -1, 0, 0, {:t}, {:t}) ON CONFLICT ("user", book, day) DO NOTHING`)
      .bind({ id: $security.randomStringWithAlphabet(15, "abcdefghijklmnopqrstuvwxyz0123456789"), u: userId, b: book.id, d: day, t }).execute();
    const row = $app.findFirstRecordByFilter("group_reads", "user = {:u} && book = {:b} && day = {:d}", { u: userId, b: book.id, d: day });
    const seen = (Array.isArray(body.seen) ? body.seen : []).map((x) => parseInt(x, 10)).filter((x) => x > 0 && (!pages || x <= pages)).slice(0, 500);
    if (require(`${__hooks}/convert_lib.js`).VIEW[fmt] === "pdf") {
      let list = [];
      try { list = JSON.parse(toString(row.get("pages")) || "[]"); } catch (_) { list = []; }
      if (!Array.isArray(list)) list = [];
      const set = {};
      for (const p of list.concat(seen, [parseInt(body.page, 10) || 0])) if (p > 0) set[p] = 1;
      const all = Object.keys(set).map(Number).sort((a, b) => a - b).slice(0, 5000);
      db.newQuery("UPDATE group_reads SET pages = {:p}, pdf_n = {:n}, updated = {:t} WHERE id = {:id}")
        .bind({ p: JSON.stringify(all), n: all.length, t, id: row.id }).execute();
    } else {
      // процент в начале дня: где человек был до первого сохранения за день (новая книга: с нуля)
      const from = row.getFloat("epub_from") < 0 ? (oldPct == null ? 0 : oldPct) : row.getFloat("epub_from");
      db.newQuery("UPDATE group_reads SET epub_from = {:f}, epub_to = MAX(epub_to, {:to}), epub_n = epub_n + {:n}, updated = {:t} WHERE id = {:id}")
        .bind({ f: from, to: newPct, n: Math.max(1, seen.length), t, id: row.id }).execute();
    }
  } catch (err) {
    $app.logger().warn("Не удалось записать чтение для группы", "error", String(err));
  }
}

/* ---------- Что видно на экране группы ---------- */
// Кто сегодня читал книгу группы и сколько, дни недели с чтением, где каждый участник в книге (для плана).
// Только текущая книга группы и только её участникам.
function groupState(app, g, day, from) {
  const bookId = g.getString("book");
  day = clientDay(day);
  if (!isDay(from) || from > day || from < new Date(Date.parse(day) - 7 * 864e5).toISOString().slice(0, 10)) from = day;
  const members = app.findAllRecords("group_members", $dbx.hashExp({ group: g.id }));
  const out = {};
  for (const m of members) out[m.getString("user")] = { today: { pages: 0, pct: 0, read: false }, days: [], pdf: null, epub: null };
  if (bookId) {
    const reads = app.findRecordsByFilter("group_reads", "book = {:b} && day >= {:f} && day <= {:d}", "day", 0, 0, { b: bookId, f: from, d: day });
    for (const r of reads) {
      const u = out[r.getString("user")]; if (!u) continue;
      const growth = r.getFloat("epub_from") >= 0 ? Math.max(0, Math.round((r.getFloat("epub_to") - r.getFloat("epub_from")) * 10) / 10) : 0;
      const read = r.getInt("pdf_n") > 0 || r.getInt("epub_n") > 0 || growth > 0;
      if (read) u.days.push(r.getString("day"));
      if (r.getString("day") === day) u.today = { pages: r.getInt("pdf_n"), pct: growth, read };
    }
    // pdf: читалка PDF (PDF, DjVu), epub: читалка EPUB (EPUB, FB2, MOBI, AZW3, TXT); если форматов одной
    // читалки несколько, берётся самый свежий; f = какой именно формат
    const VIEW = require(`${__hooks}/convert_lib.js`).VIEW;
    for (const r of app.findRecordsByFilter("reading", "book = {:b}", "updated", 0, 0, { b: bookId })) {
      const u = out[r.getString("user")]; if (!u) continue;
      if (VIEW[r.getString("format")] === "epub") u.epub = { pct: r.getFloat("pct"), at: r.getString("updated"), f: r.getString("format") };
      else u.pdf = { page: r.getInt("page"), pages: r.getInt("pages"), at: r.getString("updated"), f: r.getString("format") || "pdf" };
    }
  }
  return { book: bookId, day, from, members: out };
}

module.exports = {
  CFG, config, clientDay, newCode, isMember, memberGroup, ownGroup, groupByCode, checkLimit, checkRoom, addMember,
  groupBook, blockedBooks, startBook, currentGroupBook, removeMember, handOverGroups, shareGroup,
  checkNoteGroup, checkCommentCreate, checkCommentUpdate, checkPlan, recordRead, groupState, nowStr,
};
