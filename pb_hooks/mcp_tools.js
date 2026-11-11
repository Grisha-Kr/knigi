// Этап 4: инструменты сервера MCP. Помощник видит их названия и описания и по ним решает, что вызвать.
// Права как у администратора в приложении: все книги (кроме книг на проверке), свои полки, свои заметки,
// группы, где он участник. Ничего, кроме create_note, в базе не меняется. Файлы книг не отдаются,
// только извлечённый текст (text/ID_ФАЙЛА.txt).
// Подключается в обработчиках через require(`${__hooks}/mcp_tools.js`).

const L = () => require(`${__hooks}/lib.js`);
const F = () => require(`${__hooks}/files_lib.js`);
const G = () => require(`${__hooks}/groups_lib.js`);
const M = () => require(`${__hooks}/mcp_lib.js`);

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const NOTES_PER_HOUR = 30;
const COLORS = { yellow: "жёлтая", green: "зелёная", blue: "голубая", pink: "розовая" };
const KIND = { note: "Заметка", lesson: "Урок", highlight: "Цитата" };

function ToolError(msg) { this.message = msg; this.tool = true; }
const fail = (msg) => { throw new ToolError(msg); };

/* ---------- Описания инструментов ---------- */
const id = (what) => ({ type: "string", description: `Номер (id) ${what}: латинские буквы и цифры, его дают другие инструменты.` });
const TOOLS = [
  {
    name: "search_books",
    title: "Поиск книг",
    description: "Ищет книги библиотеки по названию и автору. Без запроса показывает недавно добавленные книги. " +
      "Можно ограничить полкой (вместе с её подполками). В ответе у каждой книги id, название, авторы, форматы, число страниц, полки, " +
      "отметка «Читаю» или «Прочитано» и есть ли текст (скан без текста нельзя читать через read_book). До 50 книг.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "Слова из названия или имени автора, например «Баундс молитва». Регистр и буква ё не важны." },
      shelf_id: id("полки из list_shelves"),
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Сколько книг показать, по умолчанию 20." },
    } },
    annotations: RO,
  },
  {
    name: "list_shelves",
    title: "Полки",
    description: "Дерево полок: общие полки библиотеки и мои личные полки, у каждой id и число книг. id полки можно передать в search_books и search_in_books.",
    inputSchema: { type: "object", properties: {} },
    annotations: RO,
  },
  {
    name: "get_book",
    title: "Книга целиком",
    description: "Всё о книге: авторы, год, описание, форматы и страницы, полки, оглавление (закладки PDF или разделы EPUB с номерами для read_book), " +
      "где у меня остановилось чтение, сколько моих заметок, уроков и цитат по ней, совпадают ли номера страниц файла с напечатанными.",
    inputSchema: { type: "object", properties: { book_id: id("книги") }, required: ["book_id"] },
    annotations: RO,
  },
  {
    name: "read_book",
    title: "Текст книги",
    description: "Текст книги. У PDF и DjVu from и to это номера страниц файла, у EPUB, FB2, MOBI, AZW3 и TXT номера разделов (глав) из get_book. " +
      "Каждая страница или раздел помечены номером. За один вызов не больше примерно 40 000 знаков; если не поместилось, в конце ответа написано, " +
      "с какого места продолжить. Чтобы найти нужное место, удобно сначала вызвать search_in_books или get_book (оглавление).",
    inputSchema: { type: "object", properties: {
      book_id: id("книги"),
      from: { type: "integer", minimum: 1, description: "С какой страницы (PDF) или раздела (EPUB) читать. По умолчанию 1." },
      to: { type: "integer", minimum: 1, description: "По какую страницу или раздел включительно. Если не указать, сколько поместится." },
      format: { type: "string", enum: ["pdf", "epub", "djvu", "fb2", "mobi", "azw3", "txt"], description: "Какой формат читать, если у книги их несколько. По умолчанию основной текст книги." },
      offset: { type: "integer", minimum: 0, description: "С какого знака продолжить внутри первой страницы или раздела (берётся из подсказки «Продолжение»)." },
    }, required: ["book_id"] },
    annotations: RO,
  },
  {
    name: "search_in_books",
    title: "Поиск в тексте книг",
    description: "Ищет слово или фразу в тексте книг: в одной книге, на полке или во всех книгах. Без учёта регистра и буквы ё. " +
      "Ответ: книга (id), страница или раздел и отрывок около 300 знаков. До 50 совпадений; если книг много, поиск может остановиться через 20 секунд, " +
      "тогда лучше указать книгу или полку.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "Слово или фраза. Слова фразы ищутся подряд, переносы строк не мешают." },
      book_id: id("книги, если искать в одной книге"),
      shelf_id: id("полки, если искать на полке (вместе с подполками)"),
    }, required: ["query"] },
    annotations: RO,
  },
  {
    name: "list_notes",
    title: "Мои заметки и цитаты",
    description: "Мои заметки, уроки и цитаты (сохранённые выделения из книг). Можно выбрать книгу, вид и искать по тексту, цитатам и мыслям. " +
      "У цитаты: текст, цвет, моя мысль и страница; у урока: названия прикреплённых файлов. Полный текст заметки даёт get_note.",
    inputSchema: { type: "object", properties: {
      book_id: id("книги"),
      kind: { type: "string", enum: ["note", "lesson", "highlight"], description: "note = заметка, lesson = урок, highlight = цитата. Без этого все виды." },
      query: { type: "string", description: "Слова для поиска в заголовке, тексте, цитате и мысли." },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "Сколько записей показать, по умолчанию 30, сначала новые." },
    } },
    annotations: RO,
  },
  {
    name: "get_note",
    title: "Заметка целиком",
    description: "Полный текст моей заметки, урока или цитаты в Markdown (заголовки, списки, цитаты), с книгой, страницей и датами. " +
      "Для записи из группы чтения также комментарии участников.",
    inputSchema: { type: "object", properties: { note_id: id("заметки") }, required: ["note_id"] },
    annotations: RO,
  },
  {
    name: "list_groups",
    title: "Мои группы чтения",
    description: "Группы чтения, где я участник: id, название, участники (имена), текущая книга, кто сегодня читал, план чтения и прочитанные книги группы.",
    inputSchema: { type: "object", properties: {} },
    annotations: RO,
  },
  {
    name: "get_group_notes",
    title: "Заметки группы",
    description: "Цитаты и заметки участников группы чтения по текущей книге группы (или по указанной прочитанной книге), с именами авторов и комментариями. " +
      "Только группы, где я участник.",
    inputSchema: { type: "object", properties: {
      group_id: id("группы из list_groups"),
      book_id: id("книги группы, если нужна не текущая, а прочитанная раньше"),
    }, required: ["group_id"] },
    annotations: RO,
  },
  {
    name: "create_note",
    title: "Новая заметка",
    description: "Сохраняет новую личную заметку или урок в библиотеке (например конспект главы или ответ на вопрос). Текст в Markdown: " +
      "заголовки #, ##, полужирный, курсив, списки, цитаты >, ссылки. Заметка видна только владельцу библиотеки, с пометкой, какой помощник её создал. " +
      "Можно привязать к книге и странице. Старые заметки этот инструмент не меняет. Не больше 30 новых заметок в час.",
    inputSchema: { type: "object", properties: {
      title: { type: "string", description: "Заголовок заметки, до 300 знаков." },
      text: { type: "string", description: "Текст заметки в Markdown." },
      book_id: id("книги, к которой относится заметка"),
      page: { type: "integer", minimum: 1, description: "Страница книги (PDF или DjVu), если заметка о конкретном месте." },
      kind: { type: "string", enum: ["note", "lesson"], description: "note = заметка (по умолчанию), lesson = урок." },
    }, required: ["title", "text"] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "search",
    title: "Поиск по библиотеке",
    description: "Поиск по библиотеке для глубокого исследования: книги по названию и автору, мои заметки и цитаты, отрывки в тексте книг. " +
      "Возвращает JSON {results: [{id, title, url}]}; подробности по id даёт fetch.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Что искать." } }, required: ["query"] },
    annotations: RO,
  },
  {
    name: "fetch",
    title: "Найденное целиком",
    description: "Возвращает найденное инструментом search по его id: описание книги с началом текста, заметку целиком или отрывок книги. JSON {id, title, text, url, metadata}.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "id из результатов search, например book:abc, note:abc или text:abc:45." } }, required: ["id"] },
    annotations: RO,
  },
];

/* ---------- Общее ---------- */
const s = (x) => String(x == null ? "" : x);
const day = (d) => s(d).slice(0, 10);
const plural = (n, a, b, c) => (n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? b : c);
const pl = (n, a, b, c) => n + " " + plural(n, a, b, c);
const fmtName = (f) => F().FMT_NAME[f] || s(f).toUpperCase();
const mb = (n) => (n / 1048576).toFixed(1).replace(".", ",") + " МБ";
const intArg = (v) => { const n = parseInt(v, 10); return isFinite(n) ? n : 0; };

function book(id, need) {
  id = s(id).trim();
  let b = null;
  if (/^[a-z0-9]{15}$/.test(id)) { try { b = $app.findRecordById("books", id); } catch (_) {} }
  if (!b || b.getBool("pending")) { if (need === false) return null; fail(`Книга с id «${id}» не найдена. Найдите её через search_books.`); }
  return b;
}
function authorNames(b) {
  const ids = b.getStringSlice("authors");
  if (!ids.length) return [];
  const by = {};
  for (const a of $app.findRecordsByIds("authors", ids)) by[a.id] = a.getString("name");
  return ids.map((i) => by[i]).filter(Boolean);
}
function files(b) { return F().filesOf(b.id); }
// Книги на проверке (pending) помощнику не видны совсем: ни книга, ни заметки к ней
const NOT_PENDING = "(book = '' || book.pending = false)";
function bookExists(id) { try { $app.findRecordById("books", id); return true; } catch (_) { return false; } }
function visibleShelves(userId) {
  return $app.findRecordsByFilter("shelves", "common = true || owner = {:u}", "sort,name", 0, 0, { u: userId });
}
function shelfNames(bookId, userId) {
  const ids = $app.findRecordsByFilter("shelf_books", "book = {:b}", "", 0, 0, { b: bookId }).map((x) => x.getString("shelf"));
  if (!ids.length) return [];
  return $app.findRecordsByIds("shelves", ids).filter((x) => x.getBool("common") || x.getString("owner") === userId)
    .map((x) => x.getString("name") + (x.getBool("common") ? "" : " (моя)"));
}
// Полка и все её подполки
function shelfBooks(shelfId, userId) {
  const all = visibleShelves(userId);
  if (!all.some((x) => x.id === shelfId)) fail(`Полка с id «${shelfId}» не найдена. Список полок даёт list_shelves.`);
  const ids = [shelfId];
  for (let i = 0; i < ids.length; i++) for (const x of all) if (x.getString("parent") === ids[i]) ids.push(x.id);
  const out = {};
  for (const sid of ids) for (const r of $app.findRecordsByFilter("shelf_books", "shelf = {:s}", "", 0, 0, { s: sid })) out[r.getString("book")] = 1;
  return Object.keys(out);
}
function markOf(bookId, userId) {
  let m = null;
  try { m = $app.findFirstRecordByFilter("marks", "user = {:u} && book = {:b}", { u: userId, b: bookId }); } catch (_) {}
  if (!m) return "";
  return m.getString("status") === "finished" ? `Прочитано ${day(m.getString("finished_at"))}` : "Читаю" + (m.getString("started_at") ? ` с ${day(m.getString("started_at"))}` : "");
}
const ready = (f) => f.getString("status") === "ready";
const isPdfView = (f) => F().VIEW[f.getString("format")] === "pdf";
function textState(b, list) {
  const main = list.find((f) => f.id === b.getString("text_file"));
  if (main) return main.getBool("ocr") ? "текст распознан автоматически, возможны ошибки" : "есть текст";
  if (list.some((f) => ready(f) && isPdfView(f) && !f.getBool("has_text"))) return "скан без текста";
  if (list.some((f) => f.getString("status") === "processing")) return "ещё обрабатывается";
  return "текста нет";
}
function fileLine(f, b) {
  const parts = [fmtName(f.getString("format"))];
  const v = F().VIEW[f.getString("format")];
  if (f.getString("format") !== v) parts[0] += ` (открывается как ${v.toUpperCase()})`;
  if (f.getInt("pages")) parts.push(pl(f.getInt("pages"), "страница", "страницы", "страниц"));
  if (f.getInt("file_size")) parts.push(mb(f.getInt("file_size")));
  if (f.getString("status") === "processing") parts.push("обрабатывается");
  else if (f.getString("status") === "error") parts.push("ошибка обработки");
  else if (f.getBool("has_text")) parts.push(f.getBool("ocr") ? "текст распознан автоматически" : "текст есть");
  else if (v === "pdf") parts.push("скан без текста");
  else parts.push("текста нет");
  if (b && f.id === b.getString("text_file")) parts.push("основной текст");
  return parts.join(", ");
}
// Скрытая книга (правки 4.1): «скрыта от читателей» или, если её открыли отдельным читателям (правки 4.3),
// «скрыта, открыта: Анна, Пётр»
function hiddenText(b) {
  const names = L().bookReaders(b.id).map((r) => r.name);
  return names.length ? "скрыта, открыта: " + names.join(", ") : "скрыта от читателей";
}
// Аудио (правки 4.3): «есть аудио: 3 главы (1 черновик)». Сам звук помощник не получает.
const A = () => require(`${__hooks}/audio_lib.js`);
function audioBrief(bookId) {
  const all = A().tracksOf(bookId, true);
  if (!all.length) return "";
  const drafts = all.filter((t) => !t.getBool("published")).length;
  return `есть аудио: ${pl(all.length, "глава", "главы", "глав")}${drafts ? ` (черновиков: ${drafts})` : ""}`;
}
function bookBrief(b, userId, n) {
  const list = files(b);
  const authors = authorNames(b);
  const lines = [`${n ? n + ". " : ""}«${b.getString("title")}» (id: ${b.id})${b.getBool("hidden") ? " · " + hiddenText(b) : ""}`];
  const info = [];
  if (authors.length) info.push("автор: " + authors.join(", "));
  if (b.getInt("year")) info.push("год: " + b.getInt("year"));
  info.push("форматы: " + (list.map((f) => fmtName(f.getString("format"))).join(", ") || "нет"));
  if (b.getInt("pages")) info.push(pl(b.getInt("pages"), "страница", "страницы", "страниц"));
  info.push(textState(b, list));
  const sh = shelfNames(b.id, userId);
  if (sh.length) info.push("полки: " + sh.join(", "));
  const mk = markOf(b.id, userId);
  if (mk) info.push(mk);
  const au = audioBrief(b.id);
  if (au) info.push(au);
  lines.push("   " + info.join("; "));
  return lines.join("\n");
}
const appLink = (ctx, path) => ctx.base + "/#" + path;

/* ---------- Текст книги ---------- */
function textFileOf(b, fmt) {
  const list = files(b);
  let f = null;
  if (fmt) {
    f = list.find((x) => x.getString("format") === fmt);
    if (!f) fail(`У книги «${b.getString("title")}» нет формата ${fmtName(fmt)}. Есть: ${list.map((x) => fmtName(x.getString("format"))).join(", ")}.`);
  } else f = list.find((x) => x.id === b.getString("text_file"));
  if (f && f.getBool("has_text") && ready(f)) {
    let text = null;
    try { text = toString($os.readFile($filepath.join(F().textDir(), f.id + ".txt"))); } catch (_) {}
    if (text) return { f, text, list };
  }
  const scan = (f && isPdfView(f) && ready(f) && !f.getBool("has_text")) || (!f && list.some((x) => ready(x) && isPdfView(x) && !x.getBool("has_text")));
  if (scan) fail("Это скан без текста. Распознайте его в приложении: карточка книги → «Распознать текст».");
  if ((f || list[0]) && (f || list[0]).getString("status") === "processing") fail("Книга ещё обрабатывается на сервере. Попробуйте через несколько минут.");
  fail("У этой книги нет текста" + (fmt ? ` в формате ${fmtName(fmt)}` : "") + ".");
}
// Части текста: страницы (=== Страница N ===) или разделы (=== Раздел N: название ===)
function parts(text) {
  const re = /^=== (?:Страница (\d+)|Раздел (\d+)(?::\s?(.*?))?) ===$/gm;
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    if (out.length) out[out.length - 1].end = m.index;
    out.push({ n: parseInt(m[1] || m[2], 10), title: m[3] || "", page: !!m[1], start: re.lastIndex + 1, head: m.index });
  }
  if (out.length) out[out.length - 1].end = text.length;
  return out;
}
const body = (text, p) => text.slice(Math.min(p.start, p.end), p.end).trim();

// Номера страниц PDF и оглавление (закладки): qpdf --json, в памяти до перезапуска
function pdfStruct(f) {
  const key = "kn_mcp_pdf:" + f.id + ":" + f.getInt("file_size");
  const c = $app.store().get(key);
  if (c) return c;
  let res = { outlines: [], labels: null };
  try {
    const out = toString($os.cmd("timeout", "60", "qpdf", "--json=2", "--json-key=outlines", "--json-key=pagelabels",
      $filepath.join(F().booksDir(), f.getString("file"))).output());
    const j = JSON.parse(out);
    const str = (v) => s(v).replace(/^[ub]:/, "");
    const walk = (list, depth) => {
      for (const o of list || []) {
        if (res.outlines.length >= 400) return;
        res.outlines.push({ title: str(o.title).replace(/\s+/g, " ").trim(), page: o.destpageposfrom1 || 0, depth });
        walk(o.kids, depth + 1);
      }
    };
    walk(j.outlines, 0);
    if (Array.isArray(j.pagelabels) && j.pagelabels.length) {
      res.labels = j.pagelabels.map((x) => ({ index: x.index || 0, style: str((x.label || {})["/S"]).replace(/^\//, ""), prefix: str((x.label || {})["/P"]), start: (x.label || {})["/St"] || 1 }))
        .sort((a, b) => a.index - b.index);
    }
  } catch (_) {}
  $app.store().set(key, res);
  return res;
}
function roman(n) {
  const R = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [v, r] of R) while (n >= v) { out += r; n -= v; }
  return out;
}
function pageLabel(labels, n) {
  if (!labels) return "";
  let r = null;
  for (const x of labels) if (x.index <= n - 1) r = x;
  if (!r) return String(n);
  const v = r.start + (n - 1 - r.index);
  let num = "";
  if (r.style === "D") num = String(v);
  else if (r.style === "r") num = roman(v);
  else if (r.style === "R") num = roman(v).toUpperCase();
  else if (r.style === "a" || r.style === "A") { const ch = String.fromCharCode(97 + ((v - 1) % 26)); num = ch.repeat(Math.floor((v - 1) / 26) + 1); if (r.style === "A") num = num.toUpperCase(); }
  return r.prefix + num;
}
// Напечатанные номера по тексту: число в первой или последней строке страницы
function guessOffset(text, ps) {
  const diffs = {};
  let found = 0;
  for (const p of ps) {
    const lines = body(text, p).split("\n").map((x) => x.trim()).filter(Boolean);
    if (!lines.length) continue;
    for (const l of [lines[0], lines[lines.length - 1]]) {
      const m = /^[-–—\s]*(\d{1,4})[-–—\s]*$/.exec(l);
      if (m) { const d = p.n - parseInt(m[1], 10); diffs[d] = (diffs[d] || 0) + 1; found++; break; }
    }
  }
  const top = Object.keys(diffs).sort((a, b) => diffs[b] - diffs[a])[0];
  if (top === undefined || found < Math.max(5, ps.length * 0.2) || diffs[top] < found * 0.6) return null;
  return parseInt(top, 10);
}
function pageNumbering(f, text, ps) {
  if (!isPdfView(f)) return { note: "", label: () => "" };
  const st = f.getString("format") === "pdf" ? pdfStruct(f) : { labels: null };
  if (st.labels) {
    const last = ps.length ? ps[ps.length - 1].n : f.getInt("pages");
    let differ = false;
    for (let n = 1; n <= Math.min(last, 5000) && !differ; n++) if (pageLabel(st.labels, n) !== String(n)) differ = true;
    if (differ) {
      return { note: "Номера страниц: N в «Страница N» это номер страницы файла PDF (так их считает приложение и read_book). " +
        "Напечатанный в книге номер указан в скобках, он из разметки страниц файла.", label: (n) => { const x = pageLabel(st.labels, n); return x !== String(n) ? x : ""; } };
    }
    return { note: "", label: () => "" };
  }
  const k = guessOffset(text, ps);
  if (k) {
    return { note: `Номера страниц: N в «Страница N» это номер страницы файла PDF. Похоже, напечатанный в книге номер ${k > 0 ? "меньше" : "больше"} на ${Math.abs(k)} ` +
      `(страница файла N = страница книги N${k > 0 ? "−" : "+"}${Math.abs(k)}); это догадка по числам внизу или вверху страниц.`, label: (n) => (n - k > 0 ? String(n - k) + "?" : "") };
  }
  return { note: "", label: () => "" };
}

/* ---------- Заметки: HTML редактора ↔ Markdown ---------- */
const decode = (x) => x.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
function htmlToMd(html) {
  html = L().cleanHtml(html);
  const blocks = [];
  let cur = null;
  const lists = [];
  const hrefs = [];
  const start = (type, prefix) => { cur = { type, prefix, text: "" }; };
  const end = () => { if (cur) { if (cur.text.trim() || cur.type === "li") blocks.push(cur); cur = null; } };
  const add = (t) => { if (!cur) start("p", ""); cur.text += t; };
  // по кускам: тег или текст между тегами (без чередования в одном выражении: goja на нём ошибается)
  for (const tok of html.split(/(<[^>]*>)/)) {
    if (!tok) continue;
    const m = /^<(\/?)([a-zA-Z0-9]+)/.exec(tok);
    if (!m) { if (tok[0] !== "<") add(decode(tok).replace(/\s+/g, " ")); continue; }
    const close = m[1] === "/", tag = m[2].toLowerCase();
    if (tag === "p" || tag === "h2" || tag === "h3" || tag === "blockquote") {
      if (close) end(); else { end(); start(tag, tag === "h2" ? "## " : tag === "h3" ? "### " : tag === "blockquote" ? "> " : ""); }
    } else if (tag === "ul" || tag === "ol") {
      if (close) lists.pop(); else { end(); lists.push({ type: tag, n: 0 }); }
    } else if (tag === "li") {
      if (close) end();
      else { end(); const l = lists[lists.length - 1] || { type: "ul", n: 0 }; l.n++; start("li", "  ".repeat(Math.max(0, lists.length - 1)) + (l.type === "ol" ? l.n + ". " : "- ")); }
    } else if (tag === "br") add("\n");
    else if (tag === "strong") add("**");
    else if (tag === "em") add("*");
    else if (tag === "s") add("~~");
    else if (tag === "a") {
      if (close) { const h = hrefs.pop(); if (h) add(`](${decode(h)})`); }
      else { const hm = /href="([^"]*)"/.exec(tok); const hv = hm ? hm[1] : ""; hrefs.push(hv); if (hv) add("["); }
    }
  }
  end();
  let out = "";
  blocks.forEach((b, i) => {
    const prev = blocks[i - 1];
    const t = b.text.replace(/\*\*\s*\*\*/g, "").trim().split("\n").map((x, j) => (j ? (b.type === "blockquote" ? "> " : "") : b.prefix) + x.trim()).join("\n");
    if (i) out += (prev.type === b.type && (b.type === "li" || b.type === "blockquote")) ? "\n" : "\n\n";
    out += t;
  });
  return out.trim();
}
function inlineMd(t) {
  t = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  t = t.replace(/`([^`]+)`/g, "$1");
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, a, h) => /^(https?:\/\/|mailto:)/i.test(h) ? `<a href="${h.replace(/"/g, "&quot;")}">${a}</a>` : a);
  t = t.replace(/\*\*([^*]+?)\*\*|__([^_]+?)__/g, (_, a, b) => `<strong>${a || b}</strong>`);
  t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>").replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>");
  t = t.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  return t;
}
function mdToHtml(md) {
  const lines = s(md).replace(/\r\n?/g, "\n").split("\n");
  let html = "", para = [], code = false;
  const stack = [];
  const flush = () => { if (para.length) { html += `<p>${para.map(inlineMd).join("<br>")}</p>`; para = []; } };
  const closeLists = () => { while (stack.length) html += `</li></${stack.pop().type}>`; };
  for (const raw of lines) {
    const line = raw.replace(/\t/g, "    ");
    if (/^\s*(```|~~~)/.test(line)) { flush(); closeLists(); code = !code; continue; }
    if (code) { html += `<p>${inlineMd(line).replace(/<[^>]+>/g, "") || "<br>"}</p>`; continue; }
    if (!line.trim()) { flush(); continue; }
    let m;
    if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) { flush(); closeLists(); const tag = m[1].length <= 2 ? "h2" : "h3"; html += `<${tag}>${inlineMd(m[2])}</${tag}>`; continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); closeLists(); continue; }
    if ((m = /^\s{0,3}>\s?(.*)$/.exec(line))) { flush(); closeLists(); if (m[1].trim()) html += `<blockquote>${inlineMd(m[1])}</blockquote>`; continue; }
    if ((m = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line))) {
      flush();
      const indent = m[1].length, type = /\d/.test(m[2]) ? "ol" : "ul";
      while (stack.length && indent < stack[stack.length - 1].indent) html += `</li></${stack.pop().type}>`;
      const top = stack[stack.length - 1];
      if (top && indent === top.indent && type !== top.type) html += `</li></${stack.pop().type}>`;
      const t2 = stack[stack.length - 1];
      if (!t2 || indent > t2.indent) { html += `<${type}>`; stack.push({ type, indent }); }
      else html += "</li>";
      html += `<li>${inlineMd(m[3])}`;
      continue;
    }
    closeLists();
    para.push(line.trim());
  }
  flush(); closeLists();
  return html;
}

/* ---------- Заметки: доступ и вывод ---------- */
function myGroupIds(userId) { return $app.findRecordsByFilter("group_members", "user = {:u}", "", 0, 0, { u: userId }).map((m) => m.getString("group")); }
function noteVisible(n, userId) {
  if (n.getString("owner") === userId) return true;
  const g = n.getString("group");
  return !!(g && G().isMember($app, g, userId));
}
function placeOf(n) { return n.getString("place") || (n.getInt("page") ? "с. " + n.getInt("page") : ""); }
function userName(id, cache) {
  if (cache && cache[id] !== undefined) return cache[id];
  let name = "Без имени";
  try { name = $app.findRecordById("users", id).getString("name").trim() || "Без имени"; } catch (_) { name = "Удалённый пользователь"; }
  if (cache) cache[id] = name;
  return name;
}
function noteLine(n, opts) {
  opts = opts || {};
  const kind = n.getString("kind");
  const head = [KIND[kind] || "Заметка"];
  if (kind === "highlight") head[0] += ", " + (COLORS[n.getString("color")] || "жёлтая");
  if (opts.author) head.push(opts.author);
  if (kind !== "highlight" && n.getString("title")) head.push(`«${n.getString("title")}»`);
  const meta = [];
  if (!opts.noBook && (n.getString("book") || n.getString("book_title"))) meta.push(`книга «${n.getString("book_title")}»` + (n.getString("book") ? ` (id: ${n.getString("book")})` : " (книга удалена)"));
  const pl2 = placeOf(n);
  if (pl2) meta.push(pl2);
  meta.push((kind === "highlight" ? "сохранена " : "изменено ") + day(kind === "highlight" ? n.getString("created") : n.getString("updated")));
  if (n.getBool("shared")) meta.push("видна всем читателям");
  if (n.getString("group") && !opts.author) meta.push("видно группе");
  if (n.getString("ai")) meta.push("создано " + n.getString("ai"));
  let out = `• ${head.join(" · ")} (id: ${n.id})\n  ${meta.join(" · ")}`;
  if (kind === "highlight") {
    out += `\n  «${n.getString("quote").slice(0, opts.full ? 20000 : 1500)}»`;
    if (n.getString("body_text")) out += `\n  Мысль: ${n.getString("body_text").slice(0, opts.full ? 20000 : 1000)}`;
  } else if (n.getString("body_text")) {
    const t = n.getString("body_text").replace(/\s+/g, " ");
    out += `\n  ${opts.full ? t : t.slice(0, 300) + (t.length > 300 ? "…" : "")}`;
  }
  if (kind === "lesson") {
    const fl = $app.findRecordsByFilter("note_files", "note = {:n}", "sort,created", 0, 0, { n: n.id }).map((x) => x.getString("name"));
    if (fl.length) out += `\n  Файлы: ${fl.join(", ")}`;
  }
  return out;
}
function commentsText(n, groupId, cache) {
  const list = $app.findRecordsByFilter("note_comments", "note = {:n} && group = {:g}", "created", 0, 0, { n: n.id, g: groupId });
  if (!list.length) return "";
  return "\n  Комментарии:" + list.map((c) => {
    const u = c.getString("user");
    const who = G().isMember($app, groupId, u) ? userName(u, cache) : "Бывший участник";
    return `\n   – ${who}, ${day(c.getString("created"))}${c.getBool("edited") ? " (изменено)" : ""}: ${c.getString("text")}`;
  }).join("");
}

/* ---------- Инструменты ---------- */
const H = {};

H.search_books = (a, ctx) => {
  const limit = Math.min(50, Math.max(1, intArg(a.limit) || 20));
  const q = L().norm(a.query || "");
  let list;
  const inShelf = a.shelf_id ? shelfBooks(s(a.shelf_id), ctx.user.id) : null;
  if (q) {
    const words = q.split(" ").filter(Boolean).slice(0, 8);
    const params = {};
    const filter = ["pending = false"].concat(words.map((w, i) => { params["w" + i] = w; return `search ~ {:w${i}}`; })).join(" && ");
    list = $app.findRecordsByFilter("books", filter, "title", inShelf ? 2000 : limit + 1, 0, params);
    if (inShelf) list = list.filter((b) => inShelf.indexOf(b.id) >= 0);
    const exact = book(q.trim(), false);
    if (exact && !list.some((b) => b.id === exact.id)) list.unshift(exact);
  } else if (inShelf) {
    list = $app.findRecordsByIds("books", inShelf).filter((b) => !b.getBool("pending")).sort((x, y) => s(y.getString("created")).localeCompare(x.getString("created")));
  } else {
    list = $app.findRecordsByFilter("books", "pending = false", "-created", limit + 1, 0);
  }
  const more = list.length > limit;
  list = list.slice(0, limit);
  if (!list.length) return { text: q ? `По запросу «${a.query}» книг не нашлось. Попробуйте другое слово или search_in_books, чтобы искать в тексте.` : "Книг не нашлось.", log: { note: s(a.query) } };
  const head = q ? `Книги по запросу «${a.query}»` : "Недавно добавленные книги";
  return {
    text: `${head}${a.shelf_id ? " на полке" : ""}: ${list.length}${more ? " (показаны первые, уточните запрос)" : ""}.\n\n` + list.map((b, i) => bookBrief(b, ctx.user.id, i + 1)).join("\n") +
      "\n\nПодробнее о книге: get_book(book_id). Текст: read_book(book_id).",
    log: { note: s(a.query).slice(0, 200) },
  };
};

H.list_shelves = (a, ctx) => {
  const all = visibleShelves(ctx.user.id);
  const counts = {};
  const list = arrayOf(new DynamicModel({ shelf: "", n: 0 }));
  $app.db().newQuery("SELECT sb.shelf AS shelf, COUNT(*) AS n FROM shelf_books sb JOIN books b ON b.id = sb.book WHERE b.pending = FALSE GROUP BY sb.shelf").all(list);
  for (const r of list) counts[r.shelf] = r.n;
  const tree = (common) => {
    const out = [];
    const walk = (parent, depth) => {
      for (const x of all.filter((y) => y.getBool("common") === common && y.getString("parent") === parent && (common || y.getString("owner") === ctx.user.id))) {
        out.push(`${"  ".repeat(depth)}- ${x.getString("name")} (id: ${x.id}) · ${pl(counts[x.id] || 0, "книга", "книги", "книг")}`);
        walk(x.id, depth + 1);
      }
    };
    walk("", 0);
    return out.length ? out.join("\n") : "  (нет)";
  };
  return { text: `Общие полки:\n${tree(true)}\n\nМои полки:\n${tree(false)}\n\nКниги полки: search_books(shelf_id). Поиск в тексте на полке: search_in_books(query, shelf_id).` };
};

H.get_book = (a, ctx) => {
  const b = book(a.book_id);
  const list = files(b);
  const u = ctx.user.id;
  const out = [`«${b.getString("title")}» (id: ${b.id})`];
  const authors = authorNames(b);
  if (authors.length) out.push("Авторы: " + authors.join(", "));
  if (b.getInt("year")) out.push("Год: " + b.getInt("year"));
  out.push("Добавлена в библиотеку: " + day(b.getString("created")));
  // правки 4.1: скрытую книгу видит только владелец библиотеки
  out.push("Видимость: " + (!b.getBool("hidden") ? "видна всем читателям"
    : L().bookReaders(b.id).length ? hiddenText(b) + " (остальным читателям не видна)" : "скрыта от читателей (видна только владельцу библиотеки)"));
  out.push("Ссылка в приложении: " + appLink(ctx, "/b/" + b.id));
  if (b.getString("description")) out.push("Описание: " + L().plainText(b.getString("description")).slice(0, 4000));
  out.push("\nФорматы:\n" + (list.map((f) => "- " + fileLine(f, b)).join("\n") || "- нет"));
  out.push("Текст: " + textState(b, list));
  const sh = shelfNames(b.id, u);
  out.push("Полки: " + (sh.length ? sh.join(", ") : "не стоит на полках"));
  const mk = markOf(b.id, u);
  out.push("Отметка: " + (mk || "нет"));
  const rd = $app.findRecordsByFilter("reading", "user = {:u} && book = {:b}", "-updated", 0, 0, { u, b: b.id });
  out.push("Где я остановился: " + (rd.length ? rd.map((r) => {
    const f = r.getString("format");
    return F().VIEW[f] === "epub" ? `${fmtName(f)} ${r.getFloat("pct")}% (${day(r.getString("updated"))})` : `${fmtName(f)} с. ${r.getInt("page")} из ${r.getInt("pages")} (${day(r.getString("updated"))})`;
  }).join("; ") : "книгу ещё не открывал"));
  const tracks = A().tracksOf(b.id, true);
  if (tracks.length) {
    if (b.getString("audio_note")) out.push("\nОписание аудио: " + b.getString("audio_note"));
    out.push((b.getString("audio_note") ? "" : "\n") + "Аудио (главы по порядку, звук помощнику не передаётся):\n" + tracks.map((t, i) =>
      `- ${i + 1}. ${t.getString("title")} · ${A().durText(t.getFloat("duration"))}${t.getBool("published") ? "" : " · черновик"}`).join("\n"));
  }
  const cnt = (k) => $app.countRecords("notes", $dbx.hashExp({ owner: u, book: b.id, kind: k }));
  out.push(`Мои записи по книге: заметок ${cnt("note")}, уроков ${cnt("lesson")}, цитат ${cnt("highlight")} (список: list_notes(book_id)).`);
  // оглавление
  const main = list.find((f) => f.id === b.getString("text_file"));
  const pdf = (main && isPdfView(main) ? main : null) || list.find((f) => f.getString("format") === "pdf" && ready(f));
  if (pdf && pdf.getString("format") === "pdf") {
    const st = pdfStruct(pdf);
    if (st.outlines.length) {
      out.push("\nОглавление (закладки PDF, номера страниц файла):\n" + st.outlines.slice(0, 300).map((o) => `${"  ".repeat(o.depth)}- ${o.title}${o.page ? " · с. " + o.page : ""}`).join("\n") +
        (st.outlines.length > 300 ? "\n  …" : ""));
    }
  }
  let t = null;
  try { t = textFileOf(b, ""); } catch (_) {}
  if (t) {
    const ps = parts(t.text);
    if (ps.length && !ps[0].page) {
      out.push(`\nРазделы (${fmtName(t.f.getString("format"))}, номера для read_book):\n` + ps.slice(0, 300).map((p) => `- ${p.n}${p.title ? ": " + p.title : ""} (${pl(body(t.text, p).length, "знак", "знака", "знаков")})`).join("\n"));
    } else if (ps.length) {
      const pn = pageNumbering(t.f, t.text, ps);
      if (pn.note) out.push("\n" + pn.note);
      out.push(`\nЧитать: read_book(book_id="${b.id}", from=1). Текст ${fmtName(t.f.getString("format"))}, ${pl(ps.length, "страница", "страницы", "страниц")}.`);
    }
  }
  return { text: out.join("\n"), log: { book: b.id, title: b.getString("title") } };
};

H.read_book = (a, ctx) => {
  const b = book(a.book_id);
  const t = textFileOf(b, a.format ? s(a.format) : "");
  const ps = parts(t.text);
  if (!ps.length) fail("Текст книги пустой.");
  const max = M().CFG.maxChars();
  const isPage = ps[0].page;
  const last = ps[ps.length - 1].n;
  let from = Math.max(1, intArg(a.from) || 1);
  const to = intArg(a.to) ? Math.max(from, intArg(a.to)) : 0;
  if (from > last) fail(`В книге ${isPage ? pl(last, "страница", "страницы", "страниц") : pl(last, "раздел", "раздела", "разделов")}. Начните с меньшего номера.`);
  const pn = isPage ? pageNumbering(t.f, t.text, ps) : { note: "", label: () => "" };
  let offset = Math.max(0, intArg(a.offset));
  let out = "", used = 0, lastShown = 0, cont = null, empty = 0;
  for (const p of ps) {
    if (p.n < from) continue;
    if (to && p.n > to) break;
    let txt = body(t.text, p);
    if (offset) { txt = txt.slice(offset); }
    const lbl = isPage ? pn.label(p.n) : "";
    const head = isPage ? `=== Страница ${p.n}${lbl ? ` (в книге: ${lbl})` : ""} ===` : `=== Раздел ${p.n}${p.title ? ": " + p.title : ""} ===`;
    if (!txt.trim()) { empty++; txt = isPage ? "[на странице нет текста]" : "[раздел без текста]"; }
    const room = max - used - head.length - 2;
    if (txt.length > room) {
      if (used > 0 && room < 2000) { cont = { from: p.n, offset: offset }; break; }
      // часть страницы или раздела: режем по абзацу
      let cut = txt.lastIndexOf("\n", room);
      if (cut < room * 0.6) cut = txt.lastIndexOf(" ", room);
      if (cut < room * 0.5) cut = room;
      out += `${head}${offset ? " (продолжение)" : ""}\n${txt.slice(0, cut).trim()}\n\n`;
      cont = { from: p.n, offset: offset + cut };
      lastShown = p.n;
      break;
    }
    out += `${head}${offset ? " (продолжение)" : ""}\n${txt}\n\n`;
    used += head.length + txt.length + 2;
    offset = 0;
    lastShown = p.n;
  }
  if (!cont && lastShown < (to || last)) {
    const next = ps.find((p) => p.n > lastShown);
    if (next) cont = { from: next.n, offset: 0 };
  }
  const unit = isPage ? "страницы" : "разделы";
  const gen = (n, one, many) => n + " " + (n % 10 === 1 && n % 100 !== 11 ? one : many); // «из 21 страницы», «из 6 страниц»
  const total = isPage ? gen(last, "страницы", "страниц") : gen(last, "раздела", "разделов");
  let head = `«${b.getString("title")}» (id: ${b.id}), ${fmtName(t.f.getString("format"))}${t.f.getBool("ocr") ? ", текст распознан автоматически (возможны ошибки)" : ""}. ` +
    `Показаны ${unit} ${from}–${lastShown || from} из ${total}.`;
  if (pn.note) head += "\n" + pn.note;
  if (isPage && empty && empty === (lastShown - from + 1)) head += "\nНа этих страницах нет текста: возможно, это картинки или скан.";
  let tail = "";
  if (cont) tail = `\nПродолжение: read_book(book_id="${b.id}", from=${cont.from}${cont.offset ? ", offset=" + cont.offset : ""}${to ? ", to=" + to : ""})`;
  return { text: head + "\n\n" + out.trim() + "\n" + tail, log: { book: b.id, title: b.getString("title"), note: `${unit} ${from}–${lastShown || from}` } };
};

// Поиск по тексту одной книги: позиции совпадений (без учёта регистра и ё/е, слова фразы через любые пробелы)
function lowerSame(text) {
  const low = text.toLowerCase().replace(/ё/g, "е");
  if (low.length === text.length) return low;
  let out = "";
  for (let i = 0; i < text.length; i++) { const c = text[i].toLowerCase(); out += c.length === 1 ? (c === "ё" ? "е" : c) : text[i]; }
  return out;
}
function phraseRe(q) {
  const words = L().norm(q).split(" ").filter(Boolean).slice(0, 12);
  if (!words.length) return null;
  return new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\u00ad-]+"), "g");
}
function excerpt(text, i, len) {
  const a = Math.max(0, i - 140), b = Math.min(text.length, i + len + 160);
  let x = text.slice(a, b).replace(/^=== .* ===$/gm, " ").replace(/\s+/g, " ").trim();
  if (a > 0) x = "…" + x.replace(/^\S*\s/, "");
  if (b < text.length) x = x.replace(/\s\S*$/, "") + "…";
  return x;
}
function findIn(text, re, maxHits) {
  const low = lowerSame(text);
  const ps = parts(text);
  const hits = [];
  let m, total = 0;
  re.lastIndex = 0;
  while ((m = re.exec(low))) {
    total++;
    if (hits.length < maxHits) {
      let p = null;
      for (let lo = 0, hi = ps.length - 1; lo <= hi;) { const mid = (lo + hi) >> 1; if (ps[mid].head <= m.index) { p = ps[mid]; lo = mid + 1; } else hi = mid - 1; }
      hits.push({ p, text: excerpt(text, m.index, m[0].length) });
    }
    if (m[0].length === 0) re.lastIndex++;
  }
  return { hits, total };
}
const placeName = (p) => !p ? "" : p.page ? `с. ${p.n}` : `раздел ${p.n}${p.title ? " «" + p.title + "»" : ""}`;

H.search_in_books = (a, ctx) => {
  const re = phraseRe(a.query || "");
  if (!re) fail("Напишите слово или фразу для поиска.");
  let books;
  if (a.book_id) books = [book(a.book_id)];
  else if (a.shelf_id) books = $app.findRecordsByIds("books", shelfBooks(s(a.shelf_id), ctx.user.id)).filter((b) => !b.getBool("pending") && b.getString("text_file"));
  else books = $app.findRecordsByFilter("books", "pending = false && text_file != ''", "title", 0, 0);
  const one = books.length === 1;
  const t0 = Date.now();
  const out = [];
  let shown = 0, stopped = false, searched = 0, booksHit = 0;
  for (const b of books) {
    if (shown >= 50) { stopped = "limit"; break; }
    if (Date.now() - t0 > 20000) { stopped = "time"; break; }
    let t = null;
    try { t = textFileOf(b, ""); } catch (err) { if (one) throw err; continue; }
    searched++;
    const r = findIn(t.text, re, one ? 50 : Math.min(5, 50 - shown));
    if (!r.total) continue;
    booksHit++;
    out.push(`«${b.getString("title")}» (id: ${b.id}), ${fmtName(t.f.getString("format"))}: ${pl(r.total, "совпадение", "совпадения", "совпадений")}` +
      (r.total > r.hits.length ? ` (показаны ${r.hits.length})` : ""));
    for (const h of r.hits) { out.push(`  ${++shown}. ${placeName(h.p)}: «${h.text}»`); }
  }
  let text = out.length ? `Поиск «${a.query}»: найдено в ${pl(booksHit, "книге", "книгах", "книгах")} (просмотрено ${searched}).\n\n` + out.join("\n")
    : `«${a.query}» в тексте ${one ? "этой книги" : `${pl(searched, "книги", "книг", "книг")}`} не нашлось.` + (searched < books.length ? " У части книг нет текста (сканы)." : "");
  if (stopped === "time") text += `\n\nПоиск прерван через 20 секунд (просмотрено ${searched} из ${books.length} книг), уточните книгу или полку.`;
  else if (stopped === "limit") text += "\n\nПоказаны первые 50 совпадений, уточните запрос, книгу или полку.";
  if (out.length) text += "\n\nПрочитать место: read_book(book_id, from=страница или раздел).";
  return { text, log: { book: one ? books[0].id : "", title: one ? books[0].getString("title") : "", note: s(a.query).slice(0, 200) } };
};

H.list_notes = (a, ctx) => {
  const limit = Math.min(100, Math.max(1, intArg(a.limit) || 30));
  const params = { u: ctx.user.id };
  const f = ["owner = {:u}", NOT_PENDING];
  let b = null;
  if (a.book_id) { b = book(a.book_id, false); params.b = s(a.book_id); f.push("book = {:b}"); }
  if (a.kind) { if (!KIND[a.kind]) fail("kind: note, lesson или highlight."); params.k = s(a.kind); f.push("kind = {:k}"); }
  L().norm(a.query || "").split(" ").filter(Boolean).slice(0, 8).forEach((w, i) => { params["w" + i] = w; f.push(`search ~ {:w${i}}`); });
  const list = $app.findRecordsByFilter("notes", f.join(" && "), "-updated", limit + 1, 0, params);
  const more = list.length > limit;
  if (!list.length) return { text: "Записей не нашлось." + (a.query ? " Попробуйте другие слова." : ""), log: { book: b ? b.id : "", title: b ? b.getString("title") : "" } };
  return {
    text: `Мои записи${b ? ` по книге «${b.getString("title")}»` : ""}${a.query ? ` по запросу «${a.query}»` : ""}: ${list.slice(0, limit).length}${more ? " (есть ещё, увеличьте limit или уточните)" : ""}.\n\n` +
      list.slice(0, limit).map((n) => noteLine(n, { noBook: !!b })).join("\n\n") + "\n\nПолный текст: get_note(note_id).",
    log: { book: b ? b.id : "", title: b ? b.getString("title") : "", note: s(a.query).slice(0, 200) },
  };
};

function noteRec(nid, userId) {
  let n = null;
  try { n = $app.findRecordById("notes", s(nid).trim()); } catch (_) {}
  if (!n || !noteVisible(n, userId) || (n.getString("book") && !book(n.getString("book"), false) && bookExists(n.getString("book")))) fail(`Заметка с id «${nid}» не найдена.`);
  return n;
}
function noteMarkdown(n, ctx) {
  const kind = n.getString("kind");
  const own = n.getString("owner") === ctx.user.id;
  const out = [];
  out.push(kind === "highlight" ? `# Цитата (${COLORS[n.getString("color")] || "жёлтая"})` : `# ${n.getString("title") || "Без заголовка"}`);
  const meta = [`${KIND[kind] || "Заметка"}, id: ${n.id}`];
  if (!own) meta.push("автор: " + userName(n.getString("owner")));
  if (n.getString("book")) meta.push(`книга «${n.getString("book_title")}» (id: ${n.getString("book")})`);
  else if (n.getString("book_title")) meta.push(`книга «${n.getString("book_title")}» (удалена)`);
  if (placeOf(n)) meta.push(placeOf(n));
  meta.push("создана " + day(n.getString("created")), "изменена " + day(n.getString("updated")));
  if (n.getBool("shared")) meta.push("видна всем читателям");
  if (n.getString("group")) { let g = null; try { g = $app.findRecordById("groups", n.getString("group")); } catch (_) {} meta.push("видно группе" + (g ? ` «${g.getString("name")}»` : "")); }
  if (n.getString("ai")) meta.push("создано " + n.getString("ai"));
  meta.push("ссылка: " + appLink(ctx, "/note/" + n.id));
  out.push("_" + meta.join(" · ") + "_");
  if (kind === "highlight") {
    out.push(n.getString("quote").split("\n").map((x) => "> " + x).join("\n"));
    const t = htmlToMd(n.getString("body"));
    if (t) out.push("Мысль: " + t);
  } else {
    if (n.getString("quote")) out.push(n.getString("quote").split("\n").map((x) => "> " + x).join("\n"));
    out.push(htmlToMd(n.getString("body")) || "(текста нет)");
  }
  if (kind === "lesson") {
    const fl = $app.findRecordsByFilter("note_files", "note = {:n}", "sort,created", 0, 0, { n: n.id });
    if (fl.length) out.push("Прикреплённые файлы: " + fl.map((x) => `${x.getString("name")} (${mb(x.getInt("size"))})`).join(", "));
  }
  if (n.getString("group") && G().isMember($app, n.getString("group"), ctx.user.id)) {
    const c = commentsText(n, n.getString("group"), {});
    if (c) out.push(c.trim());
  }
  return out.join("\n\n");
}
H.get_note = (a, ctx) => {
  const n = noteRec(a.note_id, ctx.user.id);
  return { text: noteMarkdown(n, ctx), log: { book: n.getString("book"), title: n.getString("book_title"), note: (n.getString("title") || n.getString("kind")).slice(0, 200) } };
};

H.list_groups = (a, ctx) => {
  const gids = myGroupIds(ctx.user.id);
  if (!gids.length) return { text: "Я не состою ни в одной группе чтения." };
  const cache = {};
  const today = new Date().toISOString().slice(0, 10);
  const week = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  const out = [];
  for (const g of $app.findRecordsByIds("groups", gids)) {
    const lines = [`Группа «${g.getString("name")}» (id: ${g.id})`];
    if (g.getString("description")) lines.push("  Описание: " + g.getString("description").slice(0, 500));
    const members = $app.findRecordsByFilter("group_members", "group = {:g}", "created", 0, 0, { g: g.id });
    lines.push("  Участники: " + members.map((m) => userName(m.getString("user"), cache) + (m.getString("user") === g.getString("owner") ? " (создатель)" : "") + (m.getString("user") === ctx.user.id ? " (я)" : "")).join(", "));
    const bid = g.getString("book");
    let cur = null;
    if (bid) { try { cur = $app.findRecordById("books", bid); } catch (_) {} }
    lines.push("  Читает сейчас: " + (cur ? `«${cur.getString("title")}» (id: ${cur.id})` : "книга не выбрана"));
    if (cur) {
      const st = G().groupState($app, g, today, week);
      const read = Object.keys(st.members).filter((u) => st.members[u].today.read).map((u) => {
        const x = st.members[u].today;
        return userName(u, cache) + (x.pages ? ` (${pl(x.pages, "страница", "страницы", "страниц")})` : x.pct ? ` (+${x.pct}%)` : "");
      });
      lines.push("  Сегодня читали: " + (read.length ? read.join(", ") : "пока никто"));
      const wk = Object.keys(st.members).map((u) => `${userName(u, cache)}: ${pl(st.members[u].days.length, "день", "дня", "дней")}`);
      lines.push("  За неделю читали: " + wk.join(", "));
      if (G().CFG.plan()) {
        const gb = G().currentGroupBook($app, g.id);
        const plan = gb ? $app.findRecordsByFilter("group_plan", "gbook = {:b}", "due", 0, 0, { b: gb.id }) : [];
        if (plan.length) lines.push("  План: " + plan.map((p) => (F().VIEW[p.getString("format")] === "pdf" ? `до с. ${p.getInt("page")}` : `до ${p.getFloat("pct")}%${p.getString("chapter") ? " (" + p.getString("chapter") + ")" : ""}`) + ` к ${p.getString("due")}`).join("; "));
      }
    }
    const past = $app.findRecordsByFilter("group_books", "group = {:g} && finished_at != ''", "-finished_at", 0, 0, { g: g.id });
    if (past.length) lines.push("  Прочитанные книги: " + past.map((x) => `«${x.getString("book_title")}»${x.getString("book") ? " (id: " + x.getString("book") + ")" : ""}, ${day(x.getString("started_at"))} – ${day(x.getString("finished_at"))}`).join("; "));
    out.push(lines.join("\n"));
  }
  return { text: out.join("\n\n") + "\n\nЗаметки и цитаты группы: get_group_notes(group_id)." };
};

H.get_group_notes = (a, ctx) => {
  let g = null;
  try { g = G().memberGroup($app, s(a.group_id).trim(), ctx.user.id); } catch (_) { fail(`Группа с id «${a.group_id}» не найдена среди моих групп. Список: list_groups.`); }
  const bid = s(a.book_id || g.getString("book")).trim();
  if (!bid) return { text: `У группы «${g.getString("name")}» сейчас нет книги.` };
  const gb = $app.findRecordsByFilter("group_books", "group = {:g} && book = {:b}", "-started_at", 1, 0, { g: g.id, b: bid });
  if (!gb.length && bid !== g.getString("book")) fail("Эту книгу группа не читала. Список книг группы: list_groups.");
  const title = gb.length ? gb[0].getString("book_title") : (book(bid, false) || { getString: () => "" }).getString("title");
  const list = $app.findRecordsByFilter("notes", "group = {:g} && book = {:b} && kind != 'lesson'", "-created", 300, 0, { g: g.id, b: bid });
  const cache = {};
  const head = `Группа «${g.getString("name")}» (id: ${g.id}), книга «${title}» (id: ${bid})${bid === g.getString("book") ? ", читает сейчас" : ", прочитана раньше"}: ${pl(list.length, "запись", "записи", "записей")}, сначала новые.`;
  if (!list.length) return { text: head + "\n\nУчастники пока ничего не отправили в группу по этой книге.", log: { book: bid, title } };
  const body2 = list.map((n) => noteLine(n, { author: userName(n.getString("owner"), cache), noBook: true, full: true }) + commentsText(n, g.id, cache)).join("\n\n");
  return { text: head + "\n\n" + body2, log: { book: bid, title, note: g.getString("name").slice(0, 200) } };
};

H.create_note = (a, ctx) => {
  const lib = L();
  const since = new Date(Date.now() - 3600e3).toISOString().replace("T", " ");
  if ($app.countRecords("notes", $dbx.exp("ai != '' AND created > {:t}", { t: since })) >= NOTES_PER_HOUR) {
    fail(`За последний час помощники уже создали ${NOTES_PER_HOUR} заметок, это предел. Попробуйте позже.`);
  }
  const title = s(a.title).replace(/\s+/g, " ").trim().slice(0, 300);
  const md = s(a.text);
  if (md.length > 300000) fail("Текст слишком длинный (больше 300 000 знаков). Разделите на несколько заметок.");
  const html = lib.cleanHtml(mdToHtml(md));
  const plain = lib.plainText(html);
  if (!title && !plain) fail("Нужен заголовок или текст заметки.");
  const kind = a.kind === "lesson" ? "lesson" : "note";
  const r = new Record($app.findCollectionByNameOrId("notes"));
  r.set("owner", ctx.user.id);
  r.set("kind", kind);
  r.set("title", title);
  r.set("body", html);
  r.set("body_text", plain.slice(0, 1000000));
  r.set("search", lib.norm(title + " " + plain).slice(0, 1000000));
  r.set("shared", false);
  r.set("ai", ctx.grant.getString("service") || "ИИ-помощник");
  let b = null, warn = "";
  if (a.book_id) {
    b = book(a.book_id);
    r.set("book", b.id);
    r.set("book_title", b.getString("title"));
    const page = intArg(a.page);
    if (page) {
      const list = files(b);
      const main = list.find((f) => f.id === b.getString("text_file"));
      const pf = (main && isPdfView(main) && main.getInt("pages") ? main : null) || list.find((f) => isPdfView(f) && f.getInt("pages") > 0);
      if (!pf) warn = " Страница не указана: у книги нет файла со страницами (PDF или DjVu).";
      else if (page > pf.getInt("pages")) fail(`В книге ${pl(pf.getInt("pages"), "страница", "страницы", "страниц")}, страницы ${page} нет.`);
      else { r.set("page", page); r.set("format", pf.getString("format")); r.set("place", "с. " + page); }
    }
  }
  $app.save(r);
  return {
    text: `${kind === "lesson" ? "Урок" : "Заметка"} сохранена: «${title || "Без заголовка"}» (id: ${r.id})${b ? `, к книге «${b.getString("title")}»` : ""}${r.getInt("page") ? ", с. " + r.getInt("page") : ""}.` +
      ` Видна только владельцу библиотеки, с пометкой «Создано ${r.getString("ai")}».${warn}\nОткрыть в приложении: ${appLink(ctx, "/note/" + r.id)}`,
    log: { book: b ? b.id : "", title: b ? b.getString("title") : "", note: ("новая заметка: " + title).slice(0, 200) },
  };
};

/* ---------- search и fetch для глубокого исследования ChatGPT ---------- */
H.search = (a, ctx) => {
  const q = s(a.query).trim();
  if (!q) fail("Напишите, что искать.");
  const results = [];
  const words = L().norm(q).split(" ").filter(Boolean).slice(0, 8);
  const params = {};
  const wf = words.map((w, i) => { params["w" + i] = w; return `search ~ {:w${i}}`; });
  if (wf.length) {
    for (const b of $app.findRecordsByFilter("books", ["pending = false"].concat(wf).join(" && "), "title", 10, 0, params)) {
      results.push({ id: "book:" + b.id, title: b.getString("title") + (authorNames(b).length ? " · " + authorNames(b).join(", ") : ""), url: appLink(ctx, "/b/" + b.id) });
    }
    params.u = ctx.user.id;
    for (const n of $app.findRecordsByFilter("notes", ["owner = {:u}", NOT_PENDING].concat(wf).join(" && "), "-updated", 10, 0, params)) {
      results.push({ id: "note:" + n.id, title: (KIND[n.getString("kind")] || "Заметка") + ": " + (n.getString("title") || n.getString("quote").slice(0, 80) || "без заголовка") + (n.getString("book_title") ? " · " + n.getString("book_title") : ""), url: appLink(ctx, "/note/" + n.id) });
    }
  }
  // отрывки в тексте книг: до 15, не дольше 8 секунд
  const re = phraseRe(q);
  if (re) {
    const t0 = Date.now();
    let n = 0;
    for (const b of $app.findRecordsByFilter("books", "pending = false && text_file != ''", "title", 0, 0)) {
      if (n >= 15 || Date.now() - t0 > 8000) break;
      let t = null;
      try { t = textFileOf(b, ""); } catch (_) { continue; }
      const r = findIn(t.text, re, Math.min(3, 15 - n));
      for (const h of r.hits) {
        n++;
        const where = h.p ? (h.p.page ? "p" : "s") + h.p.n : "p1";
        results.push({ id: `text:${b.id}:${where}`, title: `«${b.getString("title")}», ${placeName(h.p)}: ${h.text.slice(0, 160)}`, url: appLink(ctx, `/b/${b.id}`) });
      }
    }
  }
  return { text: JSON.stringify({ results }), log: { note: q.slice(0, 200) } };
};
H.fetch = (a, ctx) => {
  const idv = s(a.id).trim();
  let m;
  if ((m = /^book:([a-z0-9]{15})$/.exec(idv))) {
    const b = book(m[1]);
    let text = H.get_book({ book_id: b.id }, ctx).text;
    try { text += "\n\nНачало текста:\n" + H.read_book({ book_id: b.id, from: 1 }, ctx).text.slice(0, 12000); } catch (_) {}
    return { text: JSON.stringify({ id: idv, title: b.getString("title"), text, url: appLink(ctx, "/b/" + b.id), metadata: { authors: authorNames(b).join(", "), year: String(b.getInt("year") || "") } }), log: { book: b.id, title: b.getString("title") } };
  }
  if ((m = /^note:([a-z0-9]{15})$/.exec(idv))) {
    const n = noteRec(m[1], ctx.user.id);
    return { text: JSON.stringify({ id: idv, title: n.getString("title") || KIND[n.getString("kind")] || "Заметка", text: noteMarkdown(n, ctx), url: appLink(ctx, "/note/" + n.id), metadata: { book: n.getString("book_title") } }), log: { book: n.getString("book"), title: n.getString("book_title") } };
  }
  if ((m = /^text:([a-z0-9]{15}):([ps])(\d+)$/.exec(idv))) {
    const b = book(m[1]);
    const n = parseInt(m[3], 10);
    const r = H.read_book(m[2] === "p" ? { book_id: b.id, from: Math.max(1, n - 1), to: n + 1 } : { book_id: b.id, from: n, to: n }, ctx);
    return { text: JSON.stringify({ id: idv, title: `${b.getString("title")}, ${m[2] === "p" ? "с. " + n : "раздел " + n}`, text: r.text, url: appLink(ctx, "/b/" + b.id), metadata: { book_id: b.id } }), log: r.log };
  }
  fail("Неизвестный id. Он должен быть из результатов search: book:…, note:… или text:….");
};

/* ---------- Вызов ---------- */
function call(name, args, ctx) {
  const h = H[name];
  if (!h) return null;
  try {
    const r = h(args && typeof args === "object" ? args : {}, ctx);
    return { result: { content: [{ type: "text", text: r.text }], isError: false }, log: r.log || {} };
  } catch (err) {
    if (err && err.tool) return { result: { content: [{ type: "text", text: err.message }], isError: true }, log: { error: true, note: err.message } };
    $app.logger().error("Ошибка инструмента MCP", "tool", name, "error", String(err));
    return { result: { content: [{ type: "text", text: "На сервере библиотеки произошла ошибка: " + String(err && err.message || err).slice(0, 300) }], isError: true }, log: { error: true, note: String(err).slice(0, 200) } };
  }
}

// Один запрос JSON-RPC. Уведомления (без id) ответа не получают.
function rpc(msg, ctx) {
  const M = require(`${__hooks}/mcp_lib.js`);
  const has = msg && typeof msg === "object" && Object.prototype.hasOwnProperty.call(msg, "id") && msg.id !== null;
  const id = has ? msg.id : null;
  const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return msg && (msg.result !== undefined || msg.error !== undefined) ? null : fail(-32600, "Неверный запрос JSON-RPC.");
  }
  if (!has) return null; // notifications/initialized, notifications/cancelled и прочие уведомления
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const p = msg.params || {};
  switch (msg.method) {
    case "initialize": {
      const asked = String(p.protocolVersion || "");
      return ok({
        protocolVersion: M.PROTOCOLS.indexOf(asked) >= 0 ? asked : M.PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "knigi", title: "Библиотека", version: "4.0.0" },
        instructions: "Домашняя библиотека владельца: книги (PDF, EPUB, DjVu, FB2 и другие), полки, его заметки, уроки и цитаты, группы чтения. " +
          "Найдите книгу через search_books, узнайте оглавление через get_book, читайте текст через read_book (страницы у PDF, разделы у EPUB), " +
          "ищите слова в тексте через search_in_books. Заметки: list_notes и get_note, группы: list_groups и get_group_notes. " +
          "Новую заметку (например конспект) сохраняет create_note. Отвечайте по-русски, указывайте книгу и страницу.",
      });
    }
    case "ping": return ok({});
    case "tools/list": return ok({ tools: TOOLS });
    case "tools/call": {
      const name = String(p.name || "");
      const r = call(name, p.arguments || {}, ctx);
      if (!r) return fail(-32602, "Неизвестный инструмент: " + name);
      M.writeLog(ctx.grant, name, r.log);
      return ok(r.result);
    }
    case "resources/list": return ok({ resources: [] });
    case "resources/templates/list": return ok({ resourceTemplates: [] });
    case "prompts/list": return ok({ prompts: [] });
    default: return fail(-32601, "Метод не поддерживается: " + msg.method);
  }
}


module.exports = { TOOLS, call, rpc, mdToHtml, htmlToMd, pageLabel, guessOffset, parts };
