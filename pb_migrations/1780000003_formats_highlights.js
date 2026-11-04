/// <reference path="../pb_data/types.d.ts" />

// Этап 2: несколько форматов у одной книги, прогресс по форматам, выделения в тексте.
//
// 1. Новая коллекция book_files: файлы книги, у книги не больше одного файла каждого формата.
//    Каждый файл этапа 1 переносится сюда с тем же номером (id), что у книги, поэтому файлы,
//    обложки и тексты на диске (ID.pdf, covers/ID-…, text/ID.txt) не переименовываются.
// 2. books: formats (какие форматы есть) и text_file (номер файла, чей текст основной: PDF с текстом,
//    иначе EPUB). Поля format, file, orig_name, hash переехали в book_files и из books убраны.
//    file_size, pages, has_text, status, status_note остаются сводкой по файлам (ставит сервер, syncBook).
// 3. reading: прогресс по каждому формату (format, pct для EPUB, pos = место в EPUB).
//    Весь прогресс этапа 1 относится к PDF: другой читалки не было.
// 4. notes: вид highlight (выделение), format (в каком файле страница или место), place
//    («с. 45» или «Глава 3 · 41%»), цитата до 20 000 знаков. Выделения может делать любой вошедший.
// 5. EPUB-файлы один раз обрабатываются заново: сервер достаёт из них текст для этапа 3.
//    Название, авторы и обложка при этом не меняются (обработка ставит их, только если пусто).

migrate((app) => {
  const AUTH = '@request.auth.id != ""';
  const ADMIN = '@request.auth.role = "admin"';
  const FORMATS = ["pdf", "epub", "djvu"];
  const books = app.findCollectionByNameOrId("books");

  // --- 1. файлы книг ---
  const files = new Collection({
    type: "base",
    name: "book_files",
    // видят все вошедшие (без имени файла на диске, исходного имени и отпечатка: прячет хук);
    // создают, меняют и удаляют только маршруты сервера
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "book", collectionId: books.id, maxSelect: 1, cascadeDelete: true, required: true },
      { type: "select", name: "format", values: FORMATS, maxSelect: 1, required: true },
      { type: "text", name: "file", max: 100 },       // имя файла в BOOKS_DIR: ID.pdf
      { type: "text", name: "orig_name", max: 300 },  // имя файла при загрузке
      { type: "number", name: "file_size", onlyInt: true },
      { type: "number", name: "pages", onlyInt: true },
      { type: "bool", name: "has_text" },
      { type: "select", name: "status", values: ["processing", "ready", "error"], maxSelect: 1 },
      { type: "text", name: "status_note", max: 500 },
      { type: "text", name: "hash", max: 64 },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_book_files_pair ON book_files (book, format)",
      "CREATE INDEX idx_book_files_status ON book_files (status)",
      "CREATE INDEX idx_book_files_hash ON book_files (hash)",
    ],
  });
  app.save(files);

  // перенос: прямой запрос, чтобы сохранить номера и даты
  app.db().newQuery(`INSERT INTO book_files (id, book, format, file, orig_name, file_size, pages, has_text, status, status_note, hash, created, updated)
    SELECT id, id, format, file, orig_name, file_size, pages, has_text,
      CASE WHEN format = 'epub' AND status = 'ready' THEN 'processing' ELSE status END,
      status_note, hash, created, updated
    FROM books WHERE format != '' AND file != ''`).execute();

  // --- 2. книги: сводка по файлам ---
  books.fields.add(new SelectField({ name: "formats", values: FORMATS, maxSelect: 3 }));
  books.fields.add(new TextField({ name: "text_file", max: 15 }));
  app.save(books);
  app.db().newQuery(`UPDATE books SET
      formats = CASE WHEN format != '' THEN json_array(format) ELSE '[]' END,
      text_file = CASE WHEN format = 'pdf' AND has_text THEN id ELSE '' END,
      status = CASE WHEN format = 'epub' AND status = 'ready' THEN 'processing' ELSE status END`).execute();
  books.indexes = (books.indexes || []).filter((i) => i.indexOf("idx_books_hash") < 0);
  for (const name of ["format", "file", "orig_name", "hash"]) {
    const f = books.fields.getByName(name);
    if (f) books.fields.removeById(f.id);
  }
  app.save(books);

  // --- 3. прогресс по форматам ---
  const reading = app.findCollectionByNameOrId("reading");
  reading.fields.add(new SelectField({ name: "format", values: FORMATS, maxSelect: 1 }));
  reading.fields.add(new NumberField({ name: "pct" }));               // EPUB: сколько прочитано, 0–100
  reading.fields.add(new TextField({ name: "pos", max: 2000 }));      // EPUB: место (CFI)
  reading.indexes = (reading.indexes || []).filter((i) => i.indexOf("idx_reading_pair") < 0)
    .concat(["CREATE UNIQUE INDEX idx_reading_key ON reading (user, book, format)"]);
  app.save(reading);
  app.db().newQuery("UPDATE reading SET format = 'pdf' WHERE format = ''").execute();

  // --- 4. выделения в заметках ---
  const notes = app.findCollectionByNameOrId("notes");
  notes.fields.getByName("kind").values = ["note", "lesson", "highlight"];
  notes.fields.getByName("quote").max = 20000;
  notes.fields.add(new SelectField({ name: "format", values: FORMATS, maxSelect: 1 }));
  notes.fields.add(new TextField({ name: "place", max: 200 }));
  const OWN = "owner = @request.auth.id";
  const SHARED_OK = '(@request.body.shared:isset = false || @request.body.shared = false || ' + ADMIN + ')';
  const KIND_OK = '(@request.body.kind = "note" || @request.body.kind = "highlight" || ' + ADMIN + ')';
  notes.createRule = `${AUTH} && @request.body.owner = @request.auth.id && ${SHARED_OK} && ${KIND_OK}`;
  notes.updateRule = `${OWN} && (@request.body.owner:isset = false || @request.body.owner = @request.auth.id) && ${SHARED_OK} && (@request.body.kind:isset = false || ${KIND_OK})`;
  notes.indexes = (notes.indexes || []).concat(["CREATE INDEX idx_notes_kind ON notes (book, kind)"]);
  app.save(notes);
  // заметки этапа 1 со страницей к PDF-книге: страница из PDF
  app.db().newQuery(`UPDATE notes SET format = 'pdf'
    WHERE format = '' AND page > 0 AND book IN (SELECT book FROM book_files WHERE format = 'pdf')`).execute();
}, (app) => {
  // Откат: у книги остаётся один файл (PDF, иначе EPUB, иначе DjVu), прогресс и выделения других форматов удаляются.
  const books = app.findCollectionByNameOrId("books");
  books.fields.add(new SelectField({ name: "format", values: ["pdf", "epub", "djvu"], maxSelect: 1 }));
  books.fields.add(new TextField({ name: "file", max: 100 }));
  books.fields.add(new TextField({ name: "orig_name", max: 300 }));
  books.fields.add(new TextField({ name: "hash", max: 64 }));
  books.indexes = (books.indexes || []).concat(["CREATE INDEX idx_books_hash ON books (hash)"]);
  app.save(books);
  app.db().newQuery(`UPDATE books SET (format, file, orig_name, hash) = (
    SELECT format, file, orig_name, hash FROM book_files f WHERE f.book = books.id
    ORDER BY CASE format WHEN 'pdf' THEN 0 WHEN 'epub' THEN 1 ELSE 2 END LIMIT 1)`).execute();
  for (const name of ["formats", "text_file"]) {
    const f = books.fields.getByName(name);
    if (f) books.fields.removeById(f.id);
  }
  app.save(books);
  try { app.delete(app.findCollectionByNameOrId("book_files")); } catch (_) {}

  app.db().newQuery("DELETE FROM reading WHERE format != 'pdf' AND format != ''").execute();
  const reading = app.findCollectionByNameOrId("reading");
  reading.indexes = (reading.indexes || []).filter((i) => i.indexOf("idx_reading_key") < 0)
    .concat(["CREATE UNIQUE INDEX idx_reading_pair ON reading (user, book)"]);
  for (const name of ["format", "pct", "pos"]) {
    const f = reading.fields.getByName(name);
    if (f) reading.fields.removeById(f.id);
  }
  app.save(reading);

  app.db().newQuery("DELETE FROM notes WHERE kind = 'highlight'").execute();
  const notes = app.findCollectionByNameOrId("notes");
  notes.fields.getByName("kind").values = ["note", "lesson"];
  for (const name of ["format", "place"]) {
    const f = notes.fields.getByName(name);
    if (f) notes.fields.removeById(f.id);
  }
  notes.indexes = (notes.indexes || []).filter((i) => i.indexOf("idx_notes_kind") < 0);
  app.save(notes);
});
