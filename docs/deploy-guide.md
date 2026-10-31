# Деплой GameDeck на VPS: разбор по шагам

Цель: GameDeck доступен из интернета по `https://ваш-домен`, чтобы его можно было открыть как Telegram Mini App. Пример ниже для VPS в Нидерландах, но подойдёт любой сервер с Linux и публичным IP.

## Шаг 0. Что получится

```
Telegram / браузер ──HTTPS──▶ Caddy :443 ──HTTP──▶ app :3000 ──▶ postgres :5432
                              (сертификат)        (Node: страница, /api, /socket.io)
```

Три контейнера в `deploy/compose.yml`:

- **caddy** принимает HTTPS, сам получает и продлевает сертификат Let's Encrypt и пересылает всё в Node, включая WebSocket. Единственный, у кого открыты порты наружу (80 и 443).
- **app** — образ из `Dockerfile`: собранный сервер и клиент, один процесс на порту 3000. Миграции базы применяются при старте.
- **postgres** — база с рейтингом, монетами и магазином. Данные в томе `pgdata`, переживают пересборку и перезапуск.

Почему так:

- **Telegram требует HTTPS** с настоящим сертификатом, по голому IP или `http://` Mini App не откроется. Caddy делает это без единой строчки настроек сертификатов.
- **Порт 3000 и база наружу не открыты.** Из интернета видно только Caddy.
- **Один образ для всего.** Сервер уже умеет отдавать собранный клиент, так что отдельный nginx для статики не нужен.

## Шаг 1. Сервер

Хватит самого маленького тарифа: 1 vCPU, 1–2 ГБ RAM, 10–20 ГБ диска, Ubuntu 24.04 или Debian 12. Игры на костях почти не нагружают процессор, больше всего памяти съедает Postgres.

Нидерланды (Амстердам) удобны: низкий пинг и из России, и из Европы, Telegram оттуда доступен без ограничений. Варианты, где есть локация в Амстердаме:

- **Timeweb Cloud, Aeza** и другие провайдеры с оплатой российской картой.
- **DigitalOcean, Vultr, Linode** — нужна зарубежная карта.

Что проверить при выборе: публичный IPv4, открытые входящие порты 80 и 443, возможность поставить Docker (обычный KVM-сервер, не «хостинг сайтов»).

### Сервер в России или дома

Тоже подходит, и для игроков из России пинг даже лучше. Отличия:

- **Docker Hub из РФ недоступен.** Поэтому базовые образы в `Dockerfile` и `compose.yml` берутся с зеркала `mirror.gcr.io`, а образ приложения с `ghcr.io`. Оба открываются из РФ.
- **Нужен белый IP.** Если сервер за домашним роутером, пробросьте на него порты 80 и 443 (TCP, для HTTP/3 ещё 443/UDP), а для автодеплоя ещё и SSH.
- **Блокировка Telegram игре не мешает.** Mini App грузится с телефона игрока напрямую с нашего сервера. Доступ к `api.telegram.org` понадобится только боту (платежи Stars), и из РФ его придётся пускать через прокси.

### Proxmox: всё одной командой

Если сервер работает на Proxmox VE, шаги 3–4 делает скрипт `deploy/proxmox/gamedeck-lxc.sh`. Запуск в shell хоста PVE от root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Futli/GameDeck/main/deploy/proxmox/gamedeck-lxc.sh)"
```

Он спросит ID, ресурсы, сеть и домен (Enter оставляет значение по умолчанию), затем:

1. скачает свежий шаблон Debian и создаст непривилегированный LXC с `nesting` и `keyctl`, без них Docker в LXC не работает;
2. поставит внутри Docker (если `get.docker.com` недоступен, то `docker.io` из Debian и compose с GitHub);
3. склонирует репозиторий в `/opt/gamedeck`, создаст `deploy/.env` со случайным паролем базы и запустит compose. Если образа в GHCR нет или он закрыт, соберёт его на месте;
4. дождётся, пока приложение станет `healthy`, и покажет, какие порты пробросить на роутере.

По умолчанию: 2 ядра, 2 ГБ RAM, 10 ГБ диска, DHCP на `vmbr0`, автозапуск вместе с хостом. Без вопросов: `YES=1 DOMAIN=game.example.com bash gamedeck-lxc.sh`.

## Шаг 2. Домен

Нужно имя, которое указывает на IP сервера.

- **Свой домен**: в DNS добавить A-запись, например `gamedeck.example.com → 203.0.113.10`. Подождать, пока `ping gamedeck.example.com` начнёт отвечать с этого IP.
- **Без домена**: бесплатный `203-0-113-10.sslip.io` (IP через дефисы) сразу указывает на `203.0.113.10`. Для первых тестов хватит, но для публичного запуска лучше свой домен: у sslip.io общие лимиты Let's Encrypt, и сертификат иногда не выдаётся.

## Шаг 3. Docker и код

```bash
ssh root@203.0.113.10

# Docker с compose-плагином (официальный скрипт)
curl -fsSL https://get.docker.com | sh
# если скрипт не скачивается (например, из РФ) — пакеты дистрибутива:
# apt install -y docker.io docker-compose-v2

# Файрвол: только SSH и веб
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable

git clone https://github.com/Futli/GameDeck.git /opt/gamedeck
cd /opt/gamedeck/deploy
```

## Шаг 4. Настройки и запуск

```bash
cp .env.example .env
nano .env        # DOMAIN и POSTGRES_PASSWORD (openssl rand -hex 24)
docker compose up -d --build
```

Первая сборка занимает пару минут. Проверка:

```bash
docker compose ps                       # app и postgres: healthy
curl https://ваш-домен/api/health       # {"ok":true,"rooms":0}
docker compose logs -f app              # логи сервера
```

Если сертификат не получен, смотрите `docker compose logs caddy`: обычно это значит, что домен ещё не указывает на сервер или закрыт порт 80.

## Шаг 5. Подключить к Telegram

1. В [@BotFather](https://t.me/BotFather): `/newbot`, затем `/newapp` (или Bot Settings → Configure Mini App) и указать `https://ваш-домен`.
2. В `deploy/.env` добавить `BOT_TOKEN` (токен бота) и `TELEGRAM_APP_URL` (`https://t.me/<бот>/<short name>`), затем `docker compose up -d`.
3. Открыть бота в Telegram и запустить приложение: имя и аватар подтянутся сами.

Как это устроено и как проверить: [telegram-guide.md](telegram-guide.md). Платежи Stars — отдельная задача.

## Шаг 6. Обновление

```bash
cd /opt/gamedeck && git pull
cd deploy && docker compose up -d --build
```

Пересобирается только `app`. Комнаты живут в памяти, поэтому идущие партии при обновлении прервутся, а рейтинг, монеты и покупки останутся в базе.

### Автодеплой из GitHub

`.github/workflows/deploy.yml` делает это сам на каждый push в `main`:

1. **test** — `pnpm typecheck` и `pnpm test` (на PR тоже).
2. **image** — собирает образ и кладёт в GitHub Container Registry: `ghcr.io/futli/gamedeck:latest` и `:<sha коммита>`.
3. **deploy** — заходит на сервер по SSH, обновляет `/opt/gamedeck`, скачивает новый образ и перезапускает `app`. Сервер ничего не собирает сам, поэтому обновление занимает секунды и не ест его память.

Включается один раз:

```bash
# на сервере: отдельный ключ только для деплоя
ssh-keygen -t ed25519 -N '' -f ~/.ssh/gamedeck_deploy
cat ~/.ssh/gamedeck_deploy.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/gamedeck_deploy        # приватный ключ, скопировать в GitHub
```

В репозитории: **Settings → Secrets and variables → Actions**:

- **Variables**: `DEPLOY_HOST` — IP или домен сервера.
- **Secrets**: `DEPLOY_USER` — пользователь SSH (например `root`), `DEPLOY_SSH_KEY` — приватный ключ целиком.

Пока `DEPLOY_HOST` не задан, шаг deploy пропускается, а образ всё равно собирается. Первый запуск на сервере (шаги 3–4) делается руками: `.env` с паролем базы GitHub не хранит. Откат: Actions → нужный старый запуск → Re-run jobs, или на сервере `APP_IMAGE=ghcr.io/futli/gamedeck:<sha> docker compose up -d --no-build`.

## Шаг 7. Резервная копия базы

```bash
# снять копию
docker compose exec -T postgres pg_dump -U gamedeck gamedeck | gzip > ~/gamedeck-$(date +%F).sql.gz

# восстановить в пустую базу
gunzip -c ~/gamedeck-2026-10-30.sql.gz | docker compose exec -T postgres psql -U gamedeck gamedeck
```

Копию стоит класть по cron раз в сутки и иногда уносить с сервера.

## Без Docker

Тоже можно: Node 22 + pnpm, `pnpm install && pnpm build`, `DATABASE_URL=... pnpm start` под systemd, перед ним Caddy или nginx. Но Docker проще повторить на новом сервере и откатить.
