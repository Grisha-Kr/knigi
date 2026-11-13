/// <reference path="../pb_data/types.d.ts" />

// Правки 4.8: защита файлов книг.
//
// rate_use: счётчик ограничения скорости (MAX_MB_PER_HOUR) по читателю. Раньше он жил в памяти сервера и
//   обнулялся при каждом перезапуске (в том числе после update.sh). Одна строка на человека: h = номер часа
//   (UTC, часы от 1970 года), cur = байт за этот час, prev = байт за прошлый час. Пишет только сервер
//   (files_lib.js, takeBytes), правила закрыты. Удаление пользователя удаляет его строку.
//
// read_log.files (JSON): сколько байт отдано за этот час по каждому файлу книги {"ID_ФАЙЛА": байт}.
//   По нему журнал выделяет часы, где файл получен почти целиком, а страниц просмотрено мало.
//   У старых строк поле пустое, их журнал не выделяет.

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  app.save(new Collection({
    type: "base",
    name: "rate_use",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "user", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { type: "number", name: "h", onlyInt: true },
      { type: "number", name: "cur", onlyInt: true },
      { type: "number", name: "prev", onlyInt: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_rate_use_user ON rate_use (user)"],
  }));
  const log = app.findCollectionByNameOrId("read_log");
  if (!log.fields.getByName("files")) log.fields.add(new JSONField({ name: "files", maxSize: 20000 }));
  app.save(log);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("rate_use")); } catch (_) {}
  const log = app.findCollectionByNameOrId("read_log");
  log.fields.removeByName("files");
  app.save(log);
});
