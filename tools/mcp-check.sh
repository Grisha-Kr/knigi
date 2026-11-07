#!/usr/bin/env bash
# Проверка этапа 4 (MCP и OAuth) на чистом локальном PocketBase. Запуск из папки репозитория:
#   PB=/путь/к/pocketbase bash tools/mcp-check.sh
# Нужны: pocketbase 0.40.3 (лежит не в /tmp), node 18+, pdftotext и qpdf (poppler-utils, qpdf), unzip.
# Скрипт трижды поднимает PocketBase на 127.0.0.1:8093 с отдельной папкой данных:
#   1) обычный: весь путь как Claude, ChatGPT и Perplexity и проверки отказов;
#   2) с MCP_IP_ALLOW=203.0.113.0/24: /mcp отвечает 403;
#   3) с MCP_ENABLED=0: /mcp и выдача токенов выключены.
set -uo pipefail
cd "$(dirname "$0")/.."
PB="${PB:-./pocketbase}"
PORT="${PORT:-8093}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/knigi-mcp-XXXXXX")"
LOG="$WORK/server.log"
export BOOKS_DIR="$WORK/books" FILES_DIR="$WORK/files" KN_BASE="http://127.0.0.1:$PORT" KN_LOG="$LOG"
unset APP_URL MCP_IP_ALLOW MCP_ENABLED MCP_REDIRECT_HOSTS
[ -x "$PB" ] || { echo "Не найден PocketBase: $PB (укажите PB=/путь/к/pocketbase)"; exit 2; }
pid=""
start() { # дополнительные переменные окружения
  env "$@" "$PB" serve --http "127.0.0.1:$PORT" --dir "$WORK/pb_data" --publicDir pb_public --hooksDir pb_hooks --migrationsDir pb_migrations >>"$LOG" 2>&1 &
  pid=$!
  for _ in $(seq 1 50); do curl -s -o /dev/null "$KN_BASE/api/health" && return 0; sleep 0.2; done
  echo "PocketBase не запустился:"; tail -30 "$LOG"; exit 2
}
stop() { [ -n "$pid" ] && kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; pid=""; }
trap 'stop' EXIT
code=0
start; node tools/mcp-check.mjs || code=1; stop
start MCP_IP_ALLOW=203.0.113.0/24; node tools/mcp-check.mjs --expect-ip-block || code=1; stop
start MCP_ENABLED=0; node tools/mcp-check.mjs --expect-disabled || code=1; stop
if grep -q "Отклонён адрес возврата" "$LOG"; then echo; echo "Строки журнала службы:"; grep "Отклонён адрес возврата" "$LOG" | head -3; fi
[ "$code" = 0 ] && echo "Все проверки прошли. Папка с данными проверки: $WORK" || echo "Есть ошибки. Журнал сервера: $LOG"
exit $code
