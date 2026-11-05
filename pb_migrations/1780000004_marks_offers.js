/// <reference path="../pb_data/types.d.ts" />

// Правки 2.2: отметки «Читаю» и «Прочитано», книги от читателей с проверкой.
//
// 1. marks: отметка человека у книги. status reading («Читаю») или finished («Прочитано»),
//    started_at (когда отметил «Читаю»), finished_at (дата прочтения, её можно поменять).
//    Одна запись на пару (человек, книга). Видит и меняет только владелец. Существующим книгам
//    отметки не ставятся: блок «Продолжить чтение» после обновления пустой.
// 2. books: pending (книга на проверке) и offered_by (кто предложил). Книгу на проверке видит
//    только администратор: правила books и book_files закрывают её от остальных, маршруты сервера
//    (ссылка на файл, обложка, прогресс, полки, заметки, отметки) проверяют то же самое.
//    Ставит и снимает pending только сервер (маршруты «Предложить», «Одобрить», «Отклонить»).
// 3. book_offers: предложенные книги. Читатель видит только свои строки, администратор все.
//    Пишет только сервер. book пустеет, когда книгу отклонили (её файл удалён).

migrate((app) => {
  const AUTH = '@request.auth.id != ""';
  const ADMIN = '@request.auth.role = "admin"';
  const users = app.findCollectionByNameOrId("users");
  const books = app.findCollectionByNameOrId("books");

  // --- 2. книги на проверке ---
  books.fields.add(new BoolField({ name: "pending" }));
  books.fields.add(new RelationField({ name: "offered_by", collectionId: users.id, maxSelect: 1, cascadeDelete: false }));
  books.listRule = `${AUTH} && (pending = false || ${ADMIN})`;
  books.viewRule = `${AUTH} && (pending = false || ${ADMIN})`;
  books.indexes = (books.indexes || []).concat(["CREATE INDEX idx_books_pending ON books (pending)"]);
  app.save(books);

  const files = app.findCollectionByNameOrId("book_files");
  files.listRule = `${AUTH} && (book.pending = false || ${ADMIN})`;
  files.viewRule = `${AUTH} && (book.pending = false || ${ADMIN})`;
  app.save(files);

  // --- 1. отметки «Читаю» и «Прочитано» ---
  const ME = "user = @request.auth.id";
  app.save(new Collection({
    type: "base",
    name: "marks",
    listRule: ME, viewRule: ME,
    createRule: `${AUTH} && @request.body.user = @request.auth.id`,
    updateRule: `${ME} && (@request.body.user:isset = false || @request.body.user = @request.auth.id)`,
    deleteRule: ME,
    fields: [
      { type: "relation", name: "user", collectionId: users.id, maxSelect: 1, cascadeDelete: true, required: true },
      { type: "relation", name: "book", collectionId: books.id, maxSelect: 1, cascadeDelete: true, required: true },
      { type: "select", name: "status", values: ["reading", "finished"], maxSelect: 1, required: true },
      { type: "date", name: "started_at" },
      { type: "date", name: "finished_at" },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_marks_key ON marks (user, book)"],
  }));

  // --- 3. предложенные книги ---
  const OWN_OR_ADMIN = `${AUTH} && (user = @request.auth.id || ${ADMIN})`;
  app.save(new Collection({
    type: "base",
    name: "book_offers",
    listRule: OWN_OR_ADMIN, viewRule: OWN_OR_ADMIN, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "user", collectionId: users.id, maxSelect: 1, cascadeDelete: true, required: true },
      { type: "relation", name: "book", collectionId: books.id, maxSelect: 1, cascadeDelete: false },
      { type: "text", name: "title", max: 500 },       // название книги (меняется вместе с книгой)
      { type: "text", name: "file_name", max: 300 },   // имя файла при загрузке
      { type: "number", name: "file_size", onlyInt: true },
      { type: "text", name: "note", max: 1000 },       // «пара слов о книге» от читателя
      { type: "select", name: "status", values: ["pending", "approved", "rejected"], maxSelect: 1, required: true },
      { type: "text", name: "reason", max: 1000 },     // почему отклонена
      { type: "date", name: "decided_at" },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_book_offers_user ON book_offers (user, status)",
      "CREATE INDEX idx_book_offers_book ON book_offers (book)",
    ],
  }));
}, (app) => {
  for (const name of ["book_offers", "marks"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
  // книги, которые так и остались на проверке, при откате становятся обычными
  const AUTH = '@request.auth.id != ""';
  const books = app.findCollectionByNameOrId("books");
  books.listRule = AUTH;
  books.viewRule = AUTH;
  books.indexes = (books.indexes || []).filter((i) => i.indexOf("idx_books_pending") < 0);
  for (const name of ["pending", "offered_by"]) {
    const f = books.fields.getByName(name);
    if (f) books.fields.removeById(f.id);
  }
  app.save(books);
  const files = app.findCollectionByNameOrId("book_files");
  files.listRule = AUTH;
  files.viewRule = AUTH;
  app.save(files);
});
