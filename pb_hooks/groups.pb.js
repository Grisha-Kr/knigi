/// <reference path="../pb_data/types.d.ts" />

// Группы чтения (этап 3): хуки коллекций и маршруты /api/knigi/groups/...
// Логика в groups_lib.js. Все проверки на сервере: правила коллекций пускают только участников,
// хуки не дают поменять то, что ставит сервер, маршруты проверяют участника и создателя.

/* ---------- Кто что видит ---------- */
// Другой пользователь (участник общей группы): только имя и фото. Почту и остальное видит лишь сам человек.
onRecordEnrich((e) => {
  const auth = e.requestInfo.auth;
  if (!(auth && (auth.isSuperuser() || auth.id === e.record.id))) {
    e.record.hide("email", "emailVisibility", "verified", "role", "theme", "created", "updated");
  }
  e.next();
}, "users");

// Код ссылки-приглашения видит только создатель группы.
onRecordEnrich((e) => {
  const auth = e.requestInfo.auth;
  if (!(auth && (auth.isSuperuser() || auth.id === e.record.getString("owner")))) e.record.hide("invite_code");
  e.next();
}, "groups");

// Фильтры и сортировка в пользователях и группах: только безопасные поля.
// Так через фильтр нельзя подобрать скрытое (почту участника, код ссылки чужой группы).
onRecordsListRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const ok = ["id", "name", "owner", "book", "@request.auth.id", "true", "false", "null"];
    const q = e.requestInfo().query || {};
    for (const p of ["filter", "sort"]) {
      const s = String(q[p] || "").replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "");
      for (const w of s.match(/[@A-Za-z_][\w.:@]*/g) || []) {
        if (ok.indexOf(w) < 0) throw new BadRequestError("Такой запрос не поддерживается.");
      }
    }
  }
  e.next();
}, "users", "groups");

// Подписки на живые обновления без фильтров: приложению они не нужны, а через них можно подбирать скрытые поля.
onRealtimeSubscribeRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    for (const sub of e.subscriptions) {
      let t = String(sub);
      try { t = decodeURIComponent(t); } catch (_) {}
      if (t.indexOf("filter") >= 0) throw new BadRequestError("Такая подписка не поддерживается.");
    }
  }
  e.next();
});

/* ---------- Группа: название и описание меняет создатель ---------- */
// Создатель, код ссылки и книга меняются только маршрутами ниже.
onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const o = e.record.original();
    for (const f of ["owner", "invite_code", "book"]) e.record.set(f, o.getString(f));
    const name = e.record.getString("name").replace(/\s+/g, " ").trim();
    if (!name) throw new BadRequestError("Введите название группы.");
    e.record.set("name", name);
    e.record.set("description", e.record.getString("description").trim());
  }
  e.next();
}, "groups");

// Удаление аккаунта: группы, где человек создатель, переходят к другому участнику или удаляются.
onRecordDelete((e) => {
  require(`${__hooks}/groups_lib.js`).handOverGroups(e.app, e.record.id);
  e.next();
}, "users");

/* ---------- План чтения: только создатель ---------- */
onRecordCreateRequest((e) => { if (!e.hasSuperuserAuth()) require(`${__hooks}/groups_lib.js`).checkPlan(e); e.next(); }, "group_plan");
onRecordUpdateRequest((e) => { if (!e.hasSuperuserAuth()) require(`${__hooks}/groups_lib.js`).checkPlan(e); e.next(); }, "group_plan");
onRecordDeleteRequest((e) => {
  if (!e.hasSuperuserAuth() && !require(`${__hooks}/groups_lib.js`).CFG.plan()) throw new BadRequestError("План чтения сейчас выключен.");
  e.next();
}, "group_plan");

/* ---------- Комментарии ---------- */
onRecordCreateRequest((e) => { if (!e.hasSuperuserAuth()) require(`${__hooks}/groups_lib.js`).checkCommentCreate(e); e.next(); }, "note_comments");
onRecordUpdateRequest((e) => { if (!e.hasSuperuserAuth()) require(`${__hooks}/groups_lib.js`).checkCommentUpdate(e); e.next(); }, "note_comments");

/* ---------- Маршруты ---------- */
const GROUP_AUTH = $apis.requireAuth("users");

// Настройки групп для приложения: лимиты и включён ли план.
routerAdd("GET", "/api/knigi/group-config", (e) => e.json(200, require(`${__hooks}/groups_lib.js`).config()), GROUP_AUTH);

// Сколько групп в библиотеке: только число и только администратору. Названия, участники и записи групп ему не видны.
routerAdd("GET", "/api/knigi/admin/groups-count", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  return e.json(200, { count: $app.countRecords("groups") });
}, GROUP_AUTH);

// Создать группу {name, description, book}: создатель сразу участник, первая книга становится текущей.
routerAdd("POST", "/api/knigi/groups", (e) => {
  const G = require(`${__hooks}/groups_lib.js`);
  const body = e.requestInfo().body || {};
  const name = String(body.name || "").replace(/\s+/g, " ").trim();
  const desc = String(body.description || "").trim();
  if (!name) throw new BadRequestError("Введите название группы.");
  if (name.length > 100) throw new BadRequestError("Название группы слишком длинное: не больше 100 знаков.");
  if (desc.length > 1000) throw new BadRequestError("Описание слишком длинное: не больше 1000 знаков.");
  if (!body.book) throw new BadRequestError("Выберите первую книгу группы.");
  const b = G.groupBook($app, body.book);
  G.checkLimit($app, e.auth.id);
  let id = "";
  $app.runInTransaction((tx) => {
    const g = new Record(tx.findCollectionByNameOrId("groups"));
    g.set("name", name);
    g.set("description", desc);
    g.set("owner", e.auth.id);
    g.set("invite_code", G.newCode());
    g.set("book", b.id);
    tx.save(g);
    G.startBook(tx, g, b);
    G.addMember(tx, g, e.auth.id);
    id = g.id;
  });
  return e.json(200, { id });
}, GROUP_AUTH);

// Группа по коду из ссылки: название, создатель, книга, сколько участников. Код проверяет только сервер.
routerAdd("GET", "/api/knigi/join/{code}", (e) => {
  const G = require(`${__hooks}/groups_lib.js`);
  const g = G.groupByCode($app, e.request.pathValue("code"));
  let owner = "", book = "";
  try { owner = $app.findRecordById("users", g.getString("owner")).getString("name"); } catch (_) {}
  try { book = $app.findRecordById("books", g.getString("book")).getString("title"); } catch (_) {}
  const members = $app.countRecords("group_members", $dbx.hashExp({ group: g.id }));
  return e.json(200, {
    id: g.id, name: g.getString("name"), description: g.getString("description"), owner, book, members,
    member: G.isMember($app, g.id, e.auth.id),
    full: members >= G.CFG.maxMembers(),
    max: G.CFG.maxMembers(),
  });
}, GROUP_AUTH);
routerAdd("POST", "/api/knigi/join/{code}", (e) => {
  const G = require(`${__hooks}/groups_lib.js`);
  const g = G.groupByCode($app, e.request.pathValue("code"));
  if (!G.isMember($app, g.id, e.auth.id)) {
    G.checkRoom($app, g.id);
    G.checkLimit($app, e.auth.id);
    G.addMember($app, g, e.auth.id);
    // скрытые книги группы (правки 4.1): новому участнику видна их карточка, как остальным
    const F = require(`${__hooks}/files_lib.js`);
    for (const gb of $app.findRecordsByFilter("group_books", "group = {:g} && book != ''", "", 0, 0, { g: g.id })) F.syncKept(gb.getString("book"));
  }
  return e.json(200, { id: g.id });
}, GROUP_AUTH);

// Новая ссылка: старая сразу перестаёт работать.
routerAdd("POST", "/api/knigi/groups/{id}/link", (e) => {
  const G = require(`${__hooks}/groups_lib.js`);
  const g = G.ownGroup($app, e.request.pathValue("id"), e.auth.id);
  g.set("invite_code", G.newCode());
  $app.save(g);
  return e.json(200, { invite_code: g.getString("invite_code") });
}, GROUP_AUTH);

// Передать роль создателя другому участнику.
routerAdd("POST", "/api/knigi/groups/{id}/owner", (e) => {
  const G = require(`${__hooks}/groups_lib.js`);
  const g = G.ownGroup($app, e.request.pathValue("id"), e.auth.id);
  const user = String((e.requestInfo().body || {}).user || "");
  if (!user || user === e.auth.id || !G.isMember($app, g.id, user)) throw new BadRequestError("Выберите другого участника группы.");
  g.set("owner", user);
  $app.save(g);
  return e.json(200, { ok: true });
}, GROUP_AUTH);

// Исключить участника (только создатель). Его заметки в группе становятся личными, комментарии остаются.
routerAdd("POST", "/api/knigi/groups/{id}/remove", (e) => {
  const G = require(`${__hooks}/groups_lib.js`);
  const g = G.ownGroup($app, e.request.pathValue("id"), e.auth.id);
  const user = String((e.requestInfo().body || {}).user || "");
  if (!user || user === e.auth.id) throw new BadRequestError("Себя исключить нельзя: чтобы уйти, выберите «Выйти из группы».");
  if (!G.isMember($app, g.id, user)) throw new BadRequestError("Этого человека уже нет в группе.");
  $app.runInTransaction((tx) => G.removeMember(tx, g.id, user));
  return e.json(200, { ok: true });
}, GROUP_AUTH);

// Выйти из группы. Создатель сначала передаёт роль; если он последний участник, группа удаляется.
routerAdd("POST", "/api/knigi/groups/{id}/leave", (e) => {
  const G = require(`${__hooks}/groups_lib.js`);
  const g = G.memberGroup($app, e.request.pathValue("id"), e.auth.id);
  if (g.getString("owner") === e.auth.id) {
    if ($app.countRecords("group_members", $dbx.hashExp({ group: g.id })) > 1) {
      throw new BadRequestError("Вы создатель группы. Сначала передайте эту роль другому участнику: «Участники» → «Сделать создателем».");
    }
    $app.delete(g);
    return e.json(200, { deleted: true });
  }
  $app.runInTransaction((tx) => G.removeMember(tx, g.id, e.auth.id));
  return e.json(200, { deleted: false });
}, GROUP_AUTH);

// «Книга прочитана, выбрать следующую» {book}: текущая уходит в прочитанные с датой, план по ней закрывается.
routerAdd("POST", "/api/knigi/groups/{id}/book", (e) => {
  const G = require(`${__hooks}/groups_lib.js`);
  const g = G.ownGroup($app, e.request.pathValue("id"), e.auth.id);
  const b = G.groupBook($app, (e.requestInfo().body || {}).book);
  if (b.id === g.getString("book")) throw new BadRequestError("Группа уже читает эту книгу.");
  $app.runInTransaction((tx) => {
    for (const gb of tx.findRecordsByFilter("group_books", "group = {:g} && finished_at = ''", "", 0, 0, { g: g.id })) {
      gb.set("finished_at", G.nowStr());
      tx.save(gb);
    }
    const g2 = tx.findRecordById("groups", g.id);
    g2.set("book", b.id);
    tx.save(g2);
    G.startBook(tx, g2, b);
    for (const m of tx.findAllRecords("group_members", $dbx.hashExp({ group: g.id, user: e.auth.id }))) { m.set("book_seen", b.id); tx.save(m); }
  });
  return e.json(200, { ok: true });
}, GROUP_AUTH);

// Человек открыл экран группы: с этого времени считается «новое», плашку о новой книге он уже видел.
routerAdd("POST", "/api/knigi/groups/{id}/seen", (e) => {
  const G = require(`${__hooks}/groups_lib.js`);
  const g = G.memberGroup($app, e.request.pathValue("id"), e.auth.id);
  const m = $app.findFirstRecordByFilter("group_members", "group = {:g} && user = {:u}", { g: g.id, u: e.auth.id });
  m.set("last_seen", G.nowStr());
  m.set("book_seen", g.getString("book"));
  $app.save(m);
  return e.json(200, { id: m.id, last_seen: m.getString("last_seen"), book_seen: m.getString("book_seen") });
}, GROUP_AUTH);

// Экран группы: кто сегодня читал книгу группы и сколько, неделя с понедельника, где каждый в книге (для плана).
// ?day=ГГГГ-ММ-ДД (сегодня по часам устройства), ?from= понедельник этой недели.
routerAdd("GET", "/api/knigi/groups/{id}/state", (e) => {
  const G = require(`${__hooks}/groups_lib.js`);
  const g = G.memberGroup($app, e.request.pathValue("id"), e.auth.id);
  const q = e.requestInfo().query || {};
  return e.json(200, G.groupState($app, g, String(q.day || ""), String(q.from || "")));
}, GROUP_AUTH);
