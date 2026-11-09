/// <reference path="../pb_data/types.d.ts" />

// Правки 4.1, часть Б: срок доступа для читателей (по образцу «Молитвенного дневника», правки 2.5).
// users.access_until (ГГГГ-ММ-ДД, пусто = бессрочно) и users.suspended (пауза). Менять их может только сервер
// по команде администратора: правило обновления users запрещает присылать эти поля.
// invites.access_period: срок для новых пользователей ("", 1m, 3m, 6m).
// access_log: история продлений, пауз и заметок администратора. Через API её не читает и не пишет никто,
// только маршруты сервера. Удаляется вместе с пользователем.
// Все уже зарегистрированные пользователи остаются бессрочными: пустая дата, без паузы.

const PROTECT = " && @request.body.access_until:isset = false && @request.body.suspended:isset = false";

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("access_until")) {
    users.fields.add(new TextField({ name: "access_until", max: 10, pattern: "^(\\d{4}-\\d{2}-\\d{2})?$" }));
  }
  if (!users.fields.getByName("suspended")) users.fields.add(new BoolField({ name: "suspended" }));
  if ((users.updateRule || "").indexOf("access_until") < 0) users.updateRule = (users.updateRule || "id = @request.auth.id") + PROTECT;
  app.save(users);
  // у всех, кто уже есть, доступ бессрочный
  app.db().newQuery("UPDATE users SET access_until = '', suspended = FALSE").execute();

  const invites = app.findCollectionByNameOrId("invites");
  if (!invites.fields.getByName("access_period")) invites.fields.add(new TextField({ name: "access_period", max: 10 }));
  app.save(invites);

  app.save(new Collection({
    type: "base",
    name: "access_log",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "user", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { type: "text", name: "by_name", max: 300 },
      { type: "text", name: "action", max: 30 },
      { type: "text", name: "until_before", max: 10 },
      { type: "text", name: "until_after", max: 10 },
      { type: "text", name: "note", max: 1000 },
      { type: "autodate", name: "created", onCreate: true },
    ],
    indexes: ["CREATE INDEX idx_access_log_user ON access_log (user)"],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("access_log")); } catch (_) {}
  const invites = app.findCollectionByNameOrId("invites");
  invites.fields.removeByName("access_period");
  app.save(invites);
  const users = app.findCollectionByNameOrId("users");
  users.updateRule = (users.updateRule || "").replace(PROTECT, "");
  users.fields.removeByName("access_until");
  users.fields.removeByName("suspended");
  app.save(users);
});
