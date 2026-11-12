/// <reference path="../pb_data/types.d.ts" />

// Дополнение к правкам 4.6: «Мои отзывы» в профиле читателя.
// Свой отзыв человек видит всегда, даже если книга ему больше не видна (её скрыли или сняли личный доступ):
// в «Моих отзывах» такой отзыв стоит бледным с пометкой «Книга временно недоступна». Чужие отзывы
// к такой книге по-прежнему не видны. Менять и удалять отзыв к невидимой книге нельзя (маршруты проверяют bookOpen).
// Данные миграция не трогает, меняются только правила чтения.

const AUTH = '@request.auth.id != ""';
const ADMIN = '@request.auth.role = "admin"';
const OLD = `${AUTH} && ((book.pending = false && (book.hidden = false || book.book_access_via_book.user ?= @request.auth.id)) || ${ADMIN})`;
const NEW = `${AUTH} && (user = @request.auth.id || (book.pending = false && (book.hidden = false || book.book_access_via_book.user ?= @request.auth.id)) || ${ADMIN})`;

migrate((app) => {
  const c = app.findCollectionByNameOrId("reviews");
  c.listRule = NEW;
  c.viewRule = NEW;
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("reviews");
  c.listRule = OLD;
  c.viewRule = OLD;
  app.save(c);
});
