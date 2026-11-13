/// <reference path="../pb_data/types.d.ts" />

// Вид главной страницы (правки 4.7): свёрнутые блоки и закрытое «Продолжить слушание». Логика в home_lib.js.
// Поле users.home_ui человек меняет только своё и только этим маршрутом (правило обновления users
// запрещает присылать его обычным запросом). Маршрут открыт всем вошедшим, и без доступа тоже
// (срок закончился, пауза, условия не приняты): главную они видят, значит и свернуть блоки могут.
// В подключение к ИИ (MCP) эти настройки не попадают.

// Чужие настройки вида не видит никто, даже участник общей группы
onRecordEnrich((e) => {
  const auth = e.requestInfo.auth;
  if (!(auth && (auth.isSuperuser() || auth.id === e.record.id))) e.record.hide("home_ui");
  e.next();
}, "users");

routerAdd("GET", "/api/knigi/home-ui", (e) => require(`${__hooks}/home_lib.js`).get(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/knigi/home-ui", (e) => require(`${__hooks}/home_lib.js`).save(e), $apis.requireAuth("users"));
