/// <reference path="../pb_data/types.d.ts" />

// Отзывы о книгах (правки 4.6): маршруты и хуки. Логика в reviews_lib.js.
// Через обычный API отзывы только читаются (тем, кому видна книга), правила записи закрыты: всё пишут эти маршруты.
// В подключение к ИИ (MCP) отзывы не попадают.

// «Просмотрен администратором» нужен только администратору
onRecordEnrich((e) => {
  const auth = e.requestInfo.auth;
  if (!(auth && (auth.isSuperuser() || auth.getString("role") === "admin"))) e.record.hide("seen");
  e.next();
}, "reviews");

// Имя или фото поменялись: копия в отзывах тоже
onRecordAfterUpdateSuccess((e) => {
  e.next();
  const o = e.record.original();
  if (o.getString("name") === e.record.getString("name") && o.getString("avatar") === e.record.getString("avatar")) return;
  try { require(`${__hooks}/reviews_lib.js`).syncUser(e.record); } catch (err) { console.log("Отзывы: имя не обновилось: " + err); }
}, "users");

// Отметка «Прочитано» появилась, пропала или книга удалена: пометка «прочитал(а)» у отзыва
onRecordAfterCreateSuccess((e) => { e.next(); require(`${__hooks}/reviews_lib.js`).markChanged(e.record); }, "marks");
onRecordAfterUpdateSuccess((e) => { e.next(); require(`${__hooks}/reviews_lib.js`).markChanged(e.record); }, "marks");
onRecordAfterDeleteSuccess((e) => { e.next(); require(`${__hooks}/reviews_lib.js`).markChanged(e.record); }, "marks");

routerAdd("POST", "/api/knigi/reviews", (e) => require(`${__hooks}/reviews_lib.js`).create(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/knigi/reviews/{id}", (e) => require(`${__hooks}/reviews_lib.js`).update(e, e.request.pathValue("id")), $apis.requireAuth("users"));
routerAdd("DELETE", "/api/knigi/reviews/{id}", (e) => require(`${__hooks}/reviews_lib.js`).remove(e, e.request.pathValue("id")), $apis.requireAuth("users"));
routerAdd("POST", "/api/knigi/admin/reviews/seen", (e) => require(`${__hooks}/reviews_lib.js`).seenAll(e), $apis.requireAuth("users"));
