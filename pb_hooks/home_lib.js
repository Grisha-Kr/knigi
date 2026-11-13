/// <reference path="../pb_data/types.d.ts" />

// Вид главной страницы (правки 4.7): какие блоки свёрнуты и закрыт ли блок «Продолжить слушание».
// Хранится в users.home_ui, чтобы свёрнутое на телефоне было свёрнуто и на компьютере.
// Это настройка вида: срок доступа, пауза и условия пользования на неё не влияют, а сам маршрут
// не трогает ничего, кроме поля home_ui у того, кто вошёл.

// Блоки главной, которые сворачиваются: «Продолжить чтение», «Полки», «Мои полки», «Новые отзывы»
const BLOCKS = ["reading", "shelves", "mine", "reviews"];
const KEYS = ["collapsed", "listen_hidden"];
const MAX_BYTES = 500;
const BAD = "Такие настройки главной не поддерживаются.";

// Что лежит в базе, в приведённом виде: {collapsed: [...], listen_hidden: bool}
function read(user) {
  let v = null;
  try { v = JSON.parse(toString(user.get("home_ui")) || "null"); } catch (_) {}
  if (!v || typeof v !== "object" || Array.isArray(v)) v = {};
  const list = Array.isArray(v.collapsed) ? v.collapsed : [];
  return { collapsed: BLOCKS.filter((k) => list.indexOf(k) >= 0), listen_hidden: v.listen_hidden === true };
}

// Проверка присланного: только известные ключи и значения, иначе 400. Пропущенный ключ остаётся прежним.
function clean(body, cur) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestError(BAD);
  const keys = Object.keys(body);
  if (!keys.length || keys.some((k) => KEYS.indexOf(k) < 0)) throw new BadRequestError(BAD);
  const out = { collapsed: cur.collapsed, listen_hidden: cur.listen_hidden };
  if (body.collapsed !== undefined) {
    const list = body.collapsed;
    if (!Array.isArray(list) || list.length > BLOCKS.length) throw new BadRequestError(BAD);
    for (let i = 0; i < list.length; i++) {
      if (typeof list[i] !== "string" || BLOCKS.indexOf(list[i]) < 0 || list.indexOf(list[i]) !== i) throw new BadRequestError(BAD);
    }
    out.collapsed = BLOCKS.filter((k) => list.indexOf(k) >= 0);
  }
  if (body.listen_hidden !== undefined) {
    if (typeof body.listen_hidden !== "boolean") throw new BadRequestError(BAD);
    out.listen_hidden = body.listen_hidden;
  }
  return out;
}

function get(e) {
  const u = $app.findRecordById("users", e.auth.id);
  e.response.header().set("Cache-Control", "no-store");
  return e.json(200, read(u));
}

function save(e) {
  if (e.request.contentLength > MAX_BYTES) throw new BadRequestError(BAD);
  const body = e.requestInfo().body;
  let size = MAX_BYTES + 1;
  try { size = JSON.stringify(body).length; } catch (_) {}
  if (size > MAX_BYTES) throw new BadRequestError(BAD);
  let out = null;
  // свежая запись и сохранение в одной транзакции: остальные поля пользователя (срок, пауза, условия,
  // «без подписи») остаются такими, какие они в базе в эту секунду
  $app.runInTransaction((tx) => {
    const u = tx.findRecordById("users", e.auth.id);
    out = clean(body, read(u));
    u.set("home_ui", out);
    tx.save(u);
  });
  e.response.header().set("Cache-Control", "no-store");
  return e.json(200, out);
}

module.exports = { BLOCKS, read, clean, get, save };
