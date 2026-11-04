/// <reference path="../pb_data/types.d.ts" />

// Начальная схема «Библиотеки», этап 1.
// Книги и общие полки читают все вошедшие, меняет только администратор приложения (users.role = "admin").
// Свои полки, прогресс чтения и заметки видит и меняет только владелец. Заметку с shared = true
// читают все вошедшие; shared и уроки (kind = "lesson") может ставить только администратор.
// Файлы книг, обложки, тексты и файлы уроков лежат вне pb_data (папки BOOKS_DIR и FILES_DIR),
// в записях только имена файлов: так ежедневная копия базы остаётся маленькой.
// Изменения структуры потом только новыми миграциями: эта на сервере уже применена.

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");

  // --- пользователи: роль и тема ---
  if (!users.fields.getByName("role")) {
    users.fields.add(new SelectField({ name: "role", values: ["user", "admin"], maxSelect: 1 }));
  }
  if (!users.fields.getByName("theme")) {
    users.fields.add(new SelectField({ name: "theme", values: ["auto", "light", "dark"], maxSelect: 1 }));
  }
  users.listRule = "id = @request.auth.id";
  users.viewRule = "id = @request.auth.id";
  users.createRule = "";
  // роль через API не меняет никто, только суперпользователь в панели
  users.updateRule = "id = @request.auth.id && @request.body.role:isset = false";
  users.deleteRule = null; // аккаунт удаляет суперпользователь в панели
  app.save(users);

  const AUTH = '@request.auth.id != ""';
  const ADMIN = '@request.auth.role = "admin"';
  const txt = (name, max, required) => ({ type: "text", name, max: max || 500, required: !!required });
  const num = (name, onlyInt) => ({ type: "number", name, onlyInt: !!onlyInt });
  const rel = (name, collectionId, o) => ({ type: "relation", name, collectionId, maxSelect: 1, cascadeDelete: true, required: false, ...(o || {}) });
  const stamps = () => [
    { type: "autodate", name: "created", onCreate: true },
    { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
  ];

  // --- авторы ---
  const authors = new Collection({
    type: "base",
    name: "authors",
    listRule: AUTH, viewRule: AUTH, createRule: ADMIN, updateRule: ADMIN, deleteRule: ADMIN,
    fields: [
      txt("name", 200, true),
      txt("sort_name", 200), // фамилия первой, для списка по алфавиту (ставит сервер, если пусто)
      txt("search", 400),    // строчными, ё заменена на е (ставит сервер)
      ...stamps(),
    ],
    indexes: ["CREATE INDEX idx_authors_sort ON authors (sort_name)"],
  });
  app.save(authors);

  // --- книги ---
  // Создаёт запись только маршрут загрузки, удаляет только маршрут удаления (там же файлы, текст, обложка).
  // Администратор через API меняет только title, authors, year, description; остальное ставит сервер.
  const books = new Collection({
    type: "base",
    name: "books",
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: ADMIN, deleteRule: null,
    fields: [
      txt("title", 500, true),
      { type: "relation", name: "authors", collectionId: authors.id, maxSelect: 50, cascadeDelete: false },
      num("year", true),
      txt("description", 20000),
      { type: "select", name: "format", values: ["pdf", "epub", "djvu"], maxSelect: 1, required: true },
      txt("file", 100),       // имя файла в BOOKS_DIR: ID.pdf
      txt("orig_name", 300),  // имя файла при загрузке (видит только администратор)
      num("file_size", true),
      num("pages", true),
      { type: "bool", name: "has_text" },
      { type: "select", name: "status", values: ["processing", "ready", "error"], maxSelect: 1 },
      txt("status_note", 500),
      txt("cover", 100),      // имя файла обложки в BOOKS_DIR/covers
      txt("hash", 64),        // sha256 файла: так видны повторы
      txt("search", 2000),    // название и авторы строчными, ё = е (ставит сервер)
      ...stamps(),
    ],
    indexes: [
      "CREATE INDEX idx_books_created ON books (created)",
      "CREATE INDEX idx_books_status ON books (status)",
      "CREATE INDEX idx_books_hash ON books (hash)",
    ],
  });
  app.save(books);

  // --- полки: общие (common, создаёт администратор, видят все) и свои (видит только владелец) ---
  // Дерево до трёх уровней (проверяет хук). Удалить можно только пустую полку без подполок.
  const SHELF_EDIT = `${AUTH} && ((common = false && owner = @request.auth.id) || (common = true && ${ADMIN}))`;
  const shelves = new Collection({
    type: "base",
    name: "shelves",
    listRule: `${AUTH} && (common = true || owner = @request.auth.id)`,
    viewRule: `${AUTH} && (common = true || owner = @request.auth.id)`,
    createRule: `${AUTH} && @request.body.owner = @request.auth.id && (@request.body.common:isset = false || @request.body.common = false || ${ADMIN})`,
    updateRule: SHELF_EDIT,
    deleteRule: SHELF_EDIT,
    fields: [
      rel("owner", users.id, { required: true }),
      txt("name", 120, true),
      { type: "bool", name: "common" },
      num("sort"),
      ...stamps(),
    ],
    indexes: ["CREATE INDEX idx_shelves_owner ON shelves (owner, common)"],
  });
  app.save(shelves);
  shelves.fields.add(new RelationField({ name: "parent", collectionId: shelves.id, cascadeDelete: true, maxSelect: 1 }));
  shelves.indexes = shelves.indexes.concat(["CREATE INDEX idx_shelves_parent ON shelves (parent)"]);
  app.save(shelves);

  // --- книги на полках ---
  const ON_SHELF = `${AUTH} && ((shelf.common = false && shelf.owner = @request.auth.id) || (shelf.common = true && ${ADMIN}))`;
  app.save(new Collection({
    type: "base",
    name: "shelf_books",
    listRule: `${AUTH} && (shelf.common = true || shelf.owner = @request.auth.id)`,
    viewRule: `${AUTH} && (shelf.common = true || shelf.owner = @request.auth.id)`,
    createRule: `${AUTH} && ((@request.body.shelf.common = false && @request.body.shelf.owner = @request.auth.id) || (@request.body.shelf.common = true && ${ADMIN}))`,
    updateRule: ON_SHELF,
    deleteRule: ON_SHELF,
    fields: [
      rel("shelf", shelves.id, { required: true }),
      rel("book", books.id, { required: true }),
      num("sort"),
      ...stamps(),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_shelf_books_pair ON shelf_books (shelf, book)",
      "CREATE INDEX idx_shelf_books_book ON shelf_books (book)",
    ],
  }));

  // --- прогресс чтения: у каждого свой, пишет только сервер (маршрут progress) ---
  const ME = "user = @request.auth.id";
  app.save(new Collection({
    type: "base",
    name: "reading",
    listRule: ME, viewRule: ME, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      rel("user", users.id, { required: true }),
      rel("book", books.id, { required: true }),
      num("page", true),
      num("pages", true),
      ...stamps(),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_reading_pair ON reading (user, book)"],
  }));

  // --- заметки и уроки ---
  // book может быть пустым: заметка без книги или книга удалена (тогда в book_title её название).
  // quote, anchor, color: место под выделения в тексте книги (этап 2). anchor = где выделено на странице.
  const OWN = "owner = @request.auth.id";
  const SHARED_OK = (p) => `(${p}shared:isset = false || ${p}shared = false || ${ADMIN})`;
  const notes = new Collection({
    type: "base",
    name: "notes",
    listRule: `${OWN} || (shared = true && ${AUTH})`,
    viewRule: `${OWN} || (shared = true && ${AUTH})`,
    createRule: `${AUTH} && @request.body.owner = @request.auth.id && ${SHARED_OK("@request.body.")} && (@request.body.kind = "note" || ${ADMIN})`,
    updateRule: `${OWN} && (@request.body.owner:isset = false || @request.body.owner = @request.auth.id) && ${SHARED_OK("@request.body.")} && (@request.body.kind:isset = false || @request.body.kind = "note" || ${ADMIN})`,
    deleteRule: OWN,
    fields: [
      rel("owner", users.id, { required: true }),
      rel("book", books.id, { cascadeDelete: false }),
      txt("book_title", 500),
      { type: "select", name: "kind", values: ["note", "lesson"], maxSelect: 1, required: true },
      txt("title", 300),
      { type: "editor", name: "body", maxSize: 2 * 1024 * 1024 },
      txt("body_text", 1000000), // текст без оформления (ставит сервер): для этапа 3
      txt("search", 1000000),    // название и текст строчными, ё = е: для поиска (ставит сервер)
      num("page", true),
      { type: "bool", name: "shared" },
      txt("quote", 5000),
      { type: "json", name: "anchor", maxSize: 20000 },
      txt("color", 20),
      ...stamps(),
    ],
    indexes: [
      "CREATE INDEX idx_notes_owner ON notes (owner, updated)",
      "CREATE INDEX idx_notes_book ON notes (book)",
      "CREATE INDEX idx_notes_shared ON notes (shared)",
    ],
  });
  app.save(notes);

  // --- файлы уроков: лежат в FILES_DIR, в записи имя файла на диске ---
  // Создаёт только маршрут загрузки. Читатель видит только PDF общего урока.
  app.save(new Collection({
    type: "base",
    name: "note_files",
    listRule: `${OWN} || (${AUTH} && note.shared = true && ext = "pdf")`,
    viewRule: `${OWN} || (${AUTH} && note.shared = true && ext = "pdf")`,
    createRule: null, updateRule: null, deleteRule: OWN,
    fields: [
      rel("note", notes.id, { required: true }),
      rel("owner", users.id, { required: true }),
      txt("name", 300, true),
      txt("ext", 10),
      num("size", true),
      txt("file", 100),
      num("sort"),
      ...stamps(),
    ],
    indexes: ["CREATE INDEX idx_note_files_note ON note_files (note)"],
  }));

  // --- журнал чтения: по часам (hour = "2026-11-04T13", час по UTC) ---
  // Пишет только сервер, читает только администратор. Книгу удалили: book пустой, название в book_title.
  app.save(new Collection({
    type: "base",
    name: "read_log",
    listRule: ADMIN, viewRule: ADMIN, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      rel("user", users.id, { required: true }),
      rel("book", books.id, { cascadeDelete: false }),
      txt("book_title", 500),
      txt("hour", 13, true),
      { type: "json", name: "pages", maxSize: 200000 }, // какие страницы открыты за этот час
      num("pages_seen", true),
      num("bytes_sent", true),
      { type: "bool", name: "over_limit" },
      ...stamps(),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_read_log_key ON read_log (user, book, hour)",
      "CREATE INDEX idx_read_log_hour ON read_log (hour)",
    ],
  }));

  // --- приглашения: видит и создаёт только администратор приложения ---
  app.save(new Collection({
    type: "base",
    name: "invites",
    listRule: ADMIN, viewRule: ADMIN, createRule: ADMIN, updateRule: ADMIN, deleteRule: ADMIN,
    fields: [
      txt("code", 40, true), txt("note", 300), num("max_uses", true), num("uses", true), txt("expires", 10),
      { type: "relation", name: "created_by", collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
      { type: "relation", name: "used_by", collectionId: users.id, cascadeDelete: false, maxSelect: 999 },
      { type: "autodate", name: "created", onCreate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_invites_code ON invites (code)"],
  }));

  // --- настройки: имя приложения и ежедневные резервные копии в 3:00, храним 14 ---
  const s = app.settings();
  s.meta.appName = "Библиотека";
  s.backups.cron = "0 3 * * *";
  s.backups.cronMaxKeep = 14;
  app.save(s);
}, (app) => {
  for (const name of ["invites", "read_log", "note_files", "notes", "reading", "shelf_books", "shelves", "books", "authors"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
});
