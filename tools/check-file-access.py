#!/usr/bin/env python3
# Проверка защиты файлов книг на работающем сайте (правки 4.8). Только чтение: ничего не меняет и ничего
# не пишет на диск, файлы книг целиком не скачивает (от каждого ответа читает не больше 64 КБ).
#
# Запуск на сервере (или на Mac, если указать адрес):
#   python3 /opt/knigi/src/tools/check-file-access.py
#   python3 tools/check-file-access.py https://knigi.grishaweb.ru
# Адрес сайта берётся из аргумента, иначе из APP_URL в /opt/knigi/knigi.env, иначе https://knigi.grishaweb.ru.
# Спросит почту и пароль администратора (пароль на экране не виден). Под администратором журнал чтения не пишется.
#
# Что проверяет: ссылка на книгу живёт 15 минут, на аудио 2 часа; без куки файл не отдаётся; кусок PDF приходит
# ровно такой, как просили, даже с заголовком If-Range (раньше так получали весь файл); кусок больше 4 МБ не отдаётся;
# файл книги и глава аудио не открываются как страница (новая вкладка), а читалка и плеер работают.
import base64
import getpass
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.dont_write_bytecode = True
READ_MAX = 64 * 1024
MB = 1024 * 1024


def site_url():
    if len(sys.argv) > 1 and sys.argv[1].startswith("http"):
        return sys.argv[1].rstrip("/")
    try:
        with open("/opt/knigi/knigi.env", encoding="utf-8") as f:
            for line in f:
                if line.startswith("APP_URL="):
                    v = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if v:
                        return v.rstrip("/")
    except OSError:
        pass
    return "https://knigi.grishaweb.ru"


BASE = site_url()
CTX = ssl.create_default_context()


def call(path, method="GET", data=None, headers=None):
    """Запрос к сайту: (код, заголовки, первые 64 КБ тела, длина по Content-Length или прочитанному)."""
    h = {"User-Agent": "knigi-check-file-access"}
    h.update(headers or {})
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    r = urllib.request.Request(BASE + path, data=body, headers=h, method=method)
    try:
        res = urllib.request.urlopen(r, context=CTX, timeout=60)
    except urllib.error.HTTPError as e:
        res = e
    except urllib.error.URLError as e:
        raise SystemExit("Сайт %s не отвечает: %s" % (BASE, e.reason))
    try:
        chunk = res.read(READ_MAX + 1)
    finally:
        res.close()
    cl = res.headers.get("Content-Length")
    length = int(cl) if cl and cl.isdigit() else len(chunk)
    return res.status, res.headers, chunk[:READ_MAX], length


def jwt_exp(url):
    t = urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get("t", [""])[0]
    try:
        p = t.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4))).get("exp", 0)
    except Exception:
        return 0


problems = []
checks = 0


def check(cond, good, bad):
    global checks
    checks += 1
    if cond:
        print("  ОК        " + good)
    else:
        print("  ПРОБЛЕМА  " + bad)
        problems.append(bad)


def cookie_of(headers):
    for k, v in headers.items():
        if k.lower() == "set-cookie" and v.startswith("kn_s="):
            return v.split(";")[0]
    return ""


def main():
    print("Проверка защиты файлов книг на " + BASE)
    email = input("Почта администратора: ").strip()
    password = getpass.getpass("Пароль (не отображается): ")
    st, _, b, _ = call("/api/collections/users/auth-with-password", "POST", {"identity": email, "password": password})
    password = ""
    if st != 200:
        raise SystemExit("Войти не получилось: проверьте почту и пароль.")
    auth = json.loads(b)
    if auth.get("record", {}).get("role") != "admin":
        raise SystemExit("Это не администратор. Запустите проверку с почтой администратора библиотеки.")
    T = {"Authorization": auth["token"]}

    def first_file(fmt_filter):
        q = urllib.parse.urlencode({"filter": fmt_filter + ' && status = "ready"', "perPage": 1, "sort": "-file_size"})
        s, _, body, _ = call("/api/collections/book_files/records?" + q, headers=T)
        items = json.loads(body).get("items", []) if s == 200 else []
        return items[0] if items else None

    # 1. PDF (читалка PDF: PDF и DjVu)
    pf = first_file('(format = "pdf" || format = "djvu")')
    if not pf:
        print("\nPDF в библиотеке нет, проверка PDF пропущена.")
    else:
        print("\nPDF: самый большой файл, %.1f МБ" % (pf["file_size"] / MB))
        st, hd, body, _ = call("/api/knigi/books/%s/link?f=%s" % (pf["book"], pf["format"]), headers=T)
        if st != 200:
            raise SystemExit("Ссылка на книгу не выдана: " + body.decode("utf-8", "replace")[:200])
        L = json.loads(body)
        ck = cookie_of(hd)
        left = jwt_exp(L["url"]) - time.time()
        check(L.get("ttl") == 900 and 800 < left <= 960, "ссылка на книгу живёт 15 минут",
              "ссылка на книгу живёт не 15 минут (ttl %s, осталось %d с): обновление не выложено?" % (L.get("ttl"), left))
        st, _, _, _ = call(L["url"], headers={"Range": "bytes=0-1"})
        check(st == 401, "без куки входа файл не отдаётся (401)", "без куки входа ответ %s вместо 401" % st)
        st, _, body, n = call(L["url"], headers={"Cookie": ck, "Range": "bytes=0-1", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors"})
        check(st == 206 and n == 2, "читалка получает кусок (206, 2 байта)", "обычный кусок для читалки не пришёл: ответ %s, %d байт" % (st, n))
        st, _, _, n = call(L["url"], headers={"Cookie": ck, "Range": "bytes=0-1", "If-Range": '"x"'})
        check(st == 206 and n == 2, "If-Range весь файл не отдаёт (206, 2 байта)",
              "If-Range отдал %d байт с ответом %s: дыра не закрыта" % (n, st))
        st, _, _, n = call(L["url"], headers={"Cookie": ck, "Range": "bytes=0-1", "If-Range": "Mon, 01 Jan 2001 00:00:00 GMT"})
        check(st == 206 and n == 2, "If-Range с датой тоже (206, 2 байта)", "If-Range с датой отдал %d байт с ответом %s" % (n, st))
        if pf["file_size"] > 4 * MB + 10:
            st, _, _, _ = call(L["url"], headers={"Cookie": ck, "Range": "bytes=0-%d" % (4 * MB)})
            check(st == 400, "кусок больше 4 МБ не отдаётся (400)", "кусок больше 4 МБ: ответ %s вместо 400" % st)
        st, _, _, _ = call(L["url"], headers={"Cookie": ck})
        check(st in (400, 403), "PDF без Range не отдаётся (%s)" % st, "PDF без Range: ответ %s" % st)
        st, _, _, _ = call(L["url"], headers={"Cookie": ck, "Range": "bytes=0-1", "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate"})
        check(st == 403, "адрес PDF во вкладке не открывается (403)", "адрес PDF во вкладке: ответ %s вместо 403" % st)

    # 2. EPUB (читалка EPUB: EPUB, FB2, MOBI, AZW3, TXT)
    ef = first_file('(format = "epub" || format = "fb2" || format = "mobi" || format = "azw3" || format = "txt")')
    if not ef:
        print("\nEPUB в библиотеке нет, проверка EPUB пропущена.")
    else:
        print("\nEPUB: самый большой файл, %.1f МБ" % (ef["file_size"] / MB))
        st, hd, body, _ = call("/api/knigi/books/%s/link?f=%s" % (ef["book"], ef["format"]), headers=T)
        if st == 200:
            L = json.loads(body)
            ck = cookie_of(hd)
            st, _, _, n = call(L["url"], headers={"Cookie": ck, "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate"})
            check(st == 403, "адрес EPUB во вкладке не открывается и не скачивается (403)",
                  "адрес EPUB во вкладке: ответ %s, браузер получил бы файл (%d байт)" % (st, n))
            st, _, _, n = call(L["url"], headers={"Cookie": ck, "Range": "bytes=0-9", "If-Range": '"x"', "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors"})
            check(st == 206 and n == 10, "кусок EPUB с If-Range: ровно 10 байт", "кусок EPUB с If-Range: ответ %s, %d байт" % (st, n))
        else:
            check(False, "", "ссылка на EPUB не выдана: ответ %s" % st)

    # 3. Аудио
    q = urllib.parse.urlencode({"perPage": 1, "sort": "-published,-created"})
    s, _, body, _ = call("/api/collections/audio_tracks/records?" + q, headers=T)
    items = json.loads(body).get("items", []) if s == 200 else []
    if not items:
        print("\nГлав аудио нет, проверка аудио пропущена.")
    else:
        print("\nАудио: глава «%s»" % items[0].get("title", ""))
        st, hd, body, _ = call("/api/knigi/audio/%s/link" % items[0]["id"], headers=T)
        if st == 200:
            L = json.loads(body)
            ck = cookie_of(hd)
            left = jwt_exp(L["url"]) - time.time()
            check(L.get("ttl") == 7200 and left > 7000, "ссылка на аудио по-прежнему 2 часа", "ссылка на аудио: ttl %s" % L.get("ttl"))
            st, _, _, n = call(L["url"], headers={"Cookie": ck, "Range": "bytes=0-1", "Sec-Fetch-Dest": "audio", "Sec-Fetch-Mode": "no-cors"})
            check(st == 206 and n == 2, "плеер приложения получает главу (206)", "плеер приложения: ответ %s" % st)
            st, _, _, n = call(L["url"], headers={"Cookie": ck, "Range": "bytes=0-1", "User-Agent": "AppleCoreMedia/1.0.0 (iPhone; U; CPU OS 18_0 like Mac OS X)"})
            check(st == 206, "плеер iPhone без заголовков Sec-Fetch получает главу (206)", "плеер iPhone: ответ %s" % st)
            st, _, _, _ = call(L["url"], headers={"Cookie": ck, "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate"})
            check(st == 403, "адрес главы во вкладке не открывается (403)", "адрес главы во вкладке: ответ %s вместо 403" % st)
        else:
            check(False, "", "ссылка на главу не выдана: ответ %s" % st)

    print("\nПроверок: %d." % checks)
    if problems:
        print("Что не так:")
        for p in problems:
            print("  - " + p)
        sys.exit(1)
    print("Защита работает.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nПроверка прервана.")
        sys.exit(130)
