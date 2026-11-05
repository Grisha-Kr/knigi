#!/usr/bin/python3
# -*- coding: utf-8 -*-
"""Перевод книг в форматы читалки и распознавание текста («Библиотека», правки 3.1).

Запускает сервер (pb_hooks/convert_lib.js) с пониженным приоритетом (nice, ionice):
  djvu  ВХОД.djvu ВЫХОД.pdf --work ПАПКА      DjVu → PDF (слои как в DjVu, спрятанный текст → текстовый слой PDF)
  fb2   ВХОД ВЫХОД.epub                       FB2, .fb2.zip, .fbz → EPUB
  txt   ВХОД ВЫХОД.epub --title Т --author А  TXT (UTF-8, windows-1251, KOI8-R) → EPUB с простой обложкой
  mobi  ВХОД ВЫХОД.epub --work ПАПКА          MOBI, AZW3 → EPUB (модуль mobi из /opt/knigi/venv)
  drm   ВХОД                                  защищён ли MOBI/AZW3 (Kindle DRM)
  ocr   ВХОД.pdf ВЫХОД.pdf --work ПАПКА --langs rus+eng
                                              распознавание (ocrmypdf), ход работы в ПАПКА/progress.json
Ответ всегда одна строка JSON на stdout; ошибка: {"error": "понятное сообщение"}. Код выхода 0,
кроме внезапного сбоя самой программы.
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
import html
import uuid
import base64
from html.parser import HTMLParser
from xml.etree import ElementTree as ET


class Fail(Exception):
    """Ошибка с сообщением для человека."""


def out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def sh(args, timeout=3600, check=True, text=True, stdin=None):
    p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, text=text,
                       stdin=stdin if stdin is not None else subprocess.DEVNULL)
    if check and p.returncode != 0:
        err = p.stderr if text else p.stderr.decode("utf-8", "replace")
        raise RuntimeError("%s: код %d: %s" % (os.path.basename(args[0]), p.returncode, (err or "").strip()[-400:]))
    return p.stdout


def esc(s):
    return html.escape(str(s or ""), quote=True)


def clean_xml_text(s):
    # символы, запрещённые в XML 1.0
    return re.sub("[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]", "", s)


# ======================================================================================
# Простой EPUB 3 (с NCX для старых читалок): главы XHTML, картинки, обложка, оглавление
# ======================================================================================
EPUB_CSS = """body { margin: 0 0.4em; line-height: 1.5; }
h1, h2, h3, h4 { line-height: 1.25; margin: 1.2em 0 0.6em; text-align: center; }
h1 { font-size: 1.5em; } h2 { font-size: 1.3em; } h3 { font-size: 1.15em; } h4 { font-size: 1.05em; }
p { margin: 0; text-indent: 1.5em; text-align: justify; }
p.empty { text-indent: 0; height: 1em; }
p.subtitle { text-align: center; text-indent: 0; font-weight: bold; margin: 0.8em 0; }
.epigraph { margin: 1em 0 1em 30%; font-style: italic; }
.epigraph p, .cite p, .poem p { text-indent: 0; text-align: left; }
.cite { margin: 1em 1.5em; }
.poem { margin: 1em 0 1em 2em; }
.stanza { margin: 0.8em 0; }
.author { text-align: right; font-style: italic; text-indent: 0; }
.annotation { font-style: italic; }
.cover { text-align: center; margin: 0; padding: 0; }
.cover img { max-width: 100%; max-height: 100vh; }
img { max-width: 100%; }
table { border-collapse: collapse; margin: 1em auto; }
td, th { border: 1px solid #999; padding: 0.2em 0.4em; }
aside.note { margin: 1em 0; }
"""


class Epub:
    def __init__(self, title, authors=None, lang="ru", year="", description=""):
        self.title = title or "Без названия"
        self.authors = [a for a in (authors or []) if a]
        self.lang = lang or "ru"
        self.year = year or ""
        self.description = description or ""
        self.chapters = []   # (имя файла, заголовок или "", xhtml-тело, уровень оглавления)
        self.images = {}     # имя → (mime, bytes)
        self.cover = None    # имя картинки обложки

    def add_image(self, name, mime, data):
        self.images[name] = (mime, data)

    def add_chapter(self, title, body, level=1, name=None):
        name = name or "ch%03d.xhtml" % (len(self.chapters) + 1)
        self.chapters.append((name, title or "", body, level))
        return name

    @staticmethod
    def page(title, body, lang):
        return ('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n'
                '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="%s" xml:lang="%s">\n'
                '<head><meta charset="utf-8"/><title>%s</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n'
                '<body>\n%s\n</body>\n</html>\n') % (esc(lang), esc(lang), esc(title), clean_xml_text(body))

    def save(self, path):
        uid = "urn:uuid:" + str(uuid.uuid4())
        items, spine, nav_points = [], [], []
        if self.cover:
            items.append('<item id="cover-image" href="%s" media-type="%s" properties="cover-image"/>' % (esc(self.cover), self.images[self.cover][0]))
            items.append('<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>')
            spine.append('<itemref idref="cover"/>')
        for i, (name, title, body, level) in enumerate(self.chapters):
            items.append('<item id="c%d" href="%s" media-type="application/xhtml+xml"/>' % (i + 1, esc(name)))
            spine.append('<itemref idref="c%d"/>' % (i + 1))
            if title:
                nav_points.append((name, title, level))
        n = 0
        for name, (mime, _) in self.images.items():
            if name == self.cover:
                continue
            n += 1
            items.append('<item id="img%d" href="%s" media-type="%s"/>' % (n, esc(name), mime))
        if not nav_points and self.chapters:
            nav_points.append((self.chapters[0][0], self.title, 1))
        meta = ['<dc:identifier id="bookid">%s</dc:identifier>' % uid,
                '<dc:title>%s</dc:title>' % esc(self.title),
                '<dc:language>%s</dc:language>' % esc(self.lang),
                '<meta property="dcterms:modified">%s</meta>' % time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())]
        for a in self.authors:
            meta.append('<dc:creator>%s</dc:creator>' % esc(a))
        if self.year:
            meta.append('<dc:date>%s</dc:date>' % esc(self.year))
        if self.description:
            meta.append('<dc:description>%s</dc:description>' % esc(self.description))
        if self.cover:
            meta.append('<meta name="cover" content="cover-image"/>')
        opf = ('<?xml version="1.0" encoding="utf-8"?>\n'
               '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="%s">\n'
               '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n%s\n</metadata>\n'
               '<manifest>\n<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n'
               '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n'
               '<item id="css" href="style.css" media-type="text/css"/>\n%s\n</manifest>\n'
               '<spine toc="ncx">\n%s\n</spine>\n</package>\n') % (esc(self.lang), "\n".join(meta), "\n".join(items), "\n".join(spine))
        # оглавление с вложенностью по уровням
        nav, depth = [], 0
        for name, title, level in nav_points:
            level = max(1, min(level, depth + 1))
            if level > depth:
                nav.append("<ol>" * (level - depth))
            else:
                nav.append("</li>")
                nav.append("</ol></li>" * (depth - level))
            nav.append('<li><a href="%s">%s</a>' % (esc(name), esc(title)))
            depth = level
        if depth:
            nav.append("</li>" + "</ol></li>" * (depth - 1) + "</ol>")
        nav_x = self.page("Оглавление", '<nav epub:type="toc" id="toc"><h1>Оглавление</h1>%s</nav>' % "".join(nav), self.lang)
        pts = []
        for i, (name, title, level) in enumerate(nav_points):
            pts.append('<navPoint id="p%d" playOrder="%d"><navLabel><text>%s</text></navLabel><content src="%s"/></navPoint>' % (i + 1, i + 1, esc(title), esc(name)))
        ncx = ('<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n'
               '<head><meta name="dtb:uid" content="%s"/></head><docTitle><text>%s</text></docTitle>\n<navMap>%s</navMap>\n</ncx>\n') % (uid, esc(self.title), "".join(pts))
        tmp = path + ".part"
        with zipfile.ZipFile(tmp, "w") as z:
            z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
            zc = dict(compress_type=zipfile.ZIP_DEFLATED)
            z.writestr("META-INF/container.xml", '<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                       '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n', **zc)
            z.writestr("OEBPS/content.opf", opf, **zc)
            z.writestr("OEBPS/nav.xhtml", nav_x, **zc)
            z.writestr("OEBPS/toc.ncx", ncx, **zc)
            z.writestr("OEBPS/style.css", EPUB_CSS, **zc)
            if self.cover:
                z.writestr("OEBPS/cover.xhtml", self.page(self.title, '<div class="cover"><img src="%s" alt="Обложка"/></div>' % esc(self.cover), self.lang), **zc)
            for name, title, body, level in self.chapters:
                z.writestr("OEBPS/" + name, self.page(title or self.title, body, self.lang), **zc)
            for name, (mime, data) in self.images.items():
                z.writestr("OEBPS/" + name, data, compress_type=zipfile.ZIP_STORED)
        os.replace(tmp, path)


def image_mime(data):
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg", "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png", "png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif", "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    if data.lstrip()[:5] in (b"<?xml", b"<svg ") or b"<svg" in data[:200]:
        return "image/svg+xml", "svg"
    return "", ""


def safe_image(data):
    """Картинка для EPUB: JPEG, PNG и GIF как есть, остальное (WEBP, BMP) → PNG через Pillow. SVG не берём."""
    mime, ext = image_mime(data)
    if mime in ("image/jpeg", "image/png", "image/gif"):
        return mime, ext, data
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data))
        im.load()
        buf = io.BytesIO()
        if im.mode not in ("RGB", "L", "RGBA", "LA", "P"):
            im = im.convert("RGB")
        im.save(buf, "PNG", optimize=True)
        return "image/png", "png", buf.getvalue()
    except Exception:
        return "", "", b""


# ======================================================================================
# Обложка для TXT: название на однотонном фоне в цветах приложения
# ======================================================================================
def find_font(latin=False):
    # Literata приложения: файл только с кириллицей, поэтому для названий с латиницей сначала DejaVu
    here = os.path.dirname(os.path.abspath(__file__))
    lit = [os.path.join(here, "..", "pb_public", "fonts", "literata-cyrillic-600-normal.woff2")]
    for p in ([] if latin else lit) + [
              "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf"] + (lit if latin else []):
        if os.path.exists(p):
            yield p


def make_cover(title, author, width=800, height=1200):
    from PIL import Image, ImageDraw, ImageFont
    bg, fg, accent = (44, 74, 102), (244, 239, 230), (216, 166, 96)  # #2C4A66, #F4EFE6, охра #D8A660
    im = Image.new("RGB", (width, height), bg)
    d = ImageDraw.Draw(im)

    latin = bool(re.search(r"[A-Za-z]", (title or "") + (author or "")))

    def load(size):
        for p in find_font(latin):
            try:
                f = ImageFont.truetype(p, size)
                d.textlength("Ая", font=f)
                return f
            except Exception:
                continue
        return ImageFont.load_default()

    def wrap(text, font, maxw, maxlines):
        words, lines, cur = text.split(), [], ""
        for w in words:
            t = (cur + " " + w).strip()
            if d.textlength(t, font=font) <= maxw or not cur:
                cur = t
            else:
                lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        if len(lines) > maxlines:
            lines = lines[:maxlines]
            lines[-1] = lines[-1].rstrip(".,;: ") + "…"
        return lines

    title = re.sub(r"\s+", " ", title or "Без названия").strip()
    size = 84
    while size > 36:
        tf = load(size)
        lines = wrap(title, tf, width - 160, 7)
        if len(lines) * size * 1.25 < height * 0.55 and all(d.textlength(l, font=tf) <= width - 140 for l in lines):
            break
        size -= 6
    tf = load(size)
    lines = wrap(title, tf, width - 160, 7)
    y = int(height * 0.30)
    d.rectangle([80, y - 60, width - 80, y - 54], fill=accent)
    for l in lines:
        w = d.textlength(l, font=tf)
        d.text(((width - w) / 2, y), l, font=tf, fill=fg)
        y += int(size * 1.25)
    if author:
        af = load(44)
        for l in wrap(author, af, width - 160, 2):
            y += 20
            w = d.textlength(l, font=af)
            d.text(((width - w) / 2, y), l, font=af, fill=accent)
            y += 50
    d.rectangle([80, height - 120, width - 80, height - 114], fill=accent)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=88, optimize=True)
    return buf.getvalue()


# ======================================================================================
# TXT → EPUB
# ======================================================================================
RU_COMMON = "оеаинтсрвлкмдпуяыьгзбчйхжшюцщэфъё"


def ru_score(text):
    """Чем больше доля частых строчных русских букв среди всех кириллических, тем вернее кодировка."""
    cyr = re.findall("[Ѐ-ӿ]", text)
    if not cyr:
        return 0.0
    low = sum(1 for c in cyr if c in RU_COMMON)
    return low / len(cyr)


def decode_text(raw):
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw[3:].decode("utf-8", "replace"), "utf-8"
    if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        return raw.decode("utf-16", "replace"), "utf-16"
    try:
        return raw.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        pass
    sample = raw[:400000]
    best, enc = -1.0, "cp1251"
    for e in ("cp1251", "koi8_r", "cp866"):
        try:
            s = ru_score(sample.decode(e, "replace"))
        except Exception:
            continue
        if s > best:
            best, enc = s, e
    # текст без русских букв (например, латиница в windows-1252): cp1251 даёт ту же латиницу
    return raw.decode(enc, "replace"), {"cp1251": "windows-1251", "koi8_r": "KOI8-R", "cp866": "CP866"}[enc]


HEAD_RE = re.compile(
    r"^(?:(?:глава|часть|книга|том|раздел|chapter|part|book)\s+(?:[0-9]+|[ivxlcdm]+|[а-яё]+(?:ая|ой|ий|ое))\b.{0,80}"
    r"|пролог|эпилог|предисловие|послесловие|введение|заключение|от автора|вместо предисловия|prologue|epilogue|preface|introduction"
    r"|[ivxlcdm]{1,6}\.?|[0-9]{1,3}\.?"
    r"|(?:глава|часть)\s+[0-9]+\.?\s*.{0,60})$", re.I)


def txt_paragraphs(text):
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", "    ")
    lines = text.split("\n")
    blank = sum(1 for l in lines if not l.strip())
    paras = []
    if lines and blank > len(lines) * 0.08:
        # абзацы разделены пустыми строками, внутри абзаца переносы просто склеиваем
        cur = []
        for l in lines:
            if l.strip():
                cur.append(l.strip())
            elif cur:
                paras.append(" ".join(cur))
                cur = []
        if cur:
            paras.append(" ".join(cur))
    else:
        paras = [l.strip() for l in lines if l.strip()]
    return paras


def is_heading(p, prev_blank=True):
    s = p.strip()
    if len(s) > 90 or not s:
        return False
    if HEAD_RE.match(s):
        return True
    # строка заглавными буквами, короткая (ГЛАВА ПЕРВАЯ, ЛЕТО)
    letters = re.sub(r"[^A-Za-zА-Яа-яЁё]", "", s)
    return len(letters) >= 3 and letters.upper() == letters and len(s) <= 60 and not s.endswith((",", ";"))


def cmd_txt(src, dst, title, author):
    with open(src, "rb") as f:
        raw = f.read()
    text, enc = decode_text(raw)
    paras = txt_paragraphs(text)
    if not paras:
        raise Fail("В файле нет текста.")
    total = sum(len(p) for p in paras)
    heads = [i for i, p in enumerate(paras) if is_heading(p)]
    # главы по заголовкам, если их удалось найти и они не слишком мелкие
    use_heads = len(heads) >= 2 and total / (len(heads) + 1) >= 1500 and len(heads) <= 2000
    book = Epub(title, [author] if author else [], "ru")
    book.cover = "cover.jpg"
    try:
        book.add_image("cover.jpg", "image/jpeg", make_cover(title, author))
    except Exception:
        book.cover = None
    def body_of(ps, head=None):
        h = "<h2>%s</h2>\n" % esc(head) if head else ""
        return h + "\n".join("<p>%s</p>" % esc(p) for p in ps)
    if use_heads:
        if heads[0] > 0:
            book.add_chapter("Начало", body_of(paras[:heads[0]]))
        for k, i in enumerate(heads):
            end = heads[k + 1] if k + 1 < len(heads) else len(paras)
            # длинные главы режем дополнительно, чтобы читалка на телефоне не тормозила
            chunk, size, part = [], 0, 0
            for p in paras[i + 1:end]:
                chunk.append(p)
                size += len(p)
                if size >= 60000:
                    book.add_chapter(paras[i] if part == 0 else "", body_of(chunk, paras[i] if part == 0 else None))
                    chunk, size, part = [], 0, part + 1
            if chunk or part == 0:
                book.add_chapter(paras[i] if part == 0 else "", body_of(chunk, paras[i] if part == 0 else None))
    else:
        chunk, size, n = [], 0, 0
        for p in paras:
            chunk.append(p)
            size += len(p)
            if size >= 40000:
                n += 1
                book.add_chapter("Часть %d" % n, body_of(chunk, "Часть %d" % n if n > 1 else None))
                chunk, size = [], 0
        if chunk:
            n += 1
            book.add_chapter("Часть %d" % n, body_of(chunk, "Часть %d" % n if n > 1 else None))
    book.save(dst)
    return {"title": title, "authors": [author] if author else [], "encoding": enc, "chapters": len(book.chapters), "by_headings": use_heads}


# ======================================================================================
# FB2 → EPUB
# ======================================================================================
def fb2_bytes(src):
    with open(src, "rb") as f:
        head = f.read(4)
    if head[:2] == b"PK":
        with zipfile.ZipFile(src) as z:
            names = [n for n in z.namelist() if n.lower().endswith(".fb2")] or [n for n in z.namelist() if not n.endswith("/")]
            if not names:
                raise Fail("В архиве нет файла FB2.")
            info = z.getinfo(names[0])
            if info.file_size > 400 * 1024 * 1024:
                raise Fail("Файл FB2 в архиве слишком большой.")
            return z.read(names[0])
    with open(src, "rb") as f:
        return f.read()


def fb2_parse(data):
    """Дерево FB2. Кодировка из заголовка <?xml … encoding="windows-1251"?>; битый XML чиним."""
    m = re.match(rb'\s*<\?xml[^>]*encoding\s*=\s*["\']([A-Za-z0-9_\-]+)["\']', data)
    enc = (m.group(1).decode("ascii").lower() if m else "utf-8")
    if data.startswith(b"\xef\xbb\xbf"):
        enc, data = "utf-8", data[3:]
    # бывает, что в заголовке написано windows-1251, а файл уже в UTF-8 (его перекодировали, а заголовок забыли).
    # Русский текст в windows-1251 почти никогда не читается как правильный UTF-8, поэтому UTF-8 проверяем первым.
    try:
        text = data.decode("utf-8")
        if enc not in ("utf-8", "utf8") and re.search(rb"[\x80-\xff]", data):
            enc = "utf-8"
        else:
            text = data.decode(enc)
    except (LookupError, UnicodeDecodeError):
        try:
            text = data.decode("utf-8")
            enc = "utf-8"
        except UnicodeDecodeError:
            text, enc = decode_text(data)
    text = re.sub(r"^\s*<\?xml[^>]*\?>", "", text, count=1)
    text = clean_xml_text(text)
    # пространства имён убираем: <l:href> и xlink:href становятся просто href
    def strip_ns(t):
        t = re.sub(r"\sxmlns(:\w+)?\s*=\s*(\"[^\"]*\"|'[^']*')", "", t)
        t = re.sub(r"<(/?)[\w\-]+:([\w\-]+)", r"<\1\2", t)
        t = re.sub(r"(\s)[\w\-]+:([\w\-]+\s*=)", r"\1\2", t)
        return t
    t2 = strip_ns(text)
    try:
        return ET.fromstring(t2), enc
    except ET.ParseError:
        pass
    # частые ошибки: голый &, HTML-сущности
    t3 = re.sub(r"&(?!#\d+;|#x[0-9a-fA-F]+;|amp;|lt;|gt;|quot;|apos;)", "&amp;", t2)
    try:
        return ET.fromstring(t3), enc
    except ET.ParseError:
        pass
    return LooseTree().parse(t3), enc


class LooseTree(HTMLParser):
    """Запасной разбор «грязного» FB2: собирает дерево ElementTree, прощая незакрытые теги."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = ET.Element("FictionBook")
        self.stack = [self.root]

    def parse(self, text):
        self.feed(text)
        self.close()
        return self.root

    def handle_starttag(self, tag, attrs):
        el = ET.SubElement(self.stack[-1], tag, {k: (v or "") for k, v in attrs})
        if tag not in ("image", "empty-line"):
            self.stack.append(el)

    def handle_startendtag(self, tag, attrs):
        ET.SubElement(self.stack[-1], tag, {k: (v or "") for k, v in attrs})

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        parent = self.stack[-1]
        if len(parent):
            parent[-1].tail = (parent[-1].tail or "") + data
        else:
            parent.text = (parent.text or "") + data


def el_text(el):
    return re.sub(r"\s+", " ", "".join(el.itertext()) if el is not None else "").strip()


def child(el, name):
    if el is None:
        return None
    for c in el:
        if c.tag == name:
            return c
    return None


def children(el, name):
    return [c for c in (el if el is not None else []) if c.tag == name]


class Fb2Book:
    def __init__(self, root):
        self.root = root
        self.binaries = {}
        for b in root.iter("binary"):
            bid = b.get("id") or ""
            try:
                data = base64.b64decode(re.sub(r"\s+", "", b.text or ""), validate=False)
            except Exception:
                continue
            mime, ext, data = safe_image(data)
            if mime and bid:
                self.binaries[bid] = (mime, ext, data)
        self.used = {}      # id картинки → имя файла в EPUB
        self.note_ids = set()
        self.id_file = {}   # id элемента → файл главы (для ссылок на примечания)

    def img_name(self, href):
        bid = (href or "").lstrip("#")
        if bid not in self.binaries:
            return ""
        if bid not in self.used:
            mime, ext, data = self.binaries[bid]
            self.used[bid] = "img%03d.%s" % (len(self.used) + 1, ext)
        return self.used[bid]

    def inline(self, el):
        """Содержимое абзаца: текст, выделения, ссылки, картинки."""
        parts = [esc(el.text or "")]
        for c in el:
            t = c.tag
            inner = self.inline(c)
            if t in ("emphasis", "i", "em"):
                parts.append("<em>%s</em>" % inner)
            elif t in ("strong", "b"):
                parts.append("<strong>%s</strong>" % inner)
            elif t in ("strikethrough", "s"):
                parts.append("<s>%s</s>" % inner)
            elif t in ("sub", "sup"):
                parts.append("<%s>%s</%s>" % (t, inner, t))
            elif t == "code":
                parts.append("<code>%s</code>" % inner)
            elif t == "a":
                href = c.get("href") or ""
                if href.startswith("#"):
                    parts.append('<a href="@@%s@@"%s>%s</a>' % (esc(href[1:]), ' epub:type="noteref"' if c.get("type") == "note" else "", inner))
                elif re.match(r"^(https?|mailto):", href):
                    parts.append('<a href="%s">%s</a>' % (esc(href), inner))
                else:
                    parts.append(inner)
            elif t == "image":
                n = self.img_name(c.get("href"))
                if n:
                    parts.append('<img src="%s" alt=""/>' % n)
            else:
                parts.append(inner)
            parts.append(esc(c.tail or ""))
        return "".join(parts)

    def idattr(self, el):
        i = el.get("id")
        return ' id="%s"' % esc(i) if i else ""

    def block(self, el, depth, file_name):
        """Блочный элемент раздела в XHTML."""
        t = el.tag
        if el.get("id"):
            self.id_file[el.get("id")] = file_name
        if t == "p":
            return "<p%s>%s</p>" % (self.idattr(el), self.inline(el))
        if t == "empty-line":
            return '<p class="empty"></p>'
        if t == "subtitle":
            return '<p class="subtitle"%s>%s</p>' % (self.idattr(el), self.inline(el))
        if t == "title":
            h = min(depth + 1, 4)
            lines = [self.inline(p) for p in el if p.tag == "p"] or [esc(el_text(el))]
            return "<h%d%s>%s</h%d>" % (h, self.idattr(el), "<br/>".join(lines), h)
        if t == "image":
            n = self.img_name(el.get("href"))
            return '<div class="image"%s><img src="%s" alt=""/></div>' % (self.idattr(el), n) if n else ""
        if t == "epigraph":
            return '<div class="epigraph"%s>%s</div>' % (self.idattr(el), self.blocks(el, depth, file_name))
        if t == "cite":
            return '<blockquote class="cite"%s>%s</blockquote>' % (self.idattr(el), self.blocks(el, depth, file_name))
        if t == "annotation":
            return '<div class="annotation"%s>%s</div>' % (self.idattr(el), self.blocks(el, depth, file_name))
        if t == "poem":
            return '<div class="poem"%s>%s</div>' % (self.idattr(el), self.blocks(el, depth, file_name))
        if t == "stanza":
            return '<div class="stanza">%s</div>' % self.blocks(el, depth, file_name)
        if t == "v":
            return "<p%s>%s</p>" % (self.idattr(el), self.inline(el))
        if t == "text-author":
            return '<p class="author">%s</p>' % self.inline(el)
        if t == "date":
            return '<p class="author">%s</p>' % self.inline(el)
        if t == "table":
            rows = []
            for tr in el:
                cells = "".join("<%s>%s</%s>" % ("th" if td.tag == "th" else "td", self.inline(td), "th" if td.tag == "th" else "td") for td in tr if td.tag in ("td", "th"))
                rows.append("<tr>%s</tr>" % cells)
            return "<table>%s</table>" % "".join(rows)
        if t == "section":
            return '<div class="section"%s>%s</div>' % (self.idattr(el), self.blocks(el, depth + 1, file_name))
        txt = self.inline(el)
        return "<p>%s</p>" % txt if txt.strip() else ""

    def blocks(self, el, depth, file_name):
        return "\n".join(filter(None, (self.block(c, depth, file_name) for c in el)))


def cmd_fb2(src, dst):
    data = fb2_bytes(src)
    root, enc = fb2_parse(data)
    if root.tag != "FictionBook" and root.find(".//FictionBook") is not None:
        root = root.find(".//FictionBook")
    desc = root.find("description")
    ti = child(desc, "title-info")
    pi = child(desc, "publish-info")
    title = el_text(child(ti, "book-title"))
    authors = []
    for a in children(ti, "author"):
        name = " ".join(x for x in (el_text(child(a, "first-name")), el_text(child(a, "middle-name")), el_text(child(a, "last-name"))) if x)
        name = name or el_text(child(a, "nickname"))
        if name and name not in authors:
            authors.append(name)
    year = ""
    for cand in (el_text(child(pi, "year")), (child(ti, "date").get("value") if child(ti, "date") is not None else "") or "", el_text(child(ti, "date"))):
        m = re.search(r"(1[5-9]\d\d|20\d\d)", cand or "")
        if m:
            year = m.group(1)
            break
    ann = child(ti, "annotation")
    description = "\n".join(el_text(p) for p in ann if el_text(p)) if ann is not None else ""
    lang = el_text(child(ti, "lang")) or "ru"
    fb = Fb2Book(root)
    book = Epub(title or "Без названия", authors, lang[:10], year, description[:5000])
    cp = child(ti, "coverpage")
    if cp is not None:
        img = child(cp, "image")
        n = fb.img_name(img.get("href")) if img is not None else ""
        if n:
            book.cover = n
    bodies = children(root, "body")
    main = [b for b in bodies if (b.get("name") or "") not in ("notes", "comments")] or bodies[:1]
    notes = [b for b in bodies if b not in main]
    if not bodies:
        raise Fail("В файле FB2 нет текста книги (раздела body).")

    def section_title(s):
        return el_text(child(s, "title"))[:200]

    def emit_section(s, depth, intro=None):
        """Раздел верхнего уровня = отдельный файл; очень большие делятся по подразделам."""
        name = "ch%03d.xhtml" % (len(book.chapters) + 1)
        size = len("".join(s.itertext()))
        subs = children(s, "section")
        if size > 150000 and subs and depth < 3:
            head = [c for c in s if c.tag != "section"]
            body = "\n".join(filter(None, (fb.block(c, depth, name) for c in head)))
            book.add_chapter(section_title(s), (intro or "") + body, depth + 1, name)
            for sub in subs:
                emit_section(sub, depth + 1)
            return
        body = fb.blocks(s, depth, name)
        if s.get("id"):
            fb.id_file[s.get("id")] = name
            body = '<div id="%s">%s</div>' % (esc(s.get("id")), body)
        book.add_chapter(section_title(s), (intro or "") + body, depth + 1, name)

    for b in main:
        pre = []
        for c in b:
            if c.tag == "section":
                intro = None
                if pre:
                    intro = "\n".join(filter(None, (fb.block(x, 0, "ch%03d.xhtml" % (len(book.chapters) + 1)) for x in pre)))
                    pre = []
                emit_section(c, 0, intro)
            else:
                pre.append(c)
        if pre:
            name = "ch%03d.xhtml" % (len(book.chapters) + 1)
            book.add_chapter(el_text(child(b, "title"))[:200], "\n".join(filter(None, (fb.block(x, 0, name) for x in pre))), 1, name)
    for b in notes:
        name = "notes%d.xhtml" % (notes.index(b) + 1)
        parts = []
        for s in b.iter("section"):
            sid = s.get("id")
            if sid:
                fb.id_file[sid] = name
            inner = "\n".join(filter(None, (fb.block(c, 2, name) for c in s if c.tag != "section")))
            parts.append('<aside class="note"%s epub:type="footnote">%s</aside>' % (' id="%s"' % esc(sid) if sid else "", inner))
        if not parts:
            parts = [fb.blocks(b, 1, name)]
        book.add_chapter(el_text(child(b, "title"))[:200] or ("Примечания" if b.get("name") == "notes" else "Комментарии"),
                         "<h2>%s</h2>\n%s" % (esc(el_text(child(b, "title")) or ("Примечания" if b.get("name") == "notes" else "Комментарии")), "\n".join(parts)), 1, name)
    # ссылки на примечания и разделы: в какой файл ушёл нужный id
    fixed = []
    for name, ttl, body, level in book.chapters:
        body = re.sub(r"@@([^@\"]*)@@", lambda m: ("%s#%s" % (fb.id_file[m.group(1)], m.group(1)) if fb.id_file.get(m.group(1)) and fb.id_file[m.group(1)] != name
                                                  else "#" + m.group(1)) if fb.id_file.get(m.group(1)) else "#", body)
        fixed.append((name, ttl, body, level))
    book.chapters = fixed
    for bid, fname in fb.used.items():
        mime, ext, data = fb.binaries[bid]
        book.add_image(fname, mime, data)
    if not book.chapters:
        raise Fail("В файле FB2 нет текста книги.")
    book.save(dst)
    return {"title": title, "authors": authors, "year": year, "description": description[:5000], "encoding": enc,
            "chapters": len(book.chapters), "cover": bool(book.cover)}


# ======================================================================================
# MOBI, AZW3 → EPUB
# ======================================================================================
def mobi_header(src):
    """Заголовок PalmDB и первой записи: тип книги, защита, KF8."""
    with open(src, "rb") as f:
        head = f.read(78 + 8 * 4)
        if len(head) < 86:
            raise Fail("Файл повреждён или это не книга Kindle.")
        if head[:4] == b"TPZ0" or head[:3] == b"TPZ":
            return {"type": "topaz", "drm": True}
        typ = head[60:68]
        if typ not in (b"BOOKMOBI", b"TEXtREAd"):
            raise Fail("Это не книга MOBI или AZW3. Если это KFX или другой формат Kindle, сохраните книгу как MOBI или AZW3 без защиты.")
        nrec = int.from_bytes(head[76:78], "big")
        off0 = int.from_bytes(head[78:82], "big")
        f.seek(off0)
        rec0 = f.read(1024)
    enc = int.from_bytes(rec0[12:14], "big")
    kf8 = False
    if rec0[16:20] == b"MOBI":
        ver = int.from_bytes(rec0[16 + 20:16 + 24], "big") if len(rec0) > 40 else 0
        kf8 = ver == 8
    return {"type": typ.decode("ascii"), "drm": enc != 0, "records": nrec, "kf8": kf8}


def cmd_drm(src):
    try:
        h = mobi_header(src)
    except Fail as e:
        return {"drm": False, "bad": str(e)}
    return {"drm": bool(h.get("drm")), "kf8": h.get("kf8", False)}


class XhtmlWriter(HTMLParser):
    """HTML из MOBI (старый формат) → чистый XHTML: закрытые теги, без скриптов и стилей Kindle."""
    VOID = {"br", "hr", "img"}
    KEEP = {"p", "div", "span", "br", "hr", "img", "a", "b", "i", "u", "em", "strong", "s", "sub", "sup", "small", "big",
            "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li", "table", "tr", "td", "th", "tbody", "thead",
            "pre", "code", "center", "font", "dl", "dt", "dd", "cite", "q", "tt"}
    MAP = {"center": ("div", ' style="text-align:center"'), "font": ("span", ""), "big": ("span", ""), "tt": ("code", "")}

    def __init__(self, img_map):
        super().__init__(convert_charrefs=True)
        self.parts, self.stack, self.img_map, self.skip = [], [], img_map, 0
        self.ids = []
        self.since = 0  # знаков с последнего разреза: длинный текст без разрывов страниц режем сами

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("script", "style", "head"):
            self.skip += 1
            return
        if self.skip:
            return
        if tag == "mbp:pagebreak":
            self.parts.append("\x00BREAK\x00")
            return
        if tag not in self.KEEP:
            return
        if tag in ("h1", "h2", "h3") and not self.stack and self.since > 3000:
            self.parts.append("\x00BREAK\x00")
            self.since = 0
        name, extra = self.MAP.get(tag, (tag, ""))
        at = extra
        if a.get("id"):
            at += ' id="%s"' % esc(a["id"])
            self.ids.append(a["id"])
        if tag == "a":
            if a.get("filepos"):
                at += ' href="#filepos%s"' % esc(str(int(a["filepos"])))
            elif a.get("href"):
                at += ' href="%s"' % esc(a["href"])
        if tag == "img":
            src = a.get("src") or ""
            if a.get("recindex"):
                src = self.img_map.get(str(int(a["recindex"])), "")
            if not src:
                return
            at += ' src="%s" alt=""' % esc(src)
        if tag in ("td", "th") and a.get("colspan"):
            at += ' colspan="%s"' % esc(a["colspan"])
        if a.get("align") in ("center", "right", "left", "justify") and tag in ("p", "div", "h1", "h2", "h3", "h4", "td"):
            at += ' style="text-align:%s"' % a["align"]
        if tag in self.VOID:
            self.parts.append("<%s%s/>" % (name, at))
            return
        self.parts.append("<%s%s>" % (name, at))
        self.stack.append(name)

    def handle_startendtag(self, tag, attrs):
        if tag == "mbp:pagebreak":
            self.parts.append("\x00BREAK\x00")
            return
        if tag in self.VOID or tag == "a":
            self.handle_starttag(tag, attrs)
            if tag == "a" and self.stack and self.stack[-1] == "a":
                self.handle_endtag("a")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "head"):
            self.skip = max(0, self.skip - 1)
            return
        if self.skip or tag not in self.KEEP or tag in self.VOID:
            return
        name = self.MAP.get(tag, (tag, ""))[0]
        if name in self.stack:
            while self.stack:
                t = self.stack.pop()
                self.parts.append("</%s>" % t)
                if t == name:
                    break
            if self.since > 80000 and name in ("p", "div", "blockquote", "h1", "h2", "h3", "h4", "table", "ul", "ol") and len(self.stack) <= 4:
                # закрываем открытые обёртки, режем и открываем их заново в следующей части
                opened = list(self.stack)
                self.parts.extend("</%s>" % t for t in reversed(opened))
                self.parts.append("\x00BREAK\x00")
                self.parts.extend("<%s>" % t for t in opened)
                self.since = 0

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(esc(data))
            self.since += len(data)

    def result(self):
        while self.stack:
            self.parts.append("</%s>" % self.stack.pop())
        return "".join(self.parts)


def mobi7_to_epub(html_path, dst):
    """Старый MOBI: KindleUnpack (модуль mobi) отдаёт один большой HTML и картинки. Режем на части
    по разрывам страниц и собираем EPUB."""
    base = os.path.dirname(html_path)
    with open(html_path, "rb") as f:
        raw = f.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("cp1252", "replace")
    # метаданные из content.opf рядом (его пишет KindleUnpack)
    title, authors, year, description, cover_href = "", [], "", "", ""
    for root, _, files in os.walk(base):
        for fn in files:
            if fn.endswith(".opf"):
                opf = open(os.path.join(root, fn), "rb").read().decode("utf-8", "replace")
                m = re.search(r"<dc:title[^>]*>(.*?)</dc:title>", opf, re.S)
                title = html.unescape(re.sub("<[^>]+>", "", m.group(1))).strip() if m else ""
                authors = [html.unescape(re.sub("<[^>]+>", "", x)).strip() for x in re.findall(r"<dc:creator[^>]*>(.*?)</dc:creator>", opf, re.S)]
                m = re.search(r"<dc:date[^>]*>(.*?)</dc:date>", opf, re.S)
                year = (re.search(r"(1[5-9]\d\d|20\d\d)", m.group(1)) or [""])[0] if m else ""
                m = re.search(r"<dc:description[^>]*>(.*?)</dc:description>", opf, re.S)
                description = re.sub(r"\s+", " ", html.unescape(re.sub("<[^>]+>", " ", html.unescape(m.group(1))))).strip() if m else ""
                m = re.search(r'<meta\s+name="cover"\s+content="([^"]+)"', opf)
                if m:
                    cid = m.group(1)
                    mi = re.search(r'<item[^>]*id="%s"[^>]*href="([^"]+)"' % re.escape(cid), opf) or re.search(r'<item[^>]*href="([^"]+)"[^>]*id="%s"' % re.escape(cid), opf)
                    cover_href = mi.group(1) if mi else ""
    book = Epub(title or "Без названия", authors, "ru", year, description[:5000])
    img_map = {}
    imgdir = None
    for root, dirs, files in os.walk(base):
        if os.path.basename(root).lower() == "images":
            imgdir = root
    if imgdir:
        for fn in sorted(os.listdir(imgdir)):
            m = re.match(r"image0*(\d+)\.", fn) or re.match(r"0*(\d+)\.", fn)
            with open(os.path.join(imgdir, fn), "rb") as f:
                data = f.read()
            mime, ext, data = safe_image(data)
            if not mime:
                continue
            name = "img_%s.%s" % (re.sub(r"[^A-Za-z0-9_]", "_", os.path.splitext(fn)[0]), ext)
            book.add_image(name, mime, data)
            if m:
                img_map[str(int(m.group(1)))] = name
            img_map["Images/" + fn] = name
            img_map["../Images/" + fn] = name
            if cover_href and os.path.basename(cover_href) == fn:
                book.cover = name
    w = XhtmlWriter(img_map)
    w.feed(re.sub(r"(?is)<\?xml.*?\?>", "", text))
    w.close()
    body = w.result()
    # картинки по пути Images/xxx
    body = re.sub(r'src="([^"]+)"', lambda m: 'src="%s"' % img_map.get(html.unescape(m.group(1)), html.unescape(m.group(1))), body)
    pieces = [p for p in body.split("\x00BREAK\x00")]
    # слишком мелкие куски склеиваем, крупные оставляем
    chunks, cur = [], ""
    for p in pieces:
        cur += p
        if len(cur) > 20000:
            chunks.append(cur)
            cur = ""
    if cur.strip():
        chunks.append(cur)
    # id → файл для ссылок filepos
    names = ["ch%03d.xhtml" % (i + 1) for i in range(len(chunks))]
    owner = {}
    for i, c in enumerate(chunks):
        for m in re.finditer(r'id="([^"]+)"', c):
            owner[m.group(1)] = names[i]
    # цели filepos: KindleUnpack ставит <a id="fileposNNN"/>; если нет, ссылка ведёт в ближайший файл
    for i, c in enumerate(chunks):
        def fix(m):
            target = m.group(1)
            f = owner.get(target)
            if not f:
                return 'href="#"'
            return 'href="%s#%s"' % ("" if f == names[i] else f, target)
        c = re.sub(r'href="#([^"]+)"', fix, c)
        h = re.search(r"<h[1-3][^>]*>(.*?)</h[1-3]>", c, re.S)
        ttl = re.sub(r"\s+", " ", html.unescape(re.sub("<[^>]+>", "", h.group(1)))).strip()[:200] if h else ""
        book.add_chapter(ttl, c, 1, names[i])
    if not book.chapters:
        raise Fail("В книге не найден текст.")
    book.save(dst)
    return {"title": title, "authors": authors, "year": year, "description": description[:5000]}


def cmd_mobi(src, dst, work):
    h = mobi_header(src)
    if h.get("drm"):
        return {"drm": True, "error": "Эта книга защищена Kindle, загрузите версию без защиты."}
    try:
        import mobi  # модуль ставит deploy/update.sh в /opt/knigi/venv
    except ImportError:
        raise Fail("На сервере не установлен модуль для MOBI. Запустите обновление приложения ещё раз.")
    os.makedirs(work, exist_ok=True)
    os.environ["TMPDIR"] = work
    import tempfile
    tempfile.tempdir = work
    # KindleUnpack пишет много сообщений: глушим, чтобы не испортить ответ JSON
    so = sys.stdout
    sys.stdout = io.StringIO()
    try:
        tmpdir, path = mobi.extract(src)
    except Exception as e:
        sys.stdout = so
        raise Fail("Файл Kindle не удалось прочитать: %s" % str(e)[:200])
    finally:
        sys.stdout = so
    try:
        if path.lower().endswith(".epub"):
            shutil.copyfile(path, dst)
            res = {"kf8": True}
        else:
            res = mobi7_to_epub(path, dst)
            res["kf8"] = False
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    return res


# ======================================================================================
# Невидимый текстовый слой PDF (шрифт без рисунков, как у tesseract): по нему pdf.js
# строит выделяемый текст, а pdftotext достаёт текст страницы
# ======================================================================================
TOUNICODE = b"""/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identify-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
1 beginbfrange
<0000> <FFFF> <0000>
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end
"""
GLYPHLESS_TTF = "/usr/share/tesseract-ocr/5/tessdata/pdf.ttf"


def glyphless_font(pdf):
    import pikepdf
    import zlib
    from pikepdf import Name, Dictionary, Array
    cid2gid = pikepdf.Stream(pdf, zlib.compress(b"\x00\x01" * 65536))
    cid2gid.Filter = Name.FlateDecode
    fd = Dictionary(Type=Name.FontDescriptor, FontName=Name.GlyphLessFont, Flags=5, FontBBox=Array([0, 0, 500, 1000]),
                    ItalicAngle=0, Ascent=1000, Descent=-1, CapHeight=1000, StemV=80)
    if os.path.exists(GLYPHLESS_TTF):
        with open(GLYPHLESS_TTF, "rb") as f:
            ff = pikepdf.Stream(pdf, f.read())
        fd.FontFile2 = ff
    cid = Dictionary(Type=Name.Font, Subtype=Name.CIDFontType2, BaseFont=Name.GlyphLessFont,
                     CIDSystemInfo=Dictionary(Registry=pikepdf.String("Adobe"), Ordering=pikepdf.String("Identity"), Supplement=0),
                     FontDescriptor=pdf.make_indirect(fd), DW=500, CIDToGIDMap=cid2gid)
    tu = pikepdf.Stream(pdf, TOUNICODE)
    return pdf.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type0, BaseFont=Name.GlyphLessFont, Encoding=Name("/Identity-H"),
                                        DescendantFonts=Array([pdf.make_indirect(cid)]), ToUnicode=tu))


def utf16hex(s):
    return s.encode("utf-16-be").hex().upper()


# ======================================================================================
# DjVu → PDF
# ======================================================================================
def sexp_parse(s):
    """Разбор s-выражений djvused: списки, строки в кавычках, числа и слова."""
    tokens = re.finditer(r'\(|\)|"((?:[^"\\]|\\.)*)"|[^\s()"]+', s, re.S)
    stack, cur = [], []
    for m in tokens:
        t = m.group(0)
        if t == "(":
            stack.append(cur)
            cur = []
        elif t == ")":
            if not stack:
                continue
            done = cur
            cur = stack.pop()
            cur.append(done)
        elif t.startswith('"'):
            cur.append(("str", unescape_djvu(m.group(1))))
        else:
            cur.append(t)
    while stack:
        done = cur
        cur = stack.pop()
        cur.append(done)
    return cur


def unescape_djvu(s):
    def rep(m):
        c = m.group(1)
        if c[0] in "01234567":
            return chr(int(c, 8))
        return {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "a": "\a"}.get(c, c)
    raw = re.sub(r"\\([0-7]{1,3}|.)", rep, s)
    # восьмеричные коды в режиме без -u дают байты UTF-8 по одному
    try:
        return raw.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return raw


def djvu_text_pages(src):
    """Спрятанный текст DjVu постранично: {номер страницы: [строки со словами]}."""
    try:
        txt = sh(["djvused", "-u", src, "-e", "output-txt"], timeout=1800)
    except Exception:
        return {}
    pages = {}
    parts = re.split(r"(?m)^select [^\n]*# page (\d+)\s*$", txt)
    for i in range(1, len(parts), 2):
        num = int(parts[i])
        body = parts[i + 1]
        m = body.find("set-txt")
        if m < 0:
            continue
        tree = sexp_parse(body[m + 7:])
        lines = []

        def num4(node):
            try:
                return [float(node[1]), float(node[2]), float(node[3]), float(node[4])]
            except (ValueError, IndexError, TypeError):
                return None

        def strings(node):
            return " ".join(x[1] for x in node[5:] if isinstance(x, tuple))

        def walk(node):
            if not isinstance(node, list) or not node or not isinstance(node[0], str):
                return
            kind = node[0]
            box = num4(node)
            if box is None:
                return
            subs = [x for x in node[5:] if isinstance(x, list)]
            if kind == "line" or (kind in ("word", "char") and not lines_ctx):
                words = []
                for w in subs:
                    if w and w[0] in ("word", "char"):
                        b = num4(w)
                        t = strings(w) or " ".join(strings(c) for c in w[5:] if isinstance(c, list))
                        if b and t.strip():
                            words.append((b[0], b[1], b[2], b[3], t))
                if not subs:
                    t = strings(node)
                    if t.strip():
                        words = [(box[0], box[1], box[2], box[3], t)]
                # слова с одинаковой рамкой во всю строку: кладём строку целиком
                if len(words) > 1 and all(w[:4] == words[0][:4] for w in words):
                    words = [(box[0], box[1], box[2], box[3], " ".join(w[4] for w in words))]
                words.sort(key=lambda w: w[0])
                if words:
                    lines.append((box[0], box[1], box[2], box[3], words))
                return
            if not subs:
                # текст только на уровне абзаца или страницы: делим зону на строки поровну
                t = strings(node).strip()
                if t:
                    tl = [l for l in t.split("\n") if l.strip()]
                    h = (box[3] - box[1]) / max(1, len(tl))
                    for k, l in enumerate(tl):
                        y1 = box[3] - k * h
                        lines.append((box[0], y1 - h, box[2], y1, [(box[0], y1 - h, box[2], y1, l)]))
                return
            for c in subs:
                walk(c)

        lines_ctx = False
        for node in tree:
            walk(node)
        if lines:
            pages[num] = lines
    return pages


def djvu_outline(src):
    try:
        out = sh(["djvused", "-u", src, "-e", "print-outline"], timeout=300)
    except Exception:
        return []
    tree = sexp_parse(out)
    res = []

    def walk(node, depth):
        for it in node:
            if isinstance(it, list) and len(it) >= 2 and isinstance(it[0], tuple):
                title = it[0][1].strip()
                dest = it[1][1] if isinstance(it[1], tuple) else ""
                m = re.match(r"#(\d+)$", dest.strip())
                kids = []
                walk_into = [x for x in it[2:] if isinstance(x, list)]
                node_res = {"title": title[:300], "page": int(m.group(1)) if m else None, "kids": kids}
                res_stack[-1].append(node_res)
                res_stack.append(kids)
                walk(walk_into, depth + 1)
                res_stack.pop()

    res_stack = [res]
    for top in tree:
        if isinstance(top, list) and top and top[0] == "bookmarks":
            walk(top[1:], 0)
    return res


def djvu_info(src):
    """Страницы DjVu по djvudump: размер, разрешение, какие слои есть."""
    dump = sh(["djvudump", src], timeout=600)
    if "indirect" in dump.split("\n", 3)[1] if dump.count("\n") > 2 else False:
        raise Fail("Это многофайловый DjVu (страницы лежат отдельными файлами). Соберите его в один файл (djvmcvt -b) и загрузите снова.")
    pages, cur, order = [], None, 0
    for line in dump.splitlines():
        s = line.strip()
        if s.startswith("FORM:"):
            if s.startswith("FORM:DJVU"):
                order += 1
                m = re.search(r"\[P(\d+)\]", s)
                cur = {"n": int(m.group(1)) if m else order, "w": 0, "h": 0, "dpi": 300, "mask": False, "bg": None, "bgany": False,
                       "fg": None, "fgany": False}
                pages.append(cur)
            else:
                cur = None
            continue
        if cur is None:
            continue
        if s.startswith("INFO"):
            m = re.search(r"(\d+)x(\d+)", s)
            if m:
                cur["w"], cur["h"] = int(m.group(1)), int(m.group(2))
            m = re.search(r"(\d+) dpi", s)
            if m and int(m.group(1)) >= 25:
                cur["dpi"] = int(m.group(1))
        elif s.startswith(("Sjbz", "Smmr")):
            cur["mask"] = True
        elif s.startswith(("BG44", "BGjp", "BG2k")):
            cur["bgany"] = True
            m = re.search(r"(\d+)x(\d+)\s*$", s)
            if m and cur["bg"] is None:
                cur["bg"] = (int(m.group(1)), int(m.group(2)))
        elif s.startswith(("FG44", "FGjp", "FG2k", "FGbz")):
            cur["fgany"] = True
            m = re.search(r"(\d+)x(\d+)\s*$", s)
            if m and cur["fg"] is None:
                cur["fg"] = (int(m.group(1)), int(m.group(2)))
    pages.sort(key=lambda p: p["n"])
    return pages


def flat(im, limit):
    """Ровный цвет без деталей? (у совсем ровной картинки ImageStat может споткнуться на корне)"""
    from PIL import ImageStat
    try:
        return max(ImageStat.Stat(im).stddev) < limit
    except ValueError:
        return True


def is_gray(im):
    from PIL import ImageChops
    if im.mode != "RGB":
        return True
    r, g, b = im.split()
    return max(ImageChops.difference(r, g).getextrema()[1], ImageChops.difference(g, b).getextrema()[1]) <= 14


def jpeg_bytes(im, q):
    buf = io.BytesIO()
    if is_gray(im):
        im = im.convert("L")
    im.save(buf, "JPEG", quality=q, optimize=True, progressive=False)
    return buf.getvalue(), im.mode


def djvu_page_layers(src, p, work, q):
    """Слои одной страницы: маска (чёрно-белая, для JBIG2), фон (JPEG), цвет текста.
    Возвращает словарь для сборки страницы PDF."""
    from PIL import Image, ImageOps, ImageChops, ImageMath, ImageStat
    n = p["n"]
    k = 1 if p["dpi"] <= 400 else max(1, round(p["dpi"] / 300.0))  # 600 dpi → 300: на экране не видно, файл легче
    res = {"n": n, "w_pt": p["w"] * 72.0 / p["dpi"], "h_pt": p["h"] * 72.0 / p["dpi"], "mask": None, "bg": None, "fill": None, "fg": None, "fgcolor": None}
    pref = os.path.join(work, "p%05d" % n)
    if p["mask"]:
        mpath = pref + "-m.pbm"
        sh(["ddjvu", "-format=pbm", "-mode=mask", "-page=%d" % n, "-subsample=%d" % k, src, mpath], timeout=600)
        res["mask"] = mpath
        mim = Image.open(mpath)
        res["mw"], res["mh"] = mim.size
        if not p["bgany"] and not p["fgany"]:
            return res  # чисто чёрно-белая страница
        # цвет текста: средний цвет страницы под маской, крупными клетками (как слой FG44 в DjVu)
        cpath = pref + "-c.ppm"
        sh(["ddjvu", "-format=ppm", "-mode=foreground", "-page=%d" % n, "-subsample=%d" % k, src, cpath], timeout=600)
        cim = Image.open(cpath).convert("RGB")
        if cim.size != mim.size:
            cim = cim.resize(mim.size)
        on = ImageOps.invert(mim.convert("L"))  # 255 там, где текст
        r = 8
        if p["fg"]:
            r = max(2, min(16, round(mim.size[0] / max(1, p["fg"][0]))))
        a = ImageChops.multiply(cim, Image.merge("RGB", [on, on, on])).reduce(r)
        cov = on.reduce(r)
        bands = [ImageMath.eval("convert(min(a*255/max(m,1),255),'L')", a=b, m=cov) for b in a.split()]
        fg = Image.merge("RGB", bands)
        covered = cov.point(lambda v: 255 if v > 20 else 0)
        st = ImageStat.Stat(fg, mask=covered) if covered.getbbox() else None
        os.remove(cpath)
        try:
            uniform = st is None or max(st.stddev) < 10
        except ValueError:
            uniform = True
        if uniform:
            mean = st.mean if st else [0, 0, 0]
            res["fgcolor"] = [round(c / 255.0, 3) for c in mean]
        else:
            res["fg"] = fg
        if p["bgany"]:
            bpath = pref + "-b.ppm"
            bsize = p["bg"] or (max(1, p["w"] // 3), max(1, p["h"] // 3))
            args = ["ddjvu", "-format=ppm", "-mode=background", "-page=%d" % n, "-size=%dx%d" % bsize, src, bpath]
            sh(args, timeout=600)
            bim = Image.open(bpath).convert("RGB")
            st = ImageStat.Stat(bim)
            os.remove(bpath)
            if flat(bim, 4):
                mean = st.mean
                if min(mean) < 247:
                    res["fill"] = [round(c / 255.0, 3) for c in mean]  # ровный цвет бумаги
            else:
                res["bg"] = jpeg_bytes(bim, q) + bim.size
        return res
    if not p["bgany"]:
        return res  # пустая страница
    # страница без маски: картинка целиком (фото, иллюстрация), не больше 200 точек на дюйм
    kk = max(1, round(p["dpi"] / 200.0)) if p["dpi"] > 250 else 1
    cpath = pref + "-f.ppm"
    sh(["ddjvu", "-format=ppm", "-page=%d" % n, "-subsample=%d" % kk, src, cpath], timeout=600)
    im = Image.open(cpath).convert("RGB")
    os.remove(cpath)
    st = ImageStat.Stat(im)
    if flat(im, 4):
        if min(st.mean) < 247:
            res["fill"] = [round(c / 255.0, 3) for c in st.mean]
        return res
    res["bg"] = jpeg_bytes(im, q + 5) + im.size
    return res


def jbig2_batch(masks, work, tag, lossy):
    """Маски страниц пачкой в JBIG2. lossy=True: общий словарь знаков (как в DjVu, во много раз легче),
    False: без словаря, каждая страница отдельно, точно до точки."""
    if not masks:
        return None, {}
    base = os.path.join(work, tag)
    if lossy:
        sh(["jbig2", "-s", "-p", "-t", "0.9", "-b", base] + masks, timeout=1800)
        with open(base + ".sym", "rb") as f:
            glob = f.read()
        seg = {}
        for i, m in enumerate(masks):
            with open("%s.%04d" % (base, i), "rb") as f:
                seg[m] = f.read()
            os.remove("%s.%04d" % (base, i))
        os.remove(base + ".sym")
        return glob, seg
    seg = {}
    for m in masks:
        seg[m] = sh(["jbig2", "-p", m], timeout=600, text=False)
    return None, seg


def djvu_batch_pdf(layers, text, glob, seg, path):
    import pikepdf
    import zlib
    from pikepdf import Name, Dictionary, Array
    pdf = pikepdf.new()
    font = glyphless_font(pdf) if any(text.get(l["n"]) for l in layers) else None
    gref = pdf.make_stream(glob) if glob else None
    for l in layers:
        W, H = l["w_pt"], l["h_pt"]
        xo = Dictionary()
        ops = []
        if l["fill"]:
            ops.append("%.3f %.3f %.3f rg 0 0 %.2f %.2f re f" % (l["fill"][0], l["fill"][1], l["fill"][2], W, H))
        if l["bg"]:
            data, mode, bw, bh = l["bg"]
            im = pikepdf.Stream(pdf, data)
            im.Type, im.Subtype, im.Width, im.Height = Name.XObject, Name.Image, bw, bh
            im.ColorSpace = Name.DeviceGray if mode == "L" else Name.DeviceRGB
            im.BitsPerComponent, im.Filter = 8, Name.DCTDecode
            xo.Bg = im
            ops.append("q %.3f 0 0 %.3f 0 0 cm /Bg Do Q" % (W, H))
        if l["mask"]:
            mk = pikepdf.Stream(pdf, seg[l["mask"]])
            mk.Type, mk.Subtype, mk.Width, mk.Height = Name.XObject, Name.Image, l["mw"], l["mh"]
            mk.ImageMask, mk.BitsPerComponent, mk.Filter = True, 1, Name.JBIG2Decode
            if gref is not None:
                mk.DecodeParms = Dictionary(JBIG2Globals=gref)
            if l["fg"] is not None:
                fg = l["fg"]
                fs = pikepdf.Stream(pdf, zlib.compress(fg.tobytes(), 9))
                fs.Type, fs.Subtype, fs.Width, fs.Height = Name.XObject, Name.Image, fg.size[0], fg.size[1]
                fs.ColorSpace, fs.BitsPerComponent, fs.Filter = Name.DeviceRGB, 8, Name.FlateDecode
                # фильтр JBIG2Decode отдаёт 0 там, где чёрное (текст); и трафарет, и явная маска рисуют по нулям
                fs.Mask = pdf.make_indirect(mk)
                xo.Fg = fs
                ops.append("q %.3f 0 0 %.3f 0 0 cm /Fg Do Q" % (W, H))
            else:
                c = l["fgcolor"] or [0, 0, 0]
                xo.Mk = mk
                ops.append("q %.3f %.3f %.3f rg %.3f 0 0 %.3f 0 0 cm /Mk Do Q" % (c[0], c[1], c[2], W, H))
        res = Dictionary(XObject=xo)
        tl = text.get(l["n"])
        if tl and font is not None:
            sx, sy = W / l["pw"], H / l["ph"]
            body = []
            for (lx0, ly0, lx1, ly1, words) in tl:
                fs_ = max(1.0, (ly1 - ly0) * sy)
                body.append("/FT0 %.2f Tf" % fs_)
                for i, (x0, y0, x1, y1, w) in enumerate(words):
                    w = re.sub(r"\s+", " ", w).strip()
                    if not w:
                        continue
                    last = i == len(words) - 1
                    t = w if last else w + " "
                    right = x1 if last else max(x1, words[i + 1][0])
                    width = max(0.5, (right - x0) * sx)
                    nn = len(t.encode("utf-16-be")) // 2
                    tz = 100.0 * width / (nn * fs_ * 0.5)
                    body.append("1 0 0 1 %.2f %.2f Tm %.3f Tz <%s> Tj" % (x0 * sx, ly0 * sy, tz, utf16hex(t)))
            ops.append("BT 3 Tr\n" + "\n".join(body) + "\nET")
            res.Font = Dictionary(FT0=font)
        page = pdf.add_blank_page(page_size=(W, H))
        page.obj.Resources = res
        page.obj.Contents = pdf.make_stream("\n".join(ops).encode("latin-1"))
    pdf.save(path, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate)
    pdf.close()


def cmd_djvu(src, dst, work, quality=None, lossy=True):
    pages = djvu_info(src)
    if not pages:
        raise Fail("В файле DjVu не найдено страниц.")
    os.makedirs(work, exist_ok=True)
    text = djvu_text_pages(src)
    q = quality or 62
    batch, parts, failed = 16, [], 0
    src_size = os.path.getsize(src)
    t0 = time.time()
    for b0 in range(0, len(pages), batch):
        chunk = pages[b0:b0 + batch]
        layers = []
        for p in chunk:
            try:
                if not p["w"] or not p["h"]:
                    raise RuntimeError("нет размера страницы")
                l = djvu_page_layers(src, p, work, q)
            except Exception:
                failed += 1
                l = {"n": p["n"], "w_pt": (p["w"] or 2480) * 72.0 / p["dpi"], "h_pt": (p["h"] or 3508) * 72.0 / p["dpi"],
                     "mask": None, "bg": None, "fill": None, "fg": None, "fgcolor": None}
            l["pw"], l["ph"] = p["w"] or 1, p["h"] or 1
            layers.append(l)
        masks = [l["mask"] for l in layers if l["mask"]]
        glob, seg = jbig2_batch(masks, work, "b%05d" % b0, lossy)
        part = os.path.join(work, "part%05d.pdf" % b0)
        djvu_batch_pdf(layers, text, glob, seg, part)
        for m in masks:
            os.remove(m)
        parts.append(part)
        progress(work, min(len(pages), b0 + batch), len(pages), "djvu")
    if failed > max(2, len(pages) // 10):
        raise Fail("Много повреждённых страниц в DjVu (%d из %d)." % (failed, len(pages)))
    merged = os.path.join(work, "merged.pdf")
    if len(parts) == 1:
        os.replace(parts[0], merged)
    else:
        sh(["qpdf", "--empty", "--pages"] + parts + ["--", merged], timeout=3600)
        for p in parts:
            os.remove(p)
    # оглавление DjVu → закладки PDF (их показывает «Оглавление» читалки)
    outline = djvu_outline(src)
    import pikepdf
    with pikepdf.open(merged) as pdf:
        if outline:
            def items(nodes):
                res = []
                for nd in nodes:
                    pg = nd["page"]
                    it = pikepdf.OutlineItem(nd["title"] or "—", (pg - 1) if pg and 1 <= pg <= len(pdf.pages) else None)
                    it.children.extend(items(nd["kids"]))
                    res.append(it)
                return res
            try:
                with pdf.open_outline() as ol:
                    ol.root.extend(items(outline))
            except Exception:
                pass
        pdf.save(dst, object_stream_mode=pikepdf.ObjectStreamMode.generate)
    os.remove(merged)
    size = os.path.getsize(dst)
    return {"pages": len(pages), "text_pages": len(text), "failed": failed, "size": size, "src_size": src_size,
            "ratio": round(size / max(1, src_size), 2), "seconds": round(time.time() - t0, 1), "quality": q}


# ======================================================================================
# Ход работы (для DjVu и распознавания)
# ======================================================================================
def progress(work, done, total, stage, **extra):
    if not work:
        return
    d = {"done": done, "total": total, "stage": stage, "at": time.time()}
    d.update(extra)
    tmp = os.path.join(work, "progress.json.tmp")
    try:
        with open(tmp, "w") as f:
            json.dump(d, f)
        os.replace(tmp, os.path.join(work, "progress.json"))
    except OSError:
        pass


# ======================================================================================
# Распознавание текста в сканах (ocrmypdf + tesseract)
# ======================================================================================
OCR_CHUNK = 10  # страниц в одном куске: после перезапуска сервера работа продолжается с недоделанного куска


def cmd_ocr(src, dst, work, langs):
    """Распознаёт PDF кусками в папке work. Готовые куски остаются в work, поэтому после перезапуска
    сервера работа идёт дальше. Картинки страниц не меняются: к каждой странице добавляется
    невидимый текст. Итог в dst, ответ ещё и в work/result.json."""
    import pikepdf
    os.makedirs(work, exist_ok=True)
    with open(os.path.join(work, "pid"), "w") as f:
        f.write(str(os.getpid()))
    langs = re.sub(r"[^a-z_+]", "", langs or "rus+eng") or "rus+eng"
    have = set()
    try:
        have = set(sh(["tesseract", "--list-langs"], timeout=60).split()[1:])
    except Exception:
        raise Fail("На сервере не установлена программа распознавания (tesseract). Запустите обновление приложения.")
    missing = [l for l in langs.split("+") if l not in have]
    if missing:
        raise Fail("На сервере нет языка распознавания %s. Поставьте пакет tesseract-ocr-%s или поправьте OCR_LANGS." % (", ".join(missing), missing[0]))
    try:
        import ocrmypdf
    except ImportError:
        raise Fail("На сервере не установлена программа распознавания (ocrmypdf). Запустите обновление приложения.")
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import ocr_progress
    with pikepdf.open(src) as pdf:
        total = len(pdf.pages)
    t0 = time.time()
    secs = []
    ready = sum(min(total, c0 + OCR_CHUNK) - c0 for c0 in range(0, total, OCR_CHUNK) if os.path.exists(os.path.join(work, "c%05d.pdf" % (c0 + 1))))
    progress(work, ready, total, "ocr", started=t0)
    for c0 in range(0, total, OCR_CHUNK):
        a, b = c0 + 1, min(total, c0 + OCR_CHUNK)
        part = os.path.join(work, "c%05d.pdf" % a)
        if os.path.exists(part):
            continue
        cin = os.path.join(work, "in%05d.pdf" % a)
        sh(["qpdf", src, "--pages", ".", "%d-%d" % (a, b), "--", cin], timeout=1800)
        tc = time.time()

        def cb(n, a=a, b=b, tc=tc):
            if n <= 0:
                return
            sp = (time.time() - tc) / n
            progress(work, a - 1 + min(n, b - a + 1), total, "ocr", started=t0, sec_page=round(sp, 1))
        ocr_progress.CALLBACK["fn"] = cb
        tmp = part + ".part"
        try:
            ocrmypdf.ocr(cin, tmp, language=langs.split("+"), jobs=1, output_type="pdf", optimize=0,
                         skip_text=True, pdf_renderer="sandwich", tesseract_timeout=600, progress_bar=True,
                         plugins=["ocr_progress"])  # по имени модуля: тот же объект, что импортирован выше
        except Exception as e:
            raise Fail("Распознавание остановилось на страницах %d-%d: %s" % (a, b, str(e)[:200]))
        os.replace(tmp, part)
        os.remove(cin)
        secs.append((time.time() - tc) / (b - a + 1))
        progress(work, b, total, "ocr", started=t0, sec_page=round(sum(secs) / len(secs), 1))
    # куски с текстом → в исходный файл: у каждой страницы меняются только содержимое и ресурсы,
    # сама страница (её номер в оглавлении и ссылках) остаётся на месте
    progress(work, total, total, "merge", started=t0)
    tmp = dst + ".part"
    with pikepdf.open(src) as pdf:
        for c0 in range(0, total, OCR_CHUNK):
            a = c0 + 1
            with pikepdf.open(os.path.join(work, "c%05d.pdf" % a)) as part:
                for j, pg in enumerate(part.pages):
                    orig = pdf.pages[c0 + j]
                    for key in ("/Contents", "/Resources"):
                        obj = pg.obj.get(key)
                        if obj is None:
                            continue
                        if not obj.is_indirect:
                            obj = part.make_indirect(obj)
                        orig.obj[key] = pdf.copy_foreign(obj)
        pdf.save(tmp, object_stream_mode=pikepdf.ObjectStreamMode.generate)
    os.replace(tmp, dst)
    res = {"pages": total, "seconds": round(time.time() - t0, 1), "sec_page": round(sum(secs) / len(secs), 1) if secs else 0}
    return res


# ======================================================================================
# Запуск
# ======================================================================================
def main(argv):
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd")
    ap.add_argument("src")
    ap.add_argument("dst", nargs="?")
    ap.add_argument("--work", default="")
    ap.add_argument("--title", default="")
    ap.add_argument("--author", default="")
    ap.add_argument("--langs", default="rus+eng")
    ap.add_argument("--quality", type=int, default=0)
    ap.add_argument("--lossless", action="store_true")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "djvu":
            res = cmd_djvu(a.src, a.dst, a.work or (a.dst + ".work"), a.quality or None, not a.lossless)
        elif a.cmd == "fb2":
            res = cmd_fb2(a.src, a.dst)
        elif a.cmd == "txt":
            res = cmd_txt(a.src, a.dst, a.title or "Без названия", a.author)
        elif a.cmd == "mobi":
            res = cmd_mobi(a.src, a.dst, a.work or (a.dst + ".work"))
        elif a.cmd == "drm":
            res = cmd_drm(a.src)
        elif a.cmd == "ocr":
            res = cmd_ocr(a.src, a.dst, a.work, a.langs)
            
        elif a.cmd == "cover":
            with open(a.dst, "wb") as f:
                f.write(make_cover(a.title, a.author))
            res = {"ok": True}
        else:
            res = {"error": "Неизвестная команда " + a.cmd}
    except Fail as e:
        res = {"error": str(e)}
    except Exception as e:  # сбой программы: коротко, без длинной трассировки
        import traceback
        traceback.print_exc(file=sys.stderr)
        res = {"error": "Ошибка при обработке: %s" % str(e)[:300]}
    if a.cmd == "ocr" and a.work:
        # распознавание идёт в фоне отдельно от сервера: ответ он читает из файла
        try:
            with open(os.path.join(a.work, "result.json.tmp"), "w") as f:
                json.dump(res, f, ensure_ascii=False)
            os.replace(os.path.join(a.work, "result.json.tmp"), os.path.join(a.work, "result.json"))
        except OSError:
            pass
    out(res)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
