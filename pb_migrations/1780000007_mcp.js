/// <reference path="../pb_data/types.d.ts" />

// Этап 4: подключение библиотеки к ИИ-помощникам (Claude, ChatGPT, Perplexity) как удалённого сервера MCP.
//
// Все коллекции ниже пишет и читает только сервер (правила null): приложение получает
// список подключений и журнал маршрутом /api/knigi/admin/mcp (только администратор).
// Токены, коды и секреты хранятся только хэшами (sha256), сами значения нигде не сохраняются.
//
// 1. mcp_clients: приложения, которые зарегистрировались сами (DCR, RFC 7591): client_id,
//    хэш секрета, способ проверки секрета, адреса возврата.
// 2. mcp_grants: подключения («Claude», «ChatGPT», «Perplexity»): кто разрешил, какой клиент,
//    когда последний раз пользовались. «Отключить» удаляет запись, её коды и токены удаляются каскадом.
// 3. mcp_codes: одноразовые коды авторизации (5 минут).
// 4. mcp_tokens: токены доступа (около часа) и обновления (60 дней, продлеваются при обновлении).
// 5. mcp_log: журнал обращений (инструмент, книга), хранится 90 дней.
// 6. notes.ai: какой помощник создал заметку («Claude», «ChatGPT», «Perplexity» или адрес сайта).
//    Ставит только сервер, приложение показывает «Создано …» и фильтр «От ИИ».

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const stamps = () => [
    { type: "autodate", name: "created", onCreate: true },
    { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
  ];
  const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };

  const clients = new Collection(Object.assign({
    type: "base",
    name: "mcp_clients",
    fields: [
      { type: "text", name: "client_id", max: 64, required: true },
      { type: "text", name: "secret_hash", max: 64 },
      { type: "select", name: "auth_method", values: ["none", "client_secret_post", "client_secret_basic"], maxSelect: 1, required: true },
      { type: "text", name: "name", max: 200 },          // client_name из регистрации (для журнала службы)
      { type: "json", name: "redirect_uris", maxSize: 20000 },
      { type: "text", name: "ip", max: 64 },             // откуда зарегистрировался (для разбора сбоев)
      ...stamps(),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_mcp_clients_id ON mcp_clients (client_id)"],
  }, closed));
  app.save(clients);

  const grants = new Collection(Object.assign({
    type: "base",
    name: "mcp_grants",
    fields: [
      { type: "relation", name: "user", collectionId: users.id, maxSelect: 1, cascadeDelete: true, required: true },
      { type: "relation", name: "client", collectionId: clients.id, maxSelect: 1, cascadeDelete: true, required: true },
      { type: "text", name: "service", max: 200 },       // «Claude», «ChatGPT», «Perplexity» или адрес сайта
      { type: "text", name: "host", max: 200 },          // сайт адреса возврата: claude.ai, chatgpt.com …
      { type: "text", name: "scope", max: 200 },
      { type: "date", name: "last_used" },
      ...stamps(),
    ],
    indexes: ["CREATE INDEX idx_mcp_grants_user ON mcp_grants (user)"],
  }, closed));
  app.save(grants);

  app.save(new Collection(Object.assign({
    type: "base",
    name: "mcp_codes",
    fields: [
      { type: "text", name: "hash", max: 64, required: true },
      { type: "relation", name: "client", collectionId: clients.id, maxSelect: 1, cascadeDelete: true, required: true },
      { type: "relation", name: "user", collectionId: users.id, maxSelect: 1, cascadeDelete: true, required: true },
      { type: "text", name: "redirect_uri", max: 2000 },
      { type: "text", name: "challenge", max: 200 },
      { type: "text", name: "scope", max: 200 },
      { type: "text", name: "resource", max: 500 },
      { type: "date", name: "expires" },
      ...stamps(),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_mcp_codes_hash ON mcp_codes (hash)"],
  }, closed)));

  app.save(new Collection(Object.assign({
    type: "base",
    name: "mcp_tokens",
    fields: [
      { type: "relation", name: "grant", collectionId: grants.id, maxSelect: 1, cascadeDelete: true, required: true },
      { type: "select", name: "kind", values: ["access", "refresh"], maxSelect: 1, required: true },
      { type: "text", name: "hash", max: 64, required: true },
      { type: "date", name: "expires" },
      ...stamps(),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_mcp_tokens_hash ON mcp_tokens (hash)",
      'CREATE INDEX idx_mcp_tokens_grant ON mcp_tokens ("grant")',
    ],
  }, closed)));

  app.save(new Collection(Object.assign({
    type: "base",
    name: "mcp_log",
    fields: [
      { type: "text", name: "grant", max: 15 },          // без связи: журнал остаётся и после «Отключить»
      { type: "text", name: "service", max: 200 },
      { type: "text", name: "tool", max: 60 },
      { type: "text", name: "book", max: 15 },
      { type: "text", name: "book_title", max: 500 },
      { type: "text", name: "note", max: 300 },          // коротко, что было: запрос поиска, страницы, ошибка
      { type: "bool", name: "error" },
      ...stamps(),
    ],
    indexes: ["CREATE INDEX idx_mcp_log_created ON mcp_log (created)"],
  }, closed)));

  const notes = app.findCollectionByNameOrId("notes");
  notes.fields.add(new TextField({ name: "ai", max: 200 }));
  app.save(notes);
}, (app) => {
  for (const name of ["mcp_log", "mcp_tokens", "mcp_codes", "mcp_grants", "mcp_clients"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
  const notes = app.findCollectionByNameOrId("notes");
  const f = notes.fields.getByName("ai");
  if (f) { notes.fields.removeById(f.id); app.save(notes); }
});
