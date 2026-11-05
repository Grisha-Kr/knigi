// Общие функции для хуков. В обработчиках PocketBase код верхнего уровня файла
// недоступен, поэтому каждый обработчик подключает этот файл через require.
// Файлы книг, обложки, тексты, загрузка и журнал чтения: files_lib.js.

const MB = 1024 * 1024;

// Администратор приложения: первый зарегистрированный (users.role = "admin")
function isAdmin(rec) {
  return !!(rec && rec.collection && rec.collection().name === "users" && rec.getString("role") === "admin");
}
function requireAdmin(e) {
  if (!isAdmin(e.auth)) throw new ForbiddenError("Это может сделать только администратор библиотеки.");
}

// Строка для поиска: строчными, ё = е, без лишних пробелов
function norm(s) {
  return String(s || "").toLowerCase().replace(/ё/g, "е").replace(/[«»"„“”]/g, "").replace(/\s+/g, " ").trim();
}

/* ---------- Авторы ---------- */
// Для списка по алфавиту фамилия идёт первой: «Эдвард Баундс» → «Баундс Эдвард».
// «Баундс Э. М.», «Баундс, Эдвард» и имена из одного слова остаются как есть.
function sortName(name) {
  name = String(name || "").replace(/\s+/g, " ").trim();
  if (!name || name.indexOf(",") >= 0) return name.replace(/,/g, "");
  const w = name.split(" ");
  if (w.length < 2) return name;
  const last = w[w.length - 1];
  if (/^([A-ZА-ЯЁ]\.)+$/i.test(last) || /\.$/.test(last)) return name; // в конце инициалы: фамилия уже первая
  if (w.every((x, i) => i === w.length - 1 || /^[A-ZА-ЯЁ]\.$/i.test(x) || /^([A-ZА-ЯЁ]\.)+$/i.test(x))) {
    return last + " " + w.slice(0, -1).join(" "); // «Э. М. Баундс»
  }
  return last + " " + w.slice(0, -1).join(" ");
}

// Авторы из строки свойств файла или имени: «Иванов И. И., Петров П.; Сидоров»
function splitAuthors(s) {
  return String(s || "").split(/\s*[;,&]\s*|\s+(?:и|and)\s+/i).map((x) => x.replace(/\s+/g, " ").trim())
    .filter((x) => x.length >= 2 && x.length <= 200 && !/^(unknown|anonymous|unspecified|неизвестен|неизвестно|автор|author|admin|administrator|user|пользователь)$/i.test(x)).slice(0, 10);
}

// Найти автора по имени (без учёта регистра и буквы ё) или создать нового
function authorId(app, name) {
  const key = norm(name);
  let a = null;
  try { a = app.findFirstRecordByData("authors", "search", key); } catch (_) {}
  if (a) return a.id;
  a = new Record(app.findCollectionByNameOrId("authors"));
  a.set("name", String(name).replace(/\s+/g, " ").trim());
  app.save(a);
  return a.id;
}

// Строка поиска книги: название и имена авторов
function bookSearch(app, book) {
  const ids = book.getStringSlice("authors");
  const names = [];
  for (const id of ids) {
    try { names.push(app.findRecordById("authors", id).getString("name")); } catch (_) {}
  }
  return norm(book.getString("title") + " " + names.join(" ")).slice(0, 2000);
}

// Автор без книг больше не нужен
function dropLonelyAuthors(app, ids) {
  for (const id of ids || []) {
    if (!id) continue;
    const used = app.findRecordsByFilter("books", "authors ?= {:a}", "", 1, 0, { a: id });
    if (used.length) continue;
    try { app.delete(app.findRecordById("authors", id)); } catch (_) {}
  }
}

/* ---------- Полки ---------- */
const MAX_DEPTH = 3; // «Молитва» → «Классика» → «Баундс и Мюллер»

function shelfDepth(app, shelf) {
  let d = 1, cur = shelf, guard = 0;
  while (cur.getString("parent") && guard++ < 10) {
    try { cur = app.findRecordById("shelves", cur.getString("parent")); } catch (_) { break; }
    d++;
  }
  return d;
}

// Новая полка: общая только у администратора, подполка лежит в полке того же вида и того же владельца
function checkShelfCreate(e) {
  const r = e.record;
  const name = r.getString("name").trim();
  if (!name) throw new BadRequestError("Введите название полки.");
  r.set("name", name);
  r.set("owner", e.auth.id);
  const common = r.getBool("common");
  if (common && !isAdmin(e.auth)) throw new ForbiddenError("Общие полки создаёт только администратор.");
  const pid = r.getString("parent");
  if (!pid) return;
  let p = null;
  try { p = $app.findRecordById("shelves", pid); } catch (_) {}
  if (!p) throw new BadRequestError("Полка, внутрь которой вы кладёте эту, не найдена.");
  if (p.getBool("common") !== common) throw new BadRequestError("Подполка должна быть того же вида, что и полка: общая в общей, своя в своей.");
  if (!common && p.getString("owner") !== e.auth.id) throw new ForbiddenError("Это чужая полка.");
  if (shelfDepth($app, p) >= MAX_DEPTH) throw new BadRequestError("Глубже трёх уровней полки не вкладываются.");
}

// Изменить можно название и порядок. Владелец, вид и место в дереве остаются прежними.
function checkShelfUpdate(e) {
  const o = e.record.original();
  e.record.set("owner", o.getString("owner"));
  e.record.set("common", o.getBool("common"));
  e.record.set("parent", o.getString("parent"));
  const name = e.record.getString("name").trim();
  if (!name) throw new BadRequestError("Введите название полки.");
  e.record.set("name", name);
}

function checkShelfDelete(e) {
  const id = e.record.id;
  if ($app.countRecords("shelves", $dbx.hashExp({ parent: id })) > 0) {
    throw new BadRequestError("Удалить можно только полку без подполок. Сначала удалите подполки.");
  }
  if ($app.countRecords("shelf_books", $dbx.hashExp({ shelf: id })) > 0) {
    throw new BadRequestError("Удалить можно только пустую полку. Сначала уберите с неё книги (сами книги останутся в библиотеке).");
  }
}

/* ---------- Заметки ---------- */
// HTML из редактора: только разрешённые теги, у ссылок только адреса http, https и mailto.
// Остальные атрибуты, скрипты, стили и комментарии убираются.
const TAGS = { p: 1, br: 1, h2: 1, h3: 1, strong: 1, b: 1, em: 1, i: 1, u: 1, s: 1, ul: 1, ol: 1, li: 1, blockquote: 1, a: 1 };
const RENAME = { b: "strong", i: "em", h1: "h2", h4: "h3", h5: "h3", h6: "h3", div: "p" };
function cleanHtml(html) {
  html = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|template|svg|math|noscript)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed|template|svg|math|noscript)\b[^>]*>/gi, "");
  let out = "";
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0, m;
  const text = (s) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  while ((m = re.exec(html))) {
    out += text(html.slice(last, m.index));
    last = re.lastIndex;
    let tag = m[1].toLowerCase();
    tag = RENAME[tag] || tag;
    if (!TAGS[tag]) continue;
    const closing = m[0][1] === "/";
    if (closing) { if (tag !== "br") out += `</${tag}>`; continue; }
    if (tag === "a") {
      const h = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[2] || "");
      let href = h ? (h[2] || h[3] || h[4] || "") : "";
      href = href.replace(/&amp;/g, "&").trim();
      if (!/^(https?:\/\/|mailto:)/i.test(href)) href = "";
      out += href ? `<a href="${href.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer">` : "<a>";
      continue;
    }
    out += `<${tag}>`;
  }
  out += text(html.slice(last));
  return out.replace(/&nbsp;/g, " ");
}
// Текст без оформления: для поиска (и на этапе 3 для Claude)
function plainText(html) {
  return String(html || "")
    .replace(/<\/(p|h2|h3|li|blockquote)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

// Цвета выделений (этап 2)
const HL_COLORS = ["yellow", "green", "blue", "pink"];

function checkNote(e) {
  const r = e.record;
  const admin = isAdmin(e.auth);
  if (!r.getString("kind")) r.set("kind", "note");
  const kind = r.getString("kind");
  if (!admin) {
    r.set("shared", false); // делиться может только администратор
    if (kind !== "note" && kind !== "highlight") throw new ForbiddenError("Уроки пишет только администратор.");
  }
  // выделение не превращается в заметку или урок и наоборот: для этого есть «Сделать заметкой»
  const o = r.isNew() ? null : r.original();
  if (o && (o.getString("kind") === "highlight") !== (kind === "highlight")) {
    throw new BadRequestError("Цитату нельзя превратить в заметку. Нажмите «Сделать заметкой»: появится новая заметка, а цитата останется.");
  }
  r.set("title", r.getString("title").replace(/\s+/g, " ").trim());
  const body = cleanHtml(r.getString("body"));
  r.set("body", body);
  const plain = plainText(body).slice(0, 1000000);
  r.set("body_text", plain);
  const quote = r.getString("quote").replace(/[ \t]+/g, " ").trim();
  r.set("quote", quote);
  r.set("place", r.getString("place").replace(/\s+/g, " ").trim().slice(0, 200));
  r.set("search", norm(r.getString("title") + " " + plain + " " + quote).slice(0, 1000000));
  if (r.getInt("page") < 0) r.set("page", 0);
  if (kind === "highlight") {
    if (!r.getString("book")) throw new BadRequestError("Цитата сохраняется из книги.");
    if (!quote) throw new BadRequestError("Выделите текст.");
    if (HL_COLORS.indexOf(r.getString("color")) < 0) r.set("color", "yellow");
    if (!r.getString("format")) throw new BadRequestError("Не указан формат книги.");
    r.set("title", "");
  }
  const bookId = r.getString("book");
  if (bookId) {
    let b = null;
    try { b = $app.findRecordById("books", bookId); } catch (_) {}
    if (b && b.getBool("pending") && !admin) b = null; // книга на проверке: её видит только администратор
    if (!b) throw new BadRequestError("Книга не найдена: возможно, её удалили.");
    r.set("book_title", b.getString("title"));
  }
  // в группу (этап 3): только участник и только к книге, которую группа читает сейчас
  require(`${__hooks}/groups_lib.js`).checkNoteGroup(r, e.auth);
}

/* ---------- Отметки «Читаю» и «Прочитано» (правки 2.2) ---------- */
// Отметка человека у книги: status reading или finished. «Читаю» ставит started_at (если пусто),
// «Прочитано» ставит finished_at (сегодня, если дату не прислали). Книга и владелец после создания не меняются.
const isDay = (s) => /^\d{4}-\d{2}-\d{2}/.test(String(s || ""));
function checkMark(e) {
  const r = e.record;
  const admin = isAdmin(e.auth);
  if (r.isNew()) {
    r.set("user", e.auth.id);
    let b = null;
    try { b = $app.findRecordById("books", r.getString("book")); } catch (_) {}
    if (b && b.getBool("pending") && !admin) b = null;
    if (!b) throw new BadRequestError("Книга не найдена: возможно, её удалили.");
    if ($app.countRecords("marks", $dbx.hashExp({ user: e.auth.id, book: b.id })) > 0) {
      throw new BadRequestError("Отметка у этой книги уже есть. Обновите страницу.");
    }
  } else {
    const o = r.original();
    r.set("user", o.getString("user"));
    r.set("book", o.getString("book"));
  }
  const st = r.getString("status");
  if (st !== "reading" && st !== "finished") throw new BadRequestError("Неизвестная отметка.");
  const now = new Date().toISOString().replace("T", " ");
  if (st === "reading" && !r.getString("started_at")) r.set("started_at", now);
  if (st === "finished") {
    const d = r.getString("finished_at");
    if (!d) r.set("finished_at", now.slice(0, 10) + " 12:00:00.000Z");
    else {
      if (!isDay(d)) throw new BadRequestError("Проверьте дату прочтения.");
      const day = String(d).slice(0, 10);
      if (day > new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10)) throw new BadRequestError("Дата прочтения не может быть в будущем.");
      if (day < "1900-01-01") throw new BadRequestError("Проверьте дату прочтения.");
    }
  }
}

/* ---------- Регистрация по приглашению ---------- */
function checkRegistration(e) {
  const total = $app.countRecords("users");
  let invite = null;
  if (total > 0) {
    const body = e.requestInfo().body || {};
    const code = String(body["invite"] || "").trim().toUpperCase();
    if (!code) throw new BadRequestError("Для регистрации нужен код приглашения.");
    try { invite = $app.findFirstRecordByData("invites", "code", code); } catch (_) { invite = null; }
    if (!invite) throw new BadRequestError("Такого кода приглашения нет. Проверьте, что он введён без ошибок.");
    const max = invite.getInt("max_uses");
    if (max > 0 && invite.getInt("uses") >= max) throw new BadRequestError("Это приглашение уже использовано.");
    const expires = invite.getString("expires");
    if (expires && expires < new Date().toISOString().slice(0, 10)) throw new BadRequestError("Срок действия приглашения истёк.");
    e.record.set("role", "user");
  } else {
    e.record.set("role", "admin");
  }
  if (!e.record.getString("theme")) e.record.set("theme", "auto");
  return invite;
}

/* ---------- Письма (правки 2.2) ---------- */
const MAIL_PER_DAY = 5; // писем в сутки на одну почту: сброс пароля, подтверждение и смена почты вместе

// Можно ли отправить ещё одно письмо этому человеку. Если можно, письмо записывается в mail_log.
// Если нельзя, хук отвечает как обычно (204), но письмо не уходит: по ответу не узнать, есть ли такая почта.
function mailAllowed(user, kind) {
  const ago = (days) => new Date(Date.now() - days * 864e5).toISOString().replace("T", " ");
  $app.db().newQuery("DELETE FROM mail_log WHERE created < {:t}").bind({ t: ago(7) }).execute();
  const sent = $app.countRecords("mail_log", $dbx.exp("user = {:u} AND created > {:t}", { u: user.id, t: ago(1) }));
  if (sent >= MAIL_PER_DAY) {
    $app.logger().warn("Письмо не отправлено: на эту почту за сутки уже ушло " + MAIL_PER_DAY + " писем", "user", user.id, "kind", kind);
    return false;
  }
  const r = new Record($app.findCollectionByNameOrId("mail_log"));
  r.set("user", user.id);
  r.set("kind", kind);
  $app.save(r);
  return true;
}

function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  return n + " " + (a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many);
}
function durationText(sec) {
  if (sec >= 86400 && sec % 86400 === 0) return plural(sec / 86400, "день", "дня", "дней");
  if (sec >= 3600 && sec % 3600 === 0) return plural(sec / 3600, "час", "часа", "часов");
  return plural(Math.max(1, Math.round(sec / 60)), "минуту", "минуты", "минут");
}
const TTL_OPTION = { reset: "passwordResetToken", verify: "verificationToken", change: "emailChangeToken", otp: "otp" };

const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Устройство из строки браузера (User-Agent) коротко и по-русски
function deviceName(ua) {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const br = /YaBrowser/.test(ua) ? "Яндекс Браузер" : /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera"
    : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "";
  return [br, os].filter(Boolean).join(", ") || "неизвестное устройство";
}
// Сведения о входе от PocketBase («2026-10-30 12:00:00.000Z - IP браузер») в три строки по-русски
function alertInfo(info) {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)\S* - (\S+) ?(.*)$/.exec(info || "");
  if (!m) return info;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + 3 * 3600e3); // по Москве
  const two = (x) => String(x).padStart(2, "0");
  const when = `${two(d.getUTCDate())}.${two(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} по Москве`;
  const ua = m[7].replace(/&#34;|&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  return `Когда: ${when}<br>Адрес в интернете: ${escHtml(m[6])}<br>Устройство: ${escHtml(deviceName(ua))}`;
}

const MAIL_HEAD = `<!DOCTYPE html>
<html lang="ru"><head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;-webkit-text-size-adjust:100%}
@media (prefers-color-scheme: dark){
  body,.mol-bg{background:#15181B!important}
  .mol-card{background:#1E2226!important;color:#ECE6DA!important}
  .mol-ink{color:#ECE6DA!important}
  .mol-muted{color:#A39B8D!important}
  .mol-link{color:#9DBEDC!important}
  .mol-btn{background:#8DB3D6!important}
  .mol-btn-a{color:#0F1A24!important}
  .mol-box{background:#23313D!important;color:#DCE6EE!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:#F4EFE6;">`;
const MAIL_FOOT = "</body></html>";

// Письмо перед отправкой: обращение по имени, срок ссылки из настроек коллекции и своя обёртка вместо стандартной PocketBase.
// Если в шаблоне нет меток <!--mol--> (шаблон переписали в панели), письмо уходит как есть.
function mailPolish(e, kind) {
  try {
    const html = e.message.html;
    const a = html.indexOf("<!--mol-->"), b = html.indexOf("<!--/mol-->");
    if (a < 0 || b < a) return;
    let body = html.slice(a, b + "<!--/mol-->".length);
    const name = e.record ? e.record.getString("name").trim() : "";
    body = body.split("{MOL_HELLO}").join(name ? `Здравствуйте, ${escHtml(name)}.` : "Здравствуйте.");
    if (TTL_OPTION[kind]) {
      const opt = e.record.collection()[TTL_OPTION[kind]];
      body = body.split("{MOL_TTL}").join(durationText(opt.duration));
    }
    if (kind === "alert" && e.meta && e.meta.info) body = body.split(e.meta.info).join(alertInfo(e.meta.info));
    e.message.html = MAIL_HEAD + body + MAIL_FOOT;
  } catch (err) {
    $app.logger().warn("Не удалось оформить письмо, ушло стандартное", "kind", kind, "error", String(err));
  }
}

/* ---------- Свои письма: книги на проверке (правки 2.2) ---------- */
// Почта настроена, если в панели включён SMTP. Иначе писем нет, всё видно в приложении.
function mailReady() {
  try { return !!$app.settings().smtp.enabled; } catch (_) { return false; }
}
function letterHtml(title, paragraphs, href, button) {
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const p = (t) => `<p class="mol-ink" style="margin:0 0 16px;font-size:16px;line-height:24px;color:#26231F;">${t}</p>`;
  const appUrl = String($app.settings().meta.appURL || "").replace(/\/+$/, "");
  const btn = href ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr>
<td class="mol-btn" align="center" bgcolor="#2C4A66" style="background:#2C4A66;border-radius:12px;">
<a class="mol-btn-a" href="${escHtml(href)}" target="_blank" rel="noopener" style="display:block;padding:15px 20px;font-family:${font};font-size:17px;line-height:22px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:12px;">${escHtml(button)}</a>
</td></tr></table>` : "";
  return MAIL_HEAD + `
<table class="mol-bg" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F4EFE6" style="width:100%;background:#F4EFE6;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;">
<tr><td class="mol-card" bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:16px;padding:28px 22px 16px;font-family:${font};color:#26231F;text-align:left;">
<h1 class="mol-ink" style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;font-weight:bold;color:#26231F;">${escHtml(title)}</h1>
${paragraphs.map(p).join("\n")}
${btn}
</td></tr>
<tr><td class="mol-muted" align="center" style="padding:16px 8px 0;font-family:${font};font-size:12px;line-height:18px;color:#6E665A;">
Библиотека<br><a class="mol-muted" href="${escHtml(appUrl)}" target="_blank" rel="noopener" style="color:#6E665A;">${escHtml(appUrl)}</a>
</td></tr>
</table>
</td></tr></table>` + MAIL_FOOT;
}
// Отправить письмо, если почта настроена. Ошибка почты не мешает основному действию.
function sendLetter(user, kind, subject, title, paragraphs, path, button) {
  if (!mailReady() || !user || !user.getString("email")) return false;
  try {
    const s = $app.settings();
    const appUrl = String(s.meta.appURL || "").replace(/\/+$/, "");
    const name = user.getString("name").trim();
    const html = letterHtml(title, [name ? `Здравствуйте, ${escHtml(name)}.` : "Здравствуйте."].concat(paragraphs), path ? appUrl + path : "", button);
    $app.newMailClient().send(new MailerMessage({
      from: { address: s.meta.senderAddress, name: s.meta.senderName },
      to: [{ address: user.getString("email") }],
      subject, html,
    }));
    const r = new Record($app.findCollectionByNameOrId("mail_log"));
    r.set("user", user.id);
    r.set("kind", kind);
    $app.save(r);
    return true;
  } catch (err) {
    $app.logger().warn("Письмо не отправлено", "kind", kind, "error", String(err));
    return false;
  }
}
// Администратору: «Новая книга на проверке», не чаще одного письма в час
function mailNewOffer(offer, who) {
  if (!mailReady()) return;
  const admins = $app.findRecordsByFilter("users", "role = 'admin'", "created", 1, 0);
  if (!admins.length) return;
  const admin = admins[0];
  const hourAgo = new Date(Date.now() - 3600e3).toISOString().replace("T", " ");
  if ($app.countRecords("mail_log", $dbx.exp("user = {:u} AND kind = 'offer' AND created > {:t}", { u: admin.id, t: hourAgo })) > 0) return;
  const whoName = who.getString("name").trim() || who.getString("email");
  const note = offer.getString("note");
  sendLetter(admin, "offer", "Новая книга на проверке", "Новая книга на проверке",
    [`${escHtml(whoName)} предлагает книгу «${escHtml(offer.getString("title"))}».` + (note ? ` Пара слов от читателя: ${escHtml(note)}` : ""),
      "Книга видна только вам, пока вы её не одобрите. Откройте раздел «На проверке», чтобы посмотреть её, поправить данные и принять решение."],
    "/#/review", "Открыть «На проверке»");
}
// Читателю: решение по его книге
function mailOfferDecision(offer) {
  let user = null;
  try { user = $app.findRecordById("users", offer.getString("user")); } catch (_) { return; }
  const title = offer.getString("title");
  if (offer.getString("status") === "approved") {
    sendLetter(user, "offer_ok", "Ваша книга добавлена в библиотеку", "Книга добавлена",
      [`Книга «${escHtml(title)}», которую вы предложили, теперь в библиотеке. Спасибо!`],
      "/#/b/" + offer.getString("book"), "Открыть книгу");
  } else {
    sendLetter(user, "offer_no", "Ваша книга не добавлена в библиотеку", "Книга не добавлена",
      [`Книгу «${escHtml(title)}», которую вы предложили, администратор не добавил в библиотеку.`,
        `Причина: ${escHtml(offer.getString("reason"))}`],
      "/#/profile", "Открыть профиль");
  }
}

module.exports = {
  MB, isAdmin, requireAdmin, norm, sortName, splitAuthors, authorId, bookSearch, dropLonelyAuthors,
  MAX_DEPTH, shelfDepth, checkShelfCreate, checkShelfUpdate, checkShelfDelete,
  cleanHtml, plainText, checkNote, checkRegistration, HL_COLORS,
  MAIL_PER_DAY, mailAllowed, mailPolish, durationText, alertInfo,
  checkMark, mailReady, sendLetter, mailNewOffer, mailOfferDecision, escHtml,
};
