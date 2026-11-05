// Правки 3.1: перевод новых форматов в формат читалки и распознавание текста в сканах.
// Тяжёлую работу делает tools/knigi_convert.py (Python): DjVu → PDF, FB2/MOBI/AZW3/TXT → EPUB,
// распознавание (ocrmypdf + tesseract). Все запуски с пониженным приоритетом (nice 19, ionice idle).
// Подключается в обработчиках через require(`${__hooks}/convert_lib.js`).

// Формат файла → какая читалка его открывает (такая же таблица VIEW в app.js)
const VIEW = { pdf: "pdf", djvu: "pdf", epub: "epub", fb2: "epub", mobi: "epub", azw3: "epub", txt: "epub" };
const FORMATS = Object.keys(VIEW);
const FMT_NAME = { pdf: "PDF", epub: "EPUB", djvu: "DjVu", fb2: "FB2", mobi: "MOBI", azw3: "AZW3", txt: "TXT" };

// Имя файла → формат и расширение оригинала на диске. .fb2.zip хранится как .fbz (это тот же zip с FB2).
function fmtOfName(name) {
  const n = String(name || "").toLowerCase();
  if (/\.fb2\.zip$/.test(n) || /\.fbz$/.test(n)) return { fmt: "fb2", ext: "fbz" };
  const m = /\.([a-z0-9]{1,8})$/.exec(n);
  const x = m ? m[1] : "";
  if (x === "djv" || x === "djvu") return { fmt: "djvu", ext: "djvu" };
  if (VIEW[x]) return { fmt: x, ext: x };
  return { fmt: "", ext: x };
}

function toolPath() { return $filepath.join(__hooks, "..", "tools", "knigi_convert.py"); }
// Python: из /opt/knigi/venv (там модуль mobi, ставит update.sh), иначе системный
function python() {
  const venv = $os.getenv("KNIGI_VENV") || $filepath.join($app.dataDir(), "..", "venv");
  const p = $filepath.join(venv, "bin", "python3");
  try { if ($os.stat(p).size() > 0) return p; } catch (_) {}
  return "/usr/bin/python3";
}
function hasCmd(name) {
  try { $os.cmd("sh", "-c", 'command -v "$1" >/dev/null', "sh", name).run(); return true; } catch (_) { return false; }
}

// Запустить программу перевода и дождаться ответа (одна строка JSON). Ошибка с понятным текстом.
function runTool(args, timeoutSec) {
  const nice = hasCmd("ionice") ? ["nice", "-n", "19", "ionice", "-c", "3"] : ["nice", "-n", "19"];
  let out = "";
  try {
    out = toString($os.cmd("timeout", String(timeoutSec || 3600), ...nice, python(), toolPath(), ...args).output());
  } catch (err) {
    const s = String(err);
    if (/exit status 124/.test(s)) throw new Error("перевод занял слишком много времени и остановлен");
    throw new Error("программа перевода остановилась (" + s.slice(0, 150) + ")");
  }
  const line = out.trim().split("\n").pop() || "";
  let res = null;
  try { res = JSON.parse(line); } catch (_) {}
  if (!res) throw new Error("программа перевода вернула непонятный ответ");
  return res;
}

// Защищён ли файл Kindle (проверка при загрузке, файл ещё не стал книгой)
function kindleDrm(path) {
  try {
    const r = runTool(["drm", path], 60);
    return !!r.drm;
  } catch (_) { return false; }
}

function workDir(name) {
  const F = require(`${__hooks}/files_lib.js`);
  return $filepath.join(F.booksDir(), ".work", name);
}

// Перевести оригинал src (формат fmt) в файл читалки dst. opts: title, author (для TXT). Возвращает ответ программы.
function convert(fmt, src, dst, id, opts) {
  const work = workDir(id);
  try { $os.removeAll(work); } catch (_) {}
  $os.mkdirAll(work, 0o750);
  try {
    let res;
    if (fmt === "djvu") res = runTool(["djvu", src, dst, "--work", work], 4 * 3600);
    else if (fmt === "fb2") res = runTool(["fb2", src, dst], 1800);
    else if (fmt === "mobi" || fmt === "azw3") res = runTool(["mobi", src, dst, "--work", work], 1800);
    else if (fmt === "txt") res = runTool(["txt", src, dst, "--title", (opts && opts.title) || "Без названия", "--author", (opts && opts.author) || ""], 1800);
    else throw new Error("неизвестный формат " + fmt);
    if (res.error) throw new Error(res.error);
    return res;
  } finally {
    try { $os.removeAll(work); } catch (_) {}
  }
}

/* ======================================================================================
   Распознавание текста (OCR)
   Очередь в ocr_jobs. Работает отдельный процесс (setsid), сервер раз в минуту смотрит, как идут
   дела: читает ход работы, по окончании подменяет файл книги, после перезапуска сервера
   запускает прерванное распознавание снова (готовые куски по 10 страниц не пересчитываются).
   ====================================================================================== */
const OCR_DEFAULT_SEC = 10; // сколько секунд на страницу, пока нет своих замеров
function ocrLangs() { return String($os.getenv("OCR_LANGS") || "rus+eng").replace(/[^a-z_+]/g, "") || "rus+eng"; }
function ocrAvailable() { return hasCmd("ocrmypdf") && hasCmd("tesseract"); }
function ocrDir(jobId) {
  const F = require(`${__hooks}/files_lib.js`);
  return $filepath.join(F.booksDir(), ".ocr", jobId);
}
function readJson(path) {
  try { return JSON.parse(toString($os.readFile(path))); } catch (_) { return null; }
}
const now = () => new Date().toISOString().replace("T", " ");

// Сканы книги: файлы для читалки PDF (PDF и DjVu), готовые, без текста
function scanFiles(bookId) {
  const F = require(`${__hooks}/files_lib.js`);
  return F.filesOf(bookId).filter((f) => VIEW[f.getString("format")] === "pdf" && f.getString("status") === "ready" && !f.getBool("has_text"));
}
function activeJob(fileId) {
  const list = $app.findRecordsByFilter("ocr_jobs", "file = {:f} && (status = 'queued' || status = 'running')", "", 1, 0, { f: fileId });
  return list.length ? list[0] : null;
}
function addJob(book, f) {
  if (activeJob(f.id)) return 0;
  const j = new Record($app.findCollectionByNameOrId("ocr_jobs"));
  j.set("book", book.id);
  j.set("file", f.id);
  j.set("book_title", book.getString("title"));
  j.set("status", "queued");
  j.set("pages", f.getInt("pages"));
  j.set("done_pages", 0);
  j.set("attempts", 0);
  $app.save(j);
  return 1;
}
function ocrBook(book) {
  if (!ocrAvailable()) throw new BadRequestError("На сервере не установлена программа распознавания. Запустите обновление приложения (update.sh).");
  const list = scanFiles(book.id);
  if (!list.length) throw new BadRequestError("В этой книге нет скана без текста.");
  let n = 0;
  for (const f of list) n += addJob(book, f);
  if (!n) throw new BadRequestError("Эта книга уже в очереди на распознавание.");
  return n;
}
// Все сканы библиотеки, которых ещё нет в очереди (книги на проверке не трогаем)
function allScans() {
  const res = [];
  const rows = $app.findRecordsByFilter("book_files", "status = 'ready' && has_text = false && (format = 'pdf' || format = 'djvu')", "created", 0, 0);
  for (const f of rows) {
    if (activeJob(f.id)) continue;
    let b = null;
    try { b = $app.findRecordById("books", f.getString("book")); } catch (_) {}
    if (!b || b.getBool("pending")) continue;
    res.push({ b, f });
  }
  return res;
}
function ocrAll() {
  if (!ocrAvailable()) throw new BadRequestError("На сервере не установлена программа распознавания. Запустите обновление приложения (update.sh).");
  let n = 0;
  for (const x of allScans()) n += addJob(x.b, x.f);
  return n;
}
// Средняя скорость по последним готовым книгам
function secPerPage() {
  const done = $app.findRecordsByFilter("ocr_jobs", "status = 'done' && sec_page > 0", "-finished_at", 10, 0);
  let pages = 0, secs = 0;
  for (const j of done) { pages += j.getInt("pages"); secs += j.getInt("pages") * j.getFloat("sec_page"); }
  return pages ? Math.round(secs / pages * 10) / 10 : OCR_DEFAULT_SEC;
}

// Жив ли процесс распознавания этого задания
function workerPid(job) {
  const raw = (() => { try { return toString($os.readFile($filepath.join(ocrDir(job.id), "pid"))).trim(); } catch (_) { return ""; } })();
  const pid = parseInt(raw, 10);
  if (!pid) return 0;
  try {
    const cmdline = toString($os.readFile(`/proc/${pid}/cmdline`));
    return cmdline.indexOf(job.id) >= 0 ? pid : 0; // номер процесса мог достаться другой программе
  } catch (_) { return 0; }
}
function signalGroup(pid, sig) {
  if (!pid) return;
  try { $os.cmd("kill", "-" + sig, "--", "-" + pid).run(); } catch (_) {}
}
// Пока сервер переводит новую книгу, распознавание стоит на паузе: тяжёлая работа идёт по одной
function ocrPause(on) {
  for (const j of $app.findRecordsByFilter("ocr_jobs", "status = 'running'", "", 5, 0)) {
    const pid = workerPid(j);
    if (pid) signalGroup(pid, on ? "STOP" : "CONT");
  }
}
function procBusy() {
  const t = $app.store().get("kn_proc");
  return !!t && Date.now() - t < 6 * 3600e3;
}

function spawn(job) {
  const F = require(`${__hooks}/files_lib.js`);
  const f = $app.findRecordById("book_files", job.getString("file"));
  const src = $filepath.join(F.booksDir(), f.getString("file"));
  if (!F.exists(src)) throw new Error("файл книги не найден на диске");
  const work = ocrDir(job.id);
  $os.mkdirAll(work, 0o750);
  try { $os.remove($filepath.join(work, "pid")); } catch (_) {}
  // отдельный сеанс (setsid): сервер не ждёт окончания; при остановке службы systemd останавливает и его
  const script = 'cd "$1" && exec env TMPDIR="$1" OMP_THREAD_LIMIT=1 nice -n 19 ' + (hasCmd("ionice") ? "ionice -c 3 " : "") +
    '"$2" "$3" ocr "$4" "$1/out.pdf" --work "$1" --langs "$5" >>"$1/log" 2>&1 </dev/null';
  $os.cmd("setsid", "-f", "sh", "-c", script, "sh", work, python(), toolPath(), src, ocrLangs()).run();
  $app.store().set("kn_ocr_spawn:" + job.id, Date.now());
  const r = $app.findRecordById("ocr_jobs", job.id);
  r.set("status", "running");
  if (!r.getString("started_at")) r.set("started_at", now());
  r.set("attempts", r.getInt("attempts") + 1);
  r.set("error", "");
  $app.save(r);
}
function cleanup(jobId) {
  try { $os.removeAll(ocrDir(jobId)); } catch (_) {}
  $app.store().remove("kn_ocr_spawn:" + jobId);
}
function failJob(job, msg) {
  const r = $app.findRecordById("ocr_jobs", job.id);
  r.set("status", "error");
  r.set("error", String(msg || "Неизвестная ошибка").slice(0, 1000));
  r.set("finished_at", now());
  $app.save(r);
  cleanup(job.id);
}

// Распознанный файл подменяет файл книги. Если что-то не так, книга остаётся как была.
function finalize(job, res) {
  const F = require(`${__hooks}/files_lib.js`);
  let f = null;
  try { f = $app.findRecordById("book_files", job.getString("file")); } catch (_) {}
  if (!f) { failJob(job, "Файл книги убрали, пока шло распознавание."); return; }
  const out = $filepath.join(ocrDir(job.id), "out.pdf");
  const path = $filepath.join(F.booksDir(), f.getString("file"));
  const pages = f.getInt("pages");
  const info = F.pdfInfo(out);
  if (!info.pages || (pages && info.pages !== pages)) { failJob(job, "Распознанный файл не совпал с книгой по числу страниц. Книга оставлена как была."); return; }
  const tmp = path + ".ocr";
  $os.rename(out, tmp);
  try {
    F.optimizePdf(tmp, info.pages);
    const tx = F.pdfText(tmp, f.id, info.pages);
    $os.rename(tmp, path);
    const hasText = info.pages > 0 && tx.withText / info.pages >= 0.2;
    const r = $app.findRecordById("book_files", f.id);
    r.set("has_text", hasText);
    r.set("ocr", true);
    const size = F.fileSize(path);
    if (size > 0) r.set("file_size", size);
    r.set("status_note", hasText ? "" : "Распознавание почти не нашло текста: возможно, в книге одни картинки.");
    $app.save(r);
    F.syncBook(f.getString("book"));
  } catch (err) {
    try { $os.remove(tmp); } catch (_) {}
    failJob(job, "Не удалось заменить файл книги: " + String(err).slice(0, 200));
    return;
  }
  const j = $app.findRecordById("ocr_jobs", job.id);
  j.set("status", "done");
  j.set("done_pages", info.pages);
  j.set("pages", info.pages);
  j.set("sec_page", res.sec_page || 0);
  j.set("finished_at", now());
  $app.save(j);
  cleanup(job.id);
}

// Шаг очереди: раз в минуту (cron), после постановки в очередь и после отмены
function ocrTick() {
  let got = false;
  $app.store().setFunc("kn_ocr", (old) => {
    if (old && Date.now() - old < 15 * 60e3) return old;
    got = true;
    return Date.now();
  });
  if (!got) return;
  try {
    for (let guard = 0; guard < 5; guard++) {
      const running = $app.findRecordsByFilter("ocr_jobs", "status = 'running'", "created", 1, 0);
      if (running.length) {
        const job = running[0];
        const work = ocrDir(job.id);
        const res = readJson($filepath.join(work, "result.json"));
        if (res) {
          if (res.error) failJob(job, res.error);
          else finalize(job, res);
          continue; // сразу берём следующую книгу
        }
        const pid = workerPid(job);
        if (pid) {
          const p = readJson($filepath.join(work, "progress.json"));
          if (p && (p.done !== job.getInt("done_pages") || (p.sec_page && p.sec_page !== job.getFloat("sec_page")))) {
            const r = $app.findRecordById("ocr_jobs", job.id);
            r.set("done_pages", p.done || 0);
            if (p.sec_page) r.set("sec_page", p.sec_page);
            $app.save(r);
          }
          signalGroup(pid, procBusy() ? "STOP" : "CONT");
          return;
        }
        const spawned = $app.store().get("kn_ocr_spawn:" + job.id);
        if (spawned && Date.now() - spawned < 3 * 60e3) return; // только что запущен, ещё не записал номер процесса
        if (job.getInt("attempts") >= 8) { failJob(job, "Распознавание несколько раз прерывалось. Попробуйте ещё раз позже."); continue; }
        if (procBusy()) return;
        try { spawn(job); } catch (err) { failJob(job, String(err)); continue; }
        return;
      }
      if (procBusy()) return;
      const next = $app.findRecordsByFilter("ocr_jobs", "status = 'queued'", "created", 1, 0);
      if (!next.length) return;
      if (!ocrAvailable()) { failJob(next[0], "На сервере не установлена программа распознавания. Запустите обновление приложения."); continue; }
      try { spawn(next[0]); } catch (err) { failJob(next[0], String(err)); }
      return;
    }
  } finally {
    $app.store().remove("kn_ocr");
  }
}

function ocrCancel(jobId, reason) {
  let j = null;
  try { j = $app.findRecordById("ocr_jobs", jobId); } catch (_) {}
  if (!j) throw new NotFoundError("Задание не найдено.");
  const st = j.getString("status");
  if (st !== "queued" && st !== "running") throw new BadRequestError("Это распознавание уже закончилось.");
  if (st === "running") {
    const pid = workerPid(j);
    signalGroup(pid, "TERM");
    signalGroup(pid, "CONT"); // если стоял на паузе, пусть получит сигнал
  }
  j.set("status", "canceled");
  j.set("error", reason || "");
  j.set("finished_at", now());
  $app.save(j);
  cleanup(j.id);
}
// Файл убирают или обрабатывают заново: его распознавание отменяется
function ocrCancelFile(fileId, reason) {
  for (const j of $app.findRecordsByFilter("ocr_jobs", "file = {:f} && (status = 'queued' || status = 'running')", "", 0, 0, { f: fileId })) {
    try { ocrCancel(j.id, reason); } catch (_) {}
  }
}

// Для раздела «Распознавание текста» в профиле: задания с ходом работы и оценка времени
function ocrState() {
  const sec = secPerPage();
  const jobs = [];
  const add = (list) => { for (const j of list) jobs.push(j); };
  add($app.findRecordsByFilter("ocr_jobs", "status = 'running'", "created", 0, 0));
  add($app.findRecordsByFilter("ocr_jobs", "status = 'queued'", "created", 0, 0));
  add($app.findRecordsByFilter("ocr_jobs", "status != 'running' && status != 'queued'", "-finished_at", 30, 0));
  const busy = procBusy();
  const scans = allScans();
  return {
    available: ocrAvailable(),
    langs: ocrLangs(),
    sec_page: sec,
    paused: busy,
    scans: { count: scans.length, pages: scans.reduce((n, x) => n + x.f.getInt("pages"), 0) },
    jobs: jobs.map((j) => {
      const o = { id: j.id, book: j.getString("book"), file: j.getString("file"), title: j.getString("book_title"), status: j.getString("status"),
        pages: j.getInt("pages"), done: j.getInt("done_pages"), sec_page: j.getFloat("sec_page"), error: j.getString("error"),
        started_at: j.getString("started_at"), finished_at: j.getString("finished_at"), created: j.getString("created") };
      if (o.status === "running") {
        const p = readJson($filepath.join(ocrDir(j.id), "progress.json"));
        if (p) { o.done = p.done || 0; if (p.total) o.pages = p.total; if (p.sec_page) o.sec_page = p.sec_page; o.stage = p.stage; }
      }
      return o;
    }),
  };
}
// Брошенные папки распознавания и перевода (задание закончилось, а папка осталась)
function ocrCleanDirs() {
  const F = require(`${__hooks}/files_lib.js`);
  for (const base of [$filepath.join(F.booksDir(), ".ocr"), $filepath.join(F.booksDir(), ".work")]) {
    let list = [];
    try { list = $os.readDir(base); } catch (_) { continue; }
    for (const d of list) {
      const name = d.name();
      let keep = false;
      if (base.endsWith(".ocr")) {
        try { const j = $app.findRecordById("ocr_jobs", name); keep = j.getString("status") === "running" || j.getString("status") === "queued"; } catch (_) {}
      } else {
        try { keep = $app.findRecordById("book_files", name).getString("status") === "processing"; } catch (_) {}
      }
      if (!keep) { try { $os.removeAll($filepath.join(base, name)); } catch (_) {} }
    }
  }
}

module.exports = {
  VIEW, FORMATS, FMT_NAME, fmtOfName, python, toolPath, runTool, kindleDrm, convert,
  ocrLangs, ocrAvailable, ocrBook, ocrAll, ocrTick, ocrCancel, ocrCancelFile, ocrState, ocrPause, ocrCleanDirs, secPerPage, scanFiles,
};
