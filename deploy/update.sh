#!/usr/bin/env bash
# Обновление «Библиотеки» до последней версии кода из GitHub.
# Запуск на сервере (от root):  bash /opt/knigi/src/deploy/update.sh
#
# Как устроено (правки 3.1): скрипт сначала скачивает новую версию кода (git fetch, рабочие файлы
# пока не меняются) и сразу перезапускает сам себя уже из новой версии. Поэтому новые программы
# и настройки ставятся с первого запуска, второй запуск не нужен.
# Дальше: недостающие программы, модуль для MOBI, новые настройки, копия базы, новая версия кода,
# запуск. Если новая версия не запустилась, возвращается прежняя.
set -euo pipefail
NAME=knigi
APP=/opt/$NAME
SRC=$APP/src
ENV="$APP/$NAME.env"
[ "$(id -u)" = "0" ] || { echo "Запустите от имени root."; exit 1; }
# Папка с кодом принадлежит пользователю knigi, поэтому git нужно явно разрешить работать с ней от root.
GIT="git -c safe.directory=$SRC -C $SRC"

# ---------- 1. Новая версия скрипта ----------
if [ "${KNIGI_UPDATE_STAGE:-}" != "2" ]; then
  echo "Скачиваю новую версию кода…"
  $GIT fetch --quiet origin
  TARGET="$($GIT rev-parse '@{u}')"
  NEW="$(mktemp /tmp/knigi-update-XXXXXX)"
  if $GIT show "$TARGET:deploy/update.sh" > "$NEW" 2>/dev/null && [ -s "$NEW" ]; then
    KNIGI_UPDATE_STAGE=2 KNIGI_UPDATE_TARGET="$TARGET" exec bash "$NEW" "$@"
  fi
  rm -f "$NEW"
  echo "Не удалось взять новую версию скрипта, продолжаю этим."
  KNIGI_UPDATE_TARGET="$TARGET"
fi
TARGET="${KNIGI_UPDATE_TARGET:-}"
# временная копия скрипта убирается сама
case "$0" in /tmp/knigi-update-*) trap 'rm -f "$0"' EXIT ;; esac

# ---------- 2. Программы для обработки книг ----------
# Ставятся, только если их ещё нет. Распознавание текста: ocrmypdf и tesseract с языками из OCR_LANGS.
# jbig2: сжатие страниц DjVu при переводе в PDF. python3-venv: отдельная папка для модуля MOBI.
LANGS="rus+eng"
if [ -f "$ENV" ] && grep -q '^OCR_LANGS=' "$ENV"; then LANGS="$(grep '^OCR_LANGS=' "$ENV" | tail -1 | cut -d= -f2- | tr -d ' "'\''')"; fi
need=""
for p in pdftoppm:poppler-utils qpdf:qpdf djvused:djvulibre-bin ddjvu:djvulibre-bin unzip:unzip ocrmypdf:ocrmypdf tesseract:tesseract-ocr jbig2:jbig2; do
  command -v "${p%%:*}" >/dev/null 2>&1 || need="$need ${p#*:}"
done
/usr/bin/python3 -c 'import ensurepip' >/dev/null 2>&1 || need="$need python3-venv"
[ -f /usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf ] || need="$need fonts-dejavu-core"
for l in ${LANGS//+/ }; do
  ls /usr/share/tesseract-ocr/*/tessdata/"$l".traineddata >/dev/null 2>&1 || need="$need tesseract-ocr-${l//_/-}"
done
if [ -n "$need" ]; then
  echo "Устанавливаю программы:$need"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  # без «рекомендуемых» пакетов: они распознаванию не нужны и занимают место
  apt-get install -y -qq --no-install-recommends $need >/dev/null
fi

# ---------- 3. Модуль для книг Kindle (MOBI, AZW3) ----------
# Ставится через pip в отдельную папку /opt/knigi/venv, системный Python не трогается.
# Папка видит системные пакеты (ocrmypdf, pikepdf, Pillow). Если обновление Ubuntu сломает папку
# (например, сменится версия Python), скрипт создаст её заново.
VENV="$APP/venv"
MOBI_VER="0.3.3"
if ! "$VENV/bin/python3" -c "import mobi, ocrmypdf, pikepdf, PIL" >/dev/null 2>&1; then
  echo "Готовлю модуль для книг Kindle (MOBI, AZW3)…"
  rm -rf "$VENV"
  if /usr/bin/python3 -m venv --system-site-packages "$VENV" >/dev/null 2>&1 && \
     "$VENV/bin/pip" install --quiet --disable-pip-version-check --no-cache-dir "mobi==$MOBI_VER" >/dev/null 2>&1; then
    echo "  Готово."
  else
    echo "  Не получилось (нет доступа к pypi.org?). MOBI и AZW3 пока не будут приниматься, остальное работает. Запустите обновление ещё раз позже."
  fi
fi

# ---------- 4. Новые настройки в knigi.env ----------
# Дописываются только те, которых в файле ещё нет. Ваши значения не меняются.
add_setting() { # имя значение комментарий
  [ -f "$ENV" ] || return 0
  grep -q "^$1=" "$ENV" || printf '\n# %s\n%s=%s\n' "$3" "$1" "$2" >> "$ENV"
}
add_setting GROUP_MAX_PER_USER 5 "Группы чтения: в скольких группах может состоять один человек (вместе с теми, что он создал)."
add_setting GROUP_MAX_MEMBERS 25 "Группы чтения: сколько участников может быть в одной группе."
add_setting GROUP_PLAN 1 "Группы чтения: план чтения у создателя группы. 1 включён, 0 спрятан (этапы в базе сохраняются)."
add_setting OCR_LANGS rus+eng "Распознавание текста в сканах: языки через +. Например rus+eng+grc (древнегреческий). Для нового языка запустите обновление: оно поставит пакет tesseract-ocr-ЯЗЫК."

# ---------- 5. Копия базы и новая версия кода ----------
echo "Делаю резервную копию базы перед обновлением…"
mkdir -p "$APP/pb_data/backups"
# Если что-то пойдёт не так, приложение всё равно запустится снова.
trap 'systemctl start $NAME || true; case "$0" in /tmp/knigi-update-*) rm -f "$0" ;; esac' EXIT
systemctl stop $NAME
# В копию идёт только база. Книги и файлы уроков лежат отдельно (books, files) и не копируются:
# их оригиналы хранит владелец, плюс хостинг раз в неделю копирует весь сервер.
tar -czf "$APP/pb_data/backups/before-update-$(date +%Y%m%d-%H%M).tar.gz" -C "$APP/pb_data" data.db auxiliary.db 2>/dev/null || true

# Папки книг и файлов: если их ещё нет, создаём
mkdir -p "$APP/books" "$APP/files"

OLD="$($GIT rev-parse HEAD)"
if [ -n "$TARGET" ]; then $GIT merge --ff-only --quiet "$TARGET"; else $GIT pull --ff-only; fi
chown -R $NAME:$NAME "$APP/src" "$APP/pb_data" "$APP/books" "$APP/files"
[ -f "$ENV" ] && chown $NAME:$NAME "$ENV"

systemctl start $NAME
sleep 4
if systemctl is-active --quiet $NAME; then
  echo "Готово: приложение обновлено и работает (версия $($GIT log -1 --format=%h))."
  djvu="$(ls "$APP/books"/*.djvu 2>/dev/null | wc -l)"
  [ "$djvu" -gt 0 ] && echo "Книги DjVu ($djvu) переводятся в PDF в фоне, по одной. Это может занять несколько минут на книгу."
  exit 0
fi
journalctl -u $NAME -n 30 --no-pager
echo "Новая версия не запустилась (текст ошибки выше). Возвращаю прежнюю версию кода…"
$GIT reset --hard "$OLD" >/dev/null
chown -R $NAME:$NAME "$APP/src"
systemctl restart $NAME
sleep 4
if systemctl is-active --quiet $NAME; then
  echo "Работает прежняя версия. Покажите помощнику текст ошибки выше. Копия базы лежит в $APP/pb_data/backups."
else
  echo "Приложение не запустилось и на прежней версии. Копия базы лежит в $APP/pb_data/backups. Покажите помощнику вывод команды: journalctl -u $NAME -n 50"
fi
exit 1
