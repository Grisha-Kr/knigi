/// <reference path="../pb_data/types.d.ts" />

// Правки 4.3, дополнение: описание аудио у книги (books.audio_note), обычный текст до 300 знаков,
// например «Аудиокнига, записанная мной» или «Подкаст по книге, сделан с помощью ИИ».
// Видят все, кому видна книга; меняет только администратор маршрутом POST /api/knigi/books/{id}/audio-note
// (обычное изменение книги через API поле не меняет: хук update books оставляет прежнее значение).
// Книги, которые уже есть, получают пустое описание.

migrate((app) => {
  const books = app.findCollectionByNameOrId("books");
  if (!books.fields.getByName("audio_note")) books.fields.add(new TextField({ name: "audio_note", max: 300 }));
  app.save(books);
}, (app) => {
  const books = app.findCollectionByNameOrId("books");
  books.fields.removeByName("audio_note");
  app.save(books);
});
