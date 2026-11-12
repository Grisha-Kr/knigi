/// <reference path="../pb_data/types.d.ts" />

// Сообщения администратору (правки 4.5, часть А): маршруты. Логика в messages_lib.js.
// Через обычный API сообщения и ответы только читаются (своё читателю, всё администратору), правила записи
// закрыты: всё пишут эти маршруты. В подключение к ИИ (MCP) сообщения не попадают.

// Состояние «Новое / Прочитано / Отвечено» и архив нужны только администратору
onRecordEnrich((e) => {
  const auth = e.requestInfo.auth;
  if (!(auth && (auth.isSuperuser() || auth.getString("role") === "admin"))) e.record.hide("status", "archived");
  e.next();
}, "messages");


routerAdd("POST", "/api/knigi/messages", (e) => require(`${__hooks}/messages_lib.js`).create(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/knigi/messages/{id}/reply", (e) => require(`${__hooks}/messages_lib.js`).reply(e, e.request.pathValue("id")), $apis.requireAuth("users"));
routerAdd("POST", "/api/knigi/messages/{id}/seen", (e) => require(`${__hooks}/messages_lib.js`).seen(e, e.request.pathValue("id")), $apis.requireAuth("users"));
routerAdd("POST", "/api/knigi/messages/{id}/state", (e) => require(`${__hooks}/messages_lib.js`).setState(e, e.request.pathValue("id")), $apis.requireAuth("users"));
routerAdd("DELETE", "/api/knigi/messages/{id}", (e) => require(`${__hooks}/messages_lib.js`).remove(e, e.request.pathValue("id")), $apis.requireAuth("users"));
// Снимок экрана: ссылка на 2 часа и кука (как файлы уроков), сам файл по адресу под /api/knigi/f/
routerAdd("GET", "/api/knigi/messages/{id}/shot", (e) => require(`${__hooks}/messages_lib.js`).shotLink(e, e.request.pathValue("id")), $apis.requireAuth("users"));
routerAdd("GET", "/api/knigi/f/shot/{id}", (e) => require(`${__hooks}/messages_lib.js`).shotServe(e, e.request.pathValue("id")));
