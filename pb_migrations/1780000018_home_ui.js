/// <reference path="../pb_data/types.d.ts" />

// Правки 4.7: вид главной страницы запоминается в аккаунте.
// users.home_ui (JSON): {"collapsed": ["reading", "shelves", "mine", "reviews"], "listen_hidden": true}
//   collapsed: какие блоки главной свёрнуты; listen_hidden: блок «Продолжить слушание» закрыт крестиком.
// Пусто = всё развёрнуто и «Продолжить слушание» показано, поэтому старые записи менять не нужно.
// Пишет только маршрут POST /api/knigi/home-ui (home_lib.js) с проверкой ключей: правило обновления users
// запрещает присылать поле обычным запросом. Видит поле только сам человек (onRecordEnrich в home.pb.js).

const PROTECT = " && @request.body.home_ui:isset = false";

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("home_ui")) users.fields.add(new JSONField({ name: "home_ui", maxSize: 500 }));
  if ((users.updateRule || "").indexOf("home_ui") < 0) users.updateRule = (users.updateRule || "id = @request.auth.id") + PROTECT;
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.updateRule = (users.updateRule || "").replace(PROTECT, "");
  users.fields.removeByName("home_ui");
  app.save(users);
});
