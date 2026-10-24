#!/usr/bin/env bash
# Установка или обновление сервера HYTEAM на VPS (Ubuntu 22.04 / 24.04, Debian 12).
# Запуск из распакованной папки проекта:
#   sudo bash deploy/install.sh              — адрес вида https://1-2-3-4.sslip.io (без своего домена)
#   sudo bash deploy/install.sh games.ru     — свой домен (A-запись домена должна указывать на IP сервера)
# Повторный запуск обновляет код и сохраняет базу, файлы игр и настройки.
set -euo pipefail

APP_DIR=/opt/hyteam
DATA_DIR=/var/lib/hyteam
ENV_FILE=/etc/hyteam.env
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "запустите через sudo: sudo bash deploy/install.sh"
[ -f "$SRC_DIR/server/index.js" ] || die "не найден server/index.js — запускайте скрипт из папки проекта"
command -v apt-get >/dev/null || die "нужна Ubuntu или Debian"
export DEBIAN_FRONTEND=noninteractive

# ---------- Адрес ----------
DOMAIN="${1:-}"
if [ -z "$DOMAIN" ] && [ -f "$ENV_FILE" ]; then
  DOMAIN="$(grep -E '^DOMAIN=' "$ENV_FILE" | cut -d= -f2- || true)"
fi
say "Обновляю список пакетов"
apt-get update -y
apt-get install -y curl ca-certificates gnupg
if [ -z "$DOMAIN" ]; then
  IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org || curl -4 -fsS --max-time 10 https://ifconfig.me || hostname -I | awk '{print $1}')"
  [ -n "$IP" ] || die "не удалось узнать внешний IP — укажите домен: sudo bash deploy/install.sh games.ru"
  DOMAIN="${IP//./-}.sslip.io"
fi
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN%%/*}"
echo "Адрес магазина: https://$DOMAIN"

# ---------- Node.js ----------
node_ok() {
  command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'
}
if ! node_ok; then
  say "Устанавливаю Node.js 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node_ok || die "не удалось установить Node.js 22.13+"
NODE_BIN="$(command -v node)"

# ---------- Caddy (HTTPS-сертификаты Let's Encrypt получает сам) ----------
if ! command -v caddy >/dev/null; then
  say "Устанавливаю Caddy"
  if ! apt-get install -y caddy; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
  fi
fi

# ---------- Пользователь, код, зависимости ----------
id hyteam >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin hyteam
mkdir -p "$APP_DIR" "$DATA_DIR"

say "Копирую HYTEAM в $APP_DIR"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  rm -rf "$APP_DIR/server" "$APP_DIR/public" "$APP_DIR/deploy"
  cp -r "$SRC_DIR/server" "$SRC_DIR/public" "$SRC_DIR/deploy" "$SRC_DIR/package.json" "$APP_DIR/"
  if [ -f "$SRC_DIR/package-lock.json" ]; then cp "$SRC_DIR/package-lock.json" "$APP_DIR/"; fi
fi
cd "$APP_DIR"
say "Устанавливаю зависимости"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund || npm install --omit=dev --ignore-scripts --no-audit --no-fund

# ---------- Настройки ----------
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
DOMAIN=$DOMAIN
PORT=3000
HOST=127.0.0.1
DATA_DIR=$DATA_DIR
COOKIE_SECURE=1
MAX_GAME_MB=0
EOF
else
  if grep -q '^DOMAIN=' "$ENV_FILE"; then sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" "$ENV_FILE"; else echo "DOMAIN=$DOMAIN" >> "$ENV_FILE"; fi
fi
chown root:hyteam "$ENV_FILE"
chmod 640 "$ENV_FILE"
chown -R hyteam:hyteam "$DATA_DIR"
PORT="$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2-)"
PORT="${PORT:-3000}"

# ---------- Автозапуск ----------
say "Настраиваю автозапуск (systemd)"
cat > /etc/systemd/system/hyteam.service <<EOF
[Unit]
Description=HYTEAM game store
After=network-online.target
Wants=network-online.target

[Service]
User=hyteam
Group=hyteam
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN --disable-warning=ExperimentalWarning server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

# Ежедневная резервная копия базы (хранятся 7 последних, в $DATA_DIR/backups).
cat > /etc/cron.daily/hyteam-backup <<EOF
#!/bin/sh
cd $APP_DIR && set -a && . $ENV_FILE && set +a && runuser -u hyteam -- $NODE_BIN --disable-warning=ExperimentalWarning server/backup.js >/dev/null
EOF
chmod 755 /etc/cron.daily/hyteam-backup

# Команда для назначения администратора: sudo hyteam-make-admin логин
cat > /usr/local/bin/hyteam-make-admin <<EOF
#!/bin/sh
[ -n "\$1" ] || { echo "Использование: sudo hyteam-make-admin логин"; exit 1; }
cd $APP_DIR && set -a && . $ENV_FILE && set +a && runuser -u hyteam -- $NODE_BIN --disable-warning=ExperimentalWarning server/make-admin.js "\$1"
EOF
chmod 755 /usr/local/bin/hyteam-make-admin

# ---------- HTTPS ----------
say "Настраиваю HTTPS для $DOMAIN"
if [ -f /etc/caddy/Caddyfile ] && ! grep -q '# HYTEAM' /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
fi
cat > /etc/caddy/Caddyfile <<EOF
# HYTEAM — создано deploy/install.sh
$DOMAIN {
	reverse_proxy 127.0.0.1:$PORT
}
EOF

if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi

systemctl daemon-reload
systemctl enable hyteam >/dev/null 2>&1
systemctl restart hyteam
systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy

say "Проверяю запуск"
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/meta" >/dev/null 2>&1; then OK=1; break; fi
  sleep 1
done
[ "${OK:-0}" = 1 ] || die "сервер не отвечает — смотрите журнал: journalctl -u hyteam -n 50"

say "Готово!"
cat <<EOF

  Магазин:            https://$DOMAIN
  (сертификат HTTPS выпускается при первом открытии — подождите до минуты)

  В программе HYTEAM: «Подключиться» → $DOMAIN
  Первый зарегистрированный аккаунт станет владельцем магазина.

  Журнал:             journalctl -u hyteam -f
  Перезапуск:         systemctl restart hyteam
  Администратор:      sudo hyteam-make-admin логин
  Данные и бэкапы:    $DATA_DIR

EOF
