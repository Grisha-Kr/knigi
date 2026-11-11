/// <reference path="../pb_data/types.d.ts" />

// Аудио к книгам (правки 4.3, часть Б): маршруты. Логика в audio_lib.js, загрузка кусками в files_lib.js
// (upload/start с kind "audio"). Главы и прогресс слушания через обычный API не меняет никто: правила
// коллекций закрыты, всё идёт этими маршрутами.

// Служебное имя файла на диске не показывается никому
onRecordEnrich((e) => { e.record.hide("file"); e.next(); }, "audio_tracks");

// Ссылка на файл главы: только вошедшему, с действующим сроком доступа, если книга ему открыта.
// Живёт 2 часа и работает только вместе с кукой, которую ставит этот же ответ.
routerAdd("GET", "/api/knigi/audio/{id}/link", (e) => {
  return e.json(200, require(`${__hooks}/audio_lib.js`).link(e, e.request.pathValue("id")));
}, $apis.requireAuth("users"));

// Сам файл: проверяются ключ в адресе и кука. Запросы частей файла (Range) работают: перемотка, iPhone.
// Адрес под /api/knigi/f/, где Caddy файлы не сжимает.
routerAdd("GET", "/api/knigi/f/audio/{id}", (e) => {
  return require(`${__hooks}/audio_lib.js`).serve(e, e.request.pathValue("id"));
});

// Последние запросы файлов аудио (для «Сведений о воспроизведении»), только администратору
routerAdd("GET", "/api/knigi/admin/audio-log", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  return e.json(200, { rows: require(`${__hooks}/audio_lib.js`).requestLog(String((e.requestInfo().query || {}).track || "")) });
}, $apis.requireAuth("users"));

// Где человек остановился в главе {pos, done, played}
routerAdd("POST", "/api/knigi/audio/{id}/progress", (e) => {
  return e.json(200, require(`${__hooks}/audio_lib.js`).saveProgress(e, e.request.pathValue("id")));
}, $apis.requireAuth("users"));

/* ---------- Администратор ---------- */
// Переименовать и опубликовать или снять с публикации: {title} и/или {published}
routerAdd("POST", "/api/knigi/audio/{id}", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const t = require(`${__hooks}/audio_lib.js`).editTrack(e.request.pathValue("id"), e.requestInfo().body || {});
  return e.json(200, { id: t.id, title: t.getString("title"), published: t.getBool("published"), published_at: t.getString("published_at") });
}, $apis.requireAuth("users"));
// Вверх (dir = -1) или вниз (dir = 1)
routerAdd("POST", "/api/knigi/audio/{id}/move", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  require(`${__hooks}/audio_lib.js`).moveTrack(e.request.pathValue("id"), parseInt((e.requestInfo().body || {}).dir, 10) || 1);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
// Удалить главу: файл с диска и прогресс слушания у всех
routerAdd("DELETE", "/api/knigi/audio/{id}", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  require(`${__hooks}/audio_lib.js`).deleteTrack(e.request.pathValue("id"));
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
// Описание аудио у книги {text}: обычный текст до 300 знаков, пустой текст очищает (правки 4.3, дополнение)
routerAdd("POST", "/api/knigi/books/{id}/audio-note", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  let b = null;
  try { b = $app.findRecordById("books", e.request.pathValue("id")); } catch (_) {}
  if (!b) throw new NotFoundError("Книга не найдена: возможно, её удалили.");
  const text = String((e.requestInfo().body || {}).text || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (text.length > 300) throw new BadRequestError("Описание длиннее 300 знаков. Сократите его.");
  b.set("audio_note", text);
  $app.save(b);
  return e.json(200, { audio_note: b.getString("audio_note") });
}, $apis.requireAuth("users"));

// Книга только из аудио: {title, authors}. Создаётся скрытой, как любая новая книга.
routerAdd("POST", "/api/knigi/audio-books", (e) => {
  require(`${__hooks}/lib.js`).requireAdmin(e);
  const b = require(`${__hooks}/audio_lib.js`).createAudioBook(e.requestInfo().body || {});
  return e.json(200, { id: b.id });
}, $apis.requireAuth("users"));

// Удалили главу каскадом (вместе с книгой): файл убираем с диска. deleteBook делает это и сам.
onRecordAfterDeleteSuccess((e) => {
  e.next();
  try { const F = require(`${__hooks}/files_lib.js`); F.rmFile(F.audioDir(), e.record.getString("file")); }
  catch (err) { $app.logger().error("Не удалось удалить файл главы", "track", e.record.id, "error", String(err)); }
}, "audio_tracks");
