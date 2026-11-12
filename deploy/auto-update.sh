#!/usr/bin/env bash
# Автообновление GameDeck: сервер сам проверяет, появился ли в main новый коммит
# с готовым образом, и переходит на него. Запускается таймером systemd раз в 2 минуты
# (ставит deploy/install-auto-update.sh).
#
# Почему сервер тянет сам, а не GitHub заходит по SSH: сервер стоит за чужим роутером.
# Чтобы GitHub мог зайти, пришлось бы открыть SSH в интернет и хранить ключ в GitHub.
# Здесь наружу не открыто ничего: сервер только скачивает.
set -euo pipefail

REPO_DIR=${REPO_DIR:-/opt/gamedeck}
IMAGE=${IMAGE:-ghcr.io/futli/gamedeck}
STATE_FILE="$REPO_DIR/deploy/.deployed"

cd "$REPO_DIR"
git fetch --quiet origin main
target=$(git rev-parse origin/main)
[[ -f $STATE_FILE && $(<"$STATE_FILE") == "$target" ]] && exit 0

# Образ собирает GitHub Actions и только после зелёных тестов. Образа ещё нет —
# значит, сборка идёт или тесты упали: остаёмся на старой версии и проверим позже.
if ! docker manifest inspect "$IMAGE:$target" >/dev/null 2>&1; then
  echo "Образ $IMAGE:$target ещё не готов, жду"
  exit 0
fi

echo "Обновляю до $target"
# compose.yml и Caddyfile берутся из того же коммита, что и образ.
git reset --hard --quiet "$target"
cd deploy
APP_IMAGE="$IMAGE:$target" docker compose pull --quiet app
# Та же версия под меткой latest: её берут команды compose, запущенные руками без APP_IMAGE.
# Без этого ручной `docker compose up -d` вернул бы приложение на старый локальный latest.
docker tag "$IMAGE:$target" "$IMAGE:latest"
APP_IMAGE="$IMAGE:$target" docker compose up -d --no-build --remove-orphans

# Новая версия должна ответить на проверку здоровья. Коммит записывается только после этого:
# если не ответила, таймер попробует снова, а в журнале останутся логи приложения.
for _ in $(seq 60); do
  if [[ $(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)") == healthy ]]; then
    echo "$target" > "$STATE_FILE"
    docker image prune -f >/dev/null
    echo "Готово: $target"
    exit 0
  fi
  sleep 2
done
echo "Приложение не стало healthy после обновления до $target" >&2
docker compose logs --tail 50 app >&2
exit 1
