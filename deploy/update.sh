#!/usr/bin/env bash
# Обновление «Библиотеки» до последней версии кода из GitHub.
# Запуск на сервере (от root):  bash /opt/knigi/src/deploy/update.sh
set -euo pipefail
NAME=knigi
APP=/opt/$NAME
[ "$(id -u)" = "0" ] || { echo "Запустите от имени root."; exit 1; }

# Если что-то пойдёт не так, приложение всё равно запустится снова.
trap 'systemctl start $NAME || true' EXIT

# Программы для обработки книг: если какой-то ещё нет (обновление со старой версии), ставим
need=""
for p in pdftoppm:poppler-utils qpdf:qpdf djvused:djvulibre-bin unzip:unzip; do
  command -v "${p%%:*}" >/dev/null 2>&1 || need="$need ${p#*:}"
done
if [ -n "$need" ]; then
  echo "Устанавливаю программы:$need"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $need >/dev/null
fi

echo "Делаю резервную копию базы перед обновлением…"
mkdir -p "$APP/pb_data/backups"
systemctl stop $NAME
# В копию идёт только база. Книги и файлы уроков лежат отдельно (books, files) и не копируются:
# их оригиналы хранит владелец, плюс хостинг раз в неделю копирует весь сервер.
tar -czf "$APP/pb_data/backups/before-update-$(date +%Y%m%d-%H%M).tar.gz" -C "$APP/pb_data" data.db auxiliary.db 2>/dev/null || true

# Папки книг и файлов: если их ещё нет, создаём
mkdir -p "$APP/books" "$APP/files"

echo "Загружаю новую версию кода…"
# Папка с кодом принадлежит пользователю knigi, поэтому git нужно явно разрешить работать с ней от root.
GIT="git -c safe.directory=$APP/src -C $APP/src"
OLD="$($GIT rev-parse HEAD)"
$GIT pull --ff-only
chown -R $NAME:$NAME "$APP"

systemctl start $NAME
sleep 4
if systemctl is-active --quiet $NAME; then
  echo "Готово: приложение обновлено и работает."
  exit 0
fi
journalctl -u $NAME -n 30 --no-pager
echo "Новая версия не запустилась (текст ошибки выше). Возвращаю прежнюю версию кода…"
$GIT reset --hard "$OLD" >/dev/null
chown -R $NAME:$NAME "$APP"
systemctl restart $NAME
sleep 4
if systemctl is-active --quiet $NAME; then
  echo "Работает прежняя версия. Покажите помощнику текст ошибки выше. Копия базы лежит в $APP/pb_data/backups."
else
  echo "Приложение не запустилось и на прежней версии. Копия базы лежит в $APP/pb_data/backups. Покажите помощнику вывод команды: journalctl -u $NAME -n 50"
fi
exit 1
