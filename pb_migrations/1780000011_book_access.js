/// <reference path="../pb_data/types.d.ts" />

// Правки 4.3, часть А: скрытая книга, открытая отдельным читателям.
//
// book_access: список читателей, которым администратор открыл скрытую книгу (книга, читатель, кто добавил, когда).
//   Читатель видит только свои строки (по ним приложение знает, когда книгу открыли ему), администратор все.
//   Через API не пишет никто: список сохраняет маршрут POST /api/knigi/books/{id}/readers.
//   Удаление книги или пользователя убирает строки каскадом.
// Правила книг, файлов книг и полок дополняются условием «читатель есть в списке»: для него книга ведёт себя
//   как обычная видимая. Список действует, только пока книга скрыта (hidden). Когда книга видна всем,
//   он хранится и снова заработает, если книгу скрыть.
// Данные, которые уже есть, миграция не трогает: списки пустые, всё работает как после правок 4.1.

const AUTH = '@request.auth.id != ""';
const ADMIN = '@request.auth.role = "admin"';
// именно kept_for.id (см. 1780000008_hidden_books.js)
const OLD_BOOKS = `${AUTH} && ((pending = false && (hidden = false || kept_for.id ?= @request.auth.id)) || ${ADMIN})`;
const OLD_FILES = `${AUTH} && ((book.pending = false && book.hidden = false) || ${ADMIN})`;
const OLD_SB = `${AUTH} && ((shelf.common = true && (book.hidden = false || ${ADMIN})) || shelf.owner = @request.auth.id)`;

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const books = app.findCollectionByNameOrId("books");

  app.save(new Collection({
    type: "base",
    name: "book_access",
    listRule: `${AUTH} && (user = @request.auth.id || ${ADMIN})`,
    viewRule: `${AUTH} && (user = @request.auth.id || ${ADMIN})`,
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "book", required: true, collectionId: books.id, cascadeDelete: true, maxSelect: 1 },
      { type: "relation", name: "user", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { type: "relation", name: "added_by", collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
      { type: "autodate", name: "created", onCreate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_book_access_pair ON book_access (book, user)",
      "CREATE INDEX idx_book_access_user ON book_access (user)",
    ],
  }));

  const OPEN = "book_access_via_book.user ?= @request.auth.id";
  books.listRule = `${AUTH} && ((pending = false && (hidden = false || kept_for.id ?= @request.auth.id || ${OPEN})) || ${ADMIN})`;
  books.viewRule = books.listRule;
  app.save(books);

  const files = app.findCollectionByNameOrId("book_files");
  files.listRule = `${AUTH} && ((book.pending = false && (book.hidden = false || book.${OPEN})) || ${ADMIN})`;
  files.viewRule = files.listRule;
  app.save(files);

  const sb = app.findCollectionByNameOrId("shelf_books");
  sb.listRule = `${AUTH} && ((shelf.common = true && (book.hidden = false || book.${OPEN} || ${ADMIN})) || shelf.owner = @request.auth.id)`;
  sb.viewRule = sb.listRule;
  app.save(sb);
}, (app) => {
  const sb = app.findCollectionByNameOrId("shelf_books");
  sb.listRule = OLD_SB;
  sb.viewRule = OLD_SB;
  app.save(sb);
  const files = app.findCollectionByNameOrId("book_files");
  files.listRule = OLD_FILES;
  files.viewRule = OLD_FILES;
  app.save(files);
  const books = app.findCollectionByNameOrId("books");
  books.listRule = OLD_BOOKS;
  books.viewRule = OLD_BOOKS;
  app.save(books);
  try { app.delete(app.findCollectionByNameOrId("book_access")); } catch (_) {}
});
