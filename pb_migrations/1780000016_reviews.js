/// <reference path="../pb_data/types.d.ts" />

// Правки 4.6: отзывы о книгах.
//
// reviews: отзыв читателя (или администратора) о книге. Один человек пишет к книге один отзыв (уникальная пара
//   book, user). Текст до 2000 знаков, без оформления. Публикуется сразу, проверки нет.
//   user_name, user_avatar: имя и имя файла фото автора (копия из users, обновляется хуком при смене имени
//     или фото). Почты в отзыве нет: другим читателям её не видно, как в группах.
//   finished: у автора отметка «Прочитано» на этой книге (обновляет хук marks), в приложении «прочитал(а)».
//   edited: когда автор последний раз менял текст (пусто, если не менял), в приложении «изменён».
//   seen: администратор видел этот отзыв (раздел «Отзывы» в профиле); новый или изменённый читателем отзыв
//     снова непросмотренный. Поле видит только администратор (onRecordEnrich в reviews.pb.js).
//
// Видят отзыв те, кому видна сама книга: книга не на проверке и видна всем или открыта этому читателю лично
// (то же условие, что у глав аудио, правки 4.3). Скрытая книга прячет и отзывы. Через API никто не пишет:
// создают, меняют и удаляют только маршруты /api/knigi/reviews... (reviews.pb.js). Удаление книги и
// пользователя удаляет их отзывы. Книги, заметки и всё, что уже есть, миграция не трогает.

const AUTH = '@request.auth.id != ""';
const ADMIN = '@request.auth.role = "admin"';

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const books = app.findCollectionByNameOrId("books");
  const READ = `${AUTH} && ((book.pending = false && (book.hidden = false || book.book_access_via_book.user ?= @request.auth.id)) || ${ADMIN})`;

  app.save(new Collection({
    type: "base",
    name: "reviews",
    listRule: READ, viewRule: READ,
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "book", required: true, collectionId: books.id, cascadeDelete: true, maxSelect: 1 },
      { type: "relation", name: "user", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { type: "text", name: "user_name", max: 300 },
      { type: "text", name: "user_avatar", max: 300 },
      { type: "bool", name: "finished" },
      { type: "text", name: "text", required: true, max: 2000 },
      { type: "date", name: "edited" },
      { type: "bool", name: "seen" },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_reviews_book_user ON reviews (book, user)",
      "CREATE INDEX idx_reviews_user ON reviews (user)",
      "CREATE INDEX idx_reviews_created ON reviews (created)",
    ],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("reviews")); } catch (_) {}
});
