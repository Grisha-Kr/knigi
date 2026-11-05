/// <reference path="../pb_data/types.d.ts" />

// Этап 3: группы чтения. Несколько человек читают одну книгу, видят, кто сегодня читал,
// по желанию создателя идут по плану, делятся заметками и цитатами и комментируют их.
//
// 1. groups: название, описание, создатель, код ссылки-приглашения, текущая книга.
//    Видят только участники. Создать, вступить, сменить книгу, ссылку и создателя можно только
//    маршрутами /api/knigi/... Создатель через обычный API меняет только название и описание
//    (остальное хук оставляет прежним) и может удалить группу.
// 2. group_members: участник группы. last_seen: когда он последний раз открывал группу (точка «новое»),
//    book_seen: какую книгу группы он уже видел (плашка «Группа начала новую книгу»). Пишет только сервер.
// 3. group_books: книги группы по порядку: started_at, finished_at (пусто у текущей).
//    book_title остаётся, даже если книгу удалили из библиотеки.
// 4. group_plan: этапы плана чтения (по желанию создателя). Этап привязан к книге группы (gbook):
//    после смены книги план новой книги пустой, старый остаётся в базе. Меняет только создатель.
// 5. group_reads: сколько человек прочитал за день (по открытым страницам). Одна строка на
//    (человек, книга, день); день по часам устройства. Читает только сам человек, группе нужные
//    цифры отдаёт маршрут /api/knigi/groups/{id}/state, только по текущей книге группы.
// 6. note_comments: комментарии к групповым заметкам и цитатам. Видны участникам группы, пока заметка в ней.
// 7. notes.group: в какой группе видна заметка или цитата. Пусто = личная, как раньше.
// 8. users: участники общих групп видят друг у друга имя и фото (почту и остальное скрывает хук).

migrate((app) => {
  const AUTH = '@request.auth.id != ""';
  const users = app.findCollectionByNameOrId("users");
  const books = app.findCollectionByNameOrId("books");
  const notes = app.findCollectionByNameOrId("notes");
  const stamps = () => [
    { type: "autodate", name: "created", onCreate: true },
    { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
  ];
  const rel = (name, collectionId, cascade, required) => ({ type: "relation", name, collectionId, cascadeDelete: !!cascade, maxSelect: 1, required: !!required });
  // запись видна, если вы участник её группы
  const MEMBER = "group.group_members_via_group.user ?= @request.auth.id";

  // --- 1. группы (правила ставятся ниже, когда появится коллекция участников) ---
  const groups = new Collection({
    type: "base",
    name: "groups",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "text", name: "name", max: 100, required: true },
      { type: "text", name: "description", max: 1000 },
      // при удалении аккаунта создателя хук передаёт группу другому участнику или удаляет её
      rel("owner", users.id, false, true),
      { type: "text", name: "invite_code", min: 16, max: 64, required: true },
      rel("book", books.id, false, false), // текущая книга (книгу удалили: пусто)
      ...stamps(),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_groups_invite ON groups (invite_code)", "CREATE INDEX idx_groups_book ON groups (book)"],
  });
  app.save(groups);

  // --- 2. участники ---
  const members = new Collection({
    type: "base",
    name: "group_members",
    listRule: MEMBER, viewRule: MEMBER, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      rel("group", groups.id, true, true),
      rel("user", users.id, true, true),
      { type: "date", name: "last_seen" },
      { type: "text", name: "book_seen", max: 15 },
      ...stamps(),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_group_members_pair ON group_members (`group`, user)",
      "CREATE INDEX idx_group_members_user ON group_members (user)",
    ],
  });
  app.save(members);

  const IN_GROUP = "group_members_via_group.user ?= @request.auth.id";
  groups.listRule = IN_GROUP;
  groups.viewRule = IN_GROUP;
  groups.updateRule = "owner = @request.auth.id";
  groups.deleteRule = "owner = @request.auth.id";
  app.save(groups);

  // --- 3. книги группы ---
  const gbooks = new Collection({
    type: "base",
    name: "group_books",
    listRule: MEMBER, viewRule: MEMBER, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      rel("group", groups.id, true, true),
      rel("book", books.id, false, false),
      { type: "text", name: "book_title", max: 500 },
      { type: "date", name: "started_at" },
      { type: "date", name: "finished_at" },
      ...stamps(),
    ],
    indexes: ["CREATE INDEX idx_group_books_group ON group_books (`group`, started_at)", "CREATE INDEX idx_group_books_book ON group_books (book)"],
  });
  app.save(gbooks);

  // --- 4. план чтения: меняет только создатель группы (хук проверяет книгу, формат и цель) ---
  app.save(new Collection({
    type: "base",
    name: "group_plan",
    listRule: MEMBER, viewRule: MEMBER,
    createRule: `${AUTH} && @request.body.group.owner = @request.auth.id`,
    updateRule: "group.owner = @request.auth.id",
    deleteRule: "group.owner = @request.auth.id",
    fields: [
      rel("group", groups.id, true, true),
      rel("gbook", gbooks.id, true, true),
      { type: "select", name: "format", values: ["pdf", "epub"], maxSelect: 1, required: true },
      { type: "number", name: "page", onlyInt: true },  // PDF: до какой страницы
      { type: "number", name: "pct" },                  // EPUB: до какого процента
      { type: "text", name: "chapter", max: 200 },      // EPUB: подпись главы (необязательно)
      { type: "text", name: "due", max: 10, pattern: "^\\d{4}-\\d{2}-\\d{2}$", required: true }, // к какой дате
      ...stamps(),
    ],
    indexes: ["CREATE INDEX idx_group_plan_gbook ON group_plan (gbook, due)"],
  }));

  // --- 5. чтение по дням (для «Сегодня читали» и недели группы) ---
  app.save(new Collection({
    type: "base",
    name: "group_reads",
    listRule: "user = @request.auth.id", viewRule: "user = @request.auth.id", createRule: null, updateRule: null, deleteRule: null,
    fields: [
      rel("user", users.id, true, true),
      rel("book", books.id, true, true),
      { type: "text", name: "day", max: 10, required: true },  // ГГГГ-ММ-ДД по часам устройства
      { type: "json", name: "pages", maxSize: 100000 },        // PDF: какие страницы открыты за день
      { type: "number", name: "pdf_n", onlyInt: true },        // PDF: сколько разных страниц
      { type: "number", name: "epub_from" },                   // EPUB: процент в начале дня (-1 = ещё не читал EPUB в этот день)
      { type: "number", name: "epub_to" },                     // EPUB: самый дальний процент за день
      { type: "number", name: "epub_n", onlyInt: true },       // EPUB: сколько раз листал
      ...stamps(),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_group_reads_key ON group_reads (user, book, day)", "CREATE INDEX idx_group_reads_book ON group_reads (book, day)"],
  }));

  // --- 7. заметки: поле группы ---
  notes.fields.add(new RelationField({ name: "group", collectionId: groups.id, maxSelect: 1, cascadeDelete: false }));
  const NOTE_READ = 'owner = @request.auth.id || (shared = true && @request.auth.id != "") || (group != "" && group.group_members_via_group.user ?= @request.auth.id)';
  notes.listRule = NOTE_READ;
  notes.viewRule = NOTE_READ;
  notes.indexes = (notes.indexes || []).concat(["CREATE INDEX idx_notes_group ON notes (`group`, book)"]);
  app.save(notes);

  // --- 6. комментарии ---
  app.save(new Collection({
    type: "base",
    name: "note_comments",
    listRule: `${MEMBER} && note.group = group`,
    viewRule: `${MEMBER} && note.group = group`,
    createRule: `${AUTH} && @request.body.user = @request.auth.id`,
    updateRule: "user = @request.auth.id",
    // свой комментарий, любой под своей заметкой, любой в группе, где вы создатель
    deleteRule: "user = @request.auth.id || note.owner = @request.auth.id || group.owner = @request.auth.id",
    fields: [
      rel("note", notes.id, true, true),
      rel("group", groups.id, true, true),
      rel("user", users.id, true, true),
      { type: "text", name: "text", max: 2000, required: true },
      { type: "bool", name: "edited" },
      ...stamps(),
    ],
    indexes: ["CREATE INDEX idx_note_comments_note ON note_comments (note, created)", "CREATE INDEX idx_note_comments_group ON note_comments (`group`, created)"],
  }));

  // --- 8. пользователи: имя и фото участников общих групп ---
  const USER_READ = "id = @request.auth.id || group_members_via_user.group.group_members_via_group.user ?= @request.auth.id";
  users.listRule = USER_READ;
  users.viewRule = USER_READ;
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.listRule = "id = @request.auth.id";
  users.viewRule = "id = @request.auth.id";
  app.save(users);
  for (const name of ["note_comments", "group_reads", "group_plan"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
  const notes = app.findCollectionByNameOrId("notes");
  const f = notes.fields.getByName("group");
  if (f) notes.fields.removeById(f.id);
  notes.indexes = (notes.indexes || []).filter((i) => i.indexOf("idx_notes_group") < 0);
  const READ = 'owner = @request.auth.id || (shared = true && @request.auth.id != "")';
  notes.listRule = READ;
  notes.viewRule = READ;
  app.save(notes);
  for (const name of ["group_books", "group_members", "groups"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
});
