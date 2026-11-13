// Аудио к книгам (правки 4.3, часть Б). Подключается через require(`${__hooks}/audio_lib.js`) внутри обработчиков
// (audio.pb.js, files_lib.js, mcp_tools.js).
// Главы загружает только администратор, тем же путём, что и книги: кусками по 8 МБ (upload/start с kind "audio").
// Файл ложится в AUDIO_DIR под именем «ID_ГЛАВЫ-хвост.mp3|m4a» (новый хвост при замене: старые ссылки
// не попадают на новый файл). Содержимое и длительность проверяет tools/knigi_convert.py audio.
// Новая глава появляется черновиком: её видит и слушает только администратор, пока не нажмёт «Опубликовать».
// Слушать главу может тот, кому открыта книга (bookOpen в lib.js), с действующим сроком доступа.
// Ссылка на файл и кука те же, что у книг (files_lib.js: makeLink, linkUser): 2 часа, только в браузере,
// где выполнен вход. Ограничение скорости на аудио не действует, прослушивание пишется в журнал чтения.

const F = () => require(`${__hooks}/files_lib.js`);
const L = () => require(`${__hooks}/lib.js`);
const MIME = { mp3: "audio/mpeg", m4a: "audio/mp4" };
const nowStr = () => new Date().toISOString().replace("T", " ");

function trackOf(id) {
  let t = null;
  try { t = $app.findRecordById("audio_tracks", String(id || "")); } catch (_) {}
  if (!t) throw new NotFoundError("Глава не найдена: возможно, её удалили.");
  return t;
}
// Глава, которую человек может слушать: книга ему открыта, глава опубликована (черновик только администратору)
function openTrack(id, user) {
  const t = trackOf(id);
  const lib = L();
  if (!t.getBool("published") && !lib.isAdmin(user)) throw new NotFoundError("Глава не найдена: возможно, её удалили.");
  // срок доступа первым (без доступа только своя одобренная книга), потом видимость книги:
  // скрытая книга скрывает и аудио (404 или «временно недоступна»)
  lib.openForRead(t.getString("book"), user);
  return t;
}
function nextSort(bookId) {
  const r = new DynamicModel({ m: 0 });
  $app.db().newQuery("SELECT COALESCE(MAX(sort), 0) AS m FROM audio_tracks WHERE book = {:b}").bind({ b: bookId }).one(r);
  return (r.m || 0) + 1;
}
// Аудио у книги изменилось: приложениям уходит сообщение (снятую с публикации главу PocketBase им сам не пришлёт)
function notify(bookId) {
  let b = null;
  try { b = $app.findRecordById("books", bookId); } catch (_) {}
  F().notifyVisibility(bookId, b ? b.getBool("hidden") : false);
}

/* ---------- Загрузка ---------- */
// Начало загрузки: к какой книге и как назвать новую главу, или какой главе заменить файл
function checkStart(body) {
  if (body.track) {
    const t = trackOf(body.track);
    return { book: t.getString("book"), track: t.id, title: t.getString("title"), duration: 0 };
  }
  let b = null;
  try { b = $app.findRecordById("books", String(body.book || "")); } catch (_) {}
  if (!b) throw new NotFoundError("Книга не найдена: возможно, её удалили.");
  if (b.getBool("pending")) throw new BadRequestError("Книга на проверке. Сначала одобрите её, потом добавляйте аудио.");
  const title = String(body.title || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!title) throw new BadRequestError("Напишите название главы, например «Предисловие» или «Глава 1».");
  const dur = parseFloat(body.duration);
  const pos = parseInt(body.pos, 10);
  return { book: b.id, track: "", title, duration: dur > 0 && dur < 86400 ? dur : 0, pos: pos > 0 ? pos : 0 };
}
// Конец загрузки: склеить куски, проверить содержимое, создать главу (черновик) или заменить файл
function finishAudio(e, up, meta) {
  const FL = F();
  FL.ensureDirs();
  const C = require(`${__hooks}/convert_lib.js`);
  let t = null;
  if (meta.track) t = trackOf(meta.track);
  let b = null;
  try { b = $app.findRecordById("books", meta.book); } catch (_) {}
  if (!b) { FL.dropUpload(up); throw new NotFoundError("Книга не найдена: возможно, её удалили."); }
  const id = t ? t.id : FL.newId();
  const tmp = `${id}-${FL.randTail()}.part`;
  const dir = FL.audioDir();
  FL.joinChunks(up, meta, $filepath.join(dir, tmp));
  FL.dropUpload(up);
  let info = null;
  // --fix: у M4A описание звука (moov) переносится в начало файла, иначе iPhone качает файл целиком,
  // прежде чем начать играть (правки 4.3, звук не перекодируется)
  try { info = C.runTool(["audio", $filepath.join(dir, tmp), "--fix"], 600); }
  catch (err) { FL.rmFile(dir, tmp); throw new BadRequestError("Файл не удалось проверить: " + String(err.message || err)); }
  if (!info || info.error || !MIME[info.format]) {
    FL.rmFile(dir, tmp);
    throw new BadRequestError((info && info.error) || "Это не MP3 и не M4A. Сохраните главу как MP3 или M4A.");
  }
  const name = `${id}-${FL.randTail()}.${info.format}`;
  $os.rename($filepath.join(dir, tmp), $filepath.join(dir, name));
  const duration = info.duration > 0 ? info.duration : (meta.duration || 0);
  const old = t ? t.getString("file") : "";
  if (!t) {
    t = new Record($app.findCollectionByNameOrId("audio_tracks"));
    t.set("id", id);
    t.set("book", b.id);
    t.set("title", meta.title || "Глава");
    t.set("sort", nextSort(b.id));
    t.set("published", false); // новая глава всегда черновик
  }
  t.set("file", name);
  t.set("size", meta.size);
  t.set("duration", Math.round(duration * 10) / 10);
  t.set("format", info.format);
  try { $app.save(t); } catch (err) { FL.rmFile(dir, name); throw err; }
  if (old && old !== name) FL.rmFile(dir, old);
  if (!meta.track && meta.pos > 0) placeTrack(t.id, meta.pos);
  if (t.getBool("published")) notify(b.id);
  return { kind: "audio", id: b.id, track: t.id, duration: t.getFloat("duration"), format: info.format };
}

/* ---------- Изменить, переставить, опубликовать, удалить (администратор) ---------- */
function editTrack(id, body) {
  const t = trackOf(id);
  const was = t.getBool("published");
  if (body.title !== undefined) {
    const title = String(body.title || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!title) throw new BadRequestError("Напишите название главы.");
    t.set("title", title);
  }
  if (body.published !== undefined) {
    const on = !!body.published;
    if (on && !t.getString("file")) throw new BadRequestError("У главы нет файла.");
    t.set("published", on);
    if (on && !was) t.set("published_at", nowStr());
  }
  $app.save(t);
  if (was || t.getBool("published")) notify(t.getString("book"));
  return t;
}
// Переставить на одну позицию вверх (dir = -1) или вниз (1)
function moveTrack(id, dir) {
  const t = trackOf(id);
  // обычный массив номеров: перестановка прямо в списке записей PocketBase путает элементы
  const ids = $app.findRecordsByFilter("audio_tracks", "book = {:b}", "sort,created", 0, 0, { b: t.getString("book") }).map((x) => String(x.id));
  const i = ids.indexOf(t.id);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= ids.length) return;
  const tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
  $app.runInTransaction((tx) => {
    ids.forEach((id, k) => {
      const r = tx.findRecordById("audio_tracks", id);
      if (r.getInt("sort") === k + 1) return;
      r.set("sort", k + 1);
      tx.save(r);
    });
  });
  notify(t.getString("book"));
}
// Поставить главу на место number (1 = первой), остальные сдвигаются
function placeTrack(id, number) {
  const t = trackOf(id);
  const ids = $app.findRecordsByFilter("audio_tracks", "book = {:b}", "sort,created", 0, 0, { b: t.getString("book") }).map((x) => String(x.id)).filter((x) => x !== t.id);
  ids.splice(Math.max(0, Math.min(ids.length, number - 1)), 0, t.id);
  $app.runInTransaction((tx) => {
    ids.forEach((x, k) => {
      const r = tx.findRecordById("audio_tracks", x);
      if (r.getInt("sort") === k + 1) return;
      r.set("sort", k + 1);
      tx.save(r);
    });
  });
}
function deleteTrack(id) {
  const t = trackOf(id);
  const name = t.getString("file"), bookId = t.getString("book"), pub = t.getBool("published");
  $app.delete(t); // прогресс слушания удаляется каскадом
  F().rmFile(F().audioDir(), name);
  if (pub) notify(bookId);
}

/* ---------- Книга только из аудио ---------- */
// Название, авторы; обложку администратор ставит потом обычной «Заменить обложку» (её зовёт приложение).
// Как любая новая книга, она скрыта, пока её не откроют всем или отдельным читателям.
function createAudioBook(body) {
  const lib = L();
  const title = String(body.title || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!title) throw new BadRequestError("Введите название книги.");
  const authors = String(body.authors || "").trim().slice(0, 1000);
  const b = new Record($app.findCollectionByNameOrId("books"));
  b.set("title", title);
  b.set("formats", []);
  b.set("status", "ready");
  b.set("hidden", true);
  if (authors) b.set("authors", lib.splitAuthors(authors).map((n) => lib.authorId($app, n)));
  $app.save(b);
  return b;
}

/* ---------- Ссылка, файл, прогресс ---------- */
function link(e, id) {
  const t = openTrack(id, e.auth); // срок доступа и видимость книги (openForRead)
  const FL = F();
  if (!t.getString("file") || !FL.exists($filepath.join(FL.audioDir(), t.getString("file")))) throw new NotFoundError("Файл главы не найден на сервере.");
  return { url: FL.makeLink(e, "audio", t.id, e.auth.id), ttl: FL.LINK_TTL, size: t.getInt("size"), duration: t.getFloat("duration"), format: t.getString("format") };
}
// Последние запросы файлов аудио (в памяти сервера, 150 штук): что и с какого устройства просил плеер.
// Показываются администратору в «Сведениях о воспроизведении» на экране плеера.
function logRequest(e, id, user, note) {
  try {
    const h = e.request.header;
    const ua = String(h.get("User-Agent") || "");
    const dev = /iPhone|iPad/.test(ua) ? (/AppleCoreMedia|CFNetwork/.test(ua) ? "iPhone, звук" : "iPhone") : /Macintosh/.test(ua) ? "Mac" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : "другое";
    const row = { at: new Date().toISOString(), track: id, user: user ? user.getString("name") : "", range: String(h.get("Range") || ""),
      ifRange: String(h.get("If-Range") || ""), method: e.request.method, dev, ua: ua.slice(0, 160), note: note || "",
      // правки 4.8: как браузер назвал запрос (audio, empty, document); у плеера iPhone обычно пусто
      dest: String(h.get("Sec-Fetch-Dest") || "").slice(0, 20), mode: String(h.get("Sec-Fetch-Mode") || "").slice(0, 20) };
    $app.store().setFunc("kn_alog", (old) => (old || []).concat([row]).slice(-150));
  } catch (_) {}
}
function requestLog(trackId) {
  const list = $app.store().get("kn_alog") || [];
  return list.filter((r) => !trackId || r.track === trackId).slice(-80).reverse();
}
function serve(e, id) {
  const FL = F();
  let user = null;
  // правки 4.8: главу нельзя открыть как страницу (новая вкладка, «Сохранить ссылку как»); плеер приложения
  // просит её тегом audio, плеер iPhone при выключенном экране заголовков Sec-Fetch не шлёт
  try { FL.refuseAsPage(e, "Глава открывается только в плеере приложения."); user = FL.linkUser(e, "audio", id); } catch (err) { logRequest(e, id, null, "отказ: " + String(err.message || err).slice(0, 80)); throw err; }
  logRequest(e, id, user, "");
  const t = openTrack(id, user); // выданная раньше ссылка без доступа тоже перестаёт работать (кроме своей книги)
  const name = t.getString("file");
  if (!name) throw new NotFoundError("Файл главы не найден на сервере.");
  FL.noStore(e);
  const h = e.response.header();
  h.set("Content-Type", MIME[t.getString("format")] || "audio/mpeg");
  h.set("Content-Disposition", "inline");
  h.set("Accept-Ranges", "bytes");
  // ограничения скорости на аудио нет: перемотка часовой главы легко упёрлась бы в лимит книг
  return e.fileFS($os.dirFS(FL.audioDir()), name);
}
// Где человек остановился: {pos, done, played}. played = сколько секунд слушал с прошлого сохранения (для журнала).
function saveProgress(e, id) {
  const t = openTrack(id, e.auth); // без доступа место сохраняется только в своей одобренной книге
  const body = e.requestInfo().body || {};
  const dur = t.getFloat("duration") || 0;
  let pos = Math.max(0, parseFloat(body.pos) || 0);
  if (dur) pos = Math.min(pos, dur);
  const key = { u: e.auth.id, t: t.id };
  let r = null;
  try { r = $app.findFirstRecordByFilter("audio_progress", "user = {:u} && track = {:t}", key); } catch (_) {}
  if (!r) {
    r = new Record($app.findCollectionByNameOrId("audio_progress"));
    r.set("user", e.auth.id);
    r.set("track", t.id);
  }
  r.set("book", t.getString("book"));
  r.set("pos", Math.round(pos * 10) / 10);
  // «прослушано» остаётся, если человек вернулся к главе и слушает её снова
  if (body.done === true) r.set("done", true);
  if (body.done === false && body.reset === true) r.set("done", false);
  try { $app.save(r); } catch (err) {
    r = $app.findFirstRecordByFilter("audio_progress", "user = {:u} && track = {:t}", key);
    r.set("pos", Math.round(pos * 10) / 10);
    if (body.done === true) r.set("done", true);
    $app.save(r);
  }
  const played = Math.min(Math.max(0, parseFloat(body.played) || 0), 600);
  if (played > 0 && !L().isAdmin(e.auth)) {
    let b = null;
    try { b = $app.findRecordById("books", t.getString("book")); } catch (_) {}
    if (b) F().logListen(e.auth.id, b, played, t.getString("title"));
  }
  return { id: r.id, track: t.id, book: t.getString("book"), pos: r.getFloat("pos"), done: r.getBool("done"), created: r.getString("created"), updated: r.getString("updated") };
}

/* ---------- Для подключения к ИИ ---------- */
const durText = (sec) => {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h} ч ${m} мин` : m ? `${m} мин${s ? " " + s + " с" : ""}` : `${s} с`;
};
function tracksOf(bookId, withDrafts) {
  return $app.findRecordsByFilter("audio_tracks", withDrafts ? "book = {:b}" : "book = {:b} && published = true", "sort,created", 0, 0, { b: bookId });
}

module.exports = { logRequest, requestLog, MIME, trackOf, openTrack, checkStart, finishAudio, editTrack, moveTrack, deleteTrack, createAudioBook, link, serve, saveProgress, durText, tracksOf, notify };
