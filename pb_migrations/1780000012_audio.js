/// <reference path="../pb_data/types.d.ts" />

// Правки 4.3, часть Б: аудио к книгам.
//
// audio_tracks: главы аудио (книга, название, порядок, файл, размер, длительность в секундах, формат mp3/m4a,
//   опубликована, когда опубликована). Сам файл лежит вне pb_data, в AUDIO_DIR (/opt/knigi/audio), в записи
//   только его имя: ежедневная копия базы не разрастается. Черновик (published = false) видит только администратор.
//   Опубликованную главу видят те, кому открыта книга: книга не на проверке и видна всем или открыта
//   этому читателю (правки 4.3, часть А). Через API главы не меняет никто: загрузка, название, порядок,
//   публикация и удаление идут маршрутами /api/knigi/audio/... (audio.pb.js).
// audio_progress: где человек остановился в главе (секунды), дослушал ли её, когда слушал. Видит только он сам,
//   пишет маршрут /api/knigi/audio/{id}/progress. Удаляется вместе с главой, книгой или пользователем.
// read_log: listen_sec (сколько секунд слушал за этот час) и listen (какие главы), для журнала чтения.
// Книги, файлы, заметки и всё, что уже есть, миграция не трогает.

const AUTH = '@request.auth.id != ""';
const ADMIN = '@request.auth.role = "admin"';

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const books = app.findCollectionByNameOrId("books");
  const READ = `${AUTH} && ((published = true && book.pending = false && (book.hidden = false || book.book_access_via_book.user ?= @request.auth.id)) || ${ADMIN})`;

  const tracks = new Collection({
    type: "base",
    name: "audio_tracks",
    listRule: READ, viewRule: READ,
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "book", required: true, collectionId: books.id, cascadeDelete: true, maxSelect: 1 },
      { type: "text", name: "title", required: true, max: 200 },
      { type: "number", name: "sort" },
      { type: "text", name: "file", max: 200 },
      { type: "number", name: "size" },
      { type: "number", name: "duration" },
      { type: "select", name: "format", maxSelect: 1, values: ["mp3", "m4a"] },
      { type: "bool", name: "published" },
      { type: "date", name: "published_at" },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_audio_tracks_book ON audio_tracks (book, sort)"],
  });
  app.save(tracks);

  app.save(new Collection({
    type: "base",
    name: "audio_progress",
    listRule: "user = @request.auth.id", viewRule: "user = @request.auth.id",
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "user", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { type: "relation", name: "track", required: true, collectionId: tracks.id, cascadeDelete: true, maxSelect: 1 },
      { type: "relation", name: "book", collectionId: books.id, cascadeDelete: true, maxSelect: 1 },
      { type: "number", name: "pos" },
      { type: "bool", name: "done" },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_audio_progress_pair ON audio_progress (user, track)",
      "CREATE INDEX idx_audio_progress_book ON audio_progress (book)",
    ],
  }));

  const log = app.findCollectionByNameOrId("read_log");
  if (!log.fields.getByName("listen_sec")) log.fields.add(new NumberField({ name: "listen_sec" }));
  if (!log.fields.getByName("listen")) log.fields.add(new JSONField({ name: "listen", maxSize: 20000 }));
  app.save(log);
  app.db().newQuery("UPDATE read_log SET listen_sec = 0 WHERE listen_sec IS NULL").execute();
}, (app) => {
  for (const name of ["audio_progress", "audio_tracks"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
  const log = app.findCollectionByNameOrId("read_log");
  log.fields.removeByName("listen_sec");
  log.fields.removeByName("listen");
  app.save(log);
});
