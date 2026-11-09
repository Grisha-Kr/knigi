#!/usr/bin/env bash
# Проверка правок 4.1 (скрытые книги и срок доступа) на чистом локальном PocketBase. Запуск из папки репозитория:
#   PB=/путь/к/pocketbase bash tools/access-check.sh
# Нужны: pocketbase 0.40.3 (лежит не в /tmp), node 18+, pdftotext и qpdf (poppler-utils, qpdf), unzip.
# Скрипт поднимает PocketBase на 127.0.0.1:8093 (порт можно сменить: PORT=8095) с отдельной папкой данных,
# запускает tools/access-check.mjs и останавливает сервер. Старую проверку этапа 4 запускайте отдельно:
#   PB=/путь/к/pocketbase bash tools/mcp-check.sh
set -uo pipefail
cd "$(dirname "$0")/.."
PB="${PB:-./pocketbase}"
PORT="${PORT:-8093}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/knigi-access-XXXXXX")"
LOG="$WORK/server.log"
export BOOKS_DIR="$WORK/books" FILES_DIR="$WORK/files" KN_BASE="http://127.0.0.1:$PORT" CONTACT_EMAIL="owner@example.com"
unset APP_URL APP_TZ_OFFSET
[ -x "$PB" ] || { echo "Не найден PocketBase: $PB (укажите PB=/путь/к/pocketbase)"; exit 2; }
"$PB" serve --http "127.0.0.1:$PORT" --dir "$WORK/pb_data" --publicDir pb_public --hooksDir pb_hooks --migrationsDir pb_migrations >>"$LOG" 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null; wait $pid 2>/dev/null' EXIT
for _ in $(seq 1 50); do curl -s -o /dev/null "$KN_BASE/api/health" && break; sleep 0.2; done
node tools/access-check.mjs "$@"; code=$?
[ "$code" = 0 ] && echo "Все проверки прошли. Папка с данными проверки: $WORK" || echo "Есть ошибки. Журнал сервера: $LOG"
exit $code
