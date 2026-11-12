/// <reference path="../pb_data/types.d.ts" />

// Срок доступа (правки 4.1, часть Б): когда срок прошёл или стоит пауза, книги не открываются,
// а свои записи можно только смотреть. Логика в access_lib.js. Файлы подключаются по алфавиту, поэтому эти
// запреты обычно срабатывают раньше хуков groups.pb.js и main.pb.js; для надёжности те же хуки там
// тоже начинаются с проверки доступа.
// Без доступа открыты: вход, просмотр, смена пароля и темы, выход из группы, передача роли создателя,
// удаление аккаунта. Каскадные удаления (удаление аккаунта, выход из группы) идут мимо этих хуков.
// Подключение к ИИ (этап 4) доступно только администратору, а на него срок не действует.

// Коллекции с данными пользователя и групп. Часть из них через API и так закрыта (их ведёт сервер),
// здесь они на случай, если правила когда-нибудь откроют.
const DATA = ["shelves", "shelf_books", "notes", "note_files", "marks", "reading", "book_offers",
  "groups", "group_members", "group_plan", "group_reads", "note_comments"];

onRecordCreateRequest((e) => { require(`${__hooks}/access_lib.js`).guard(e); e.next(); }, ...DATA);
onRecordUpdateRequest((e) => { require(`${__hooks}/access_lib.js`).guard(e); e.next(); }, ...DATA);
onRecordDeleteRequest((e) => { require(`${__hooks}/access_lib.js`).guard(e); e.next(); }, ...DATA);

// Свой профиль: без доступа нельзя менять имя и фото; пароль и тему можно.
onRecordUpdateRequest((e) => { require(`${__hooks}/access_lib.js`).guardProfile(e); e.next(); }, "users");

// Срок доступа в приглашении: только из списка
onRecordCreateRequest((e) => { require(`${__hooks}/access_lib.js`).checkInvite(e); e.next(); }, "invites");
onRecordUpdateRequest((e) => { require(`${__hooks}/access_lib.js`).checkInvite(e); e.next(); }, "invites");

// Срок и пауза другого человека не видны никому, кроме него самого (участники групп видят только имя и фото).
// Согласие с условиями (правки 4.4) тоже.
// «Без подписи на страницах» (no_mark, правки 4.2) не видит и сам читатель: это решение администратора.
onRecordEnrich((e) => {
  const auth = e.requestInfo.auth;
  if (!(auth && (auth.isSuperuser() || auth.id === e.record.id))) e.record.hide("access_until", "suspended", "terms_version", "terms_at");
  if (!(auth && (auth.isSuperuser() || auth.getString("role") === "admin"))) e.record.hide("no_mark");
  e.next();
}, "users");

routerAdd("GET", "/api/knigi/access", (e) => require(`${__hooks}/access_lib.js`).myAccess(e), $apis.requireAuth("users"));
routerAdd("GET", "/api/knigi/admin/users", (e) => require(`${__hooks}/access_lib.js`).adminUsers(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/knigi/admin/access", (e) => require(`${__hooks}/access_lib.js`).adminAccess(e), $apis.requireAuth("users"));

// Условия пользования (правки 4.4, часть А). Текст открыт и без входа: он нужен до регистрации.
routerAdd("GET", "/api/knigi/terms", (e) => require(`${__hooks}/access_lib.js`).termsGet(e));
routerAdd("POST", "/api/knigi/terms/accept", (e) => require(`${__hooks}/access_lib.js`).termsAccept(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/knigi/admin/terms", (e) => require(`${__hooks}/access_lib.js`).termsSave(e), $apis.requireAuth("users"));
