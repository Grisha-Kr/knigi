#!/usr/bin/env bash
# Установка «Библиотеки» на сервер Ubuntu 22.04 / 24.04 рядом с другими приложениями.
#
# Запуск (от root):
#   curl -fsSL https://raw.githubusercontent.com/Grisha-Kr/knigi/main/deploy/install.sh | bash -s -- АДРЕС ПОЧТА "ВАШЕ ИМЯ"
#
#   АДРЕС  — полный адрес приложения без https, например knigi.grishaweb.ru
#   ПОЧТА  — ваша почта: вход в панель администратора и контакт в политике конфиденциальности
#   ИМЯ    — как указать вас в политике конфиденциальности (оператор данных)
#
# Как устроен сервер (рассчитан на несколько приложений):
#   Caddy принимает все запросы на портах 80/443, сам получает сертификаты https
#   и по адресу направляет запрос в нужное приложение.
#   Каждое приложение: своя папка /opt/ИМЯ, свой порт на 127.0.0.1, своя служба systemd,
#   свой файл /etc/caddy/sites/ИМЯ.caddy.
#
# Общий файл /etc/caddy/Caddyfile этот скрипт НЕ меняет: в нём настройки для всех сайтов
# сервера. Скрипт только проверяет, что в нём есть строка import /etc/caddy/sites/*.caddy,
# и кладёт свой файл сайта рядом с остальными.
#
# Повторный запуск безопасен: обновит код и программу, данные, книги и настройки не тронет.

set -euo pipefail

APP="knigi"               # имя приложения: папка, служба, пользователь
PORT="8093"               # внутренний порт (8090 «Зачётка», 8091 «Молитвенный дневник», 8092 «Греческий курс»)
PB_VERSION="0.40.3"
REPO_URL="${REPO_URL:-https://github.com/Grisha-Kr/knigi.git}"
APP_DIR="/opt/$APP"
CADDYFILE="/etc/caddy/Caddyfile"
IMPORT_LINE="import /etc/caddy/sites/*.caddy"

DOMAIN="${1:-}"
CONTACT="${2:-}"
OWNER="${3:-}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || fail "запустите команду от имени root (сначала подключитесь к серверу)."
[ -n "$DOMAIN" ] || fail "не указан адрес. Пример: bash install.sh knigi.grishaweb.ru me@yandex.ru \"Иван Иванов\""
[ -n "$CONTACT" ] || fail "не указана почта."
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%/}"

say "Свободное место на диске сервера"
df -h / | sed 's/^/  /'
echo "  Книги займут 10-13 ГБ. Приложение не примет новую книгу, если свободно меньше 5 ГБ (настройка MIN_FREE_GB)."

say "1/8. Устанавливаю нужные программы"
# poppler-utils: обложка, число страниц и текст PDF; qpdf: пересборка PDF для быстрого открытия;
# djvulibre-bin: число страниц и обложка DjVu; unzip: обложка и данные EPUB.
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git unzip curl ufw openssl ca-certificates caddy poppler-utils qpdf djvulibre-bin >/dev/null

say "2/8. Проверяю общие настройки Caddy"
# Общий Caddyfile не трогаем: он обслуживает и другие сайты сервера.
if [ ! -f "$CADDYFILE" ] || ! grep -qF "$IMPORT_LINE" "$CADDYFILE"; then
  echo "  В файле $CADDYFILE нет строки:"
  echo "    $IMPORT_LINE"
  echo "  Без неё Caddy не увидит адрес нового приложения. Этот скрипт общий файл не меняет,"
  echo "  чтобы не сломать другие сайты на сервере."
  echo "  Покажите помощнику вывод команды  cat $CADDYFILE"
  exit 1
fi
echo "  Строка подключения сайтов на месте, общий файл не меняю."

say "3/8. Проверяю, что адрес $DOMAIN указывает на этот сервер"
MY_IP="$(curl -fsS4 --max-time 10 https://ifconfig.me 2>/dev/null || curl -fsS4 --max-time 10 https://api.ipify.org 2>/dev/null || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
if [ -n "$MY_IP" ] && [ "$MY_IP" != "$DNS_IP" ]; then
  echo "  Адрес $DOMAIN сейчас указывает на «${DNS_IP:-никуда}», а у сервера IP $MY_IP."
  echo "  Добавьте A-запись в настройках домена и подождите 15–60 минут, потом запустите команду снова."
  echo "  Если уверены, что всё настроено, добавьте SKIP_DNS_CHECK=1 перед командой."
  [ "${SKIP_DNS_CHECK:-0}" = "1" ] || exit 1
fi
# Порт должен быть свободен или уже занят этим же приложением
if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN && ! systemctl is-active --quiet "$APP"; then
  fail "порт $PORT уже занят другой программой. Покажите помощнику вывод команды: ss -ltnp | grep $PORT"
fi

say "4/8. Загружаю код приложения"
id "$APP" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP"
mkdir -p "$APP_DIR"
if [ -d "$APP_DIR/src/.git" ]; then
  git -c safe.directory="$APP_DIR/src" -C "$APP_DIR/src" pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$APP_DIR/src"
fi

say "5/8. Устанавливаю PocketBase $PB_VERSION"
case "$(dpkg --print-architecture)" in
  amd64) ARCH=amd64 ;;
  arm64) ARCH=arm64 ;;
  *) fail "неподдерживаемая архитектура процессора $(dpkg --print-architecture)." ;;
esac
if ! "$APP_DIR/pocketbase" --version 2>/dev/null | grep -q "$PB_VERSION"; then
  TMP_ZIP="$(mktemp --suffix=.zip)"
  curl -fsSL -o "$TMP_ZIP" "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${ARCH}.zip"
  unzip -o -q "$TMP_ZIP" pocketbase -d "$APP_DIR"
  rm -f "$TMP_ZIP"
  chmod +x "$APP_DIR/pocketbase"
fi

# Настройки. Файл создаётся один раз; при повторной установке в него только дописываются
# новые настройки, которых в нём ещё нет. Свои значения вы меняете сами, потом systemctl restart knigi.
ENV="$APP_DIR/$APP.env"
[ -f "$ENV" ] || : > "$ENV"
add_setting() { # имя значение комментарий
  grep -q "^$1=" "$ENV" || printf '\n# %s\n%s=%s\n' "$3" "$1" "$2" >> "$ENV"
}
add_setting APP_URL "https://$DOMAIN" "Адрес приложения: из него строятся ссылки в письмах."
add_setting OWNER_NAME "$OWNER" "Оператор персональных данных (виден в политике конфиденциальности)."
add_setting CONTACT_EMAIL "$CONTACT" "Почта для связи (видна в политике конфиденциальности)."
add_setting BEHIND_PROXY 1 "Приложение стоит за Caddy: настоящий адрес посетителя берётся из заголовка X-Forwarded-For. Не менять."
add_setting BOOKS_DIR "$APP_DIR/books" "Папка с файлами книг (внутри обложки covers и тексты text). В ежедневную копию базы не входит."
add_setting FILES_DIR "$APP_DIR/files" "Папка с файлами уроков. В ежедневную копию базы не входит."
add_setting MIN_FREE_GB 5 "Сколько гигабайт оставлять свободными на диске. Если свободно меньше, новая книга или файл не примутся."
add_setting WATERMARK 1 "Подпись на страницах книг (имя и почта читателя): 1 включена, 0 выключена. На администратора не действует."
add_setting READ_LOG 1 "Журнал чтения (кто, когда, какую книгу открывал): 1 включён, 0 выключен. Записи, которые уже есть, хранятся до срока."
add_setting READ_LOG_DAYS 180 "Сколько дней хранить журнал чтения. Более старые записи удаляются сами раз в сутки."
add_setting MAX_MB_PER_HOUR 200 "Сколько мегабайт книг в час сервер отдаёт одному читателю (по всем книгам вместе). 0 выключает ограничение. На администратора не действует."
add_setting GROUP_MAX_PER_USER 5 "Группы чтения: в скольких группах может состоять один человек (вместе с теми, что он создал)."
add_setting GROUP_MAX_MEMBERS 25 "Группы чтения: сколько участников может быть в одной группе."
add_setting GROUP_PLAN 1 "Группы чтения: план чтения у создателя группы. 1 включён, 0 спрятан (этапы в базе сохраняются)."

# Папки книг и файлов уроков лежат рядом с pb_data, а не внутри: ежедневная копия базы
# не разрастается на гигабайты.
mkdir -p "$APP_DIR/books" "$APP_DIR/files"
chmod 600 "$ENV"
chown -R "$APP:$APP" "$APP_DIR"

say "6/8. Настраиваю автозапуск приложения"
cat > "/etc/systemd/system/$APP.service" <<EOF
[Unit]
Description=$APP (PocketBase)
After=network-online.target
Wants=network-online.target

[Service]
User=$APP
Group=$APP
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/$APP.env
ExecStart=$APP_DIR/pocketbase serve --http 127.0.0.1:$PORT --dir $APP_DIR/pb_data --publicDir $APP_DIR/src/pb_public --hooksDir $APP_DIR/src/pb_hooks --migrationsDir $APP_DIR/src/pb_migrations
Restart=always
RestartSec=5
LimitNOFILE=8192

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$APP" >/dev/null 2>&1
systemctl restart "$APP"
sleep 4
systemctl is-active --quiet "$APP" || { journalctl -u "$APP" -n 30 --no-pager; fail "приложение не запустилось, текст ошибки выше."; }

say "7/8. Настраиваю адрес https://$DOMAIN"
# TLS только 1.2: в части российских сетей соединения с TLS 1.3 обрываются по дороге
# (рекомендация хостинга AdminVPS). Файлы книг (/api/knigi/f/) не сжимаются: они отдаются
# частями (Range), а сжатие ломает такие ответы и на PDF почти ничего не даёт.
# Большие файлы загружаются кусками по 8 МБ, поэтому ограничений на размер запроса здесь не нужно.
mkdir -p /etc/caddy/sites
SITE="/etc/caddy/sites/$APP.caddy"
OLD_SITE=""
[ -f "$SITE" ] && OLD_SITE="$(cat "$SITE")"
cat > "$SITE" <<EOF
$DOMAIN {
	tls {
		protocols tls1.2 tls1.2
	}
	@compress not path /api/knigi/f/*
	encode @compress zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
  caddy validate --config "$CADDYFILE" --adapter caddyfile || true
  # возвращаем как было, чтобы не сломать другие сайты
  if [ -n "$OLD_SITE" ]; then printf '%s\n' "$OLD_SITE" > "$SITE"; else rm -f "$SITE"; fi
  fail "ошибка в настройках Caddy, текст выше. Файл сайта убран, остальные сайты не затронуты."
fi

ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
systemctl enable caddy >/dev/null 2>&1
systemctl reload caddy 2>/dev/null || systemctl restart caddy

say "8/8. Создаю вход в панель администратора"
SU_FILE="$APP_DIR/superuser.txt"
if [ ! -f "$SU_FILE" ]; then
  SU_PASS="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  sudo -u "$APP" "$APP_DIR/pocketbase" superuser upsert "$CONTACT" "$SU_PASS" --dir "$APP_DIR/pb_data" >/dev/null
  printf 'Панель: https://%s/_/\nПочта: %s\nПароль: %s\n' "$DOMAIN" "$CONTACT" "$SU_PASS" > "$SU_FILE"
  chmod 600 "$SU_FILE"
fi

say "Готово!"
echo "  Приложение:   https://$DOMAIN"
echo "  Первое открытие может занять до минуты: сервер получает сертификат https."
echo "  Сразу создайте свой аккаунт: первый зарегистрированный становится администратором."
echo
echo "  Данные для входа в панель администратора лежат в файле $SU_FILE"
echo "  Посмотреть их:  cat $SU_FILE"
echo "  Настройки:      $ENV"
echo "  Обновление:     bash $APP_DIR/src/deploy/update.sh"
