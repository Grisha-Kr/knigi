/// <reference path="../pb_data/types.d.ts" />

// Правки 4.1, часть А: скрытые книги.
//
// books.hidden: книга видна только администратору. Новая книга, загруженная администратором, скрыта,
//   открывает её кнопка «Видна всем читателям» (маршрут /api/knigi/books/{id}/visibility).
// books.opened_at: когда книга открыта всем (для «Недавно добавленных» у читателей).
// books.kept_for: читатели, у которых с книгой уже что-то связано на момент скрытия (цитаты, заметки,
//   «Читаю», «Прочитано», прогресс, личная полка, группа). Им видна карточка с пометкой
//   «Книга временно недоступна», файлы книги не выдаются. Список ставит только сервер (keepFor в files_lib.js),
//   читателю он не показывается.
// Все книги, которые уже есть, остаются видимыми: hidden = false, opened_at = дата добавления.

const AUTH = '@request.auth.id != ""';
const ADMIN = '@request.auth.role = "admin"';

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const books = app.findCollectionByNameOrId("books");
  if (!books.fields.getByName("hidden")) books.fields.add(new BoolField({ name: "hidden" }));
  if (!books.fields.getByName("opened_at")) books.fields.add(new DateField({ name: "opened_at" }));
  if (!books.fields.getByName("kept_for")) {
    books.fields.add(new RelationField({ name: "kept_for", collectionId: users.id, maxSelect: 99, cascadeDelete: false }));
  }
  // именно kept_for.id: сравнение «kept_for ?= @request.auth.id» в PocketBase 0.40.3 не срабатывает (проверено)
  const rule = `${AUTH} && ((pending = false && (hidden = false || kept_for.id ?= @request.auth.id)) || ${ADMIN})`;
  books.listRule = rule;
  books.viewRule = rule;
  if (!(books.indexes || []).some((i) => i.indexOf("idx_books_hidden") >= 0)) {
    books.indexes = (books.indexes || []).concat(["CREATE INDEX idx_books_hidden ON books (hidden)"]);
  }
  app.save(books);
  app.db().newQuery("UPDATE books SET hidden = FALSE, opened_at = created WHERE opened_at = '' OR opened_at IS NULL").execute();

  // файлы скрытой книги видит только администратор (читалка ему одному)
  const files = app.findCollectionByNameOrId("book_files");
  files.listRule = `${AUTH} && ((book.pending = false && book.hidden = false) || ${ADMIN})`;
  files.viewRule = files.listRule;
  app.save(files);

  // скрытая книга на общей полке читателю не видна; на своей полке он её видит (карточка «временно недоступна»)
  const sb = app.findCollectionByNameOrId("shelf_books");
  sb.listRule = `${AUTH} && ((shelf.common = true && (book.hidden = false || ${ADMIN})) || shelf.owner = @request.auth.id)`;
  sb.viewRule = sb.listRule;
  app.save(sb);
}, (app) => {
  const sb = app.findCollectionByNameOrId("shelf_books");
  sb.listRule = `${AUTH} && (shelf.common = true || shelf.owner = @request.auth.id)`;
  sb.viewRule = sb.listRule;
  app.save(sb);
  const files = app.findCollectionByNameOrId("book_files");
  files.listRule = `${AUTH} && (book.pending = false || ${ADMIN})`;
  files.viewRule = files.listRule;
  app.save(files);
  const books = app.findCollectionByNameOrId("books");
  books.listRule = `${AUTH} && (pending = false || ${ADMIN})`;
  books.viewRule = books.listRule;
  books.indexes = (books.indexes || []).filter((i) => i.indexOf("idx_books_hidden") < 0);
  for (const name of ["hidden", "opened_at", "kept_for"]) books.fields.removeByName(name);
  app.save(books);
});
