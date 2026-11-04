/// <reference path="../pb_data/types.d.ts" />

// Правки 1.1: фото профиля. Поле users.avatar есть у PocketBase с самого начала, но открытое
// (файл доступен любому, кто знает адрес) и принимает SVG. Миграция делает его защищённым
// (открывается только по файловому токену, а правило users пускает только к своей записи),
// оставляет JPEG, PNG и WEBP до 512 КБ: приложение присылает уже обрезанный квадрат 512×512.
// Чужие фото отдают только маршруты: администратору все (раздел «Пользователи»),
// читателям только фото администратора («Заметки автора библиотеки»).

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  let f = users.fields.getByName("avatar");
  if (!f) {
    f = new FileField({ name: "avatar" });
    users.fields.add(f);
  }
  f.maxSelect = 1;
  f.maxSize = 512 * 1024;
  f.mimeTypes = ["image/jpeg", "image/png", "image/webp"];
  f.thumbs = [];
  f.protected = true;
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  const f = users.fields.getByName("avatar");
  if (!f) return;
  f.protected = false;
  f.maxSize = 0;
  f.mimeTypes = ["image/jpeg", "image/png", "image/svg+xml", "image/gif", "image/webp"];
  app.save(users);
});
