#!/usr/bin/env bash
# GameDeck для Proxmox VE: создаёт LXC-контейнер с Docker и поднимает в нём GameDeck
# (Caddy с HTTPS + приложение + PostgreSQL из deploy/compose.yml).
#
# Запуск на хосте PVE от root:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/Futli/GameDeck/main/deploy/proxmox/gamedeck-lxc.sh)"
#
# Скрипт задаёт вопросы, Enter оставляет значение в скобках. Любой параметр можно задать заранее,
# а YES=1 отвечает на все вопросы по умолчанию:
#   YES=1 CTID=120 DOMAIN=game.example.com bash gamedeck-lxc.sh
set -euo pipefail

REPO_URL=${REPO_URL:-https://github.com/Futli/GameDeck.git}
BRANCH=${BRANCH:-main}
# Запасной вариант, если get.docker.com недоступен (например, из РФ): docker.io из Debian + этот compose.
COMPOSE_VERSION=${COMPOSE_VERSION:-v2.29.7}

msg() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m ✓\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ask VAR "вопрос" "значение по умолчанию"
ask() {
  local var=$1 prompt=$2 def=$3 answer
  if [[ -n ${!var:-} ]]; then return; fi
  if [[ ${YES:-0} == 1 || ! -t 0 ]]; then
    printf -v "$var" '%s' "$def"
    return
  fi
  read -rp "$prompt [$def]: " answer
  printf -v "$var" '%s' "${answer:-$def}"
}

[[ $EUID -eq 0 ]] || die "Нужен root"
if ! command -v pct >/dev/null || ! command -v pveam >/dev/null; then die "Запускать на хосте Proxmox VE"; fi

# --- 1. Параметры ---
msg "Параметры контейнера"
ask CTID "ID контейнера" "$(pvesh get /cluster/nextid)"
pct status "$CTID" &>/dev/null && die "Контейнер $CTID уже существует"
ask CT_HOSTNAME "Имя хоста" "gamedeck"
ask CORES "Ядер CPU" "2"
ask MEMORY "Память, МБ" "2048"
ask DISK "Диск, ГБ" "10"
ask STORAGE "Хранилище для диска" "$(pvesm status -content rootdir | awk 'NR==2 {print $1}')"
ask TEMPLATE_STORAGE "Хранилище для шаблонов" "$(pvesm status -content vztmpl | awk 'NR==2 {print $1}')"
ask BRIDGE "Сетевой мост" "vmbr0"
ask NET "IP контейнера: dhcp или адрес/маска, например 192.168.1.50/24" "dhcp"
# shellcheck disable=SC2153 # NET задаёт ask
if [[ $NET != dhcp ]]; then
  ask GATEWAY "Шлюз" "$(ip route | awk '/^default/ {print $3; exit}')"
fi

PUBLIC_IP=$(curl -fsS --max-time 5 https://ipv4.icanhazip.com 2>/dev/null || true)
DEFAULT_DOMAIN=${PUBLIC_IP:+${PUBLIC_IP//./-}.sslip.io}
ask DOMAIN "Домен игры (A-запись на белый IP; без домена подойдёт IP-через-дефисы.sslip.io)" "${DEFAULT_DOMAIN:-gamedeck.example.com}"
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-$(openssl rand -hex 24)}

# --- 2. Шаблон Debian ---
msg "Шаблон Debian"
# Сначала ищем уже скачанный шаблон: так скрипт не ходит в сеть вовсе.
if [[ -z ${TEMPLATE:-} ]]; then
  TEMPLATE=$(pveam list "$TEMPLATE_STORAGE" | awk '/debian-1[2-9]-standard/ {sub(/.*\//, "", $1); print $1}' | sort -V | tail -n1)
fi
if [[ -n $TEMPLATE ]] && pveam list "$TEMPLATE_STORAGE" | grep -q "$TEMPLATE"; then
  ok "Уже скачан: $TEMPLATE"
else
  # pveam update/download не имеют таймаутов и из РФ могут висеть часами,
  # поэтому качаем curl'ом по очереди с нескольких зеркал.
  TEMPLATE_MIRRORS=${TEMPLATE_MIRRORS:-"http://download.proxmox.com/images/system https://mirrors.ustc.edu.cn/proxmox/images/system"}
  for mirror in $TEMPLATE_MIRRORS; do
    msg "Пробую $mirror"
    if [[ -z ${TEMPLATE:-} ]]; then
      TEMPLATE=$(curl -fsS --connect-timeout 10 --max-time 30 "$mirror/" 2>/dev/null \
        | grep -o 'debian-1[2-9]-standard_[^"<>]*_amd64\.tar\.zst' | sort -uV | tail -n1 || true)
      [[ -n $TEMPLATE ]] || { echo "   список шаблонов не получен"; continue; }
    fi
    dest=$(pvesm path "$TEMPLATE_STORAGE:vztmpl/$TEMPLATE")
    mkdir -p "$(dirname "$dest")"
    # Обрываем загрузку, если она меньше 10 КБ/с дольше минуты.
    if curl -fL --progress-bar --connect-timeout 15 --speed-limit 10240 --speed-time 60 \
      -o "$dest.part" "$mirror/$TEMPLATE"; then
      mv "$dest.part" "$dest"
      break
    fi
    rm -f "$dest.part"
  done
  [[ -n ${TEMPLATE:-} && -s $(pvesm path "$TEMPLATE_STORAGE:vztmpl/$TEMPLATE") ]] \
    || die "Не удалось скачать шаблон Debian. Скачайте его в веб-интерфейсе PVE (local → CT Templates) и запустите скрипт снова"
  ok "Скачан: $TEMPLATE"
fi

# --- 3. Контейнер ---
msg "Создаю контейнер $CTID"
NET0="name=eth0,bridge=$BRIDGE,ip=$NET"
if [[ $NET != dhcp ]]; then NET0+=",gw=$GATEWAY"; fi
# nesting и keyctl нужны, чтобы внутри непривилегированного LXC работал Docker.
pct create "$CTID" "$TEMPLATE_STORAGE:vztmpl/$TEMPLATE" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" --memory "$MEMORY" --swap 512 \
  --rootfs "$STORAGE:$DISK" \
  --net0 "$NET0" \
  --unprivileged 1 --features nesting=1,keyctl=1 \
  --onboot 1 --tags gamedeck >/dev/null
pct start "$CTID"

for _ in $(seq 60); do
  pct exec "$CTID" -- getent hosts github.com &>/dev/null && break
  sleep 1
done
pct exec "$CTID" -- getent hosts github.com &>/dev/null || die "В контейнере нет сети или DNS"
ok "Контейнер запущен"

# --- 4. Docker и GameDeck внутри ---
msg "Ставлю Docker и GameDeck (несколько минут)"
pct exec "$CTID" -- env \
  DOMAIN="$DOMAIN" POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  REPO_URL="$REPO_URL" BRANCH="$BRANCH" COMPOSE_VERSION="$COMPOSE_VERSION" \
  bash -s <<'SETUP'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git openssl >/dev/null

if ! command -v docker >/dev/null; then
  # download.docker.com из РФ может быть закрыт — тогда docker.io из репозитория Debian.
  if ! { curl -fsSL --max-time 30 https://get.docker.com -o /tmp/get-docker.sh \
    && timeout 600 sh /tmp/get-docker.sh >/dev/null; }; then
    echo "   get.docker.com недоступен, ставлю docker.io из Debian"
    apt-get install -y -qq docker.io >/dev/null
  fi
fi
if ! docker compose version &>/dev/null; then
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fsSL "https://github.com/docker/compose/releases/download/$COMPOSE_VERSION/docker-compose-linux-$(uname -m)" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi
systemctl enable --now docker >/dev/null

if [[ -d /opt/gamedeck/.git ]]; then
  git -C /opt/gamedeck pull --quiet
else
  git clone --quiet --depth 1 -b "$BRANCH" "$REPO_URL" /opt/gamedeck
fi
cd /opt/gamedeck/deploy
if [[ ! -f .env ]]; then
  umask 077
  printf 'DOMAIN=%s\nPOSTGRES_PASSWORD=%s\n' "$DOMAIN" "$POSTGRES_PASSWORD" > .env
fi

# Готовый образ из GHCR, если он доступен; иначе собираем из исходников.
docker compose pull -q caddy postgres
if docker compose pull -q app 2>/dev/null; then
  docker compose up -d --no-build
else
  docker compose up -d --build
fi

for _ in $(seq 90); do
  [[ $(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)") == healthy ]] && exit 0
  sleep 2
done
docker compose logs --tail 50 app
exit 1
SETUP
ok "GameDeck запущен"

CT_IP=$(pct exec "$CTID" -- hostname -I | awk '{print $1}')
cat <<EOF

Готово. Контейнер $CTID ($CT_HOSTNAME), локальный IP: $CT_IP

Осталось:
  1. На роутере пробросить на $CT_IP порты 80/tcp, 443/tcp и 443/udp.
  2. Домен $DOMAIN должен указывать на белый IP${PUBLIC_IP:+ ($PUBLIC_IP)}.
  3. Проверить: https://$DOMAIN/api/health
     Сертификат Caddy получит сам, как только заработают пп. 1–2.

Логи:       pct exec $CTID -- docker compose -f /opt/gamedeck/deploy/compose.yml logs -f
Пароль базы лежит в /opt/gamedeck/deploy/.env внутри контейнера.
EOF
