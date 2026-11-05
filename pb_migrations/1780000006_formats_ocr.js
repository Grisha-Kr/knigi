/// <reference path="../pb_data/types.d.ts" />

// Правки 3.1: новые форматы книг и распознавание текста в сканах.
//
// 1. Форматы (book_files.format, books.formats, reading.format, notes.format, group_plan.format):
//    к pdf, epub, djvu добавлены fb2, mobi, azw3, txt. Формат = исходный формат файла.
//    Читается файл одной из двух читалок: djvu переводится в PDF, fb2, mobi, azw3 и txt в EPUB
//    (какой читалкой открывается, видно по формату: VIEW в files_lib.js и в app.js).
// 2. book_files: orig_file (оригинал на диске, если файл переведён: ID.djvu, ID.fb2 …; у PDF и EPUB пусто:
//    читается сам оригинал), orig_size (его размер), ocr (текст распознан автоматически).
//    file по-прежнему файл для читалки (ID.pdf или ID.epub).
// 3. ocr_jobs: очередь распознавания (только администратор, пишет только сервер).
// 4. Уже загруженные DjVu снова встают в обработку: сервер переводит их в PDF по одному в фоне.
//    Номера файлов, страницы, отметки и заметки не меняются.

migrate((app) => {
  const FORMATS = ["pdf", "epub", "djvu", "fb2", "mobi", "azw3", "txt"];
  const ADMIN = '@request.auth.role = "admin"';

  const files = app.findCollectionByNameOrId("book_files");
  files.fields.getByName("format").values = FORMATS;
  files.fields.add(new TextField({ name: "orig_file", max: 100 }));
  files.fields.add(new NumberField({ name: "orig_size", onlyInt: true }));
  files.fields.add(new BoolField({ name: "ocr" }));
  app.save(files);

  const books = app.findCollectionByNameOrId("books");
  const bf = books.fields.getByName("formats");
  bf.values = FORMATS;
  bf.maxSelect = FORMATS.length;
  app.save(books);

  for (const name of ["reading", "notes", "group_plan"]) {
    const c = app.findCollectionByNameOrId(name);
    c.fields.getByName("format").values = FORMATS;
    app.save(c);
  }

  app.save(new Collection({
    type: "base",
    name: "ocr_jobs",
    listRule: ADMIN, viewRule: ADMIN, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "book", collectionId: books.id, maxSelect: 1, cascadeDelete: true, required: true },
      { type: "relation", name: "file", collectionId: files.id, maxSelect: 1, cascadeDelete: true, required: true },
      { type: "text", name: "book_title", max: 500 },
      { type: "select", name: "status", values: ["queued", "running", "done", "error", "canceled"], maxSelect: 1, required: true },
      { type: "number", name: "pages", onlyInt: true },
      { type: "number", name: "done_pages", onlyInt: true },
      { type: "number", name: "sec_page" },          // сколько секунд ушло на страницу (для оценки времени)
      { type: "number", name: "attempts", onlyInt: true }, // сколько раз запускался (после перезапуска сервера)
      { type: "text", name: "error", max: 1000 },
      { type: "date", name: "started_at" },
      { type: "date", name: "finished_at" },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_ocr_jobs_status ON ocr_jobs (status, created)", "CREATE INDEX idx_ocr_jobs_file ON ocr_jobs (file)"],
  }));

  // DjVu этапов 1-3: перевести в PDF (обработка поставит file = ID.pdf, orig_file = ID.djvu)
  app.db().newQuery("UPDATE book_files SET status = 'processing', status_note = '' WHERE format = 'djvu' AND orig_file = ''").execute();
  app.db().newQuery("UPDATE books SET status = 'processing' WHERE id IN (SELECT book FROM book_files WHERE format = 'djvu' AND status = 'processing')").execute();
}, (app) => {
  // Откат: файлы новых форматов (кроме DjVu) убираются из базы (на диске остаются), у DjVu снова читается оригинал.
  try { app.delete(app.findCollectionByNameOrId("ocr_jobs")); } catch (_) {}
  const OLD = ["pdf", "epub", "djvu"];
  app.db().newQuery("DELETE FROM reading WHERE format NOT IN ('pdf', 'epub')").execute();
  app.db().newQuery("DELETE FROM notes WHERE kind = 'highlight' AND format NOT IN ('pdf', 'epub', '')").execute();
  app.db().newQuery("UPDATE notes SET format = '' WHERE format NOT IN ('pdf', 'epub', '')").execute();
  app.db().newQuery("DELETE FROM group_plan WHERE format NOT IN ('pdf', 'epub')").execute();
  app.db().newQuery("DELETE FROM book_files WHERE format NOT IN ('pdf', 'epub', 'djvu')").execute();
  app.db().newQuery("UPDATE book_files SET file = orig_file WHERE format = 'djvu' AND orig_file != ''").execute();
  app.db().newQuery(`UPDATE books SET formats = COALESCE((SELECT json_group_array(format) FROM book_files f WHERE f.book = books.id), '[]')`).execute();
  const files = app.findCollectionByNameOrId("book_files");
  files.fields.getByName("format").values = OLD;
  for (const n of ["orig_file", "orig_size", "ocr"]) {
    const f = files.fields.getByName(n);
    if (f) files.fields.removeById(f.id);
  }
  app.save(files);
  const books = app.findCollectionByNameOrId("books");
  const bf = books.fields.getByName("formats");
  bf.values = OLD;
  bf.maxSelect = 3;
  app.save(books);
  for (const name of ["reading", "notes", "group_plan"]) {
    const c = app.findCollectionByNameOrId(name);
    c.fields.getByName("format").values = OLD;
    app.save(c);
  }
});
