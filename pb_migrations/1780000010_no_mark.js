/// <reference path="../pb_data/types.d.ts" />

// Правки 4.2: подпись на страницах можно выключить отдельному читателю.
// users.no_mark: true = у этого человека подписи нет (ни строки внизу, ни надписи по центру).
// Ставит только сервер по команде администратора (маршрут /api/knigi/admin/access, действия mark_off и mark_on),
// правило обновления users запрещает присылать это поле, а сам читатель его не видит (onRecordEnrich в access.pb.js).
// По умолчанию false: у всех подпись есть, как раньше.

const PROTECT = " && @request.body.no_mark:isset = false";

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("no_mark")) users.fields.add(new BoolField({ name: "no_mark" }));
  if ((users.updateRule || "").indexOf("no_mark") < 0) users.updateRule = (users.updateRule || "id = @request.auth.id") + PROTECT;
  app.save(users);
  app.db().newQuery("UPDATE users SET no_mark = FALSE").execute();
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.updateRule = (users.updateRule || "").replace(PROTECT, "");
  users.fields.removeByName("no_mark");
  app.save(users);
});
