/// <reference path="../pb_data/types.d.ts" />

// Правки 4.4, часть А: условия пользования библиотекой.
// terms: редакции условий (номер, текст, кто сохранил). Действует редакция с наибольшим номером.
// Старые редакции остаются, чтобы было видно, с каким текстом человек соглашался.
// Через API коллекцию никто не читает и не пишет: текст отдают и сохраняют маршруты сервера (access.pb.js).
// Текст простой: каждая строка абзац, строка с «- » в начале пункт списка, [слова](адрес) ссылка.
// users.terms_version: какую редакцию человек принял (0 = не принимал), users.terms_at: когда.
// Ставит только сервер: правило обновления users запрещает присылать эти поля.
// У всех, кто уже зарегистрирован, условия не приняты (0). На администратора условия не действуют.

const PROTECT = " && @request.body.terms_version:isset = false && @request.body.terms_at:isset = false";

const FIRST = [
  "Эта библиотека является частным собранием книг и аудиозаписей. Её владелец открывает вам доступ лично, только для чтения и прослушивания в этом приложении.",
  "Принимая условия, вы обязуетесь:",
  "- не копировать, не скачивать и не сохранять книги, аудиозаписи и их части, в том числе снимками и записью экрана;",
  "- не пересылать их другим людям и не выкладывать в интернет;",
  "- никому не передавать свой логин и пароль.",
  "Короткие цитаты с указанием автора и книги приводить можно.",
  "Взносы в библиотеку добровольны. Это пожертвование администратору на развитие библиотеки: новые книги, аудио и возможности приложения.",
  "Для защиты книг на страницах может стоять подпись с вашим именем и почтой, а сервер записывает, какие книги открывались и слушались.",
  "Если условия нарушены, доступ закрывается без предупреждения.",
  "Ваше имя и почта хранятся только для работы библиотеки. Подробнее в [Политике конфиденциальности](/privacy.html).",
].join("\n");

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("terms_version")) users.fields.add(new NumberField({ name: "terms_version", min: 0, onlyInt: true }));
  if (!users.fields.getByName("terms_at")) users.fields.add(new DateField({ name: "terms_at" }));
  if ((users.updateRule || "").indexOf("terms_version") < 0) users.updateRule = (users.updateRule || "id = @request.auth.id") + PROTECT;
  app.save(users);
  app.db().newQuery("UPDATE users SET terms_version = 0, terms_at = ''").execute();

  const terms = new Collection({
    type: "base",
    name: "terms",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "number", name: "version", required: true, min: 1, onlyInt: true },
      { type: "text", name: "text", required: true, max: 20000 },
      { type: "text", name: "by_name", max: 300 },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_terms_version ON terms (version)"],
  });
  app.save(terms);
  const r = new Record(terms);
  r.set("version", 1);
  r.set("text", FIRST);
  r.set("by_name", "");
  app.save(r);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("terms")); } catch (_) {}
  const users = app.findCollectionByNameOrId("users");
  users.updateRule = (users.updateRule || "").replace(PROTECT, "");
  users.fields.removeByName("terms_version");
  users.fields.removeByName("terms_at");
  app.save(users);
});
