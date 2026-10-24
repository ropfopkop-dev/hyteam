#!/usr/bin/env bash
# Сервер HYTEAM на домашнем компьютере с Linux Mint / Ubuntu / Debian.
# В отличие от install.sh (VPS с белым IP) порты на роутере открывать не нужно:
# магазин выходит в интернет через туннель Cloudflare.
#
# Переезд с Windows:
#   1. На старом компьютере в папке проекта:  node deploy/transfer.mjs   → hyteam-transfer.tar.gz
#   2. На ноутбуке:  mkdir ~/hyteam && tar -xzf hyteam-transfer.tar.gz -C ~/hyteam && cd ~/hyteam
#   3. sudo bash deploy/home-server.sh
#
# Варианты адреса:
#   sudo bash deploy/home-server.sh                 — быстрый туннель: адрес …trycloudflare.com, меняется после перезагрузки
#   sudo bash deploy/home-server.sh --token ТОКЕН   — постоянный туннель Cloudflare со своим доменом (токен из панели Cloudflare)
# Повторный запуск обновляет код; база и файлы сохраняются. Данные из ./data переносятся только при первой установке
# (или с флагом --import — тогда текущая база сохраняется рядом как hyteam.db.before-import).
set -euo pipefail

APP_DIR=/opt/hyteam
DATA_DIR=/var/lib/hyteam
ENV_FILE=/etc/hyteam.env
PORT=3000
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

TOKEN=""
IMPORT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="${2:-}"; shift 2 ;;
    --import) IMPORT=1; shift ;;
    *) die "неизвестный параметр: $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "запустите через sudo: sudo bash deploy/home-server.sh"
[ -f "$SRC_DIR/server/index.js" ] || die "не найден server/index.js — запускайте скрипт из распакованной папки"
command -v apt-get >/dev/null || die "нужна Linux Mint, Ubuntu или Debian"
[ "$(uname -m)" = "x86_64" ] || die "нужен 64-битный процессор (x86_64)"
export DEBIAN_FRONTEND=noninteractive

say "Обновляю список пакетов"
apt-get update -y
apt-get install -y curl ca-certificates gnupg

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

# ---------- cloudflared ----------
if ! command -v cloudflared >/dev/null; then
  say "Устанавливаю cloudflared (туннель Cloudflare)"
  curl -fsSL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  apt-get install -y /tmp/cloudflared.deb
  rm -f /tmp/cloudflared.deb
fi

# ---------- Код ----------
id hyteam >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin hyteam
mkdir -p "$APP_DIR" "$DATA_DIR"
systemctl stop hyteam 2>/dev/null || true

say "Копирую HYTEAM в $APP_DIR"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  rm -rf "$APP_DIR/server" "$APP_DIR/public" "$APP_DIR/deploy"
  cp -r "$SRC_DIR/server" "$SRC_DIR/public" "$SRC_DIR/deploy" "$SRC_DIR/package.json" "$APP_DIR/"
  if [ -f "$SRC_DIR/package-lock.json" ]; then cp "$SRC_DIR/package-lock.json" "$APP_DIR/"; fi
fi
cd "$APP_DIR"
say "Устанавливаю зависимости"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund || npm install --omit=dev --ignore-scripts --no-audit --no-fund

# ---------- Данные со старого компьютера ----------
if [ -f "$SRC_DIR/data/hyteam.db" ] && { [ ! -f "$DATA_DIR/hyteam.db" ] || [ "$IMPORT" = 1 ]; }; then
  say "Переношу данные магазина из $SRC_DIR/data"
  if [ -f "$DATA_DIR/hyteam.db" ]; then
    mv "$DATA_DIR/hyteam.db" "$DATA_DIR/hyteam.db.before-import"
    rm -f "$DATA_DIR/hyteam.db-wal" "$DATA_DIR/hyteam.db-shm"
  fi
  cp "$SRC_DIR/data/hyteam.db" "$DATA_DIR/"
  if [ -d "$SRC_DIR/data/uploads" ]; then
    mkdir -p "$DATA_DIR/uploads"
    cp -r "$SRC_DIR/data/uploads/." "$DATA_DIR/uploads/"
  fi
fi
mkdir -p "$DATA_DIR/uploads/images" "$DATA_DIR/uploads/games" "$DATA_DIR/uploads/tmp"

# ---------- Настройки ----------
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
PORT=$PORT
HOST=0.0.0.0
DATA_DIR=$DATA_DIR
MAX_GAME_MB=0
EOF
fi
# Публикация адреса туннеля в GitHub: программа HYTEAM у друзей найдёт сервер сама.
# Токен вводится один раз и хранится только в $ENV_FILE (читает только root).
PUBLISH_REPO_DEFAULT=ropfopkop-dev/hyteam
if [ -z "$TOKEN" ] && ! grep -q '^PUBLISH_TOKEN=' "$ENV_FILE" && [ -t 0 ]; then
  echo
  echo "Чтобы друзьям не вводить адрес, сервер может публиковать его в github.com/$PUBLISH_REPO_DEFAULT."
  echo "Нужен fine-grained токен GitHub (доступ только к этому репозиторию, Contents: Read and write)."
  printf 'Вставьте токен (github_pat_…) или нажмите Enter, чтобы пропустить: '
  read -rs PUB_TOKEN || PUB_TOKEN=""
  echo
  if [ -n "$PUB_TOKEN" ]; then
    printf 'PUBLISH_REPO=%s\nPUBLISH_TOKEN=%s\n' "$PUBLISH_REPO_DEFAULT" "$PUB_TOKEN" >> "$ENV_FILE"
  fi
fi
chown root:hyteam "$ENV_FILE"
chmod 640 "$ENV_FILE"
chown -R hyteam:hyteam "$DATA_DIR"

# ---------- Автозапуск сервера ----------
say "Настраиваю автозапуск сервера"
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

# ---------- Туннель ----------
say "Настраиваю туннель в интернет"
systemctl disable --now hyteam-tunnel 2>/dev/null || true
if [ -n "$TOKEN" ]; then
  # Постоянный туннель: адрес и маршрут на http://localhost:3000 задаются в панели Cloudflare (Zero Trust → Tunnels).
  cloudflared service uninstall >/dev/null 2>&1 || true
  cloudflared service install "$TOKEN"
  rm -f /etc/systemd/system/hyteam-tunnel.service
else
  cat > /etc/systemd/system/hyteam-tunnel.service <<EOF
[Unit]
Description=HYTEAM quick tunnel (trycloudflare.com)
After=network-online.target hyteam.service
Wants=network-online.target

[Service]
ExecStart=$(command -v cloudflared) tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:$PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
fi

# Служба публикации адреса (работает от root: ей нужен журнал туннеля и токен из $ENV_FILE).
cat > /etc/systemd/system/hyteam-announce.service <<EOF
[Unit]
Description=HYTEAM: publish tunnel address to GitHub
After=network-online.target hyteam-tunnel.service
Wants=network-online.target

[Service]
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN deploy/announce.mjs
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF

# Команда, которая показывает текущий адрес магазина: hyteam-address
cat > /usr/local/bin/hyteam-address <<'EOF'
#!/bin/sh
URL="$(journalctl -u hyteam-tunnel -b --no-pager 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1)"
LAN="$(hostname -I | awk '{print $1}')"
[ -n "$URL" ] && echo "Из интернета:   $URL" || echo "Из интернета:   постоянный туннель — адрес задан в панели Cloudflare"
echo "В домашней сети: http://$LAN:3000"
EOF
chmod 755 /usr/local/bin/hyteam-address

# Ежедневная резервная копия базы (7 последних, в $DATA_DIR/backups).
cat > /etc/cron.daily/hyteam-backup <<EOF
#!/bin/sh
cd $APP_DIR && set -a && . $ENV_FILE && set +a && runuser -u hyteam -- $NODE_BIN --disable-warning=ExperimentalWarning server/backup.js >/dev/null
EOF
chmod 755 /etc/cron.daily/hyteam-backup

cat > /usr/local/bin/hyteam-make-admin <<EOF
#!/bin/sh
[ -n "\$1" ] || { echo "Использование: sudo hyteam-make-admin логин"; exit 1; }
cd $APP_DIR && set -a && . $ENV_FILE && set +a && runuser -u hyteam -- $NODE_BIN --disable-warning=ExperimentalWarning server/make-admin.js "\$1"
EOF
chmod 755 /usr/local/bin/hyteam-make-admin

# ---------- Ноутбук не засыпает ----------
say "Отключаю сон: сервер должен работать и с закрытой крышкой"
mkdir -p /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/hyteam.conf <<EOF
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
IdleAction=ignore
EOF
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1 || true

if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow $PORT/tcp >/dev/null
fi

systemctl daemon-reload
systemctl enable --now hyteam >/dev/null 2>&1
systemctl restart hyteam
if [ -z "$TOKEN" ]; then
  systemctl enable hyteam-tunnel >/dev/null 2>&1
  systemctl restart hyteam-tunnel
  if grep -q '^PUBLISH_TOKEN=' "$ENV_FILE"; then
    systemctl enable hyteam-announce >/dev/null 2>&1
    systemctl restart hyteam-announce
  fi
fi

say "Проверяю запуск"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/meta" >/dev/null 2>&1; then OK=1; break; fi
  sleep 1
done
[ "${OK:-0}" = 1 ] || die "сервер не отвечает — журнал: journalctl -u hyteam -n 50"

if [ -z "$TOKEN" ]; then
  for _ in $(seq 1 30); do
    journalctl -u hyteam-tunnel -b --no-pager 2>/dev/null | grep -q 'trycloudflare.com' && break
    sleep 1
  done
fi

say "Готово!"
hyteam-address
cat <<EOF

  В программе HYTEAM: «Подключиться» → адрес выше
  Узнать адрес снова:  hyteam-address
  Публикация адреса:   journalctl -u hyteam-announce -n 20
  Журнал сервера:      journalctl -u hyteam -f
  Перезапуск:          sudo systemctl restart hyteam
  Администратор:       sudo hyteam-make-admin логин
  Данные и бэкапы:     $DATA_DIR

EOF
