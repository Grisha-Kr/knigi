#!/usr/bin/env bash
# Проверка правок 4.1 (скрытые книги и срок доступа) и 4.8 (выдача файлов книг) на чистом локальном PocketBase.
# Запуск из папки репозитория:
#   PB=/путь/к/pocketbase bash tools/access-check.sh
# Нужны: pocketbase 0.40.3 (лежит не в /tmp), node 18+, pdftotext и qpdf (poppler-utils, qpdf), unzip.
# Скрипт поднимает PocketBase на 127.0.0.1:8093 (порт можно сменить: PORT=8095) с отдельной папкой данных,
# запускает tools/access-check.mjs, потом перезапускает сервер с MAX_MB_PER_HOUR=8 и проверяет, что счётчик
# ограничения скорости сохранился (правки 4.8), и останавливает сервер. Если установлен Playwright, перед перезапуском
# идёт проверка в браузере tools/v48-ui-check.cjs (снимки в папку KN_SHOTS, если она задана). Старую проверку этапа 4 запускайте отдельно:
#   PB=/путь/к/pocketbase bash tools/mcp-check.sh
set -uo pipefail
cd "$(dirname "$0")/.."
PB="${PB:-./pocketbase}"
PORT="${PORT:-8093}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/knigi-access-XXXXXX")"
LOG="$WORK/server.log"
export BOOKS_DIR="$WORK/books" FILES_DIR="$WORK/files" AUDIO_DIR="$WORK/audio" KN_BASE="http://127.0.0.1:$PORT" KN_DATA="$WORK/pb_data" CONTACT_EMAIL="owner@example.com"
unset APP_URL APP_TZ_OFFSET MAX_MB_PER_HOUR
[ -x "$PB" ] || { echo "Не найден PocketBase: $PB (укажите PB=/путь/к/pocketbase)"; exit 2; }
start() {
  "$PB" serve --http "127.0.0.1:$PORT" --dir "$WORK/pb_data" --publicDir pb_public --hooksDir pb_hooks --migrationsDir pb_migrations >>"$LOG" 2>&1 &
  pid=$!
  for _ in $(seq 1 50); do curl -s -o /dev/null "$KN_BASE/api/health" && break; sleep 0.2; done
}
start
trap 'kill $pid 2>/dev/null; wait $pid 2>/dev/null' EXIT
node tools/access-check.mjs "$@"; code=$?
# правки 4.8 в браузере (чтение дольше 15 минут, новая вкладка, аудио, журнал, «Убрать формат»): только если есть Playwright
if [ "$code" = 0 ] && { [ $# = 0 ] || [ "${1:-}" = c ]; }; then
  if node -e "require('playwright')" >/dev/null 2>&1; then node tools/v48-ui-check.cjs; code=$?
  else echo "Проверка в браузере пропущена: нет Playwright (npm install playwright)."; fi
fi
# правки 4.8: счётчик ограничения скорости хранится в базе и переживает перезапуск
if [ "$code" = 0 ] && { [ $# = 0 ] || [ "${1:-}" = c ]; }; then
  kill $pid 2>/dev/null; wait $pid 2>/dev/null
  MAX_MB_PER_HOUR=8 start
  node tools/access-check.mjs restart; code=$?
fi
[ "$code" = 0 ] && echo "Все проверки прошли. Папка с данными проверки: $WORK" || echo "Есть ошибки. Журнал сервера: $LOG"
exit $code
